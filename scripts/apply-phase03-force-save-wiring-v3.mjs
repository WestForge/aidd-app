import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const workflowPath = path.resolve('electron/services/gitSyncWorkflow.ts');
const connectorPath = path.resolve('electron/services/gitProjectConnector.ts');

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Could not find ${filePath}. Run this script from the app repo root.`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureWorkflowImport(text) {
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+'\.\/services\/gitSyncWorkflow';/m;
  const match = text.match(importRegex);

  if (!match) {
    throw new Error('Could not find gitSyncWorkflow import in electron/main.ts');
  }

  const names = new Set(match[1].split(',').map((name) => name.trim()).filter(Boolean));
  names.add('createCheckpointIfNeeded');
  names.add('syncProject');

  const preferred = ['checkForUpdates', 'createCheckpointIfNeeded', 'getSyncStatus', 'syncProject'];
  const ordered = preferred.filter((name) => names.has(name));
  for (const name of names) {
    if (!ordered.includes(name)) ordered.push(name);
  }

  return text.replace(importRegex, `import { ${ordered.join(', ')} } from './services/gitSyncWorkflow';`);
}

function insertHelpers(text) {
  if (text.includes('async function checkpointAndShareProjectAfterSaveV3')) {
    return text;
  }

  const helper = `
function isLocalOnlySyncFailureV3(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function shouldSkipSaveCheckpointPathV3(filePath: string) {
  const normalised = path.resolve(filePath || '').replace(/\\\\/g, '/');

  return (
    normalised.includes('/.git/') ||
    normalised.includes('/.aidd-app/') ||
    normalised.includes('/.aidd/drag-files/') ||
    normalised.endsWith('/.env') ||
    normalised.includes('/node_modules/') ||
    normalised.includes('/dist/') ||
    normalised.includes('/build/')
  );
}

async function findAiddProjectRootForFileV3(filePath: string) {
  const resolved = path.resolve(filePath || '');
  if (!resolved || shouldSkipSaveCheckpointPathV3(resolved)) return null;

  let current = path.dirname(resolved);

  while (true) {
    if (await exists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    if (await exists(path.join(current, '.git'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  return null;
}

async function checkpointAndShareProjectAfterSaveV3(projectPath: string) {
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

    if (isLocalOnlySyncFailureV3(syncResult.code)) {
      console.log(\`[AIDD save-sync] Remote share skipped: \${syncResult.message}\`);
      return;
    }

    console.warn(\`[AIDD save-sync] Remote share needs attention: \${syncResult.message}\`);
  } catch (error) {
    const checkpoint = await createCheckpointIfNeeded(options);

    if (checkpoint.created) {
      console.warn(\`[AIDD save-sync] Saved and checkpointed locally after share failed: \${checkpoint.label}\`);
      return;
    }

    console.warn(\`[AIDD save-sync] Saved, but checkpoint/share did not complete: \${error instanceof Error ? error.message : String(error)}\`);
  }
}

async function withProjectSaveSyncV3<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSaveV3(projectPath);
  return result;
}

`;

  const needle = 'const gitCredentialStore = createKeytarCredentialStore();\n';
  if (!text.includes(needle)) {
    throw new Error('Could not find gitCredentialStore declaration to insert save-sync helpers.');
  }

  return text.replace(needle, `${needle}${helper}`);
}

function findIpcHandlerSpan(text, channel) {
  const start = text.indexOf(`ipcMain.handle('${channel}'`);
  if (start < 0) return null;

  const firstParen = text.indexOf('(', start);
  if (firstParen < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = firstParen; i < text.length; i++) {
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
  if (!span) {
    return { text, changed: false };
  }

  return {
    text: text.slice(0, span.start) + replacement + text.slice(span.end),
    changed: true,
  };
}

function patchRawWriteTextHandler(text, stats) {
  const replacement = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForFileV3(filePath);
  if (projectPath) {
    await checkpointAndShareProjectAfterSaveV3(projectPath);
  }

  return true;
});`;

  const result = replaceIpcHandler(text, 'fs:writeText', replacement);
  if (result.changed) stats.push('patched fs:writeText');
  return result.text;
}

function patchSimpleOneLineHandlers(text, stats) {
  const replacements = [
    [
      "ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => saveWorkflowDocument(input));",
      `ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSyncV3(input.projectPath, () => saveWorkflowDocument(input));
});`,
      'patched project:saveWorkflowDocument'
    ],
    [
      "ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => saveDeliveryPackage(input));",
      `ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSyncV3(input.projectPath, () => saveDeliveryPackage(input));
});`,
      'patched project:saveDeliveryPackage'
    ],
    [
      "ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => createDeliveryPackagePhase(input));",
      `ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => {
  return withProjectSaveSyncV3(input.projectPath, () => createDeliveryPackagePhase(input));
});`,
      'patched project:createDeliveryPackagePhase'
    ],
    [
      "ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => deleteDeliveryPackage(input));",
      `ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => {
  return withProjectSaveSyncV3(input.projectPath, () => deleteDeliveryPackage(input));
});`,
      'patched project:deleteDeliveryPackage'
    ],
    [
      "ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => createDecisionRecord(input));",
      `ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSyncV3(input.projectPath, () => createDecisionRecord(input));
});`,
      'patched project:createDecision'
    ],
  ];

  for (const [search, replacement, label] of replacements) {
    if (text.includes(search)) {
      text = text.replace(search, replacement);
      stats.push(label);
    }
  }

  return text;
}

function patchReturnBeforeSetupRead(text, channel, stats) {
  const span = findIpcHandlerSpan(text, channel);
  if (!span) return text;

  let block = text.slice(span.start, span.end);
  if (block.includes('checkpointAndShareProjectAfterSaveV3(input.projectPath)')) return text;

  const before = block;
  block = block.replace(
    /return readProjectSetup\(input\.projectPath\);/g,
    `await checkpointAndShareProjectAfterSaveV3(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  if (block !== before) {
    stats.push(`patched ${channel}`);
    return text.slice(0, span.start) + block + text.slice(span.end);
  }

  return text;
}

