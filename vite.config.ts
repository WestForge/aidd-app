import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const prismGlobalShim = fileURLToPath(new URL('./src/lib/prismjs-global.ts', import.meta.url));

// Electron loads the production renderer from local files/protocols.
// Vite's default base of '/' makes built assets point at /assets/...,
// which can produce a blank packaged window. Keep asset URLs relative.
export default defineConfig({
  base: './',
  define: {
    Prism: 'globalThis.Prism'
  },
  resolve: {
    alias: [
      {
        find: /^prismjs$/,
        replacement: prismGlobalShim
      }
    ]
  },
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true
  }
});
