/**
 * useAutoSave.js — AF-NEXT-006 rolling autosave snapshots.
 *
 * Writes a timestamped snapshot of the whole project (show + engineering + workspace) to
 * the snapshot backend — <userData>/project-recovery/snapshots on desktop, IndexedDB in the
 * browser — never to the user's project file. Triggers:
 *   - an edit, debounced (EDIT_DEBOUNCE_MS after the last change in any project store)
 *   - a safety interval (AUTO_SAVE_INTERVAL) while changes are pending
 *   - page hide / unload (best effort)
 * The backend keeps the newest SNAPSHOT_LIMIT per project. A failed write is surfaced:
 * `error` is returned and an "aquaflow:project-status" warning toast is raised (once per
 * distinct failure, then again when it recovers) — it is never swallowed.
 */
import { useEffect, useRef, useState } from "react";
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { getSnapshotBackend } from "../utils/projectRecovery";
import { captureProjectData, getFileState, getProjectKey, notify } from "../utils/projectPersistence";

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds
const EDIT_DEBOUNCE_MS = 4000;

// The signature ignores the volatile savedAt stamp so an idle project is not re-snapshotted.
const signatureOf = (data) => JSON.stringify({ ...data, savedAt: null });

export function useAutoSave() {
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);
  const lastSignatureRef = useRef(null);
  const errorRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let debounce = null;
    let disposed = false;

    const doSave = async (reason) => {
      if (busyRef.current || disposed) return;
      let data;
      try { data = captureProjectData(); } catch (e) { data = null; reportError(e); return; }
      const signature = signatureOf(data);
      if (signature === lastSignatureRef.current) return;
      busyRef.current = true;
      try {
        const file = getFileState();
        await getSnapshotBackend().write(getProjectKey(), data, {
          name: data.show?.name || "Untitled Show", originalPath: file.path || null, reason,
        });
        lastSignatureRef.current = signature;
        setLastSaved(new Date());
        if (errorRef.current) notify("Autosave is working again.", "info");
        errorRef.current = null;
        setError(null);
      } catch (e) {
        reportError(e);
      } finally {
        busyRef.current = false;
      }
    };

    const reportError = (e) => {
      const message = e?.message || String(e);
      if (errorRef.current !== message) {
        notify(`Autosave failed: ${message}. Your project file is unchanged — save manually to keep your work.`, "error");
        try { useShowStore.getState().addServerLog?.({ level: "error", msg: `Autosave failed: ${message}` }); } catch { /* ignore */ }
      }
      errorRef.current = message;
      setError(message);
    };

    const scheduleEdit = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => doSave("edit"), EDIT_DEBOUNCE_MS);
    };

    // Any change in the three project stores counts as an edit. Playback-only fields also
    // change the show store; the signature check above drops those no-op snapshots.
    const unsubs = [
      useShowStore.subscribe((s, prev) => { if (s.isDirty || s.nodes !== prev.nodes || s.timelineTracks !== prev.timelineTracks) scheduleEdit(); }),
      useEngineeringStore.subscribe((s, prev) => { if (s.lastUpdated !== prev.lastUpdated) scheduleEdit(); }),
      useProjectStore.subscribe((s, prev) => { if (s.dirty || s.programmer !== prev.programmer) scheduleEdit(); }),
    ];

    const interval = setInterval(() => doSave("interval"), AUTO_SAVE_INTERVAL);
    const handleHide = () => { doSave("unload"); };
    window.addEventListener("pagehide", handleHide);
    window.addEventListener("beforeunload", handleHide);
    // After an open or a clean save the on-disk file already holds this state: re-baseline
    // so recovery is only offered for edits made after it.
    const rebaseline = () => { clearTimeout(debounce); try { lastSignatureRef.current = signatureOf(captureProjectData()); } catch { /* ignore */ } };
    window.addEventListener("aquaflow:project-baseline", rebaseline);
    // Baseline: remember what was loaded so the first snapshot follows a real edit.
    try { lastSignatureRef.current = signatureOf(captureProjectData()); } catch { /* first edit will retry */ }

    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(interval);
      unsubs.forEach((u) => u());
      window.removeEventListener("pagehide", handleHide);
      window.removeEventListener("beforeunload", handleHide);
      window.removeEventListener("aquaflow:project-baseline", rebaseline);
    };
  }, []);

  return { lastSaved, error };
}
