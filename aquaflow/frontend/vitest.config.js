import { defineConfig } from 'vitest/config'

// Frontend unit-test config (AQ-S1-009). The resolver and runtime-signal
// projection are pure functions, so the fast Node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Node ≥ 22 ships a global localStorage that is undefined without --localstorage-file
    // and shadows jsdom's; switch it off so jsdom tests get the browser storage.
    poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] }, threads: { execArgv: ['--no-experimental-webstorage'] } },
  },
})
