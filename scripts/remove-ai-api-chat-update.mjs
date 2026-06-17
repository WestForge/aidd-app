#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');

const filesToRemove = [
  'electron/main/ipc/aiChatIpc.ts',
  'electron/services/aiChatService.ts',
  'electron/services/aiChatSettingsStore.ts',
  'src/components/AiChatPanel.tsx'
];

let removed = 0;
for (const relativePath of filesToRemove) {
  const absolutePath = path.join(projectRoot, relativePath);
  try {
    await fs.rm(absolutePath, { force: true });
    console.log(`Removed ${relativePath}`);
    removed += 1;
  } catch (error) {
    console.warn(`Could not remove ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`AI API chat cleanup complete. Removed ${removed} file entries if they existed.`);
