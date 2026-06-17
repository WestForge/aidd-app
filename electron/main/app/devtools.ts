import type { BrowserWindow } from 'electron';
import { isDev } from './env';

function shouldEnableDevTools() {
  return isDev || process.env.AIDD_DEVTOOLS === '1' || process.argv.includes('--devtools');
}

export function shouldOpenDevToolsOnStart() {
  return process.env.AIDD_DEVTOOLS === '1' || process.argv.includes('--devtools');
}

function toggleDevTools(win: BrowserWindow) {
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

export function installDevToolsShortcuts(win: BrowserWindow) {
  if (!shouldEnableDevTools()) return;

  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isToggleDevTools = input.key === 'F12'
      || (input.control && input.shift && key === 'i')
      || (input.meta && input.alt && key === 'i');

    if (!isToggleDevTools) return;

    event.preventDefault();
    toggleDevTools(win);
  });
}
