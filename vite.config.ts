import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true, outDir: 'dist',
    rollupOptions: { output: { manualChunks: {
      'pdf-renderer': ['pdfjs-dist'],
      'pdf-writer': ['pdf-lib'],
    } } },
  },
  server: { port: 8080, strictPort: true },
});
