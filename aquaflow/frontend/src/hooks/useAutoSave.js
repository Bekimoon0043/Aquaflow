/**
 * useAutoSave.js — AF-NEXT-006 rolling autosave snapshots.
 *
 * Writes a timestamped snapshot of the whole project (show + engineering + workspace) to
 * the snapshot backend — <userData>/project-recovery/snapshots on desktop, IndexedDB in the
 * browser — never to the user's project file. Triggers:
 *   - an edit, debounced (EDIT_DEBOUNCE_MS after the last content change in a project store)
 *   - a safety interval (AUTOSAVE_TICK_MS) while changes are pending
 *   - page hide / unload (best effort)
 *
 * A snapshot is written only when the project content changed since the last snapshot or
 * clean save (cheap store change counter — utils/autosavePolicy.js — no JSON hashing), and
 * large projects back off (≥ 3 min between snapshots above 15 MB, 5 min above 60 MB). The
 * project is stringified exactly once per snapshot; the JSON string is handed to the
 * backend as-is, so the desktop main process does not re-serialise it.
 *
 * The backend keeps the newest SNAPSHOT_LIMIT per project and a total byte cap. A failed
 * write is surfaced: `error` is returned and an "aquaflow:project-status" toast is raised
 * (once per distinct failure, then again when it recovers) — it is never swallowed.
 */
import { useEffect, useRef, useState } from "react";
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { getSnapshotBackend } from "../utils/projectRecovery";
import { captureProjectData, getFileState, getProjectKey, notify } from "../utils/projectPersistence";
import { AUTOSAVE_TICK_MS, createProjectChangeTracker, shouldWriteSnapshot } from "../utils/autosavePolicy";

const EDIT_DEBOUNCE_MS = 4000;

export function useAutoSave() {
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let debounce = null;
    let disposed = false;
    // Revision of the project content at the last snapshot / open / clean save.
    let savedRevision = 0;
    let lastBytes = 0;
    let lastWriteAt = 0;

    const scheduleEdit = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => doSave("edit"), EDIT_DEBOUNCE_MS);
    };
    const tracker = createProjectChangeTracker(
      { show: useShowStore, engineering: useEngineeringStore, project: useProjectStore },
      scheduleEdit,
    );

    const reportError = (e) => {
      const message = e?.message || String(e);
      if (errorRef.current !== message) {
        notify(`Autosave failed: ${message}. Your project file is unchanged — save manually to keep your work.`, "error");
        try { useShowStore.getState().addServerLog?.({ level: "error", msg: `Autosave failed: ${message}` }); } catch { /* ignore */ }
      }
      errorRef.current = message;
      setError(message);
    };

    async function doSave(reason) {
      if (busyRef.current || disposed) return;
      const revision = tracker.revision();
      if (!shouldWriteSnapshot({ revision, savedRevision, lastBytes, lastWriteAt, now: Date.now() })) return;
      busyRef.current = true;
      try {
        const data = captureProjectData();
        const json = JSON.stringify(data); // the only serialisation of this snapshot
        const file = getFileState();
        await getSnapshotBackend().write(getProjectKey(), json, {
          name: data.show?.name || "Untitled Show", originalPath: file.path || null, reason, bytes: json.length,
        });
        // Edits made while the write was in flight keep the revision ahead → next tick saves them.
        savedRevision = revision;
        lastBytes = json.length;
        lastWriteAt = Date.now();
        setLastSaved(new Date());
        if (errorRef.current) notify("Autosave is working again.", "info");
        errorRef.current = null;
        setError(null);
      } catch (e) {
        reportError(e);
      } finally {
        busyRef.current = false;
      }
    }

    const interval = setInterval(() => doSave("interval"), AUTOSAVE_TICK_MS);
    const handleHide = () => { doSave("unload"); };
    window.addEventListener("pagehide", handleHide);
    window.addEventListener("beforeunload", handleHide);
    // After an open or a clean save the on-disk file already holds this state: re-baseline
    // so recovery is only offered for edits made after it. No serialisation needed.
    const rebaseline = () => { clearTimeout(debounce); savedRevision = tracker.revision(); };
    window.addEventListener("aquaflow:project-baseline", rebaseline);

    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(interval);
      tracker.dispose();
      window.removeEventListener("pagehide", handleHide);
      window.removeEventListener("beforeunload", handleHide);
      window.removeEventListener("aquaflow:project-baseline", rebaseline);
    };
  }, []);

  return { lastSaved, error };
}
