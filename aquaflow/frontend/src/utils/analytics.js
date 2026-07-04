// analytics.js — AquaFlow client usage analytics (AQ-S4-003)
//
// Privacy-first anonymous product analytics. Tracks feature usage from the UI and
// sends it to the backend (/api/analytics/track), which hashes the session and strips
// PII. A random, non-identifying session id is generated per browser (stored locally);
// collection is consent-gated (opt-out) and never blocks the UI (fire-and-forget).
import { apiPost } from "./apiClient";

const CONSENT_KEY = "aquaflow.analyticsConsent";
const SESSION_KEY = "aquaflow.analyticsSession";

function storage() {
  try { if (typeof localStorage !== "undefined") return localStorage; } catch { /* */ }
  return null;
}

// A random, anonymous session id (NOT tied to any user identity).
export function getSessionId() {
  const s = storage();
  let id = s && s.getItem(SESSION_KEY);
  if (!id) {
    id = "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (s) s.setItem(SESSION_KEY, id);
  }
  return id;
}

export function hasConsent() {
  const s = storage();
  if (!s) return true;                 // default opt-in; user can disable
  const v = s.getItem(CONSENT_KEY);
  return v === null ? true : v === "true";
}

export function setConsent(enabled) {
  const s = storage();
  if (s) s.setItem(CONSENT_KEY, String(!!enabled));
  // best-effort: mirror to the backend so server-side collection matches
  apiPost("/analytics/consent", { enabled: !!enabled }).catch(() => {});
  return !!enabled;
}

// Only feature/metric properties should be passed — never PII (the backend also
// strips it, but keep the client clean).
export async function trackEvent(name, properties = {}) {
  if (!name || !hasConsent()) return { tracked: false };
  try {
    return await apiPost("/analytics/track", {
      name: String(name),
      properties,
      session_id: getSessionId(),
    });
  } catch {
    return { tracked: false, offline: true };   // never surface analytics failures
  }
}

// Convenience for feature usage (e.g. opening a panel).
export function trackFeature(feature, properties = {}) {
  return trackEvent("feature_use", { feature, ...properties });
}
