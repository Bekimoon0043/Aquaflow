import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// AQ-FIX-002 — the app was shipping as a single ~1.87 MB chunk because every
// dependency (notably three.js) was bundled with application code. We split the
// heavy, rarely-changing vendors into their own chunks so (a) the application
// chunk is small and cache-busts independently of the vendor code, and (b) the
// browser can fetch vendors in parallel. three.js is isolated on its own — it is
// a single large immutable module, so its chunk is expected to be big; the size
// budget below is set just above it so the build stays warning-clean while still
// flagging any *application* chunk that balloons past the budget.
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        // BLANK-SCREEN FIX (desktop packaging): the previous react-vendor/vendor split was
        // CIRCULAR — zustand sat in react-vendor while its dependency use-sync-external-store
        // (which itself imports react) fell through to vendor, giving vendor ⇄ react-vendor.
        // Rollup then evaluated vendor before React had initialised → "Cannot read properties
        // of undefined (reading 'useState')" at runtime → React never mounted (black #root).
        // Rule now: three.js (self-contained, imports no other vendor) gets its own chunk;
        // EVERYTHING else in node_modules — React included — shares ONE vendor chunk, so no
        // vendor⇄vendor edge can exist. The build must stay free of "Circular chunk" warnings.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/three/') || id.includes('\\three\\')) return 'three'
          // AF-3D-VID-001: the video muxer is only needed when a render starts; its own
          // chunk keeps it out of startup (it imports nothing from other vendors).
          if (id.includes('/mediabunny/') || id.includes('\\mediabunny\\')) return 'mediabunny'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true }
    }
  }
})
