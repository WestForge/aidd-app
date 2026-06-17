import type { BrowserWindow } from 'electron';
import { isDev } from './env';
import { blankRendererPage, dataUrlForHtml } from './rendererFallbackPages';

export function installRendererBlankPageGuard(win: BrowserWindow) {
  if (isDev) return;

  let guardCompleted = false;

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (win.isDestroyed() || win.webContents.isDestroyed() || guardCompleted) return;

      win.webContents.executeJavaScript(`
        (() => {
          const root = document.getElementById('root');
          const bootState = window.__AIDD_RENDERER_BOOT_STATE__ || null;
          return {
            href: window.location.href,
            hasRoot: Boolean(root),
            childCount: root ? root.childElementCount : 0,
            textLength: root && root.textContent ? root.textContent.trim().length : 0,
            bootState
          };
        })();
      `)
        .then((state) => {
          guardCompleted = true;
          const hasVisibleRoot = Boolean(state?.hasRoot) && ((state?.childCount ?? 0) > 0 || (state?.textLength ?? 0) > 0);
          const bootState = state?.bootState;
          const appMounted = bootState?.mounted === true;

          if (hasVisibleRoot && appMounted) return;

          const detail = [
            `URL: ${state?.href || 'unknown'}`,
            `Root element found: ${state?.hasRoot ? 'yes' : 'no'}`,
            `Root child count: ${state?.childCount ?? 0}`,
            `Root text length: ${state?.textLength ?? 0}`,
            `Renderer boot state: ${JSON.stringify(bootState ?? null)}`
          ].join('\n');

          void win.loadURL(dataUrlForHtml(blankRendererPage(detail)));
        })
        .catch((error) => {
          guardCompleted = true;
          console.error('AIDD renderer blank-page guard failed.', error);
        });
    }, 2500);
  });
}
