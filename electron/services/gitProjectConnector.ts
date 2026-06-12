import fs from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';
import git from 'isomorphic-git';
import type { GitCredentialStore } from './gitCredentialStore';
import { readGitProjectConnection, saveGitProjectConnection } from './gitProjectConnectionStore';
import { AIDD_DEFAULT_BRANCH, readGitSyncSettings } from './gitSyncSettingsStore';
import { readGitIdentity } from './gitIdentityStore';
import type {
  AiddGitIdentity,
  AiddGitProjectConnectionCode,
  AiddGitProjectConnectionResult,
  AiddGitProjectConnectionStatus,
  AiddGitSyncSettings,
} from './gitSyncTypes';
import { mapGitError, normaliseRemoteUrlForCompare, validateHttpsRepoUrl } from './gitSyncValidation';

export interface GitProjectConnectorOptions {
  userDataPath: string;
  projectPath: string;
  credentialStore: GitCredentialStore;
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureProjectGitIgnore(projectPath: string) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const requiredEntries = ['.aidd-app/', 'node_modules/', 'dist/'];

  let existing = '';
  if (await pathExists(gitignorePath)) {
    existing = await fsp.readFile(gitignorePath, 'utf8');
  }

  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : '';
  await fsp.writeFile(gitignorePath, `${prefix}${missing.join('\n')}\n`, 'utf8');
}

async function hasLocalGitRepository(projectPath: string) {
  return pathExists(path.join(projectPath, '.git'));
}

