export type GitProvider = 'github' | 'gitlab';

export interface AiddGitIdentity {
  authorName: string;
  authorEmail: string;
  source: 'saved' | 'git-global' | 'none';
}

export interface AiddSaveGitIdentityInput {
  authorName: string;
  authorEmail: string;
}

export interface AiddGitSyncSettings {
  provider: GitProvider;
  repoUrl: string;
  branch: 'main';
  hasToken: boolean;
}

export interface StoredGitSyncSettings {
  provider: GitProvider;
  repoUrl: string;
  branch?: 'main';
}

export interface AiddSaveGitSyncSettingsInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl?: string;
  token?: string;
}

export interface AiddGitSyncTestInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl: string;
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

export type AiddGitProjectConnectionState =
  | 'missing_identity'
  | 'local_not_ready'
  | 'local_ready'
  | 'remote_not_configured'
  | 'not_connected'
  | 'connected'
  | 'remote_mismatch'
  | 'needs_attention'
  | 'error';

export interface AiddGitProjectConnectionStatus {
  connected: boolean;
  state: AiddGitProjectConnectionState;
  provider?: GitProvider;
  repoUrl?: string;
  branch: 'main';
  remoteUrl?: string;
  hasLocalRepository: boolean;
  hasToken?: boolean;
  authorName?: string;
  authorEmail?: string;
  lastConnectedAt?: string;
  message: string;
}

export type AiddGitProjectConnectionCode =
  | 'OK'
  | 'LOCAL_READY'
  | 'MISSING_PROJECT'
  | 'MISSING_IDENTITY'
  | 'INVALID_REPO_URL'
  | 'REMOTE_NOT_CONFIGURED'
  | 'REMOTE_MISMATCH'
  | 'LOCAL_REPO_ERROR'
  | 'UNKNOWN_ERROR';

export interface AiddGitProjectConnectionResult {
  ok: boolean;
  code: AiddGitProjectConnectionCode;
  message: string;
  status: AiddGitProjectConnectionStatus;
}


export type AiddGitSyncStatusState =
  | 'not_connected'
  | 'ready_to_publish_first_version'
  | 'up_to_date'
  | 'local_changes'
  | 'remote_updates_available'
  | 'syncing'
  | 'synced'
  | 'review_needed'
  | 'error';

export interface AiddGitSyncStatus {
  state: AiddGitSyncStatusState;
  message: string;
  lastSyncAt?: string;
  lastCheckpointLabel?: string;
}

export interface AiddGitSyncResult {
  ok: boolean;
  code:
    | 'OK'
    | 'NOT_CONNECTED'
    | 'MISSING_TOKEN'
    | 'LOCAL_CHECKPOINT_FAILED'
    | 'REMOTE_CHECK_FAILED'
    | 'PULL_FAILED'
    | 'PUSH_FAILED'
    | 'CONFLICT_DETECTED'
    | 'UNSAFE_REPOSITORY_STATE'
    | 'UNKNOWN_ERROR';
  message: string;
  status: AiddGitSyncStatus;
}
