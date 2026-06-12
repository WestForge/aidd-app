import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve('electron/main.ts');

if (!fs.existsSync(mainPath)) {
  throw new Error(`Could not find ${mainPath}. Run this script from the app repo root.`);
}

let text = fs.readFileSync(mainPath, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Could not apply patch: ${label}`);
  }

  text = text.replace(search, replacement);
}

function replaceIfPresent(search, replacement) {
  if (text.includes(search)) {
    text = text.replace(search, replacement);
  }
}

function ensureGitSyncWorkflowImport() {
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+'\.\/services\/gitSyncWorkflow';/m;
  const match = text.match(importRegex);

  if (!match) {
    throw new Error('Could not find gitSyncWorkflow import in electron/main.ts');
  }

  const names = new Set(
    match[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );

  names.add('createCheckpointIfNeeded');
  names.add('syncProject');

  const ordered = [
    'checkForUpdates',
    'createCheckpointIfNeeded',
    'getSyncStatus',
    'syncProject',
  ].filter((name) => names.has(name));

  for (const name of names) {
    if (!ordered.includes(name)) {
      ordered.push(name);
    }
  }

  text = text.replace(importRegex, `import { ${ordered.join(', ')} } from './services/gitSyncWorkflow';`);
}

function ensureSaveShareHelpers() {
  const helper = `
function isLocalOnlySyncFailure(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

async function checkpointAndShareProjectAfterSave(projectPath: string) {
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

    if (isLocalOnlySyncFailure(syncResult.code)) {
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

async function withProjectSaveSync<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSave(projectPath);
  return result;
}

`;

  if (text.includes('async function checkpointAndShareProjectAfterSave')) {
    return;
  }

  if (text.includes('const gitCredentialStore = createKeytarCredentialStore();')) {
    text = text.replace(
      'const gitCredentialStore = createKeytarCredentialStore();\n',
      `const gitCredentialStore = createKeytarCredentialStore();\n${helper}`
    );
    return;
  }

  throw new Error('Could not find gitCredentialStore declaration to insert save/share helpers.');
}

function patchSaveHandlers() {
  // Upgrade older local-checkpoint helper usage if present.
  text = text.replaceAll('withProjectCheckpoint(', 'withProjectSaveSync(');
  text = text.replaceAll('checkpointProjectAfterSave(', 'checkpointAndShareProjectAfterSave(');

  // Raw workflow document save.
  replaceIfPresent(
    "ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => saveWorkflowDocument(input));",
    `ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSync(input.projectPath, () => saveWorkflowDocument(input));
});`
  );

  // Foundation document save.
  replaceIfPresent(
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
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  // Standards save.
  replaceIfPresent(
    `  await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
  await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
  return readProjectSetup(input.projectPath);`,
    `  await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
  await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  // Create component/capability.
  replaceIfPresent(
    `  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || []);
  return readProjectSetup(input.projectPath);`,
    `  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || []);
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  replaceIfPresent(
    `  await createCapability(input.projectPath, input);
  return readProjectSetup(input.projectPath);`,
    `  await createCapability(input.projectPath, input);
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);`
  );

  // Raw update/create/delete handlers.
  replaceIfPresent(
    "  return updateComponent(input);",
    "  return withProjectSaveSync(input.projectPath, () => updateComponent(input));"
  );

  replaceIfPresent(
    "  return updateCapability(input);",
    "  return withProjectSaveSync(input.projectPath, () => updateCapability(input));"
  );

  replaceIfPresent(
    "  return createDeliveryPackageFromCapability(input);",
    "  return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromCapability(input));"
  );

  replaceIfPresent(
    "ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => saveDeliveryPackage(input));",
    `ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSync(input.projectPath, () => saveDeliveryPackage(input));
});`
  );

  replaceIfPresent(
    "ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => createDeliveryPackagePhase(input));",
    `ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => {
  return withProjectSaveSync(input.projectPath, () => createDeliveryPackagePhase(input));
});`
  );

  replaceIfPresent(
    "ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => deleteDeliveryPackage(input));",
    `ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => {
  return withProjectSaveSync(input.projectPath, () => deleteDeliveryPackage(input));
});`
  );

  replaceIfPresent(
    "ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => createDecisionRecord(input));",
    `ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSync(input.projectPath, () => createDecisionRecord(input));
});`
  );

  // Source project/reference writes.
  replaceIfPresent(
    "  return writeSourceProject(projectPath, result.filePaths[0]);",
    "  return withProjectSaveSync(projectPath, () => writeSourceProject(projectPath, result.filePaths[0]));"
  );

  replaceIfPresent(
    "  return writeSourceReference(projectPath, result.filePaths[0]);",
    "  return withProjectSaveSync(projectPath, () => writeSourceReference(projectPath, result.filePaths[0]));"
  );
}

ensureGitSyncWorkflowImport();
ensureSaveShareHelpers();
patchSaveHandlers();

fs.writeFileSync(mainPath, text, 'utf8');

console.log('Applied Phase 03 push-on-save patch.');
console.log('Explicit project saves now create a local checkpoint and attempt to share it when remote sync is configured.');
