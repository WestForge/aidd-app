import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so assets resolve under the file:// protocol in the packaged app.
  // With the default '/', the bundle is referenced as /assets/... which points at the
  // filesystem/asar root when loaded via win.loadFile(), producing a blank window.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
