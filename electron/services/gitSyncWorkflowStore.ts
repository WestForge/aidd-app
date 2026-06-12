import path from 'node:path';
import fsp from 'node:fs/promises';
import type { AiddGitSyncStatus } from './gitSyncTypes';
import { projectKeyFromPath } from './gitSyncSettingsStore';

const SYNC_STATE_FILE = 'git-sync-state.json';

export function getGitSyncStatePath(userDataPath: string, projectPath: string) {
  return path.join(userDataPath, 'projects', projectKeyFromPath(projectPath), SYNC_STATE_FILE);
}

export async function readGitSyncState(userDataPath: string, projectPath: string): Promise<AiddGitSyncStatus | null> {
  const filePath = getGitSyncStatePath(userDataPath, projectPath);

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw) as AiddGitSyncStatus;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveGitSyncState(userDataPath: string, projectPath: string, status: AiddGitSyncStatus) {
  const filePath = getGitSyncStatePath(userDataPath, projectPath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  return status;
}
