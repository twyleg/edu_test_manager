import { defineConfig, mergeConfig } from 'vite';
import config from './vite.config';

export default defineConfig(
  mergeConfig(config, {
    // Discover the QR worker dependency before a test starts, avoiding a mid-scan reload.
    optimizeDeps: { include: ['jsqr'] },
  }),
);
