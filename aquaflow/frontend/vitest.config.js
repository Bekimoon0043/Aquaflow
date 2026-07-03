import { defineConfig } from 'vitest/config'

// Frontend unit-test config (AQ-S1-009). The resolver and runtime-signal
// projection are pure functions, so the fast Node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
