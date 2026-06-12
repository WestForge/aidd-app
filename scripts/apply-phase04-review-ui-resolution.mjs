import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const preloadPath = path.resolve('electron/preload.ts');
const viteEnvPath = path.resolve('src/vite-env.d.ts');
const syncPath = path.resolve('src/components/Sync.tsx');
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

function insertAfterHandler(text, afterChannel, insertion) {
  if (text.includes(insertion.trim().split('\n')[0])) return text;
  const span = findIpcHandlerSpan(text, afterChannel);
  if (!span) fail(`Could not find ${afterChannel} to insert after.`);
  return text.slice(0, span.end) + insertion + text.slice(span.end);
}

function patchMain() {
  let text = read(mainPath);
  text = ensureImport(text, "import { cancelGitReview, completeGitReview, listGitReviewFiles, readGitReviewFileContent, resolveGitReviewFile } from './services/gitReviewResolver';");

  if (!text.includes("ipcMain.handle('gitSync:getReviewState'")) {
    text = ensureImport(text, "import { readActiveGitReviewState } from './services/gitReviewPackageStore';");
    const anchor = findIpcHandlerSpan(text, 'gitSync:syncProject') ? 'gitSync:syncProject' : 'fs:writeText';
    text = insertAfterHandler(text, anchor, `

ipcMain.handle('gitSync:getReviewState', async (_event, projectPath: string) => {
  return readActiveGitReviewState(projectPath);
});`);
  }

  if (!text.includes("ipcMain.handle('gitSync:listReviewFiles'")) {
    const anchor = findIpcHandlerSpan(text, 'gitSync:getReviewState') ? 'gitSync:getReviewState' : 'gitSync:syncProject';
    text = insertAfterHandler(text, anchor, `

ipcMain.handle('gitSync:listReviewFiles', async (_event, projectPath: string) => {
  return listGitReviewFiles(projectPath);
});

ipcMain.handle('gitSync:readReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; kind: 'local' | 'remote' | 'base' }) => {
  return readGitReviewFileContent(input);
});

ipcMain.handle('gitSync:resolveReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; resolution: 'keep_local' | 'use_shared' | 'use_combined_draft'; combinedContent?: string }) => {
  return resolveGitReviewFile(input);
});

ipcMain.handle('gitSync:completeReview', async (_event, projectPath: string, reviewId: string) => {
  return completeGitReview(projectPath, reviewId);
});

ipcMain.handle('gitSync:cancelReview', async (_event, projectPath: string, reviewId: string) => {
  return cancelGitReview(projectPath, reviewId);
});`);
  }

  write(mainPath, text);
}

function patchPreload() {
  let text = read(preloadPath);

  if (text.includes('resolveReviewFile:')) {
    write(preloadPath, text);
    return;
  }

  const marker = "clearToken: (projectPath: string) => ipcRenderer.invoke('gitSync:clearToken', projectPath)";
  if (!text.includes(marker)) fail('Could not find gitSync.clearToken in preload.ts.');

  text = text.replace(
    marker,
    `${marker},
    getReviewState: (projectPath: string) => ipcRenderer.invoke('gitSync:getReviewState', projectPath),
    listReviewFiles: (projectPath: string) => ipcRenderer.invoke('gitSync:listReviewFiles', projectPath),
    readReviewFile: (input: unknown) => ipcRenderer.invoke('gitSync:readReviewFile', input),
    resolveReviewFile: (input: unknown) => ipcRenderer.invoke('gitSync:resolveReviewFile', input),
    completeReview: (projectPath: string, reviewId: string) => ipcRenderer.invoke('gitSync:completeReview', projectPath, reviewId),
    cancelReview: (projectPath: string, reviewId: string) => ipcRenderer.invoke('gitSync:cancelReview', projectPath, reviewId)`
  );

  write(preloadPath, text);
}

function patchViteEnv() {
  let text = read(viteEnvPath);

  if (!text.includes('type AiddGitReviewResolution')) {
    const insertion = `
type AiddGitReviewPackageStatus = 'none' | 'pending' | 'partially_resolved' | 'ready_to_complete' | 'completed';
type AiddGitReviewFileStatus = 'unresolved' | 'resolved';
type AiddGitReviewVersionKind = 'local' | 'remote' | 'base';
type AiddGitReviewResolution = 'keep_local' | 'use_shared' | 'use_combined_draft';

interface AiddGitReviewFile {
  path: string;
  status: AiddGitReviewFileStatus;
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

interface AiddGitReadReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  kind: AiddGitReviewVersionKind;
}

interface AiddGitResolveReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  resolution: AiddGitReviewResolution;
  combinedContent?: string;
}

`;
    const marker = 'interface AiddTrackedProject';
    if (!text.includes(marker)) fail('Could not find AiddTrackedProject marker in vite-env.d.ts.');
    text = text.replace(marker, insertion + marker);
  }

  if (!text.includes('resolveReviewFile:')) {
    const marker = "      clearToken: (projectPath: string) => Promise<AiddGitSyncSettings | null>;";
    if (!text.includes(marker)) fail('Could not find gitSync.clearToken type in vite-env.d.ts.');

    text = text.replace(marker, `${marker}
      getReviewState: (projectPath: string) => Promise<AiddGitReviewState>;
      listReviewFiles: (projectPath: string) => Promise<AiddGitReviewFile[]>;
      readReviewFile: (input: AiddGitReadReviewFileInput) => Promise<string>;
      resolveReviewFile: (input: AiddGitResolveReviewFileInput) => Promise<AiddGitReviewState>;
      completeReview: (projectPath: string, reviewId: string) => Promise<AiddGitReviewState>;
      cancelReview: (projectPath: string, reviewId: string) => Promise<AiddGitReviewState>;`);
  }

  write(viteEnvPath, text);
}

function patchSync() {
  let text = read(syncPath);

  if (!text.includes("import { GitReviewPanel } from './GitReviewPanel';")) {
    text = ensureImport(text, "import { GitReviewPanel } from './GitReviewPanel';");
  }

  if (!text.includes('<GitReviewPanel activeProject={activeProject} />')) {
    const marker = '<Card>\n          <CardHeader>\n            <CardTitle>Local workflow changes</CardTitle>';
    if (text.includes(marker)) {
      text = text.replace(marker, '<GitReviewPanel activeProject={activeProject} />\n\n        ' + marker);
    } else {
      const sectionMarker = '<section className="grid gap-4">';
      if (!text.includes(sectionMarker)) fail('Could not find insertion point in Sync.tsx.');
      text = text.replace(sectionMarker, `${sectionMarker}\n        <GitReviewPanel activeProject={activeProject} />`);
    }
  }

  write(syncPath, text);
}

function patchPackageJson() {
  const pkg = JSON.parse(read(packagePath));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:git-review-resolver'] = 'tsx tests/gitReviewResolver.unit.test.ts';
  pkg.scripts['test:git-conflict-safe'] = 'npm run test:git-open-save-guard && npm run test:git-review-package && npm run test:git-review-resolver';
  write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchMain();
patchPreload();
patchViteEnv();
patchSync();
patchPackageJson();

console.log('Applied Phase 04B review UI and resolver patch.');
console.log('Run: npm run typecheck && npm run test:git-review-resolver && npm run test:git-conflict-safe');