function patchReturnWrappers(text, stats) {
  const replacements = [
    ["  return updateComponent(input);", "  return withProjectSaveSyncV3(input.projectPath, () => updateComponent(input));", 'patched updateComponent'],
    ["  return updateCapability(input);", "  return withProjectSaveSyncV3(input.projectPath, () => updateCapability(input));", 'patched updateCapability'],
    ["  return createDeliveryPackageFromCapability(input);", "  return withProjectSaveSyncV3(input.projectPath, () => createDeliveryPackageFromCapability(input));", 'patched createDeliveryPackageFromCapability'],
    ["  return writeSourceProject(projectPath, result.filePaths[0]);", "  return withProjectSaveSyncV3(projectPath, () => writeSourceProject(projectPath, result.filePaths[0]));", 'patched writeSourceProject'],
    ["  return writeSourceReference(projectPath, result.filePaths[0]);", "  return withProjectSaveSyncV3(projectPath, () => writeSourceReference(projectPath, result.filePaths[0]));", 'patched writeSourceReference'],
  ];

  for (const [search, replacement, label] of replacements) {
    if (text.includes(search)) {
      text = text.replace(search, replacement);
      stats.push(label);
    }
  }

  return text;
}

function normaliseOldHelperNames(text) {
  return text
    .replaceAll('withProjectCheckpoint(', 'withProjectSaveSyncV3(')
    .replaceAll('withProjectSaveSync(', 'withProjectSaveSyncV3(')
    .replaceAll('withProjectSaveSyncV2(', 'withProjectSaveSyncV3(')
    .replaceAll('checkpointProjectAfterSave(', 'checkpointAndShareProjectAfterSaveV3(')
    .replaceAll('checkpointAndShareProjectAfterSave(', 'checkpointAndShareProjectAfterSaveV3(')
    .replaceAll('checkpointAndShareProjectAfterSaveV2(', 'checkpointAndShareProjectAfterSaveV3(')
    .replaceAll('withProjectSaveSyncV3V3(', 'withProjectSaveSyncV3(')
    .replaceAll('checkpointAndShareProjectAfterSaveV3V3(', 'checkpointAndShareProjectAfterSaveV3(');
}

function patchGitIgnoreEntries(text) {
  return text.replaceAll(
    "const requiredEntries = ['.aidd-app/', 'node_modules/', 'dist/'];",
    "const requiredEntries = ['.aidd-app/', '.aidd/drag-files/', 'node_modules/', 'dist/'];"
  );
}

function patchWorkflowSkips(text) {
  if (text.includes("'.aidd/drag-files/'")) return text;
  return text.replace("  '.aidd-app/',", "  '.aidd-app/',\n  '.aidd/drag-files/',");
}

const stats = [];
let main = read(mainPath);

main = ensureWorkflowImport(main);
main = insertHelpers(main);
main = normaliseOldHelperNames(main);
main = patchRawWriteTextHandler(main, stats);
main = patchSimpleOneLineHandlers(main, stats);
main = patchReturnBeforeSetupRead(main, 'project:saveFoundationDocument', stats);
main = patchReturnBeforeSetupRead(main, 'project:defineStandards', stats);
main = patchReturnBeforeSetupRead(main, 'project:createComponent', stats);
main = patchReturnBeforeSetupRead(main, 'project:createCapability', stats);
main = patchReturnWrappers(main, stats);
main = patchGitIgnoreEntries(main);

write(mainPath, main);

if (fs.existsSync(workflowPath)) {
  let workflow = read(workflowPath);
  workflow = patchWorkflowSkips(workflow);
  write(workflowPath, workflow);
}

if (fs.existsSync(connectorPath)) {
  let connector = read(connectorPath);
  connector = patchGitIgnoreEntries(connector);
  write(connectorPath, connector);
}

console.log('Applied Phase 03 force save wiring v3.');
console.log('Patched paths:');
for (const item of stats) {
  console.log(`- ${item}`);
}

if (stats.length === 0) {
  console.warn('No specific save handlers were changed. Check electron/main.ts manually.');
}

console.log('');
console.log('Verify with:');
console.log('Select-String -Path .\\\\electron\\\\main.ts -Pattern "checkpointAndShareProjectAfterSaveV3|withProjectSaveSyncV3|fs:writeText"');
