import fs from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { GitCredentialStore } from './gitCredentialStore';
import { AIDD_DEFAULT_BRANCH, readGitSyncSettings } from './gitSyncSettingsStore';
import type { GitProvider } from './gitSyncTypes';
import { createGitReviewPackage, type AiddGitReviewState } from './gitReviewPackageStore';

export type AiddFileGuardMode = 'open' | 'save';
export type AiddFileGuardCode =
  | 'OK'
  | 'NOT_AIDD_PROJECT'
  | 'REMOTE_NOT_CONFIGURED'
  | 'MISSING_TOKEN'
  | 'REMOTE_UNCHANGED'
  | 'REMOTE_FILE_UNCHANGED'
  | 'REVIEW_NEEDED'
  | 'REMOTE_CHECK_FAILED';

export interface AiddFileGuardResult {
  safe: boolean;
  code: AiddFileGuardCode;
  message: string;
  projectPath?: string;
  relativePath?: string;
  review?: AiddGitReviewState;
}

export interface GitOpenSaveGuardOptions {
  userDataPath: string;
  filePath: string;
  credentialStore: GitCredentialStore;
  mode: AiddFileGuardMode;
  pendingContent?: string;
  hooks?: GitOpenSaveGuardHooks;
}

export interface GitOpenSaveGuardHooks {
  fetchRemote?: (input: { projectPath: string; provider: GitProvider; repoUrl: string; branch: string; token: string }) => Promise<void> | void;
  getLocalOid?: (projectPath: string) => Promise<string | null> | string | null;
  getRemoteOid?: (projectPath: string) => Promise<string | null> | string | null;
  readBlobAtCommit?: (input: { projectPath: string; oid: string; filepath: string }) => Promise<string | null> | string | null;
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createAuth(provider: GitProvider, token: string) {
  if (provider === 'gitlab') {
    return () => ({ username: 'oauth2', password: token });
  }

  return () => ({ username: token, password: '' });
}

function normaliseRelativePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function shouldSkipFileGuardPath(filePath: string) {
  const normalised = path.resolve(filePath || '').replace(/\\/g, '/');

  return (
    normalised.includes('/.git/') ||
    normalised.includes('/.aidd-app/') ||
    normalised.includes('/.aidd/drag-files/') ||
    normalised.includes('/node_modules/') ||
    normalised.includes('/dist/') ||
    normalised.includes('/build/') ||
    normalised.endsWith('/.env')
  );
}

export async function findAiddProjectRootForFile(filePath: string): Promise<string | null> {
  const resolved = path.resolve(filePath || '');

  if (!resolved || shouldSkipFileGuardPath(resolved)) {
    return null;
  }

  let current = path.dirname(resolved);

  while (true) {
    if (await pathExists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    if (await pathExists(path.join(current, '.git'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  return null;
}

async function defaultFetchRemote(input: { projectPath: string; provider: GitProvider; repoUrl: string; branch: string; token: string }) {
  await git.fetch({
    fs,
    http,
    dir: input.projectPath,
    remote: 'origin',
    ref: input.branch,
    singleBranch: true,
    tags: false,
    onAuth: createAuth(input.provider, input.token),
  });
}

async function resolveRef(projectPath: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir: projectPath, ref });
  } catch {
    return null;
  }
}

async function defaultReadBlobAtCommit(input: { projectPath: string; oid: string; filepath: string }): Promise<string | null> {
  try {
    const result = await git.readBlob({
      fs,
      dir: input.projectPath,
      oid: input.oid,
      filepath: input.filepath,
    });

    return Buffer.from(result.blob).toString('utf8');
  } catch {
    return null;
  }
}

async function readWorktreeContent(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function guardSafe(code: AiddFileGuardCode, message: string, projectPath?: string, relativePath?: string): AiddFileGuardResult {
  return { safe: true, code, message, projectPath, relativePath };
}

function guardBlocked(code: AiddFileGuardCode, message: string, projectPath: string, relativePath: string, review: AiddGitReviewState): AiddFileGuardResult {
  return { safe: false, code, message, projectPath, relativePath, review };
}

export async function checkFileOpenOrSaveSafety(options: GitOpenSaveGuardOptions): Promise<AiddFileGuardResult> {
  const projectPath = await findAiddProjectRootForFile(options.filePath);

  if (!projectPath) {
    return guardSafe('NOT_AIDD_PROJECT', 'File is not inside an AIDD project.');
  }

  const relativePath = normaliseRelativePath(path.relative(projectPath, options.filePath));
  const settings = await readGitSyncSettings(options.userDataPath, projectPath);

  if (!settings?.repoUrl) {
    return guardSafe('REMOTE_NOT_CONFIGURED', 'Remote repository is not configured.', projectPath, relativePath);
  }

  const token = await options.credentialStore.getToken(projectPath, settings.provider);
  if (!token?.trim()) {
    return guardSafe('MISSING_TOKEN', 'Remote update check skipped because no access token is saved.', projectPath, relativePath);
  }

  try {
    await (options.hooks?.fetchRemote || defaultFetchRemote)({
      projectPath,
      provider: settings.provider,
      repoUrl: settings.repoUrl,
      branch: AIDD_DEFAULT_BRANCH,
      token: token.trim(),
    });

    const localOid =
      (await options.hooks?.getLocalOid?.(projectPath)) ??
      (await resolveRef(projectPath, AIDD_DEFAULT_BRANCH)) ??
      (await resolveRef(projectPath, 'HEAD'));

    const remoteOid =
      (await options.hooks?.getRemoteOid?.(projectPath)) ??
      (await resolveRef(projectPath, `refs/remotes/origin/${AIDD_DEFAULT_BRANCH}`));

    if (!localOid || !remoteOid || localOid === remoteOid) {
      return guardSafe('REMOTE_UNCHANGED', 'No shared update risk detected.', projectPath, relativePath);
    }

    const readBlob = options.hooks?.readBlobAtCommit || defaultReadBlobAtCommit;
    const baseContent = await readBlob({ projectPath, oid: localOid, filepath: relativePath });
    const remoteContent = await readBlob({ projectPath, oid: remoteOid, filepath: relativePath });

    if (baseContent === remoteContent) {
      return guardSafe('REMOTE_FILE_UNCHANGED', 'Shared updates exist, but this file was not changed remotely.', projectPath, relativePath);
    }

    const localContent = options.pendingContent ?? (await readWorktreeContent(options.filePath));
    const review = await createGitReviewPackage({
      projectPath,
      reason: options.mode,
      message:
        options.mode === 'save'
          ? 'Shared updates changed this file before your save could be shared safely.'
          : 'Shared updates changed this file before it was opened for editing.',
      files: [
        {
          path: relativePath,
          localContent,
          remoteContent,
          baseContent,
        },
      ],
    });

    return guardBlocked(
      'REVIEW_NEEDED',
      'Shared updates need review before this file can be saved safely.',
      projectPath,
      relativePath,
      review
    );
  } catch (error) {
    // Remote checks should not break local-only work when the network is unavailable.
    // The actual push/share step will record the remote failure if needed.
    const message = error instanceof Error ? error.message : String(error);
    return guardSafe('REMOTE_CHECK_FAILED', `Could not check for shared updates: ${message}`, projectPath, relativePath);
  }
}

export function checkFileOpenSafety(options: Omit<GitOpenSaveGuardOptions, 'mode'>) {
  return checkFileOpenOrSaveSafety({ ...options, mode: 'open' });
}

export function checkFileSaveSafety(options: Omit<GitOpenSaveGuardOptions, 'mode'>) {
  return checkFileOpenOrSaveSafety({ ...options, mode: 'save' });
}
