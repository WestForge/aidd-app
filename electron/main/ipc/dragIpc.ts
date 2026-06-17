import { app, ipcMain } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import matter from '../../frontmatter';
import {
  STANDARD_SECTION_DEFINITIONS,
  TEMPLATE_VERSION,
  buildFoundationMarkdown,
  buildStandardSectionMarkdown,
  exists,
  slugify
} from '../domain/aiddProjectService';
import type {
  PrepareComponentContractDragFileInput,
  PrepareFoundationDragFileInput,
  PrepareMarkdownDragFileInput,
  PrepareStandardSectionDragFileInput
} from '../domain/aiddProjectService';

export function registerDragIpcHandlers() {
  const dragIconPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABOklEQVR4nO2aUQ6CMBBEV+PZ4MxwOf1qVBJid7rbqXTeP/XNQAsWzIQQQgghxJzcIgZZluUZMQ7Cvu9NGZoOZgY/ghZxR39wpPBmuA9UwGjhC4iXu4BRwxe8fq4CRg9f8HjCa8BVqC7gX85+odb3kS1S2LbNfcy6rgkm32gKsAXYqAC2ABsVwBZgowLYAmxUAFuAjQpgC7BRAWwBNiqALcBGBbAF2ExfQPieILL35x0rcq8w/ArI3siMHj9lCmSVkDFu2hoQLZtVauoiGCWdOa3S7wKt8tlrSpfbIBriUm+GvGF6hDfr/CBUG6pXeDPCk+CvcD3DmzkKaP0a65OzkJHha31p/wWOYXuf+YKrgMirwOwdOjq8xxMKNPLXIt6TBE2B6CshCsQLXgNGKwH1mf5bYSGEEEKIaXkB8t1QIHKJzAcAAAAASUVORK5CYII=';

  function dragIconPath() {
    const iconPath = path.join(app.getPath('userData'), 'native-file-drag-icon.png');
    const iconBuffer = Buffer.from(dragIconPngBase64, 'base64');

    // Always rewrite the icon. Earlier builds could leave a corrupt cached PNG in
    // AppData, and Electron will crash the main process if startDrag receives an
    // invalid image path.
    fs.writeFileSync(iconPath, iconBuffer);

    return iconPath;
  }

  function safeDragFileName(fileName: string) {
    const parsed = path.parse(fileName || 'foundation.md');
    const baseName = slugify(parsed.name || 'foundation');
    const ext = parsed.ext && parsed.ext.toLowerCase() === '.md' ? '.md' : '.md';
    return `${baseName}${ext}`;
  }

  function safeDragDirectory(directory?: string) {
    return (directory || 'markdown')
      .split(/[\\/]+/)
      .map((part) => slugify(part))
      .filter(Boolean);
  }

  async function prepareMarkdownDragFile(input: PrepareMarkdownDragFileInput) {
    if (!input.projectPath) throw new Error('Project path is required.');
    if (!input.fileName) throw new Error('Markdown file name is required.');

    const projectPath = path.resolve(input.projectPath);
    const dragDir = path.join(projectPath, '.aidd', 'drag-files', ...safeDragDirectory(input.directory));
    await fsp.mkdir(dragDir, { recursive: true });

    const safeName = safeDragFileName(input.fileName);
    const outputPath = path.join(dragDir, safeName);
    const title = input.title?.trim() || path.parse(safeName).name;
    const status = input.status || 'draft';
    const body = input.body?.trim() || '';

    await fsp.writeFile(outputPath, matter.stringify(body ? `${body}\n` : '', {
      aidd: {
        type: 'drag-export',
        title,
        status,
        templateVersion: TEMPLATE_VERSION,
        updatedAt: new Date().toISOString(),
        ...(input.metadata || {})
      }
    }), 'utf8');

    return outputPath;
  }

  async function prepareFoundationDragFile(input: PrepareFoundationDragFileInput) {
    if (!input.projectPath) throw new Error('Project path is required.');
    if (!input.fileName) throw new Error('Foundation file name is required.');

    const projectPath = path.resolve(input.projectPath);
    const dragDir = path.join(projectPath, '.aidd', 'drag-files', 'foundation');
    await fsp.mkdir(dragDir, { recursive: true });

    const safeName = safeDragFileName(input.fileName);
    const outputPath = path.join(dragDir, safeName);
    const title = input.title?.trim() || path.parse(safeName).name;
    const status = input.status || 'draft';
    const body = input.body?.trim() || '';

    await fsp.writeFile(outputPath, buildFoundationMarkdown({
      id: path.parse(safeName).name,
      title,
      status,
      required: true,
      body
    }), 'utf8');

    return outputPath;
  }



  async function prepareStandardSectionDragFile(input: PrepareStandardSectionDragFileInput) {
    if (!input.projectPath) throw new Error('Project path is required.');
    if (!input.fileName) throw new Error('Standards file name is required.');

    const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
    if (!definition) throw new Error(`Unknown Standards section: ${input.fileName}`);

    const projectPath = path.resolve(input.projectPath);
    const dragDir = path.join(projectPath, '.aidd', 'drag-files', 'standards');
    await fsp.mkdir(dragDir, { recursive: true });

    const safeName = safeDragFileName(input.fileName);
    const outputPath = path.join(dragDir, safeName);
    const title = input.title?.trim() || definition.title;
    const status = input.status || 'draft';
    const body = input.body?.trim() || '';

    await fsp.writeFile(outputPath, buildStandardSectionMarkdown({
      id: definition.id,
      title,
      status,
      required: definition.required,
      body
    }), 'utf8');

    return outputPath;
  }

  async function prepareComponentContractDragFile(input: PrepareComponentContractDragFileInput) {
    if (!input.projectPath) throw new Error('Project path is required.');
    if (!input.slug) throw new Error('Component slug is required.');
    const slug = slugify(input.slug);
    const filePath = path.join(input.projectPath, 'components', slug, 'component.md');
    if (!(await exists(filePath))) throw new Error('Generate component.md before dragging it.');
    return filePath;
  }

  async function prepareNativeDragTestFile() {
    const dragDir = path.join(app.getPath('userData'), 'native-file-drag-test');
    await fsp.mkdir(dragDir, { recursive: true });
    const filePath = path.join(dragDir, 'drag-and-drop.md');
    await fsp.writeFile(filePath, `# Native file drag test\n\nCreated by AIDD at ${new Date().toISOString()}\n`, 'utf8');
    return { filePath, fileName: path.basename(filePath) };
  }

  ipcMain.handle('drag:prepareFoundationFile', async (_event, input: PrepareFoundationDragFileInput) => prepareFoundationDragFile(input));
  ipcMain.handle('drag:prepareStandardSectionFile', async (_event, input: PrepareStandardSectionDragFileInput) => prepareStandardSectionDragFile(input));
  ipcMain.handle('drag:prepareMarkdownFile', async (_event, input: PrepareMarkdownDragFileInput) => prepareMarkdownDragFile(input));
  ipcMain.handle('drag:prepareComponentContractFile', async (_event, input: PrepareComponentContractDragFileInput) => prepareComponentContractDragFile(input));
  ipcMain.handle('drag:prepareNativeTestFile', async () => prepareNativeDragTestFile());

  // Use ipcMain.on + ipcRenderer.send for native drag-out. This keeps the call as close as possible
  // to Electron's documented ondragstart -> IPC -> event.sender.startDrag(...) flow.
  ipcMain.on('drag:startNativeFile', (event, filePath: string) => {
    const resolvedPath = path.resolve(filePath || '');
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      console.warn('[native-file-drag] File does not exist:', filePath);
      return;
    }

    const icon = dragIconPath();
    if (!fs.existsSync(icon)) {
      console.warn('[native-file-drag] Drag icon does not exist:', icon);
      return;
    }

    event.sender.startDrag({
      file: resolvedPath,
      icon
    });
  });
}
