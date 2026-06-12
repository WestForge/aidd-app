import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const preloadPath = path.resolve('electron/preload.ts');
const viteEnvPath = path.resolve('src/vite-env.d.ts');
const packagePath = path.resolve('package.json');

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

function ensureImport(text, importLine, afterNeedle) {
  if (text.includes(importLine)) return text;
  if (afterNeedle && text.includes(afterNeedle)) {
    return text.replace(afterNeedle, `${afterNeedle}\n${importLine}`);
  }
  const lastImport = [...text.matchAll(/^import .*?;$/gm)].pop();
  if (!lastImport) fail(`Could not insert import: ${importLine}`);
  return text.slice(0, lastImport.index + lastImport[0].length) + `\n${importLine}` + text.slice(lastImport.index + lastImport[0].length);
}

function ensureWorkflowImport(text) {
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+'\.\/services\/gitSyncWorkflow';/m;
  const match = text.match(importRegex);

  if (match) {
    const names = new Set(match[1].split(',').map((name) => name.trim()).filter(Boolean));
    names.add('createCheckpointIfNeeded');
    names.add('syncProject');
    const preferred = ['checkForUpdates', 'createCheckpointIfNeeded', 'getSyncStatus', 'syncProject'];
    const ordered = preferred.filter((name) => names.has(name));
    for (const name of names) if (!ordered.includes(name)) ordered.push(name);
    return text.replace(importRegex, `import { ${ordered.join(', ')} } from './services/gitSyncWorkflow';`);
  }

  return ensureImport(text, "import { createCheckpointIfNeeded, syncProject } from './services/gitSyncWorkflow';");
}

function insertSaveShareHelper(text) {
  if (text.includes('checkpointAndShareProjectAfterPhase04Save')) return text;

  const declaration = 'const gitCredentialStore = createKeytarCredentialStore();';
  const index = text.indexOf(declaration);
  if (index < 0) fail('Could not find gitCredentialStore declaration.');

  const helper = `
function isLocalOnlyPhase04SyncFailure(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

async function checkpointAndShareProjectAfterPhase04Save(projectPath: string) {
  if (!projectPath) return;

  const options = {
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore,
  };

  try {
    const syncResult = await syncProject(options);

    if (syncResult.ok) {
      console.log(\`[AIDD save-sync] Saved, checkpointed and shared: \${syncResult.message}\`);
      return;
    }

    const checkpoint = await createCheckpointIfNeeded(options);

    if (checkpoint.created) {
      console.log(\`[AIDD save-sync] Saved and checkpointed locally: \${checkpoint.label}\`);
    }

    if (isLocalOnlyPhase04SyncFailure(syncResult.code)) {
      console.log(\`[AIDD save-sync] Remote share skipped: \${syncResult.message}\`);
      return;
    }

    console.warn(\`[AIDD save-sync] Remote share needs review: \${syncResult.message}\`);
  } catch (error) {
    try {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.warn(\`[AIDD save-sync] Saved and checkpointed locally after share failed: \${checkpoint.label}\`);
      }
    } catch (checkpointError) {
      console.warn(\`[AIDD save-sync] Checkpoint failed after save: \${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}\`);
    }
  }
}
`;

  return text.slice(0, index + declaration.length) + helper + text.slice(index + declaration.length);
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
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
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
  text = ensureWorkflowImport(text);
  text = ensureImport(text, "import { checkFileOpenSafety, checkFileSaveSafety, findAiddProjectRootForFile } from './services/gitOpenSaveGuard';");
  text = ensureImport(text, "import { readActiveGitReviewState, readGitReviewFile } from './services/gitReviewPackageStore';");
  text = insertSaveShareHelper(text);

  text = replaceIpcHandler(
    text,
    'fs:readText',
    `ipcMain.handle('fs:readText', async (_event, filePath: string) => {
  const guard = await checkFileOpenSafety({
    userDataPath: app.getPath('userData'),
    filePath,
    credentialStore: gitCredentialStore,
  });

  if (!guard.safe) {
    throw new Error(guard.message);
  }

  return fsp.readFile(filePath, 'utf8');
});`
  );

  text = replaceIpcHandler(
    text,
    'fs:writeText',
    `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  const guard = await checkFileSaveSafety({
    userDataPath: app.getPath('userData'),
    filePath,
    pendingContent: content,
    credentialStore: gitCredentialStore,
  });

  if (!guard.safe) {
    throw new Error(guard.message);
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = guard.projectPath || await findAiddProjectRootForFile(filePath);

  if (projectPath) {
    await checkpointAndShareProjectAfterPhase04Save(projectPath);
  }

  return true;
});`
  );

  if (!text.includes("ipcMain.handle('gitSync:getReviewState'")) {
    const insertion = `

ipcMain.handle('gitSync:getReviewState', async (_event, projectPath: string) => {
  return readActiveGitReviewState(projectPath);
});

ipcMain.handle('gitSync:readReviewFile', async (_event, input: { projectPath: string; reviewId: string; kind: 'local' | 'remote' | 'base'; filePath: string }) => {
  return readGitReviewFile(input);
});`;
    const anchor = "ipcMain.handle('gitSync:syncProject'";
    const span = findIpcHandlerSpan(text, 'gitSync:syncProject');
    if (!span) fail('Could not find gitSync:syncProject to insert review handlers after.');
    text = text.slice(0, span.end) + insertion + text.slice(span.end);
  }

  if (!text.includes('checkFileSaveSafety')) fail('main.ts was not patched with save guard.');
  if (!text.includes('gitSync:getReviewState')) fail('main.ts was not patched with review IPC handlers.');
  write(mainPath, text);
}

