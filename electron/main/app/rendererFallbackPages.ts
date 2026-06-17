import { getRendererProtocolState, rendererIndexCandidates } from './rendererProtocol';

function htmlDocument(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0f172a;color:#e2e8f0}main{max-width:900px;margin:64px auto;padding:32px}code,pre{background:#111827;border:1px solid #334155;border-radius:8px}code{padding:2px 5px}pre{padding:16px;overflow:auto;white-space:pre-wrap}.card{background:#111827;border:1px solid #334155;border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin-top:0}</style></head><body><main><div class="card">${body}</div></main></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function dataUrlForHtml(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function missingRendererPage() {
  const candidates = getRendererProtocolState()?.candidates ?? rendererIndexCandidates();
  return htmlDocument(
    'AIDD renderer missing',
    `<h1>AIDD could not load the renderer build.</h1><p>The packaged app could not find <code>dist/renderer/index.html</code>.</p><p>Run the renderer build before packaging, and make sure electron-builder includes <code>dist/**/*</code>.</p><h2>Checked paths</h2><pre>${escapeHtml(candidates.join('\n'))}</pre>`
  );
}

export function rendererCrashPage(reason: string) {
  return htmlDocument(
    'AIDD renderer failed',
    `<h1>AIDD could not display the app window.</h1><p>${escapeHtml(reason)}</p><p>This usually means the packaged renderer JavaScript did not load, the preload script failed, or React crashed during startup.</p><p>Open DevTools with <code>F12</code> or run with <code>AIDD_DEVTOOLS=1</code> for the renderer console.</p>`
  );
}

export function blankRendererPage(detail: string) {
  return htmlDocument(
    'AIDD renderer blank',
    `<h1>AIDD loaded the HTML, but React did not start.</h1><p>${escapeHtml(detail)}</p><p>The most common cause is Vite building absolute asset paths. Make sure <code>vite.config.ts</code> contains <code>base: './'</code> and rebuild with a clean <code>dist</code> directory.</p><h2>Renderer path</h2><pre>${escapeHtml(getRendererProtocolState()?.indexPath || 'unknown')}</pre>`
  );
}
