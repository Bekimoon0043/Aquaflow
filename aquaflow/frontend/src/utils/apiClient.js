// apiClient.js — AquaFlow backend API client (AQ-X-014)
//
// Thin fetch wrapper around API_BASE_URL used by the engineering/monitoring panels to
// reach the backend engines (hydraulics, nozzles, BOM, P&ID, energy, weather, mobile,
// collaboration). Normalises JSON requests/responses and surfaces HTTP errors.
import { API_BASE_URL } from "../config";

export function apiUrl(path) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function handle(res) {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      try { detail = await res.text(); } catch { detail = ""; }
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

export async function apiGet(path) {
  return handle(await fetch(apiUrl(path), { headers: { Accept: "application/json" } }));
}

export async function apiPost(path, body) {
  return handle(await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  }));
}

// POST returning raw text (e.g. an SVG/CSV response).
export async function apiPostText(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
