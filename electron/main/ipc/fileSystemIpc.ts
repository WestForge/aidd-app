import { ipcMain } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { checkpointAndShareProjectAfterSave, findAiddProjectRootForSavedFile } from './saveSync';

export function registerFileSystemIpcHandlers() {
  ipcMain.handle('fs:readText', async (_event, filePath: string) => fsp.readFile(filePath, 'utf8'));

  ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');

    const projectPath = await findAiddProjectRootForSavedFile(filePath);

    if (projectPath) {
      await checkpointAndShareProjectAfterSave(projectPath);
    }

    return true;
  });
}
