import type { GitProvider } from './gitSyncTypes';

export function isGitProvider(value: unknown): value is GitProvider {
  return value === 'github' || value === 'gitlab';
}

export function validateGitProvider(value: unknown): GitProvider {
  if (!isGitProvider(value)) throw new Error('INVALID_PROVIDER');
  return value;
}

export function validateHttpsRepoUrl(repoUrl: string, _provider?: GitProvider): boolean {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.protocol !== 'https:') return false;
    if (!parsed.hostname) return false;
    if (parsed.username || parsed.password) return false;
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export function normaliseBranch(branch: string | undefined) {
  const value = branch?.trim() || 'main';
  return value.replace(/^refs\/heads\//, '');
}

export function normaliseRepoUrl(repoUrl: string) {
  return repoUrl.trim();
}

export function normaliseRemoteUrlForCompare(repoUrl: string) {
  return normaliseRepoUrl(repoUrl).replace(/\/+$/, '');
}

export function sanitiseGitErrorMessage(message: unknown) {
  const text = typeof message === 'string' ? message : 'The Git operation failed.';
  return text
    .replace(/https:\/\/[^\s/]+:[^\s@]+@/gi, 'https://')
    .replace(/https:\/\/[^\s@]+@/gi, 'https://')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/glpat-[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/[A-Za-z0-9_\-]{20,}/g, '[redacted]');
}

export function mapGitError(error: unknown): { code: 'AUTH_FAILED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR'; message: string } {
  const err = error as { code?: string; statusCode?: number; message?: string; data?: { statusCode?: number } };
  const statusCode = err?.statusCode ?? err?.data?.statusCode;
  const raw = `${err?.code || ''} ${statusCode || ''} ${err?.message || ''}`.toLowerCase();

  if (statusCode === 401 || statusCode === 403 || raw.includes('auth') || raw.includes('unauthorized') || raw.includes('forbidden')) {
    return { code: 'AUTH_FAILED', message: 'The token was rejected. Check repository access and token permissions.' };
  }

  if (raw.includes('network') || raw.includes('enotfound') || raw.includes('econn') || raw.includes('timeout') || raw.includes('certificate')) {
    return { code: 'NETWORK_ERROR', message: 'The repository could not be reached. Check your network connection and repository URL.' };
  }

  return { code: 'UNKNOWN_ERROR', message: sanitiseGitErrorMessage(err?.message || 'The Git operation failed.') };
}
