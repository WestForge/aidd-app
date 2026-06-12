import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const preloadPath = path.resolve('electron/preload.ts');
const viteEnvPath = path.resolve('src/vite-env.d.ts');

function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

function read(filePath) {
  if (!fs.existsSync(filePath)) fail(`Missing ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureImport(text, importLine) {
  if (text.includes(importLine)) return text;
  const lastImport = [...text.matchAll(/^import .*?;$/gm)].pop();
  if (!lastImport) fail(`Could not insert import: ${importLine}`);
  return text.slice(0, lastImport.index + lastImport[0].length) + `\n${importLine}` + text.slice(lastImport.index + lastImport[0].length);
}

function findIpcHandlerSpan(text, channel) {
  const start = text.indexOf(`ipcMain.handle('${channel}'`);
  if (start < 0) return null;
  const open = text.indexOf('(', start);
  if (open < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = open; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if (depth === 0) {
      let end = i + 1;
      while (end < text.length && /\s/.test(text[end])) end++;
      if (text[end] === ';') end++;
      return { start, end };
    }
  }

  return null;
}

function replaceIpcHandler(text, channel, replacement) {
  const span = findIpcHandlerSpan(text, channel);
  if (!span) fail(`Could not find IPC handler ${channel}`);
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

function patchMain() {
  let text = read(mainPath);

  text = ensureImport(
    text,
    "import { createSaveSyncService, findAiddProjectRootForSavedFile } from './services/gitSaveSyncService';"
  );

  if (!text.includes('const saveSyncService = createSaveSyncService({ credentialStore: gitCredentialStore });')) {
    const marker = 'const gitCredentialStore = createKeytarCredentialStore();';
    if (!text.includes(marker)) fail('Could not find gitCredentialStore declaration.');

    text = text.replace(
      marker,
      `${marker}\nconst saveSyncService = createSaveSyncService({ credentialStore: gitCredentialStore });`
    );
  }

  // Route old helper calls to the service without trying to delete old helper definitions yet.
  text = text.replaceAll('await checkpointAndShareProjectAfterSave(', 'await saveSyncService.checkpointAndShareProjectAfterSave(');
  text = text.replaceAll('withProjectSaveSync(', 'saveSyncService.withProjectSaveSync(');

  // Correct accidental replacement of function declarations if an older helper exists.
  text = text.replaceAll('async function saveSyncService.checkpointAndShareProjectAfterSave', 'async function checkpointAndShareProjectAfterSave');
  text = text.replaceAll('async function saveSyncService.withProjectSaveSync', 'async function withProjectSaveSync');

  const writeTextHandler = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForSavedFile(filePath, exists);

  if (projectPath) {
    await saveSyncService.checkpointAndShareProjectAfterSave(projectPath);
  }

  return true;
});`;

  text = replaceIpcHandler(text, 'fs:writeText', writeTextHandler);

  const getLastSaveSyncStatusHandler = `ipcMain.handle('gitSync:getLastSaveSyncStatus', async () => {
  return null;
});`;

  if (!text.includes("ipcMain.handle('gitSync:getLastSaveSyncStatus'")) {
    const anchor = findIpcHandlerSpan(text, 'gitSync:getSyncStatus') || findIpcHandlerSpan(text, 'gitSync:syncProject') || findIpcHandlerSpan(text, 'fs:writeText');
    if (!anchor) fail('Could not find anchor for getLastSaveSyncStatus handler.');
    text = text.slice(0, anchor.end) + `\n\n${getLastSaveSyncStatusHandler}` + text.slice(anchor.end);
  }

  if (!text.includes('findAiddProjectRootForSavedFile(filePath, exists)')) {
    fail('Patch verification failed: fs:writeText does not find project root.');
  }

  if (!text.includes('saveSyncService.checkpointAndShareProjectAfterSave(projectPath)')) {
    fail('Patch verification failed: fs:writeText does not call save sync service.');
  }

  write(mainPath, text);
}

function patchPreload() {
  let text = read(preloadPath);

  if (text.includes('getLastSaveSyncStatus:')) {
    write(preloadPath, text);
    return;
  }

  const marker = "cancelReview: (projectPath: string, reviewId: string) => ipcRenderer.invoke('gitSync:cancelReview', projectPath, reviewId)";
  const fallbackMarker = "clearToken: (projectPath: string) => ipcRenderer.invoke('gitSync:clearToken', projectPath)";

  if (text.includes(marker)) {
    text = text.replace(marker, `${marker},
    getLastSaveSyncStatus: () => ipcRenderer.invoke('gitSync:getLastSaveSyncStatus')`);
  } else if (text.includes(fallbackMarker)) {
    text = text.replace(fallbackMarker, `${fallbackMarker},
    getLastSaveSyncStatus: () => ipcRenderer.invoke('gitSync:getLastSaveSyncStatus')`);
  } else {
    fail('Could not find gitSync preload insertion point.');
  }

  write(preloadPath, text);
}

function patchViteEnv() {
  let text = read(viteEnvPath);

  if (!text.includes('interface AiddSaveSyncResult')) {
    const marker = 'interface AiddTrackedProject';
    if (!text.includes(marker)) fail('Could not find AiddTrackedProject marker.');

    text = text.replace(marker, `interface AiddSaveSyncResult {
  ok: boolean;
  code: 'SHARED' | 'LOCAL_CHECKPOINT' | 'SKIPPED' | 'NEEDS_REVIEW' | 'ERROR';
  message: string;
  projectPath?: string;
  checkpointCreated?: boolean;
  checkpointLabel?: string;
}

${marker}`);
  }

  if (!text.includes('getLastSaveSyncStatus:')) {
    const marker = "      cancelReview: (projectPath: string, reviewId: string) => Promise<AiddGitReviewState>;";
    const fallbackMarker = "      clearToken: (projectPath: string) => Promise<AiddGitSyncSettings | null>;";

    if (text.includes(marker)) {
      text = text.replace(marker, `${marker}
      getLastSaveSyncStatus: () => Promise<AiddSaveSyncResult | null>;`);
    } else if (text.includes(fallbackMarker)) {
      text = text.replace(fallbackMarker, `${fallbackMarker}
      getLastSaveSyncStatus: () => Promise<AiddSaveSyncResult | null>;`);
    } else {
      fail('Could not find gitSync type insertion point.');
    }
  }

  write(viteEnvPath, text);
}

patchMain();
patchPreload();
patchViteEnv();

console.log('Applied save sync service/status patch.');
console.log('');
console.log('Verify with:');
console.log('Select-String -Path .\\\\electron\\\\main.ts -Pattern "gitSaveSyncService|saveSyncService|findAiddProjectRootForSavedFile|fs:writeText" -Context 0,8');
