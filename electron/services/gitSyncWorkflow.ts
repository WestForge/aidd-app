import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { GitCredentialStore } from './gitCredentialStore';
import { readGitIdentity } from './gitIdentityStore';
import { getProjectConnectionStatus } from './gitProjectConnector';
import { AIDD_DEFAULT_BRANCH, readGitSyncSettings } from './gitSyncSettingsStore';
import { readGitSyncState, saveGitSyncState } from './gitSyncWorkflowStore';
import type {
  AiddGitSyncResult,
  AiddGitSyncStatus,
  AiddGitSyncStatusState,
  GitProvider,
} from './gitSyncTypes';
import { mapGitError } from './gitSyncValidation';

export interface GitSyncWorkflowOptions {
  userDataPath: string;
  projectPath: string;
  credentialStore: GitCredentialStore;
}

export interface GitSyncRemoteRefsInput {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
}

export interface GitSyncWorkflowTestHooks {
  listRemoteRefs?: (input: GitSyncRemoteRefsInput, token: string) => Promise<string[]> | string[];
  pushBranch?: (input: GitSyncRemoteRefsInput, token: string) => Promise<void> | void;
  fetchRemote?: (input: GitSyncRemoteRefsInput, token: string) => Promise<void> | void;
}

type GitStatusMatrix = Awaited<ReturnType<typeof git.statusMatrix>>;
type GitStatusMatrixRow = GitStatusMatrix[number];

const SKIPPED_PATH_PREFIXES = [
  '.git/',
  '.aidd-app/',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.astro/',
];

const SKIPPED_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'Thumbs.db',
  '.DS_Store',
]);

function nowIso() {
  return new Date().toISOString();
}

function branch() {
  return AIDD_DEFAULT_BRANCH;
}

function createAuth(provider: GitProvider, token: string) {
  if (provider === 'gitlab') {
    return () => ({ username: 'oauth2', password: token });
  }

  return () => ({ username: token, password: '' });
}

function normaliseFilePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}

function shouldSkipCheckpointPath(filePath: string) {
  const normalised = normaliseFilePath(filePath);
  const fileName = path.posix.basename(normalised);

  if (SKIPPED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return SKIPPED_PATH_PREFIXES.some((prefix) => normalised === prefix.slice(0, -1) || normalised.startsWith(prefix));
}

function syncStatus(state: AiddGitSyncStatusState, message: string, extra: Partial<AiddGitSyncStatus> = {}): AiddGitSyncStatus {
  return {
    state,
    message,
    ...extra,
  };
}

function syncResult(ok: boolean, code: AiddGitSyncResult['code'], status: AiddGitSyncStatus, message = status.message): AiddGitSyncResult {
  return { ok, code, message, status };
}

async function resolveToken(options: GitSyncWorkflowOptions, provider: GitProvider) {
  const token = await options.credentialStore.getToken(options.projectPath, provider);
  return token?.trim() || null;
}

async function currentBranch(projectPath: string) {
  try {
    return await git.currentBranch({ fs, dir: projectPath, fullname: false });
  } catch {
    return null;
  }
}

async function resolveRef(projectPath: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir: projectPath, ref });
  } catch {
    return null;
  }
}

async function refHistoryContains(projectPath: string, ref: string, oid: string | null) {
  if (!oid) return false;

  try {
    const commits = await git.log({ fs, dir: projectPath, ref, depth: 500 });
    return commits.some((commit) => commit.oid === oid);
  } catch {
    return false;
  }
}

async function hasAnyLocalCommit(projectPath: string) {
  return Boolean(await resolveRef(projectPath, 'HEAD'));
}

