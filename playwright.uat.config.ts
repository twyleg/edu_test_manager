import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testIgnore: ['**/benchmark.spec.ts'],
  grepInvert: /@local-sample/,
  webServer: {
    ...config.webServer,
    command: 'npm run dev -- --config vite.uat.config.ts --host 127.0.0.1 --port 18080',
  },
});
