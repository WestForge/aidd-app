import { rm } from 'node:fs/promises';

const paths = ['release', 'dist'];

for (const path of paths) {
  await rm(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
}
