/**
 * frontend/src/hooks/useLicense.js
 * React hook for AquaFlow Studio beta license management.
 * Checks license status on app load. Tries online first, falls back to cache.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../config";

// API_BASE_URL already ends in "/api" — the license routes live at /api/license/*, so append
// only "/license" here. (Appending "/api/license" produced /api/api/license → 404, which
// silently kept the license gate from ever seeing a VALID status.)
const LICENSE_API = `${API_BASE_URL}/license`;
const RECHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_STATE = {
  loading:       true,
  valid:         false,
  status:        "CHECKING",
  edition:       "NONE",
  features:      [],
  user_name:     "",
  company_name:  "",
  licenseKey:    "",
  expiresAt:     "",
  daysRemaining: 0,
  message:       "Checking license...",
  error:         null,
};

export function useLicense() {
  const [state, setState] = useState(DEFAULT_STATE);
  const intervalRef = useRef(null);

  const checkLicense = useCallback(async () => {
    try {
      const res  = await fetch(`${LICENSE_API}/status`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      setState({
        loading:       false,
        valid:         data.valid ?? false,
        status:        data.status ?? "UNKNOWN",
        edition:       data.edition ?? "NONE",
        features:      data.features ?? [],
        user_name:     data.user_name ?? "",
        company_name:  data.company_name ?? "",
        licenseKey:    data.license_key ?? "",
        expiresAt:     data.expires_at ?? "",
        daysRemaining: data.days_remaining ?? 0,
        message:       data.message ?? "",
        error:         null,
      });
      return data.valid;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        status:  "ERROR",
        message: "Could not reach license server. Check backend is running.",
        error:   err.message,
      }));
      return false;
    }
  }, []);

  useEffect(() => {
    checkLicense();
    intervalRef.current = setInterval(checkLicense, RECHECK_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [checkLicense]);

  const hasFeature = useCallback(
    (feature) => state.features.includes(feature),
    [state.features]
  );

  const activateLicense = useCallback(async (licensePath = null) => {
    setState((prev) => ({ ...prev, loading: true, message: "Activating license..." }));
    try {
      const res = await fetch(`${LICENSE_API}/activate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ license_path: licensePath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Activation failed");
      setState({
        loading:       false,
        valid:         data.valid ?? false,
        status:        data.status ?? "VALID",
        edition:       data.edition ?? "NONE",
        features:      data.features ?? [],
        user_name:     data.user_name ?? "",
        company_name:  data.company_name ?? "",
        licenseKey:    data.license_key ?? "",
        expiresAt:     data.expires_at ?? "",
        daysRemaining: data.days_remaining ?? 0,
        message:       data.message ?? "License activated",
        error:         null,
      });
      return { success: true };
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message, message: err.message }));
      return { success: false, error: err.message };
    }
  }, []);

  return { ...state, hasFeature, activateLicense, recheckLicense: checkLicense };
}

export const FEATURES = {
  PLAY:             "play",
  STOP:             "stop",
  SCHEDULE:         "schedule",
  LOAD_SHOW:        "load_show",
  ENGINEERING:      "engineering_designer",
  PREVIEW_3D:       "3d_preview",
  SHOW_PROGRAMMER:  "show_programmer",
  AI_CHOREOGRAPHY:  "ai_choreography",
  PATTERN_DESIGNER: "pattern_designer",
  SAVE:             "save",
  EXPORT:           "export",
};