async function localRemoteUrl(projectPath: string) {
  try {
    const value = await git.getConfig({ fs, dir: projectPath, path: 'remote.origin.url' });
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

async function getLocalAuthor(projectPath: string, userDataPath: string) {
  const saved = await readGitIdentity(userDataPath);
  if (saved) {
    return { name: saved.authorName, email: saved.authorEmail };
  }

  const name = await git.getConfig({ fs, dir: projectPath, path: 'user.name' });
  const email = await git.getConfig({ fs, dir: projectPath, path: 'user.email' });

  if (typeof name === 'string' && typeof email === 'string' && name.trim() && email.trim()) {
    return { name: name.trim(), email: email.trim() };
  }

  throw new Error('AIDD author identity is required before syncing this project.');
}

function checkpointLabel(projectPath: string, createdAt = new Date()) {
  const projectName = path.basename(projectPath);
  const stamp = createdAt.toISOString().slice(0, 16).replace('T', ' ');
  return `AIDD sync checkpoint: ${projectName} ${stamp}`;
}

function isStatusRowChanged(row: GitStatusMatrixRow) {
  const [, head, workdir, stage] = row;
  return !(head === 1 && workdir === 1 && stage === 1);
}

export async function listCheckpointChanges(projectPath: string): Promise<GitStatusMatrixRow[]> {
  const matrix = await git.statusMatrix({ fs, dir: projectPath });

  return matrix
    .filter((row) => isStatusRowChanged(row))
    .filter(([filepath]) => !shouldSkipCheckpointPath(filepath));
}

async function stageCheckpointChanges(projectPath: string, changes: GitStatusMatrixRow[]) {
  for (const [filepath, _head, workdir] of changes) {
    if (workdir === 0) {
      await git.remove({ fs, dir: projectPath, filepath });
    } else {
      await git.add({ fs, dir: projectPath, filepath });
    }
  }
}

export async function createCheckpointIfNeeded(options: GitSyncWorkflowOptions) {
  const changes = await listCheckpointChanges(options.projectPath);
  const hasHead = await hasAnyLocalCommit(options.projectPath);

  if (changes.length === 0 && hasHead) {
    return {
      created: false,
      changedFiles: [],
      label: undefined,
      oid: await resolveRef(options.projectPath, 'HEAD'),
    };
  }

  if (changes.length === 0 && !hasHead) {
    return {
      created: false,
      changedFiles: [],
      label: undefined,
      oid: null,
    };
  }

  const author = await getLocalAuthor(options.projectPath, options.userDataPath);
  await stageCheckpointChanges(options.projectPath, changes);

  const label = checkpointLabel(options.projectPath);
  const oid = await git.commit({
    fs,
    dir: options.projectPath,
    message: label,
    author,
  });

  return {
    created: true,
    changedFiles: changes.map(([filepath]) => filepath),
    label,
    oid,
  };
}

async function defaultListRemoteRefs(input: GitSyncRemoteRefsInput, token: string) {
  const refs = await git.listServerRefs({
    http,
    url: input.repoUrl,
    prefix: 'refs/heads/',
    onAuth: createAuth(input.provider, token),
  });

  return refs.map((ref) => ref.ref);
}

async function defaultPushBranch(input: GitSyncRemoteRefsInput, token: string, projectPath: string) {
  await git.push({
    fs,
    http,
    dir: projectPath,
    remote: 'origin',
    ref: input.branch,
    remoteRef: input.branch,
    force: false,
    onAuth: createAuth(input.provider, token),
  });
}

async function defaultFetchRemote(input: GitSyncRemoteRefsInput, token: string, projectPath: string) {
  await git.fetch({
    fs,
    http,
    dir: projectPath,
    remote: 'origin',
    ref: input.branch,
    singleBranch: true,
    tags: false,
    onAuth: createAuth(input.provider, token),
  });
}

async function fastForwardToRemote(projectPath: string, branchName: string, remoteOid: string) {
  await git.writeRef({ fs, dir: projectPath, ref: `refs/heads/${branchName}`, value: remoteOid, force: true });
  await git.checkout({ fs, dir: projectPath, ref: branchName });
}

async function loadSyncPreconditions(options: GitSyncWorkflowOptions) {
  const connection = await getProjectConnectionStatus(options);

  if (!connection.connected || !connection.repoUrl || !connection.remoteUrl) {
    return {
      ok: false as const,
      result: syncResult(
        false,
        'NOT_CONNECTED',
        syncStatus('not_connected', 'Configure repository sync before syncing this project.')
      ),
    };
  }

  const settings = await readGitSyncSettings(options.userDataPath, options.projectPath);
  if (!settings?.repoUrl) {
    return {
      ok: false as const,
      result: syncResult(
        false,
        'NOT_CONNECTED',
        syncStatus('not_connected', 'Add a remote repository URL before syncing this project.')
      ),
    };
  }

  const token = await resolveToken(options, settings.provider);
  if (!token) {
    return {
      ok: false as const,
      result: syncResult(
        false,
        'MISSING_TOKEN',
        syncStatus('error', 'Enter or save an access token before syncing this project.')
      ),
    };
  }

  const localUrl = await localRemoteUrl(options.projectPath);
  if (!localUrl || localUrl !== settings.repoUrl) {
    return {
      ok: false as const,
      result: syncResult(
        false,
        'NOT_CONNECTED',
        syncStatus('not_connected', 'Update Git setup before syncing this project.')
      ),
    };
  }

  const activeBranch = await currentBranch(options.projectPath);
  if (activeBranch && activeBranch !== branch()) {
    return {
      ok: false as const,
      result: syncResult(
        false,
        'UNSAFE_REPOSITORY_STATE',
        syncStatus('review_needed', 'Sync needs review because this project is not on the AIDD-managed main branch.')
      ),
    };
  }

  return {
    ok: true as const,
    settings,
    token,
    remoteInput: {
      provider: settings.provider,
      repoUrl: settings.repoUrl,
      branch: branch(),
    },
  };
}

function branchExists(refs: string[], branchName: string) {
  const fullRef = `refs/heads/${branchName}`;
  return refs.some((ref) => ref === fullRef || ref === branchName);
}

export async function getSyncStatus(options: GitSyncWorkflowOptions): Promise<AiddGitSyncStatus> {
  const stored = await readGitSyncState(options.userDataPath, options.projectPath);
  const connection = await getProjectConnectionStatus(options);

  if (!connection.connected) {
    return syncStatus('not_connected', connection.message, {
      lastSyncAt: stored?.lastSyncAt,
      lastCheckpointLabel: stored?.lastCheckpointLabel,
    });
  }

  const changes = await listCheckpointChanges(options.projectPath);

  if (changes.length > 0) {
    return syncStatus('local_changes', 'This project has local changes ready to share.', {
      lastSyncAt: stored?.lastSyncAt,
      lastCheckpointLabel: stored?.lastCheckpointLabel,
    });
  }

  return syncStatus(stored?.state || 'up_to_date', stored?.message || 'Project is ready to sync.', {
    lastSyncAt: stored?.lastSyncAt,
    lastCheckpointLabel: stored?.lastCheckpointLabel,
  });
}

export async function checkForUpdates(
  options: GitSyncWorkflowOptions,
  hooks: GitSyncWorkflowTestHooks = {}
): Promise<AiddGitSyncResult> {
  const preconditions = await loadSyncPreconditions(options);
  if (!preconditions.ok) return preconditions.result;

  const { settings, token, remoteInput } = preconditions;

  try {
    const refs = await (hooks.listRemoteRefs || defaultListRemoteRefs)(remoteInput, token);

    if (refs.length === 0 || !branchExists(refs, branch())) {
      const status = syncStatus('ready_to_publish_first_version', 'Repository is connected and ready for the first project publish.');
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    await (hooks.fetchRemote || ((input, authToken) => defaultFetchRemote(input, authToken, options.projectPath)))(remoteInput, token);

    const localOid = await resolveRef(options.projectPath, branch());
    const remoteOid = await resolveRef(options.projectPath, `refs/remotes/origin/${branch()}`);

    if (localOid && remoteOid && localOid === remoteOid) {
      const status = syncStatus('up_to_date', 'Project is up to date.');
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    if (localOid && remoteOid && (await refHistoryContains(options.projectPath, `refs/remotes/origin/${branch()}`, localOid))) {
      const status = syncStatus('remote_updates_available', 'Shared project updates are available.');
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    const status = syncStatus('review_needed', 'Sync needs review before updates can be combined safely.');
    await saveGitSyncState(options.userDataPath, options.projectPath, status);
    return syncResult(false, 'UNSAFE_REPOSITORY_STATE', status);
  } catch (error) {
    const mapped = mapGitError(error);
    const status = syncStatus('error', mapped.message);
    await saveGitSyncState(options.userDataPath, options.projectPath, status);
    return syncResult(false, 'REMOTE_CHECK_FAILED', status, mapped.message);
  }
}

export async function syncProject(
  options: GitSyncWorkflowOptions,
  hooks: GitSyncWorkflowTestHooks = {}
): Promise<AiddGitSyncResult> {
  const preconditions = await loadSyncPreconditions(options);
  if (!preconditions.ok) return preconditions.result;

  const { token, remoteInput } = preconditions;

  try {
    const checkpoint = await createCheckpointIfNeeded(options);
    const refs = await (hooks.listRemoteRefs || defaultListRemoteRefs)(remoteInput, token);

    if (refs.length === 0 || !branchExists(refs, branch())) {
      await (hooks.pushBranch || ((input, authToken) => defaultPushBranch(input, authToken, options.projectPath)))(remoteInput, token);

      const status = syncStatus('synced', 'Your project version was shared and the main branch is ready.', {
        lastSyncAt: nowIso(),
        lastCheckpointLabel: checkpoint.label,
      });
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    await (hooks.fetchRemote || ((input, authToken) => defaultFetchRemote(input, authToken, options.projectPath)))(remoteInput, token);

    const localOid = await resolveRef(options.projectPath, branch());
    const remoteOid = await resolveRef(options.projectPath, `refs/remotes/origin/${branch()}`);

    if (!localOid) {
      const status = syncStatus('error', 'Local project history is missing. Update Git setup before syncing.');
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(false, 'UNSAFE_REPOSITORY_STATE', status);
    }

    if (remoteOid && localOid === remoteOid) {
      const status = syncStatus('up_to_date', checkpoint.created ? 'Your changes were saved locally.' : 'Project is up to date.', {
        lastSyncAt: nowIso(),
        lastCheckpointLabel: checkpoint.label,
      });
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    if (!remoteOid || (await refHistoryContains(options.projectPath, branch(), remoteOid))) {
      await (hooks.pushBranch || ((input, authToken) => defaultPushBranch(input, authToken, options.projectPath)))(remoteInput, token);

      const status = syncStatus('synced', checkpoint.created ? 'Your changes were saved and shared.' : 'Project was shared with the repository.', {
        lastSyncAt: nowIso(),
        lastCheckpointLabel: checkpoint.label,
      });
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    if (!checkpoint.created && remoteOid && (await refHistoryContains(options.projectPath, `refs/remotes/origin/${branch()}`, localOid))) {
      await fastForwardToRemote(options.projectPath, branch(), remoteOid);

      const status = syncStatus('synced', 'New shared updates were received.', {
        lastSyncAt: nowIso(),
      });
      await saveGitSyncState(options.userDataPath, options.projectPath, status);
      return syncResult(true, 'OK', status);
    }

    const status = syncStatus('review_needed', 'Sync needs review before local and shared changes can be combined safely.', {
      lastCheckpointLabel: checkpoint.label,
    });
    await saveGitSyncState(options.userDataPath, options.projectPath, status);
    return syncResult(false, 'UNSAFE_REPOSITORY_STATE', status);
  } catch (error) {
    const mapped = mapGitError(error);
    const code = mapped.code === 'AUTH_FAILED' ? 'MISSING_TOKEN' : 'UNKNOWN_ERROR';
    const status = syncStatus('error', mapped.message);
    await saveGitSyncState(options.userDataPath, options.projectPath, status);
    return syncResult(false, code, status, mapped.message);
  }
}
