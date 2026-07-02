const trimTrailingSlash = (value = "") => value.replace(/\/$/, "");

function readBrowserOverride(key) {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || "";
  } catch {
    return "";
  }
}

function readStorageOverride(key) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function inferBackendOrigin() {
  if (typeof window === "undefined") return "http://localhost:8000";
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  const backendPort = import.meta.env.VITE_BACKEND_PORT || "8000";
  return `${protocol}//${hostname}:${backendPort}`;
}

const envApiBase = import.meta.env.VITE_API_BASE_URL || "";
const queryApiBase = readBrowserOverride("api");
const storedApiBase = readStorageOverride("aquaflow.apiBaseUrl");
const fallbackApiBase = `${inferBackendOrigin()}/api`;

const rawApiBase = trimTrailingSlash(envApiBase || queryApiBase || storedApiBase || fallbackApiBase);
const rawOrigin = rawApiBase.endsWith("/api") ? rawApiBase.slice(0, -4) : rawApiBase;
const envWsUrl = import.meta.env.VITE_WS_URL || "";
const queryWsUrl = readBrowserOverride("ws");
const storedWsUrl = readStorageOverride("aquaflow.wsUrl");
const fallbackWsUrl = `${rawOrigin.replace(/^http/, "ws")}/ws`;

export const API_BASE_URL = rawApiBase;
export const BACKEND_ORIGIN = trimTrailingSlash(rawOrigin);
export const WS_URL = trimTrailingSlash(envWsUrl || queryWsUrl || storedWsUrl || fallbackWsUrl);
export const HEALTH_URL = `${BACKEND_ORIGIN}/api/health`;
