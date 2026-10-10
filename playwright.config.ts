import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18080',
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18080',
    url: 'http://127.0.0.1:18080',
    reuseExistingServer: false,
    env: {
      VITE_GOOGLE_CLIENT_ID: 'test-client',
      VITE_GOOGLE_API_KEY: 'test-key',
      VITE_GOOGLE_APP_ID: '123456',
    },
  },
});
