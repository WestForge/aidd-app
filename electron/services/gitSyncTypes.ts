export type GitProvider = 'github' | 'gitlab';

export interface AiddGitSyncSettings {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  hasToken: boolean;
}

export interface StoredGitSyncSettings {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
}

export interface AiddSaveGitSyncSettingsInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  token?: string;
}

export interface AiddGitSyncTestInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  token?: string;
}

export type AiddGitSyncTestCode =
  | 'OK'
  | 'MISSING_PROJECT'
  | 'INVALID_REPO_URL'
  | 'INVALID_PROVIDER'
  | 'MISSING_TOKEN'
  | 'AUTH_FAILED'
  | 'EMPTY_REPOSITORY'
  | 'BRANCH_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface AiddGitSyncTestResult {
  ok: boolean;
  code: AiddGitSyncTestCode;
  message: string;
}
