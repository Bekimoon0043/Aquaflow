/**
 * useAutoSave.js
 * Auto-saves the current show to localStorage every 30 seconds
 * when there are unsaved changes. Shows a save indicator in the UI.
 */
import { useEffect, useRef, useState } from "react";
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { autoSave } from "../utils/showFile";

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export function useAutoSave() {
  const [lastSaved, setLastSaved] = useState(null);
  const timerRef = useRef(null);
  const lastEngineeringSavedRef = useRef(null);
  const lastProjectSignatureRef = useRef(null);

  useEffect(() => {
    const doSave = () => {
      const state = useShowStore.getState();
      const engineering = useEngineeringStore.getState();
      const project = useProjectStore.getState();
      const projectDocument = project.getProjectDocument(state.currentShow?.name);
      const projectSignature = JSON.stringify(projectDocument);
      if (!state.isDirty
        && engineering.lastUpdated === lastEngineeringSavedRef.current
        && projectSignature === lastProjectSignatureRef.current) return;
      autoSave(
        state,
        engineering.getProjectPayload(),
        projectDocument,
      );
      lastEngineeringSavedRef.current = engineering.lastUpdated;
      lastProjectSignatureRef.current = projectSignature;
      setLastSaved(new Date());
    };

    // Save on interval
    timerRef.current = setInterval(doSave, AUTO_SAVE_INTERVAL);

    // Also save when user leaves/closes tab
    const handleUnload = () => doSave();
    window.addEventListener("beforeunload", handleUnload);

    // Initial save after 5 seconds
    const initTimer = setTimeout(doSave, 5000);

    return () => {
      clearInterval(timerRef.current);
      clearTimeout(initTimer);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return { lastSaved };
}
