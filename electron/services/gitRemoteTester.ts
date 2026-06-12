import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { GitCredentialStore } from './gitCredentialStore';
import type { GitProvider } from './gitSyncTypes';
import { mapGitError, validateHttpsRepoUrl } from './gitSyncValidation';

export type GitRemoteConnectionCode =
  | 'OK'
  | 'INVALID_PROVIDER'
  | 'INVALID_REPO_URL'
  | 'MISSING_TOKEN'
  | 'AUTH_FAILED'
  | 'EMPTY_REPOSITORY'
  | 'BRANCH_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface GitRemoteConnectionInput {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  token?: string;
  projectId?: string;
  projectPath?: string;
}

export interface GitRemoteConnectionResult {
  ok: boolean;
  code: GitRemoteConnectionCode;
  message: string;
}

type TokenSource = string | null | undefined | GitCredentialStore;

export type GitRemoteRefLister = (
  input: GitRemoteConnectionInput,
  token: string
) => Promise<Array<string | { ref: string }>> | Array<string | { ref: string }>;

function isGitProvider(value: unknown): value is GitProvider {
  return value === 'github' || value === 'gitlab';
}

function createAuth(provider: GitProvider, token: string) {
  if (provider === 'gitlab') {
    return () => ({ username: 'oauth2', password: token });
  }

  return () => ({ username: token, password: '' });
}

async function resolveToken(input: GitRemoteConnectionInput, tokenSource?: TokenSource): Promise<string | null> {
  if (typeof input.token === 'string' && input.token.trim().length > 0) {
    return input.token.trim();
  }

  if (typeof tokenSource === 'string' && tokenSource.trim().length > 0) {
    return tokenSource.trim();
  }

  if (!tokenSource || typeof tokenSource !== 'object') {
    return null;
  }

  const projectPath = input.projectPath || input.projectId;
  if (!projectPath) {
    return null;
  }

  const token = await tokenSource.getToken(projectPath, input.provider);
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

function safeMessage(code: GitRemoteConnectionCode, branch?: string): string {
  switch (code) {
    case 'OK':
      return `Connected and found branch ${branch}.`;
    case 'INVALID_PROVIDER':
      return 'Select GitHub or GitLab as the provider.';
    case 'INVALID_REPO_URL':
      return 'Enter a valid HTTPS repository URL.';
    case 'MISSING_TOKEN':
      return 'Enter or save an access token before testing the connection.';
    case 'AUTH_FAILED':
      return 'The token was rejected. Check repository access and token permissions.';
    case 'EMPTY_REPOSITORY':
      return `Connected. The repository is empty, so branch ${branch} has not been created yet. AIDD can create it during the first project sync.`;
    case 'BRANCH_NOT_FOUND':
      return `Connected. Branch ${branch} was not found. AIDD can create it during the first project sync.`;
    case 'NETWORK_ERROR':
      return 'The repository could not be reached. Check the URL, network, and certificate trust.';
    default:
      return 'The connection test failed.';
  }
}

function normaliseRef(ref: string | { ref: string }) {
  return typeof ref === 'string' ? ref : ref.ref;
}

async function listRemoteRefs(input: GitRemoteConnectionInput, token: string, refLister?: GitRemoteRefLister) {
  if (refLister) {
    return (await refLister(input, token)).map(normaliseRef);
  }

  const refs = await git.listServerRefs({
    http,
    url: input.repoUrl.trim(),
    prefix: 'refs/heads/',
    onAuth: createAuth(input.provider, token),
  });

  return refs.map((ref) => ref.ref);
}

/**
 * Non-destructive remote connection test.
 *
 * Accepts any HTTPS Git remote URL, including self-hosted/private GitLab.
 * Does not clone, pull, push, commit, write Git config, or modify the project workspace.
 */
export async function testGitRemoteConnection(
  input: GitRemoteConnectionInput,
  tokenSource?: TokenSource,
  refLister?: GitRemoteRefLister
): Promise<GitRemoteConnectionResult> {
  const provider = input.provider;
  const repoUrl = input.repoUrl.trim();
  const branch = input.branch.trim() || 'main';

  if (!isGitProvider(provider)) {
    return {
      ok: false,
      code: 'INVALID_PROVIDER',
      message: safeMessage('INVALID_PROVIDER'),
    };
  }

  if (!validateHttpsRepoUrl(repoUrl, provider)) {
    return {
      ok: false,
      code: 'INVALID_REPO_URL',
      message: safeMessage('INVALID_REPO_URL'),
    };
  }

  const token = await resolveToken({ ...input, repoUrl, branch }, tokenSource);

  if (!token) {
    return {
      ok: false,
      code: 'MISSING_TOKEN',
      message: safeMessage('MISSING_TOKEN'),
    };
  }

  try {
    const refs = await listRemoteRefs({ ...input, repoUrl, branch }, token, refLister);

    if (refs.length === 0) {
      return {
        ok: true,
        code: 'EMPTY_REPOSITORY',
        message: safeMessage('EMPTY_REPOSITORY', branch),
      };
    }

    const branchRef = `refs/heads/${branch}`;
    const branchFound = refs.some((ref) => ref === branchRef || ref === branch);

    if (!branchFound) {
      return {
        ok: true,
        code: 'BRANCH_NOT_FOUND',
        message: safeMessage('BRANCH_NOT_FOUND', branch),
      };
    }

    return {
      ok: true,
      code: 'OK',
      message: safeMessage('OK', branch),
    };
  } catch (error) {
    const mapped = mapGitError(error);

    return {
      ok: false,
      code: mapped.code,
      message: mapped.message,
    };
  }
}

/**
 * Backwards-compatible helper for quick scripts.
 */
export const testConnection = (
  repoUrl: string,
  branch: string,
  token?: string,
  provider: GitProvider = 'gitlab'
): Promise<GitRemoteConnectionResult> =>
  testGitRemoteConnection({
    provider,
    repoUrl,
    branch,
    token,
  });
