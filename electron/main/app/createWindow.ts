import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { installDevToolsShortcuts, shouldOpenDevToolsOnStart } from './devtools';
import { isDev } from './env';
import { installRendererBlankPageGuard } from './rendererBlankPageGuard';
import { RENDERER_PROTOCOL, getRendererProtocolState } from './rendererProtocol';
import { dataUrlForHtml, missingRendererPage, rendererCrashPage } from './rendererFallbackPages';

function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, '../../preload.js'),
    path.join(__dirname, '../preload.js'),
    path.join(__dirname, 'preload.js')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

async function loadAppWindow(win: BrowserWindow) {
  if (isDev) {
    await win.loadURL('http://127.0.0.1:5173');
    return;
  }

  if (!getRendererProtocolState()?.indexPath) {
    await win.loadURL(dataUrlForHtml(missingRendererPage()));
    return;
  }

  await win.loadURL(`${RENDERER_PROTOCOL}://renderer/index.html`);
}

export function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'AIDD',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  installDevToolsShortcuts(win);
  installRendererBlankPageGuard(win);

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = sourceId ? `${sourceId}:${line}` : `line ${line}`;
    console.log(`[AIDD renderer:${level}] ${message} (${source})`);
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('AIDD preload failed.', { preloadPath, error });
    if (!isDev) {
      void win.loadURL(dataUrlForHtml(rendererCrashPage(`Preload failed: ${error instanceof Error ? error.message : String(error)}`)));
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('AIDD renderer process gone.', details);
    if (!isDev && !win.isDestroyed()) {
      void win.loadURL(dataUrlForHtml(rendererCrashPage(`Renderer process exited: ${details.reason}.`)));
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('AIDD renderer failed to load.', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (!isMainFrame || isDev) return;
    void win.loadURL(dataUrlForHtml(rendererCrashPage(`Renderer load failed: ${errorDescription} (${errorCode}).`)));
  });

  loadAppWindow(win)
    .then(() => {
      if (shouldOpenDevToolsOnStart()) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    })
    .catch((error) => {
      console.error('Failed to load AIDD window.', error);
      if (!isDev) {
        void win.loadURL(dataUrlForHtml(rendererCrashPage(error instanceof Error ? error.message : String(error))));
      }
    });
}
