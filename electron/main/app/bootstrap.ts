import { app, BrowserWindow, Menu } from 'electron';
import { createWindow } from './createWindow';
import { registerRendererProtocol } from './rendererProtocol';

export function startElectronApp() {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerRendererProtocol();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
