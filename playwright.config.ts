import { defineConfig } from '@playwright/test';

// Template port (see ~/.claude/CLAUDE.md port table). Clones get their own via new-project.
const PORT = Number(process.env.PORT ?? 4600);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // specs share one database and two of them seed the demo org; parallel files raced on Org.slug
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: `http://localhost:${PORT}/api/health`,
    // DEMO_MODE: e2e/demo.spec.ts drives /demo. DEMO_ACCESS_PASSWORD blank: a production build makes Next read
    // .env.production.local, which holds the deployed demo's password, and the gate then answers 401 to every spec.
    // Next never overwrites a variable that is already set, so blank here keeps the gate off.
    env: { DEMO_MODE: '1', DEMO_ACCESS_PASSWORD: '' },
    reuseExistingServer: false, // a stale server on this port would test the wrong app
    timeout: 300_000, // a cold production build outruns the 120s default
  },
});
