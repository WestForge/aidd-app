import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'electron', 'main.ts');
const preloadPath = path.join(root, 'electron', 'preload.ts');
const typesPath = path.join(root, 'src', 'vite-env.d.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.writeFileSync(file, text, 'utf8');
}

function patchMain() {
  let text = read(mainPath);

  if (!text.includes('nativeImage')) {
    text = text.replace(/import \{([^}]+)\} from 'electron';/, (match, imports) => {
      const names = imports.split(',').map((s) => s.trim()).filter(Boolean);
      if (!names.includes('nativeImage')) names.push('nativeImage');
      return `import { ${names.join(', ')} } from 'electron';`;
    });
  }

  const helperMarker = 'function getAiddDragIconPath()';
  if (!text.includes(helperMarker)) {
    const helper = String.raw`
const AIDD_DRAG_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPElEQVR4nO3QsQ0AIAwEwYf+eyY7QwUJbRQJ9s1vAPDdAFkJSAIJBp8JigESDD4TFAIkGHwmKAZIMPgBqA8CH3gkD7oAAAAASUVORK5CYII=';

function getAiddDragIconPath() {
  const iconPath = path.join(app.getPath('userData'), 'aidd-drag-file-icon.png');
  if (!fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, Buffer.from(AIDD_DRAG_ICON_PNG_BASE64, 'base64'));
  }
  return iconPath;
}

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function prepareFoundationDragFile(input: { projectPath: string; fileName: string; title?: string; status?: string; body: string }) {
  const projectPath = path.resolve(input.projectPath);
  const fileName = safeFileName(input.fileName || 'foundation.md');
  const outputDir = path.join(projectPath, '.aidd', 'drag-files', 'foundation');
  await ensureDir(outputDir);

  const outputPath = path.join(outputDir, fileName);
  const frontmatter = {
    aidd: {
      type: 'foundation',
      title: input.title || fileName.replace(/\.md$/i, ''),
      status: input.status || 'draft',
      exportedForDrag: true,
      updatedAt: new Date().toISOString()
    }
  };

  const body = `${input.body || ''}`.trimEnd() + '\n';
  await fsp.writeFile(outputPath, matter.stringify(body, frontmatter), 'utf8');
  return outputPath;
}
`;
    const firstIpc = text.indexOf("ipcMain.handle('project:selectFolder'");
    if (firstIpc === -1) throw new Error('Could not find IPC handler insertion point in electron/main.ts');
    text = `${text.slice(0, firstIpc)}${helper}\n${text.slice(firstIpc)}`;
  }

  if (!text.includes("ipcMain.handle('drag:prepareFoundationFile'")) {
    const handler = String.raw`
ipcMain.handle('drag:prepareFoundationFile', async (_event, input: { projectPath: string; fileName: string; title?: string; status?: string; body: string }) => prepareFoundationDragFile(input));

ipcMain.on('drag:startNativeFile', (event, filePath: string) => {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) return;
  const icon = nativeImage.createFromPath(getAiddDragIconPath());
  event.sender.startDrag({
    file: resolvedPath,
    icon
  });
});

ipcMain.handle('fs:showItemInFolder', async (_event, filePath: string) => {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) return false;
  const { shell } = await import('electron');
  shell.showItemInFolder(resolvedPath);
  return true;
});
`;
    const firstIpc = text.indexOf("ipcMain.handle('project:selectFolder'");
    if (firstIpc === -1) throw new Error('Could not find IPC handler insertion point in electron/main.ts');
    text = `${text.slice(0, firstIpc)}${handler}\n${text.slice(firstIpc)}`;
  }

  write(mainPath, text);
}

function addExposeProperty(objectText, property) {
  if (objectText.includes(property.split(':')[0] + ':')) return objectText;
  const lastBrace = objectText.lastIndexOf('}');
  return `${objectText.slice(0, lastBrace).trimEnd()},\n  ${property}\n${objectText.slice(lastBrace)}`;
}

function patchPreload() {
  let text = read(preloadPath);
  if (!text.includes('prepareFoundationDragFile:')) {
    text = text.replace(/writeText: \(filePath: string, content: string\) => ipcRenderer\.invoke\('fs:writeText', filePath, content\)/,
      `writeText: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeText', filePath, content),\n  prepareFoundationDragFile: (input: unknown) => ipcRenderer.invoke('drag:prepareFoundationFile', input),\n  startNativeFileDrag: (filePath: string) => ipcRenderer.send('drag:startNativeFile', filePath),\n  showItemInFolder: (filePath: string) => ipcRenderer.invoke('fs:showItemInFolder', filePath)`);
  }
  write(preloadPath, text);
}

function patchTypes() {
  let text = read(typesPath);
  if (!text.includes('interface AiddPrepareFoundationDragFileInput')) {
    const marker = 'interface AiddDefineStandardsInput {';
    const insert = `interface AiddPrepareFoundationDragFileInput {\n  projectPath: string;\n  fileName: string;\n  title?: string;\n  status?: AiddSetupStatus | string;\n  body: string;\n}\n\n`;
    if (!text.includes(marker)) throw new Error('Could not find type insertion point in src/vite-env.d.ts');
    text = text.replace(marker, insert + marker);
  }
  if (!text.includes('prepareFoundationDragFile:')) {
    text = text.replace(/writeText: \(filePath: string, content: string\) => Promise<boolean>;/,
      `writeText: (filePath: string, content: string) => Promise<boolean>;\n    prepareFoundationDragFile: (input: AiddPrepareFoundationDragFileInput) => Promise<string>;\n    startNativeFileDrag: (filePath: string) => void;\n    showItemInFolder: (filePath: string) => Promise<boolean>;`);
  }
  write(typesPath, text);
}

patchMain();
patchPreload();
patchTypes();
console.log('Applied v81 native file drag IPC patches.');
