import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const workflowPath = path.resolve('electron/services/gitSyncWorkflow.ts');
const connectorPath = path.resolve('electron/services/gitProjectConnector.ts');

function fail(message) {
  throw new Error(message);
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Could not find ${filePath}. Run this script from the app repo root.`);
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
    fail('Could not find import from ./services/gitSyncWorkflow in electron/main.ts.');
  }

  const names = new Set(match[1].split(',').map((name) => name.trim()).filter(Boolean));
  names.add('createCheckpointIfNeeded');
  names.add('syncProject');

  const preferredOrder = ['checkForUpdates', 'createCheckpointIfNeeded', 'getSyncStatus', 'syncProject'];
  const ordered = preferredOrder.filter((name) => names.has(name));

  for (const name of names) {
    if (!ordered.includes(name)) {
      ordered.push(name);
    }
  }

  return text.replace(importRegex, `import { ${ordered.join(', ')} } from './services/gitSyncWorkflow';`);
}

function findGitCredentialStoreInsertion(text) {
  const candidates = [
    'const gitCredentialStore = createKeytarCredentialStore();\n',
    'const gitCredentialStore = createKeytarCredentialStore();\r\n',
  ];

  for (const candidate of candidates) {
    const index = text.indexOf(candidate);
    if (index >= 0) {
      return { index, length: candidate.length, candidate };
    }
  }

  fail('Could not find "const gitCredentialStore = createKeytarCredentialStore();" in electron/main.ts.');
}

function insertHelpers(text) {
  const helperName = 'checkpointAndShareProjectAfterSaveV4';
  if (text.includes(helperName)) {
    return text;
  }

  const helper = `
function isLocalOnlySyncFailureV4(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function shouldSkipSaveCheckpointPathV4(filePath: string) {
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

async function findAiddProjectRootForFileV4(filePath: string) {
  const resolved = path.resolve(filePath || '');

  if (!resolved || shouldSkipSaveCheckpointPathV4(resolved)) {
    return null;
  }

  let current = path.dirname(resolved);

  while (true) {
    if (await exists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    if (await exists(path.join(current, '.git'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) {
      break;
    }

    current = next;
  }

  return null;
}

async function checkpointAndShareProjectAfterSaveV4(projectPath: string) {
  if (!projectPath) {
    return;
  }

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

    if (isLocalOnlySyncFailureV4(syncResult.code)) {
      console.log(\`[AIDD save-sync] Remote share skipped: \${syncResult.message}\`);
      return;
    }

    console.warn(\`[AIDD save-sync] Remote share needs attention: \${syncResult.message}\`);
  } catch (error) {
    try {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.warn(\`[AIDD save-sync] Saved and checkpointed locally after share failed: \${checkpoint.label}\`);
        return;
      }
    } catch (checkpointError) {
      console.warn(\`[AIDD save-sync] Checkpoint failed after save: \${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}\`);
    }

    console.warn(\`[AIDD save-sync] Saved, but checkpoint/share did not complete: \${error instanceof Error ? error.message : String(error)}\`);
  }
}

async function withProjectSaveSyncV4<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSaveV4(projectPath);
  return result;
}

`;

  const insertion = findGitCredentialStoreInsertion(text);
  return text.slice(0, insertion.index + insertion.length) + helper + text.slice(insertion.index + insertion.length);
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

    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;

    if (depth === 0) {
      let end = i + 1;
      while (end < text.length && /\s/.test(text[end])) end += 1;
      if (text[end] === ';') end += 1;
      return { start, end };
    }
  }

  return null;
}

function replaceIpcHandler(text, channel, replacement, stats) {
  const span = findIpcHandlerSpan(text, channel);
  if (!span) {
    stats.push(`missing ${channel}`);
    return text;
  }

  stats.push(`patched ${channel}`);
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

function patchRawWriteText(text, stats) {
  const replacement = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForFileV4(filePath);

  if (projectPath) {
    await checkpointAndShareProjectAfterSaveV4(projectPath);
  }

  return true;
});`;

  return replaceIpcHandler(text, 'fs:writeText', replacement, stats);
}

function patchKnownSaveHandlers(text, stats) {
  const handlerReplacements = [
    [
      'project:saveWorkflowDocument',
      `ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSyncV4(input.projectPath, () => saveWorkflowDocument(input));
});`
    ],
    [
      'project:saveDeliveryPackage',
      `ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSyncV4(input.projectPath, () => saveDeliveryPackage(input));
});`
    ],
    [
      'project:createDeliveryPackagePhase',
      `ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => {
  return withProjectSaveSyncV4(input.projectPath, () => createDeliveryPackagePhase(input));
});`
    ],
    [
      'project:deleteDeliveryPackage',
      `ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => {
  return withProjectSaveSyncV4(input.projectPath, () => deleteDeliveryPackage(input));
});`
    ],
    [
      'project:createDecision',
      `ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSyncV4(input.projectPath, () => createDecisionRecord(input));
});`
    ],
  ];

  for (const [channel, replacement] of handlerReplacements) {
    if (text.includes(`ipcMain.handle('${channel}'`)) {
      text = replaceIpcHandler(text, channel, replacement, stats);
    }
  }

  return text;
}

function patchReadProjectSetupReturns(text, stats) {
  const channels = [
    'project:saveFoundationDocument',
    'project:defineStandards',
    'project:createComponent',
    'project:createCapability',
  ];

  for (const channel of channels) {
    const span = findIpcHandlerSpan(text, channel);
    if (!span) {
      stats.push(`missing ${channel}`);
      continue;
    }

    let block = text.slice(span.start, span.end);
    if (block.includes('checkpointAndShareProjectAfterSaveV4(input.projectPath)')) {
      stats.push(`already patched ${channel}`);
      continue;
    }

    const previous = block;
    block = block.replace(
      /return readProjectSetup\(input\.projectPath\);/g,
      `await checkpointAndShareProjectAfterSaveV4(input.projectPath);
  return readProjectSetup(input.projectPath);`
    );

    if (block === previous) {
      stats.push(`no readProjectSetup return found in ${channel}`);
      continue;
    }

    stats.push(`patched ${channel}`);
    text = text.slice(0, span.start) + block + text.slice(span.end);
  }

  return text;
}

function patchSimpleReturns(text, stats) {
  const replacements = [
    ["return updateComponent(input);", "return withProjectSaveSyncV4(input.projectPath, () => updateComponent(input));", "patched updateComponent return"],
    ["return updateCapability(input);", "return withProjectSaveSyncV4(input.projectPath, () => updateCapability(input));", "patched updateCapability return"],
    ["return createDeliveryPackageFromCapability(input);", "return withProjectSaveSyncV4(input.projectPath, () => createDeliveryPackageFromCapability(input));", "patched delivery package return"],
    ["return writeSourceProject(projectPath, result.filePaths[0]);", "return withProjectSaveSyncV4(projectPath, () => writeSourceProject(projectPath, result.filePaths[0]));", "patched source project return"],
    ["return writeSourceReference(projectPath, result.filePaths[0]);", "return withProjectSaveSyncV4(projectPath, () => writeSourceReference(projectPath, result.filePaths[0]));", "patched source reference return"],
  ];

  for (const [search, replacement, label] of replacements) {
    if (text.includes(search)) {
      text = text.replace(search, replacement);
      stats.push(label);
    }
  }

  return text;
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

let main = read(mainPath);
const stats = [];

main = ensureWorkflowImport(main);
main = insertHelpers(main);
main = patchRawWriteText(main, stats);
main = patchKnownSaveHandlers(main, stats);
main = patchReadProjectSetupReturns(main, stats);
main = patchSimpleReturns(main, stats);
main = patchGitIgnoreEntries(main);

if (!main.includes('checkpointAndShareProjectAfterSaveV4')) {
  fail('Patch failed: checkpointAndShareProjectAfterSaveV4 was not inserted.');
}

if (!main.includes("ipcMain.handle('fs:writeText'") || !main.includes('findAiddProjectRootForFileV4(filePath)')) {
  fail('Patch failed: fs:writeText was not rewired.');
}

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

console.log('Applied Phase 03 force save wiring v4.');
console.log('');
console.log('Patch results:');
for (const item of stats) {
  console.log(`- ${item}`);
}
console.log('');
console.log('Required verification command:');
console.log('Select-String -Path .\\\\electron\\\\main.ts -Pattern "checkpointAndShareProjectAfterSaveV4|withProjectSaveSyncV4|findAiddProjectRootForFileV4|fs:writeText" -Context 0,4');
