import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { GitProvider } from './gitSyncTypes';

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

type TokenSource =
  | string
  | null
  | undefined
  | {
      getToken?: (projectPath: string, provider: GitProvider) => Promise<string | null> | string | null;
      readToken?: (projectPath: string, provider: GitProvider) => Promise<string | null> | string | null;
      get?: (projectPath: string, provider: GitProvider) => Promise<string | null> | string | null;
    };

function isGitProvider(value: unknown): value is GitProvider {
  return value === 'github' || value === 'gitlab';
}

function isHttpsRepositoryUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && parsed.pathname.length > 1 && !parsed.username && !parsed.password;
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

  if (typeof tokenSource.getToken === 'function') {
    const token = await tokenSource.getToken(projectPath, input.provider);
    if (typeof token === 'string' && token.trim().length > 0) {
      return token.trim();
    }
  }

  if (typeof tokenSource.readToken === 'function') {
    const token = await tokenSource.readToken(projectPath, input.provider);
    if (typeof token === 'string' && token.trim().length > 0) {
      return token.trim();
    }
  }

  if (typeof tokenSource.get === 'function') {
    const token = await tokenSource.get(projectPath, input.provider);
    if (typeof token === 'string' && token.trim().length > 0) {
      return token.trim();
    }
  }

  return null;
}

function safeErrorCode(error: unknown): GitRemoteConnectionCode {
  const err = error as {
    code?: string;
    name?: string;
    message?: string;
    statusCode?: number;
    data?: { statusCode?: number };
  };

  const statusCode = err.statusCode ?? err.data?.statusCode;

  if (statusCode === 401 || statusCode === 403) {
    return 'AUTH_FAILED';
  }

  if (
    err.code === 'ENOTFOUND' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT'
  ) {
    return 'NETWORK_ERROR';
  }

  const message = (err.message || '').toLowerCase();

  if (
    message.includes('authentication') ||
    message.includes('authorization') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return 'AUTH_FAILED';
  }

  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('certificate') ||
    message.includes('getaddrinfo') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnreset')
  ) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN_ERROR';
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
      return 'Enter an access token before testing the connection.';
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

/**
 * Non-destructive remote connection test.
 *
 * Accepts any HTTPS Git remote URL, including self-hosted/private GitLab.
 * Does not clone, pull, push, commit, write Git config, or modify the project workspace.
 */
export async function testGitRemoteConnection(
  input: GitRemoteConnectionInput,
  tokenSource?: TokenSource
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

  if (!isHttpsRepositoryUrl(repoUrl)) {
    return {
      ok: false,
      code: 'INVALID_REPO_URL',
      message: safeMessage('INVALID_REPO_URL'),
    };
  }

  const token = await resolveToken(input, tokenSource);

  if (!token) {
    return {
      ok: false,
      code: 'MISSING_TOKEN',
      message: safeMessage('MISSING_TOKEN'),
    };
  }

  try {
    const refs = await git.listServerRefs({
      http,
      url: repoUrl,
      prefix: 'refs/heads/',
      onAuth: createAuth(provider, token),
    });

    if (refs.length === 0) {
      return {
        ok: true,
        code: 'EMPTY_REPOSITORY',
        message: safeMessage('EMPTY_REPOSITORY', branch),
      };
    }

    const branchRef = `refs/heads/${branch}`;
    const branchFound = refs.some((ref) => ref.ref === branchRef || ref.ref === branch);

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
    const code = safeErrorCode(error);

    return {
      ok: false,
      code,
      message: safeMessage(code, branch),
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
