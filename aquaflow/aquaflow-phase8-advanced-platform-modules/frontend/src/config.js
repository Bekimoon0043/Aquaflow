const rawApiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api").replace(/\/$/, "");
const rawOrigin = rawApiBase.endsWith("/api") ? rawApiBase.slice(0, -4) : rawApiBase;

export const API_BASE_URL = rawApiBase;
export const WS_URL = (import.meta.env.VITE_WS_URL || `${rawOrigin.replace(/^http/, "ws")}/ws`).replace(/\/$/, "");
