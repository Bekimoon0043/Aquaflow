// ui-server.js — loopback static server for the packaged frontend.
//
// WHY: the Vite build emits `<script type="module" crossorigin src="./assets/…">`. ES-module
// scripts with `crossorigin` CANNOT be fetched over file:// — the module fetch is a CORS
// request and file:// has a null origin, so Chromium blocks it and React never mounts (blank
// screen). Serving the same files over http://127.0.0.1:<port> gives them a real origin so
// modules load, and that origin already matches the backend CORS regex
// (https?://(localhost|127.0.0.1)(:\d+)?) so no extra CORS config is needed.
//
// Loopback-only (binds 127.0.0.1), read-only, with a path-traversal guard and an SPA fallback
// to index.html. No dependencies.

const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".wasm": "application/wasm",
};

// Resolve a request path to an absolute file inside `root`, or null if it escapes root.
function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath).split("?")[0].split("#")[0]); }
  catch { return null; }
  const full = path.resolve(root, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  const normRoot = path.resolve(root);
  if (full !== normRoot && !full.startsWith(normRoot + path.sep)) return null;
  return full;
}

/** Start a loopback static server for `root`. Resolves { server, port, url(file), close }. */
function startUiServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let p = safeJoin(root, req.url || "/");
        if (!p) { res.writeHead(403); return res.end("forbidden"); }
        let stat = null;
        try { stat = fs.statSync(p); } catch { /* missing */ }
        if (stat && stat.isDirectory()) p = path.join(p, "index.html");
        if (!fs.existsSync(p)) {
          // SPA fallback: unknown non-file routes serve index.html (asset 404s stay 404).
          const ext = path.extname(p);
          if (ext && ext !== ".html") { res.writeHead(404); return res.end("not found"); }
          p = path.join(root, "index.html");
          if (!fs.existsSync(p)) { res.writeHead(404); return res.end("not found"); }
        }
        const ext = path.extname(p).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(p).on("error", () => { try { res.destroy(); } catch {} }).pipe(res);
      } catch {
        try { res.writeHead(500); res.end("error"); } catch {}
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: (file = "index.html") => `http://127.0.0.1:${port}/${file}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startUiServer, safeJoin, MIME };