function patchPreload() {
  let text = read(preloadPath);
  if (!text.includes('getReviewState:')) {
    text = text.replace(
      "    syncProject: (projectPath: string) => ipcRenderer.invoke('gitSync:syncProject', projectPath)",
      "    syncProject: (projectPath: string) => ipcRenderer.invoke('gitSync:syncProject', projectPath),\n    getReviewState: (projectPath: string) => ipcRenderer.invoke('gitSync:getReviewState', projectPath),\n    readReviewFile: (input: unknown) => ipcRenderer.invoke('gitSync:readReviewFile', input)"
    );
  }
  write(preloadPath, text);
}

function patchViteEnv() {
  let text = read(viteEnvPath);

  if (!text.includes('interface AiddGitReviewState')) {
    const insertAfter = `interface AiddGitSyncResult {`;
    const index = text.indexOf(insertAfter);
    if (index < 0) fail('Could not find AiddGitSyncResult in vite-env.d.ts');
    const types = `
type AiddGitReviewPackageStatus = 'none' | 'pending' | 'partially_resolved' | 'ready_to_complete' | 'completed';
type AiddGitReviewVersionKind = 'local' | 'remote' | 'base';

interface AiddGitReviewFile {
  path: string;
  status: 'unresolved' | 'resolved';
  options: Array<'keep_local' | 'use_shared' | 'manual_review' | 'combined_draft'>;
}

interface AiddGitReviewState {
  active: boolean;
  reviewId?: string;
  createdAt?: string;
  status: AiddGitReviewPackageStatus;
  message: string;
  files: AiddGitReviewFile[];
  packagePath?: string;
}

interface AiddReadGitReviewFileInput {
  projectPath: string;
  reviewId: string;
  kind: AiddGitReviewVersionKind;
  filePath: string;
}

`;
    text = text.slice(0, index) + types + text.slice(index);
  }

  if (!text.includes('getReviewState:')) {
    text = text.replace(
      "      syncProject: (projectPath: string) => Promise<AiddGitSyncResult>;",
      "      syncProject: (projectPath: string) => Promise<AiddGitSyncResult>;\n      getReviewState: (projectPath: string) => Promise<AiddGitReviewState>;\n      readReviewFile: (input: AiddReadGitReviewFileInput) => Promise<string>;"
    );
  }

  write(viteEnvPath, text);
}

function patchPackageJson() {
  const pkg = JSON.parse(read(packagePath));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:git-review-package'] = 'tsx tests/gitReviewPackageStore.unit.test.ts';
  pkg.scripts['test:git-open-save-guard'] = 'tsx tests/gitOpenSaveGuard.unit.test.ts';
  pkg.scripts['test:git-conflict-safe'] = 'npm run test:git-review-package && npm run test:git-open-save-guard';
  write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchMain();
patchPreload();
patchViteEnv();
patchPackageJson();

console.log('Applied Phase 04 open/save conflict guard wiring.');
console.log('Patched: electron/main.ts, electron/preload.ts, src/vite-env.d.ts, package.json');
