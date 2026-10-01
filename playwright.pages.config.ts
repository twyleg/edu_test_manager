import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pages',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18081/edu_test_manager/',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: 'npm run preview:pages -- --host 127.0.0.1 --port 18081 --strictPort',
    url: 'http://127.0.0.1:18081/edu_test_manager/',
    reuseExistingServer: false,
  },
});
