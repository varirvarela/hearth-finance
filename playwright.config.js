import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

// CI uses the preview server (built dist/); local dev uses Vite HMR server.
const serverCommand = isCI ? 'npm run preview' : 'npm run dev';
const serverPort    = isCI ? 4173 : 5173;
const baseURL       = `http://localhost:${serverPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile Chrome runs locally only — CI uses chromium for speed
    ...(isCI ? [] : [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }]),
  ],

  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
