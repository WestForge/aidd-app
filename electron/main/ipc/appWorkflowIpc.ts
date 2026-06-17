import { ipcMain, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { checkpointAndShareProjectAfterSave, withProjectSaveSync } from './saveSync';
import {
  STANDARD_SECTION_DEFINITIONS,
  buildFoundationMarkdown,
  buildStandardSectionMarkdown,
  buildStandardsMarkdown,
  createFoundationReviewPackage,
  createStandardsReviewPackage,
  importFoundationDocumentUpdate,
  importFoundationReviewPackage,
  importStandardSectionUpdate,
  importStandardsReviewPackage,
  readFoundationDocuments,
  readProjectSetup,
  readStandardSections,
  readWorkflowDocuments,
  saveWorkflowDocument,
  showNativeNotification,
  writeJson,
  writeStandardsManifest
} from '../domain/aiddProjectService';
import type {
  DefineStandardsInput,
  ImportFoundationDocumentUpdateInput,
  ImportFoundationReviewPackageInput,
  ImportStandardSectionUpdateInput,
  ImportStandardsReviewPackageInput,
  NotifyInput,
  SaveFoundationInput,
  SaveStandardSectionInput,
  SaveWorkflowDocumentInput
} from '../domain/aiddProjectService';

export function registerAppWorkflowIpcHandlers() {
  ipcMain.handle('app:notify', async (_event, input: NotifyInput) => showNativeNotification(input));

  ipcMain.handle('app:showItemInFolder', async (_event, filePath: string) => {
    const resolvedPath = path.resolve(filePath || '');
    if (!resolvedPath || !fs.existsSync(resolvedPath)) throw new Error(`File does not exist: ${filePath}`);
    shell.showItemInFolder(resolvedPath);
    return true;
  });

  ipcMain.handle('project:setup', async (_event, projectPath: string) => readProjectSetup(projectPath));

  ipcMain.handle('project:workflowDocuments', async (_event, projectPath: string) => readWorkflowDocuments(projectPath));

  ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
    return withProjectSaveSync(input.projectPath, () => saveWorkflowDocument(input));
  });

  ipcMain.handle('project:packageFoundationForReview', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return createFoundationReviewPackage(projectPath);
  });

  ipcMain.handle('project:prepareFoundationReviewPackage', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return createFoundationReviewPackage(projectPath);
  });

  ipcMain.handle('project:importFoundationReviewPackage', async (_event, input: ImportFoundationReviewPackageInput) => {
    if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and foundation review response zip path are required.');
    return withProjectSaveSync(input.projectPath, () => importFoundationReviewPackage(input));
  });

  ipcMain.handle('project:importFoundationDocumentUpdate', async (_event, input: ImportFoundationDocumentUpdateInput) => {
    if (!input?.projectPath || !input?.fileName || !input?.updateFilePath) throw new Error('Project path, foundation file name and Markdown update path are required.');
    return withProjectSaveSync(input.projectPath, () => importFoundationDocumentUpdate(input));
  });


  ipcMain.handle('project:packageStandardsForReview', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return createStandardsReviewPackage(projectPath);
  });

  ipcMain.handle('project:prepareStandardsReviewPackage', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return createStandardsReviewPackage(projectPath);
  });

  ipcMain.handle('project:importStandardsReviewPackage', async (_event, input: ImportStandardsReviewPackageInput) => {
    if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and standards review response zip path are required.');
    return withProjectSaveSync(input.projectPath, () => importStandardsReviewPackage(input));
  });

  ipcMain.handle('project:importStandardSectionUpdate', async (_event, input: ImportStandardSectionUpdateInput) => {
    if (!input?.projectPath || !input?.fileName || !input?.updateFilePath) throw new Error('Project path, standards file name and Markdown update path are required.');
    return withProjectSaveSync(input.projectPath, () => importStandardSectionUpdate(input));
  });

  ipcMain.handle('project:saveFoundationDocument', async (_event, input: SaveFoundationInput) => {
    const docs = await readFoundationDocuments(input.projectPath);
    const existing = docs.find((doc) => doc.fileName === input.fileName);
    if (!existing) throw new Error(`Unknown foundation document: ${input.fileName}`);
    await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
      id: existing.id,
      title: existing.title,
      status: input.status,
      required: existing.required,
      body: input.body
    }), 'utf8');
    await checkpointAndShareProjectAfterSave(input.projectPath);
    return readProjectSetup(input.projectPath);
  });

  ipcMain.handle('project:defineStandards', async (_event, input: DefineStandardsInput) => {
    const standardsDir = path.join(input.projectPath, 'foundation', 'standards');
    await fsp.mkdir(standardsDir, { recursive: true });
    await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
    await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
    await checkpointAndShareProjectAfterSave(input.projectPath);
    return readProjectSetup(input.projectPath);
  });


  ipcMain.handle('project:saveStandardSection', async (_event, input: SaveStandardSectionInput) => {
    const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
    if (!definition) throw new Error(`Unknown standards section: ${input.fileName}`);

    const standardsDir = path.join(input.projectPath, 'foundation', 'standards');
    await fsp.mkdir(standardsDir, { recursive: true });
    await fsp.writeFile(path.join(standardsDir, definition.fileName), buildStandardSectionMarkdown({
      id: definition.id,
      title: definition.title,
      status: input.status,
      required: definition.required,
      body: input.body
    }), 'utf8');

    const sections = await readStandardSections(input.projectPath);
    await writeStandardsManifest(input.projectPath, sections);
    await checkpointAndShareProjectAfterSave(input.projectPath);
    return readProjectSetup(input.projectPath);
  });
}
