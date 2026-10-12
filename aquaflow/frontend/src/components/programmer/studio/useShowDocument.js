import { useEffect, useRef, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import { compileStudio, readStudio } from './showModel';

export default function useShowDocument(items) {
  const revision = useProjectStore(s => s.loadRevision);
  const [studio, setStudio] = useState(() => readStudio(useProjectStore.getState().programmer));
  const [resolved, setResolved] = useState({ clips: [], issues: [], pending: true });
  const history = useRef({ undo: [], redo: [] });
  const current = useRef(studio);
  current.current = studio;
  const loaded = useRef(revision);
  const worker = useRef(null), request = useRef(0);
  const [workerReady, setWorkerReady] = useState(0);
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      worker.current = new Worker(new URL('./compile.worker.js', import.meta.url), { type: 'module' });
      setWorkerReady(n => n + 1);
    }
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    if (loaded.current === revision) return;
    loaded.current = revision;
    request.current++;
    history.current = { undo: [], redo: [] };
    const next = readStudio(useProjectStore.getState().programmer);
    current.current = next;
    setStudio(next);
  }, [revision]);
  useEffect(() => {
    // On project replacement the hydration effect must commit before persisting.
    if (revision !== loaded.current || studio !== current.current) return;
    const id = ++request.current;
    let active = true;
    setResolved(previous => ({ ...previous, pending: true }));
    const receive = result => {
      if (!active || request.current !== id || useProjectStore.getState().loadRevision !== revision) return;
      setResolved({ ...result, pending: false });
      const project = useProjectStore.getState();
      project.rememberProgrammer({ ...project.programmer, studio, timelineClips: result.clips,
        audioDuration: Math.max(30, ...result.clips.map(c => c.startTime + c.duration)) });
    };
    if (worker.current) {
      const currentWorker = worker.current;
      const handler = event => { if (event.data.id === id) receive(event.data); };
      const failed = () => receive({ clips: [], issues: ['Pattern resolution failed. Reopen Show Programming to retry.'] });
      currentWorker.addEventListener('message', handler);
      currentWorker.addEventListener('error', failed);
      currentWorker.postMessage({ id, studio, items });
      return () => { active = false; currentWorker.removeEventListener('message', handler); currentWorker.removeEventListener('error', failed); };
    }
    const timer = setTimeout(() => receive(compileStudio(studio, items)), 0);
    return () => { active = false; clearTimeout(timer); };
  }, [studio, items, workerReady]);

  const persist = next => {
    current.current = next;
    const project = useProjectStore.getState();
    project.rememberProgrammer({ ...project.programmer, studio: next });
    setStudio(next);
  };
  const change = action => {
    const previous = current.current;
    const next = typeof action === 'function' ? action(previous) : action;
    history.current.undo.push(previous);
    if (history.current.undo.length > 60) history.current.undo.shift();
    history.current.redo = [];
    // Persist editable sources immediately; resolved clips follow from the worker.
    persist(next);
  };
  const undo = () => {
    const next = history.current.undo.pop();
    if (!next) return;
    history.current.redo.push(current.current);
    persist(next);
  };
  const redo = () => {
    const next = history.current.redo.pop();
    if (!next) return;
    history.current.undo.push(current.current);
    persist(next);
  };
  const layout = patch => setStudio(previous => ({ ...previous, layout: { ...previous.layout, ...patch } }));
  return { studio, change, layout, undo, redo, canUndo: !!history.current.undo.length, canRedo: !!history.current.redo.length, ...resolved };
}
