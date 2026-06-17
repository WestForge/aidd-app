import { app, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { isDev } from './env';

export const RENDERER_PROTOCOL = 'aidd';

export interface RendererProtocolState {
  rootPath: string;
  indexPath: string;
  candidates: string[];
}

let rendererProtocolState: RendererProtocolState | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function uniqueExistingPathCandidates(paths: string[]) {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const normal = path.normalize(candidate);
    if (seen.has(normal)) return false;
    seen.add(normal);
    return true;
  });
}

export function rendererIndexCandidates() {
  return uniqueExistingPathCandidates([
    path.join(__dirname, '../../../renderer/index.html'),
    path.join(__dirname, '../../renderer/index.html'),
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../../dist/renderer/index.html'),
    path.join(app.getAppPath(), 'dist/renderer/index.html'),
    path.join(process.resourcesPath, 'app/dist/renderer/index.html'),
    path.join(process.resourcesPath, 'app.asar/dist/renderer/index.html')
  ]);
}

function resolveRendererIndexPath() {
  const candidates = rendererIndexCandidates();
  const indexPath = candidates.find((candidate) => fs.existsSync(candidate));
  return { indexPath, candidates };
}

function normaliseRendererRequestPath(requestUrl: string) {
  const url = new URL(requestUrl);
  const pathname = decodeURIComponent(url.pathname || '/index.html');
  return pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
}

function isPathInside(parentPath: string, candidatePath: string) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function registerRendererProtocol() {
  if (isDev) return;

  const { indexPath, candidates } = resolveRendererIndexPath();
  if (!indexPath) {
    rendererProtocolState = {
      rootPath: '',
      indexPath: '',
      candidates
    };
    console.error('AIDD renderer index.html was not found. Checked:', candidates);
    return;
  }

  rendererProtocolState = {
    rootPath: path.dirname(indexPath),
    indexPath,
    candidates
  };

  protocol.registerFileProtocol(RENDERER_PROTOCOL, (request, callback) => {
    try {
      const relativePath = normaliseRendererRequestPath(request.url);
      const filePath = path.resolve(rendererProtocolState!.rootPath, relativePath);

      if (!isPathInside(rendererProtocolState!.rootPath, filePath)) {
        callback({ error: -10 });
        return;
      }

      callback({ path: filePath });
    } catch (error) {
      console.error('Failed to resolve renderer asset.', error);
      callback({ error: -2 });
    }
  });
}

export function getRendererProtocolState() {
  return rendererProtocolState;
}
