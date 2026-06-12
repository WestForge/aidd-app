import crypto from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import type { AiddGitSyncSettings, GitProvider, StoredGitSyncSettings } from './gitSyncTypes';
import { normaliseRepoUrl, validateGitProvider } from './gitSyncValidation';

const SETTINGS_FILE = 'git-sync-settings.json';
export const AIDD_DEFAULT_BRANCH = 'main' as const;

export function projectKeyFromPath(projectPath: string) {
  const resolved = path.resolve(projectPath || '');
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24);
}

export function getGitSyncSettingsPath(userDataPath: string, projectPath: string) {
  return path.join(userDataPath, 'projects', projectKeyFromPath(projectPath), SETTINGS_FILE);
}

export async function readGitSyncSettings(userDataPath: string, projectPath: string, hasToken = false): Promise<AiddGitSyncSettings | null> {
  const filePath = getGitSyncSettingsPath(userDataPath, projectPath);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredGitSyncSettings>;
    const provider = validateGitProvider(parsed.provider);

    return {
      provider,
      repoUrl: normaliseRepoUrl(parsed.repoUrl || ''),
      branch: AIDD_DEFAULT_BRANCH,
      hasToken,
    };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveGitSyncSettings(userDataPath: string, projectPath: string, settings: StoredGitSyncSettings) {
  const provider: GitProvider = validateGitProvider(settings.provider);
  const safeSettings: StoredGitSyncSettings = {
    provider,
    repoUrl: normaliseRepoUrl(settings.repoUrl || ''),
    branch: AIDD_DEFAULT_BRANCH,
  };

  const filePath = getGitSyncSettingsPath(userDataPath, projectPath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(safeSettings, null, 2)}\n`, 'utf8');
  return safeSettings;
}
