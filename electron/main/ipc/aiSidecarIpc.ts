import { BrowserView, BrowserWindow, ipcMain, shell, type Rectangle } from 'electron';

const AI_WEB_PROVIDERS = {
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/'
  },
  claude: {
    label: 'Claude',
    url: 'https://claude.ai/new'
  },
  grok: {
    label: 'Grok',
    url: 'https://grok.com/'
  },
  gemini: {
    label: 'Gemini',
    url: 'https://gemini.google.com/app'
  }
} as const;

type AiWebProvider = keyof typeof AI_WEB_PROVIDERS;

type SidecarState = {
  view: BrowserView;
  provider: AiWebProvider;
  attached: boolean;
  bounds: Rectangle | null;
};

const sidecars = new Map<number, SidecarState>();

function providerFrom(input: unknown): AiWebProvider {
  if (typeof input === 'object' && input && 'provider' in input) {
    const provider = (input as { provider?: unknown }).provider;
    if (typeof provider === 'string' && provider in AI_WEB_PROVIDERS) {
      return provider as AiWebProvider;
    }
  }

  if (typeof input === 'string' && input in AI_WEB_PROVIDERS) {
    return input as AiWebProvider;
  }

  return 'chatgpt';
}

function windowFromSender(sender: Electron.WebContents) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) {
    throw new Error('AIDD window is no longer available.');
  }
  return win;
}

function providerUrl(provider: AiWebProvider) {
  return AI_WEB_PROVIDERS[provider].url;
}

function normalizeBounds(input: unknown): Rectangle | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<Rectangle>;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);

  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 80 || height < 80) return null;

  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(80, Math.round(width)),
    height: Math.max(80, Math.round(height))
  };
}

function defaultBoundsFor(win: BrowserWindow): Rectangle {
  const [contentWidth, contentHeight] = win.getContentSize();
  const width = Math.min(520, Math.max(360, Math.round(contentWidth * 0.34)));
  return {
    x: Math.max(0, contentWidth - width),
    y: 0,
    width,
    height: contentHeight
  };
}

function createSidecarView(provider: AiWebProvider) {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:aidd-ai-web-chat'
    }
  });

  view.setAutoResize({ width: false, height: false });
  view.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.warn('AI web chat failed to load.', { provider, errorCode, errorDescription, validatedURL });
  });

  return view;
}

function ensureSidecar(win: BrowserWindow, provider: AiWebProvider) {
  const existing = sidecars.get(win.id);
  if (existing && !existing.view.webContents.isDestroyed()) {
    return existing;
  }

  const state: SidecarState = {
    view: createSidecarView(provider),
    provider,
    attached: false,
    bounds: null
  };

  sidecars.set(win.id, state);

  win.once('closed', () => {
    const current = sidecars.get(win.id);
    if (current && !current.view.webContents.isDestroyed()) {
      current.view.webContents.close({ waitForBeforeUnload: false });
    }
    sidecars.delete(win.id);
  });

  return state;
}

function attachSidecar(win: BrowserWindow, state: SidecarState) {
  if (!state.attached) {
    win.addBrowserView(state.view);
    state.attached = true;
  }

  state.view.setBounds(state.bounds ?? defaultBoundsFor(win));
}

function hideSidecar(win: BrowserWindow, state: SidecarState) {
  if (!state.attached) return;
  win.removeBrowserView(state.view);
  state.attached = false;
}

async function loadProvider(state: SidecarState, provider: AiWebProvider) {
  const nextUrl = providerUrl(provider);
  state.provider = provider;

  const currentUrl = state.view.webContents.getURL();
  if (!currentUrl || !currentUrl.startsWith(new URL(nextUrl).origin)) {
    await state.view.webContents.loadURL(nextUrl);
  }
}

export function registerAiSidecarIpcHandlers() {
  ipcMain.handle('aiSidecar:show', async (event, input) => {
    const provider = providerFrom(input);
    const win = windowFromSender(event.sender);
    const state = ensureSidecar(win, provider);

    attachSidecar(win, state);
    await loadProvider(state, provider);

    return {
      visible: true,
      provider: state.provider,
      url: state.view.webContents.getURL()
    };
  });

  ipcMain.handle('aiSidecar:hide', (event) => {
    const win = windowFromSender(event.sender);
    const state = sidecars.get(win.id);
    if (state) hideSidecar(win, state);
    return { visible: false };
  });

  ipcMain.handle('aiSidecar:navigate', async (event, input) => {
    const provider = providerFrom(input);
    const win = windowFromSender(event.sender);
    const state = ensureSidecar(win, provider);

    attachSidecar(win, state);
    await loadProvider(state, provider);

    return {
      visible: true,
      provider: state.provider,
      url: state.view.webContents.getURL()
    };
  });

  ipcMain.handle('aiSidecar:setBounds', (event, input) => {
    const bounds = normalizeBounds(input);
    const win = windowFromSender(event.sender);
    const state = sidecars.get(win.id);

    if (!state || !bounds) {
      return { ok: false };
    }

    state.bounds = bounds;
    if (state.attached) {
      state.view.setBounds(bounds);
    }

    return { ok: true, bounds };
  });

  ipcMain.handle('aiSidecar:openExternal', async (_event, input) => {
    const provider = providerFrom(input);
    await shell.openExternal(providerUrl(provider));
    return { ok: true, provider };
  });

  ipcMain.handle('aiSidecar:reload', (event) => {
    const win = windowFromSender(event.sender);
    const state = sidecars.get(win.id);
    if (!state) return { ok: false };
    state.view.webContents.reload();
    return { ok: true };
  });

  ipcMain.handle('aiSidecar:goBack', (event) => {
    const win = windowFromSender(event.sender);
    const state = sidecars.get(win.id);
    if (!state || !state.view.webContents.canGoBack()) return { ok: false };
    state.view.webContents.goBack();
    return { ok: true };
  });

  ipcMain.handle('aiSidecar:goForward', (event) => {
    const win = windowFromSender(event.sender);
    const state = sidecars.get(win.id);
    if (!state || !state.view.webContents.canGoForward()) return { ok: false };
    state.view.webContents.goForward();
    return { ok: true };
  });
}
