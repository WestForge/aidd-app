import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const workflowPath = path.resolve('electron/services/gitSyncWorkflow.ts');
const connectorPath = path.resolve('electron/services/gitProjectConnector.ts');

function fail(message) {
  console.error('');
  console.error(`FAILED: ${message}`);
  process.exit(1);
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

function ensureGitSyncWorkflowImport(text) {
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+'\.\/services\/gitSyncWorkflow';/m;
  const match = text.match(importRegex);

  if (match) {
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

  const connectorImport = "import { connectProjectToRepository, getProjectConnectionStatus } from './services/gitProjectConnector';";
  if (text.includes(connectorImport)) {
    return text.replace(
      connectorImport,
      `${connectorImport}\nimport { createCheckpointIfNeeded, syncProject } from './services/gitSyncWorkflow';`
    );
  }

  fail('Could not find a place to import createCheckpointIfNeeded and syncProject.');
}

function insertHelpers(text) {
  if (text.includes('checkpointAndShareProjectAfterSaveV5')) {
    return text;
  }

  const helper = `
function isLocalOnlySyncFailureV5(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function shouldSkipSaveCheckpointPathV5(filePath: string) {
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

async function findAiddProjectRootForFileV5(filePath: string) {
  const resolved = path.resolve(filePath || '');

  if (!resolved || shouldSkipSaveCheckpointPathV5(resolved)) {
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

async function checkpointAndShareProjectAfterSaveV5(projectPath: string) {
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

    if (isLocalOnlySyncFailureV5(syncResult.code)) {
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

async function withProjectSaveSyncV5<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSaveV5(projectPath);
  return result;
}

`;

  const declaration = 'const gitCredentialStore = createKeytarCredentialStore();';
  const index = text.indexOf(declaration);

  if (index < 0) {
    fail('Could not find gitCredentialStore declaration.');
  }

  const insertAt = index + declaration.length;
  return text.slice(0, insertAt) + helper + text.slice(insertAt);
}

function patchFsWriteText(text) {
  const currentHandlerRegex =
    /ipcMain\.handle\('fs:writeText',\s*async\s*\(_event,\s*filePath:\s*string,\s*content:\s*string\)\s*=>\s*\{\s*await\s+fsp\.mkdir\(path\.dirname\(filePath\),\s*\{\s*recursive:\s*true\s*\}\);\s*await\s+fsp\.writeFile\(filePath,\s*content,\s*['"]utf8['"]\);\s*return\s+true;\s*\}\);/m;

  const replacement = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForFileV5(filePath);

  if (projectPath) {
    await checkpointAndShareProjectAfterSaveV5(projectPath);
  }

  return true;
});`;

  if (currentHandlerRegex.test(text)) {
    return {
      text: text.replace(currentHandlerRegex, replacement),
      changed: true,
      mode: 'regex',
    };
  }

  const start = text.indexOf("ipcMain.handle('fs:writeText'");
  if (start < 0) {
    fail("Could not find ipcMain.handle('fs:writeText'...)");
  }

  const endMarker = '});';
  const end = text.indexOf(endMarker, start);
  if (end < 0) {
    fail("Could not find end of fs:writeText handler.");
  }

  return {
    text: text.slice(0, start) + replacement + text.slice(end + endMarker.length),
    changed: true,
    mode: 'fallback',
  };
}

function patchKnownHandlers(text) {
  const replacements = [
    [
      "ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => saveWorkflowDocument(input));",
      `ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSyncV5(input.projectPath, () => saveWorkflowDocument(input));
});`,
    ],
    [
      "ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => saveDeliveryPackage(input));",
      `ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSyncV5(input.projectPath, () => saveDeliveryPackage(input));
});`,
    ],
    [
      "ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => createDecisionRecord(input));",
      `ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSyncV5(input.projectPath, () => createDecisionRecord(input));
});`,
    ],
  ];

  let count = 0;
  for (const [search, replacement] of replacements) {
    if (text.includes(search)) {
      text = text.replace(search, replacement);
      count += 1;
    }
  }

  text = text.replaceAll('withProjectSaveSyncV4(', 'withProjectSaveSyncV5(');
  text = text.replaceAll('checkpointAndShareProjectAfterSaveV4(', 'checkpointAndShareProjectAfterSaveV5(');

  return { text, count };
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

main = ensureGitSyncWorkflowImport(main);
main = insertHelpers(main);

const fsPatch = patchFsWriteText(main);
main = fsPatch.text;

const knownPatch = patchKnownHandlers(main);
main = knownPatch.text;
main = patchGitIgnoreEntries(main);

if (!main.includes('checkpointAndShareProjectAfterSaveV5')) {
  fail('Verification failed: helper was not inserted.');
}

if (!main.includes('findAiddProjectRootForFileV5(filePath)')) {
  fail('Verification failed: fs:writeText does not find project root.');
}

if (!main.includes('await checkpointAndShareProjectAfterSaveV5(projectPath);')) {
  fail('Verification failed: fs:writeText does not checkpoint/share.');
}

write(mainPath, main);

if (fs.existsSync(workflowPath)) {
  write(workflowPath, patchWorkflowSkips(read(workflowPath)));
}

if (fs.existsSync(connectorPath)) {
  write(connectorPath, patchGitIgnoreEntries(read(connectorPath)));
}

console.log('');
console.log('Applied Phase 03 force save wiring v5.');
console.log(`fs:writeText patch mode: ${fsPatch.mode}`);
console.log(`Known one-line handlers patched: ${knownPatch.count}`);
console.log('');
console.log('Now run:');
console.log('Select-String -Path .\\\\electron\\\\main.ts -Pattern "checkpointAndShareProjectAfterSaveV5|withProjectSaveSyncV5|findAiddProjectRootForFileV5|fs:writeText" -Context 0,8');
