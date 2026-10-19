// The show's stems: separate tracks of the song (drums, bass, vocals, …), each analysed
// (stemAnalysis.js, in a Web Worker) and kept with the project in programmer.stems so
// reopening the show needs no re-analysis. Only the curves are stored, not the audio.
import { useCallback, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import { analyzeStem, guessRole, STEM_ROLES, STEM_VERSION } from './stemAnalysis';
import { decodeSong, hashFile } from './musicSync';
import { splitSong, SPLIT_RATE } from './stemSplit';
import { uid } from './showModel';

export const MAX_STEMS = 8;

/** Analyse samples in a Web Worker (inline when workers are unavailable). */
export function analyzeStemInWorker(samples, rate, role) {
  if (typeof Worker === 'undefined') return Promise.resolve(analyzeStem(samples, rate, role));
  return new Promise((resolve, reject) => {
    let worker;
    const inline = () => { try { resolve(analyzeStem(samples, rate, role)); } catch (error) { reject(error); } };
    try { worker = new Worker(new URL('./stemAnalysis.worker.js', import.meta.url), { type: 'module' }); }
    catch { inline(); return; }
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.error) reject(new Error(data.error)); else resolve(data.analysis); };
    worker.onerror = () => { worker.terminate(); inline(); };
    worker.postMessage({ id: 1, samples, rate, role });
  });
}

export function readStems(programmer) {
  const list = programmer?.stems?.items;
  return Array.isArray(list) ? list.filter((s) => s?.analysis?.version === STEM_VERSION && STEM_ROLES[s.role]) : [];
}

/** Programmer document with `stems` replacing the current list (and the mix graph, when given). */
export function withStems(programmer, stems, mix = undefined) {
  const keep = mix === undefined ? programmer?.stems?.mix : mix;
  return { ...(programmer || {}), stems: { items: stems.slice(0, MAX_STEMS), ...(keep ? { mix: keep } : {}) } };
}

/** The whole-song frequency graph (from Split the song), or null. */
export function readMix(programmer) {
  const mix = programmer?.stems?.mix;
  return mix?.analysis?.bands ? mix : null;
}

function save(stems, mix = undefined) {
  const project = useProjectStore.getState();
  project.rememberProgrammer(withStems(project.programmer, stems, mix));
}

/** Analyse files into stem records; a role is guessed from each file name. */
export async function analyzeStemFiles(files, { decode = (f) => decodeSong(f, SPLIT_RATE), analyze = analyzeStemInWorker, hash = hashFile, roleOf = null } = {}) {
  const out = [];
  for (const file of files) {
    const role = roleOf?.(file) || guessRole(file.name);
    const { samples, rate } = await decode(file);
    const analysis = await analyze(samples, rate, role);
    out.push({ id: uid('stem'), role, name: file.name || role, hash: await hash(file), analysis, analyzedAt: Date.now() });
  }
  return out;
}

/** Split a whole song into estimated drums / bass / vocals in a Web Worker. */
export function splitInWorker(samples, rate, onProgress = null) {
  if (typeof Worker === 'undefined') return Promise.resolve(splitSong(samples, rate, onProgress));
  return new Promise((resolve, reject) => {
    let worker;
    const inline = () => { try { resolve(splitSong(samples, rate, onProgress)); } catch (error) { reject(error); } };
    try { worker = new Worker(new URL('./stemSplit.worker.js', import.meta.url), { type: 'module' }); }
    catch { inline(); return; }
    worker.onmessage = ({ data }) => {
      if (data.progress != null) { onProgress?.(data.progress); return; }
      worker.terminate();
      if (data.error) reject(new Error(data.error)); else resolve(data.stems);
    };
    worker.onerror = () => { worker.terminate(); inline(); };
    worker.postMessage({ id: 1, samples, rate });
  });
}

/** Stem records estimated from one song file. */
export async function splitSongFile(file, { decode = (f) => decodeSong(f, SPLIT_RATE), split = splitInWorker, onProgress = null } = {}) {
  const { samples, rate } = await decode(file);
  const parts = await split(samples, rate, onProgress);
  const name = file?.name || 'song';
  const stems = ['drums', 'bass', 'vocals'].map((role) => ({
    id: uid('stem'), role, name: `${STEM_ROLES[role].label} · from ${name}`, split: true, analysis: parts[role], analyzedAt: Date.now(),
  }));
  return { stems, mix: { name, analysis: parts.mix } };
}

/** Stems of the show + actions for the builder. */
export function useStems() {
  const programmer = useProjectStore((s) => s.programmer);
  const stems = readStems(programmer);
  const [state, setState] = useState({ status: 'idle', error: '', done: 0, total: 0 });
  const add = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /^audio\//.test(f.type || '') || /\.(wav|mp3|flac|ogg|m4a|aac|aif|aiff)$/i.test(f.name || ''));
    if (!files.length) return;
    setState({ status: 'working', error: '', done: 0, total: files.length });
    try {
      const added = [];
      for (const f of files) {
        added.push(...await analyzeStemFiles([f]));
        setState((s) => ({ ...s, done: s.done + 1 }));
      }
      // A new stem of the same role replaces the old one.
      const roles = new Set(added.map((s) => s.role));
      save([...readStems(useProjectStore.getState().programmer).filter((s) => !roles.has(s.role)), ...added]);
      setState({ status: 'idle', error: '', done: 0, total: 0 });
    } catch (error) {
      setState({ status: 'error', error: error.message || 'Could not read the stem', done: 0, total: 0 });
    }
  }, []);
  const setRole = useCallback((id, role) => {
    const list = readStems(useProjectStore.getState().programmer);
    const stem = list.find((s) => s.id === id);
    if (!stem || !STEM_ROLES[role]) return;
    // Re-label; drums need their kick/hat lists and melodic parts a pitch curve, so the
    // analysis is kept and only the role changes (re-load the file for a full re-analysis).
    save(list.filter((s) => s.id === id || s.role !== role).map((s) => (s.id === id ? { ...s, role, analysis: { ...s.analysis, role } } : s)));
  }, []);
  const splitSongIntoStems = useCallback(async (file) => {
    if (!file) return;
    setState({ status: 'working', error: '', done: 0, total: 100 });
    try {
      const { stems: parts, mix } = await splitSongFile(file, { onProgress: (p) => setState((s) => ({ ...s, done: Math.round(p * 100) })) });
      const roles = new Set(parts.map((s) => s.role));
      save([...readStems(useProjectStore.getState().programmer).filter((s) => !roles.has(s.role)), ...parts], mix);
      setState({ status: 'idle', error: '', done: 0, total: 0 });
    } catch (error) {
      setState({ status: 'error', error: error.message || 'Could not split the song', done: 0, total: 0 });
    }
  }, []);
  const remove = useCallback((id) => save(readStems(useProjectStore.getState().programmer).filter((s) => s.id !== id)), []);
  const clear = useCallback(() => save([]), []);
  return { stems, ...state, add, split: splitSongIntoStems, setRole, remove, clear };
}
