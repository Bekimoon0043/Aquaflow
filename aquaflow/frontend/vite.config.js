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
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/three/') || id.includes('\\three\\')) return 'three'
          if (
            id.includes('/react/') || id.includes('\\react\\') ||
            id.includes('/react-dom/') || id.includes('\\react-dom\\') ||
            id.includes('/scheduler/') || id.includes('\\scheduler\\') ||
            id.includes('zustand')
          ) return 'react-vendor'
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
