import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');
const workflowPath = path.resolve('electron/services/gitSyncWorkflow.ts');
const connectorPath = path.resolve('electron/services/gitProjectConnector.ts');

function read(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Could not find ${filePath}. Run this script from the app repo root.`);
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureWorkflowImport(text) {
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+'\.\/services\/gitSyncWorkflow';/m;
  const match = text.match(importRegex);

  if (!match) throw new Error('Could not find gitSyncWorkflow import in electron/main.ts');

  const names = new Set(match[1].split(',').map((name) => name.trim()).filter(Boolean));
  names.add('createCheckpointIfNeeded');
  names.add('syncProject');

  const preferred = ['checkForUpdates', 'createCheckpointIfNeeded', 'getSyncStatus', 'syncProject'];
  const ordered = preferred.filter((name) => names.has(name));
  for (const name of names) if (!ordered.includes(name)) ordered.push(name);

  return text.replace(importRegex, `import { ${ordered.join(', ')} } from './services/gitSyncWorkflow';`);
}

function insertSavePushHelpers(text) {
  if (text.includes('async function checkpointAndShareProjectAfterSaveV2')) return text;

  const helper = `
function isLocalOnlySyncFailureV2(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function isPathInsideV2(childPath: string, parentPath: string) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function shouldSkipSaveCheckpointPathV2(filePath: string) {
  const normalised = filePath.replace(/\\/g, '/');
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

async function findAiddProjectRootForFileV2(filePath: string) {
  const resolved = path.resolve(filePath || '');
  if (!resolved || shouldSkipSaveCheckpointPathV2(resolved)) return null;

  let current = path.dirname(resolved);
  const parsed = path.parse(current);

  while (current && current !== parsed.root) {
    if (await exists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  return null;
}

async function checkpointAndShareProjectAfterSaveV2(projectPath: string) {
  if (!projectPath) return;

  const options = {
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore,
  };

  try {
    const syncResult = await syncProject(options);

    if (syncResult.ok) {
      console.log(\`[AIDD] Saved and shared project changes: \${syncResult.message}\`);
      return;
    }

    if (isLocalOnlySyncFailureV2(syncResult.code)) {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.log(\`[AIDD] Saved project changes locally: \${checkpoint.label}\`);
      }

      return;
    }

    console.warn(\`[AIDD] Saved project changes, but sharing needs attention: \${syncResult.message}\`);
  } catch (error) {
    try {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.warn(\`[AIDD] Saved project changes locally after share failed: \${checkpoint.label}\`);
      }

      return;
    } catch (checkpointError) {
      const message = checkpointError instanceof Error ? checkpointError.message : String(checkpointError);
      throw new Error(\`Saved changes, but could not create local Git checkpoint: \${message}\`);
    }
  }
}

async function withProjectSaveSyncV2<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSaveV2(projectPath);
  return result;
}

`;

  const needle = 'const gitCredentialStore = createKeytarCredentialStore();\n';
  if (!text.includes(needle)) throw new Error('Could not find gitCredentialStore declaration to insert save/push helpers.');
  return text.replace(needle, `${needle}${helper}`);
}

function replaceIfPresent(text, search, replacement) {
  return text.includes(search) ? text.replace(search, replacement) : text;
}

function patchSaveHandlers(text) {
  // Use V2 helper for any earlier helper calls.
  text = text.replaceAll('withProjectCheckpoint(', 'withProjectSaveSyncV2(');
  text = text.replaceAll('withProjectSaveSync(', 'withProjectSaveSyncV2(');
  text = text.replaceAll('checkpointProjectAfterSave(', 'checkpointAndShareProjectAfterSaveV2(');
  text = text.replaceAll('checkpointAndShareProjectAfterSave(', 'checkpointAndShareProjectAfterSaveV2(');

  // Avoid accidentally renaming the V2 helper declaration twice.
  text = text.replaceAll('withProjectSaveSyncV2V2(', 'withProjectSaveSyncV2(');
  text = text.replaceAll('checkpointAndShareProjectAfterSaveV2V2(', 'checkpointAndShareProjectAfterSaveV2(');

  text = replaceIfPresent(
    text,
    "ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => saveWorkflowDocument(input));",
    `ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSyncV2(input.projectPath, () => saveWorkflowDocument(input));
});`
  );

  text = replaceIfPresent(
    text,
    `  await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
    id: existing.id,
    title: existing.title,
    status: input.status,
    required: existing.required,
    body: input.body
  }), 'utf8');
  return readProjectSetup(input.projectPath);`,
    `  await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
    id: existing.id,
    title: existing.title,
    status: input.status,
    required: existing.required,
    body: input.body
  }), 'utf8');
  await checkpointAndShareProjectAfterSaveV2(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  text = replaceIfPresent(
    text,
    `  await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
  await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
  return readProjectSetup(input.projectPath);`,
    `  await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
  await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
  await checkpointAndShareProjectAfterSaveV2(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  text = replaceIfPresent(
    text,
    `  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || []);
  return readProjectSetup(input.projectPath);`,
    `  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || []);
  await checkpointAndShareProjectAfterSaveV2(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  text = replaceIfPresent(
    text,
    `  await createCapability(input.projectPath, input);
  return readProjectSetup(input.projectPath);`,
    `  await createCapability(input.projectPath, input);
  await checkpointAndShareProjectAfterSaveV2(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  const wrappers = [
    ["  return updateComponent(input);", "  return withProjectSaveSyncV2(input.projectPath, () => updateComponent(input));"],
    ["  return updateCapability(input);", "  return withProjectSaveSyncV2(input.projectPath, () => updateCapability(input));"],
    ["  return createDeliveryPackageFromCapability(input);", "  return withProjectSaveSyncV2(input.projectPath, () => createDeliveryPackageFromCapability(input));"],
    ["ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => saveDeliveryPackage(input));", `ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSyncV2(input.projectPath, () => saveDeliveryPackage(input));
});`],
    ["ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => createDeliveryPackagePhase(input));", `ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => {
  return withProjectSaveSyncV2(input.projectPath, () => createDeliveryPackagePhase(input));
});`],
    ["ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => deleteDeliveryPackage(input));", `ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => {
  return withProjectSaveSyncV2(input.projectPath, () => deleteDeliveryPackage(input));
});`],
    ["ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => createDecisionRecord(input));", `ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSyncV2(input.projectPath, () => createDecisionRecord(input));
});`],
    ["  return writeSourceProject(projectPath, result.filePaths[0]);", "  return withProjectSaveSyncV2(projectPath, () => writeSourceProject(projectPath, result.filePaths[0]));"],
    ["  return writeSourceReference(projectPath, result.filePaths[0]);", "  return withProjectSaveSyncV2(projectPath, () => writeSourceReference(projectPath, result.filePaths[0]));"],
  ];

  for (const [search, replacement] of wrappers) {
    text = replaceIfPresent(text, search, replacement);
  }

  // Generic raw editor save path. This catches AiddMarkdownEditor/fs.writeText saves.
  const fsWriteOld = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');
  return true;
});`;

  const fsWriteNew = `ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForFileV2(filePath);
  if (projectPath) {
    await checkpointAndShareProjectAfterSaveV2(projectPath);
  }

  return true;
});`;

  text = replaceIfPresent(text, fsWriteOld, fsWriteNew);

  return text;
}

function patchWorkflowSkips(text) {
  if (text.includes("'.aidd/drag-files/'")) return text;
  return text.replace("  '.aidd-app/',", "  '.aidd-app/',\n  '.aidd/drag-files/',");
}

function patchGitIgnoreEntries(text) {
  return text.replaceAll(
    "const requiredEntries = ['.aidd-app/', 'node_modules/', 'dist/'];",
    "const requiredEntries = ['.aidd-app/', '.aidd/drag-files/', 'node_modules/', 'dist/'];"
  );
}

let main = read(mainPath);
main = ensureWorkflowImport(main);
main = insertSavePushHelpers(main);
main = patchSaveHandlers(main);
main = patchGitIgnoreEntries(main);
write(mainPath, main);

let workflow = read(workflowPath);
workflow = patchWorkflowSkips(workflow);
write(workflowPath, workflow);

if (fs.existsSync(connectorPath)) {
  let connector = read(connectorPath);
  connector = patchGitIgnoreEntries(connector);
  write(connectorPath, connector);
}

console.log('Applied Phase 03 save/push wiring v2.');
console.log('Raw editor saves and known project save handlers now checkpoint locally and attempt remote share.');
