import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'dist', 'main');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  mainFields: ['main', 'module'],
  conditions: ['node'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  external: [
    'electron',
    // keytar is a native module. Keep it external so electron-builder can rebuild
    // and unpack the native binary for the target Electron version.
    'keytar'
  ]
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  ...common,
  entryPoints: [path.join(rootDir, 'electron', 'main.ts')],
  outfile: path.join(outDir, 'main.js')
});

await build({
  ...common,
  entryPoints: [path.join(rootDir, 'electron', 'preload.ts')],
  outfile: path.join(outDir, 'preload.js'),
  external: ['electron']
});

console.log('Electron main/preload bundles written to dist/main');