async function getOriginRemoteUrl(projectPath: string): Promise<string | null> {
  try {
    const value = await git.getConfig({ fs, dir: projectPath, path: 'remote.origin.url' });
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

async function ensureLocalRepository(projectPath: string) {
  await ensureProjectGitIgnore(projectPath);

  if (await hasLocalGitRepository(projectPath)) {
    return;
  }

  await git.init({ fs, dir: projectPath, defaultBranch: AIDD_DEFAULT_BRANCH });
}

async function ensureOriginRemote(projectPath: string, repoUrl: string): Promise<{ ok: true; remoteUrl: string } | { ok: false; remoteUrl: string }> {
  const existingRemoteUrl = await getOriginRemoteUrl(projectPath);

  if (existingRemoteUrl && normaliseRemoteUrlForCompare(existingRemoteUrl) !== normaliseRemoteUrlForCompare(repoUrl)) {
    return { ok: false, remoteUrl: existingRemoteUrl };
  }

  await git.setConfig({ fs, dir: projectPath, path: 'remote.origin.url', value: repoUrl });
  await git.setConfig({ fs, dir: projectPath, path: 'remote.origin.fetch', value: '+refs/heads/*:refs/remotes/origin/*' });

  return { ok: true, remoteUrl: repoUrl };
}

async function configureLocalAuthor(projectPath: string, identity: AiddGitIdentity) {
  await git.setConfig({ fs, dir: projectPath, path: 'user.name', value: identity.authorName.trim() });
  await git.setConfig({ fs, dir: projectPath, path: 'user.email', value: identity.authorEmail.trim() });
}

function buildStatus(input: {
  connected: boolean;
  state: AiddGitProjectConnectionStatus['state'];
  settings?: AiddGitSyncSettings | null;
  identity?: AiddGitIdentity | null;
  hasLocalRepository?: boolean;
  remoteUrl?: string | null;
  hasToken?: boolean;
  lastConnectedAt?: string;
  message?: string;
}): AiddGitProjectConnectionStatus {
  const branch = AIDD_DEFAULT_BRANCH;

  return {
    connected: input.connected,
    state: input.state,
    provider: input.settings?.provider,
    repoUrl: input.settings?.repoUrl || undefined,
    branch,
    remoteUrl: input.remoteUrl || undefined,
    hasLocalRepository: Boolean(input.hasLocalRepository),
    hasToken: input.hasToken,
    authorName: input.identity?.authorName,
    authorEmail: input.identity?.authorEmail,
    lastConnectedAt: input.lastConnectedAt,
    message: input.message || statusMessageForState(input.state, input.settings, input.identity),
  };
}

function statusMessageForState(
  state: AiddGitProjectConnectionStatus['state'],
  settings?: AiddGitSyncSettings | null,
  identity?: AiddGitIdentity | null
) {
  switch (state) {
    case 'missing_identity':
      return 'Set your AIDD author name and email before configuring local Git.';
    case 'local_not_ready':
      return 'Local Git setup has not been completed for this project yet.';
    case 'local_ready':
      return 'Local Git setup is ready. Add a remote repository URL when you want to sync.';
    case 'remote_not_configured':
      return 'Local Git setup is ready. Remote repository sync is optional and has not been configured.';
    case 'connected':
      return `Local Git is ready${identity ? ` for ${identity.authorName} <${identity.authorEmail}>` : ''}. Repository sync is configured${settings?.repoUrl ? ` for ${settings.repoUrl}` : ''}.`;
    case 'remote_mismatch':
      return 'This project is already connected to a different repository. Review the repository URL before changing it.';
    case 'needs_attention':
      return 'The repository setup needs attention.';
    case 'error':
      return 'The repository setup could not be checked.';
    default:
      return 'Local Git setup has not been completed for this project yet.';
  }
}

function resultFromStatus(
  ok: boolean,
  code: AiddGitProjectConnectionCode,
  status: AiddGitProjectConnectionStatus,
  message = status.message
): AiddGitProjectConnectionResult {
  return { ok, code, message, status };
}

export async function getProjectConnectionStatus(options: GitProjectConnectorOptions): Promise<AiddGitProjectConnectionStatus> {
  const { userDataPath, projectPath, credentialStore } = options;

  if (!projectPath) {
    return buildStatus({
      connected: false,
      state: 'local_not_ready',
      hasLocalRepository: false,
      message: 'No active project is selected.',
    });
  }

  const identity = await readGitIdentity(userDataPath);
  const settingsWithoutToken = await readGitSyncSettings(userDataPath, projectPath);
  const hasToken = settingsWithoutToken ? await credentialStore.hasToken(projectPath, settingsWithoutToken.provider) : false;
  const settings = settingsWithoutToken ? { ...settingsWithoutToken, hasToken } : null;
  const hasRepo = await hasLocalGitRepository(projectPath);
  const remoteUrl = hasRepo ? await getOriginRemoteUrl(projectPath) : null;
  const stored = await readGitProjectConnection(userDataPath, projectPath);

  if (!identity) {
    return buildStatus({
      connected: false,
      state: 'missing_identity',
      settings,
      hasLocalRepository: hasRepo,
      remoteUrl,
      hasToken,
      lastConnectedAt: stored?.connectedAt,
    });
  }

  if (!hasRepo) {
    return buildStatus({
      connected: false,
      state: 'local_not_ready',
      settings,
      identity,
      hasLocalRepository: false,
      remoteUrl,
      hasToken,
      lastConnectedAt: stored?.connectedAt,
    });
  }

  if (!settings?.repoUrl) {
    return buildStatus({
      connected: false,
      state: 'local_ready',
      settings,
      identity,
      hasLocalRepository: true,
      remoteUrl,
      hasToken,
      lastConnectedAt: stored?.connectedAt,
    });
  }

  if (!remoteUrl) {
    return buildStatus({
      connected: false,
      state: 'remote_not_configured',
      settings,
      identity,
      hasLocalRepository: true,
      remoteUrl,
      hasToken,
      lastConnectedAt: stored?.connectedAt,
    });
  }

  if (normaliseRemoteUrlForCompare(remoteUrl) !== normaliseRemoteUrlForCompare(settings.repoUrl)) {
    return buildStatus({
      connected: false,
      state: 'remote_mismatch',
      settings,
      identity,
      hasLocalRepository: true,
      remoteUrl,
      hasToken,
      lastConnectedAt: stored?.connectedAt,
    });
  }

  return buildStatus({
    connected: true,
    state: 'connected',
    settings,
    identity,
    hasLocalRepository: true,
    remoteUrl,
    hasToken,
    lastConnectedAt: stored?.connectedAt,
  });
}

export async function connectProjectToRepository(options: GitProjectConnectorOptions): Promise<AiddGitProjectConnectionResult> {
  const { userDataPath, projectPath, credentialStore } = options;

  if (!projectPath) {
    const status = buildStatus({
      connected: false,
      state: 'local_not_ready',
      hasLocalRepository: false,
      message: 'No active project is selected.',
    });
    return resultFromStatus(false, 'MISSING_PROJECT', status);
  }

  const identity = await readGitIdentity(userDataPath);
  const settingsWithoutToken = await readGitSyncSettings(userDataPath, projectPath);
  const hasToken = settingsWithoutToken ? await credentialStore.hasToken(projectPath, settingsWithoutToken.provider) : false;
  const settings = settingsWithoutToken ? { ...settingsWithoutToken, hasToken } : null;

  if (!identity) {
    const status = buildStatus({
      connected: false,
      state: 'missing_identity',
      settings,
      hasLocalRepository: await hasLocalGitRepository(projectPath),
      remoteUrl: await getOriginRemoteUrl(projectPath),
      hasToken,
    });

    return resultFromStatus(false, 'MISSING_IDENTITY', status);
  }

  try {
    await ensureLocalRepository(projectPath);
    await configureLocalAuthor(projectPath, identity);

    const connectedAt = new Date().toISOString();

    if (!settings?.repoUrl) {
      await saveGitProjectConnection(userDataPath, projectPath, {
        branch: AIDD_DEFAULT_BRANCH,
        remoteState: 'not_configured',
        connectedAt,
      });

      const status = buildStatus({
        connected: false,
        state: 'local_ready',
        settings,
        identity,
        hasLocalRepository: true,
        remoteUrl: await getOriginRemoteUrl(projectPath),
        hasToken,
        lastConnectedAt: connectedAt,
        message: 'Local Git setup is ready. Add a remote repository URL when you want to sync.',
      });

      return resultFromStatus(true, 'LOCAL_READY', status);
    }

    if (!validateHttpsRepoUrl(settings.repoUrl, settings.provider)) {
      const status = buildStatus({
        connected: false,
        state: 'needs_attention',
        settings,
        identity,
        hasLocalRepository: true,
        remoteUrl: await getOriginRemoteUrl(projectPath),
        hasToken,
        message: 'Enter a valid HTTPS repository URL before connecting the remote repository.',
      });
      return resultFromStatus(false, 'INVALID_REPO_URL', status);
    }

    const remote = await ensureOriginRemote(projectPath, settings.repoUrl);

    if (!remote.ok) {
      const status = buildStatus({
        connected: false,
        state: 'remote_mismatch',
        settings,
        identity,
        hasLocalRepository: true,
        remoteUrl: remote.remoteUrl,
        hasToken,
      });
      return resultFromStatus(false, 'REMOTE_MISMATCH', status);
    }

    await saveGitProjectConnection(userDataPath, projectPath, {
      provider: settings.provider,
      repoUrl: settings.repoUrl,
      branch: AIDD_DEFAULT_BRANCH,
      remoteState: 'configured',
      connectedAt,
    });

    const status = buildStatus({
      connected: true,
      state: 'connected',
      settings,
      identity,
      hasLocalRepository: true,
      remoteUrl: remote.remoteUrl,
      hasToken,
      lastConnectedAt: connectedAt,
      message: `Local Git setup is ready and repository sync is configured for ${settings.repoUrl}. Use Test connection in Settings to verify remote access.`,
    });

    return resultFromStatus(true, 'OK', status);
  } catch (error) {
    const mapped = mapGitError(error);
    const status = buildStatus({
      connected: false,
      state: 'error',
      settings,
      identity,
      hasLocalRepository: await hasLocalGitRepository(projectPath),
      remoteUrl: await getOriginRemoteUrl(projectPath),
      hasToken,
      message: mapped.message,
    });

    return resultFromStatus(false, 'LOCAL_REPO_ERROR', status, mapped.message);
  }
}
