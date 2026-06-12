import path from 'node:path';
import fsp from 'node:fs/promises';
import type { GitProvider } from './gitSyncTypes';
import { projectKeyFromPath } from './gitSyncSettingsStore';

const CONNECTION_FILE = 'git-project-connection.json';

export type StoredGitProjectRemoteState = 'not_configured' | 'configured';

export interface StoredGitProjectConnection {
  provider?: GitProvider;
  repoUrl?: string;
  branch: 'main';
  remoteState: StoredGitProjectRemoteState;
  connectedAt: string;
}

export function getGitProjectConnectionPath(userDataPath: string, projectPath: string) {
  return path.join(userDataPath, 'projects', projectKeyFromPath(projectPath), CONNECTION_FILE);
}

export async function readGitProjectConnection(userDataPath: string, projectPath: string): Promise<StoredGitProjectConnection | null> {
  const filePath = getGitProjectConnectionPath(userDataPath, projectPath);

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredGitProjectConnection>;

    if (!parsed.branch || !parsed.connectedAt) {
      return null;
    }

    return {
      provider: parsed.provider,
      repoUrl: parsed.repoUrl,
      branch: 'main',
      remoteState: parsed.remoteState || (parsed.repoUrl ? 'configured' : 'not_configured'),
      connectedAt: parsed.connectedAt,
    };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveGitProjectConnection(userDataPath: string, projectPath: string, connection: StoredGitProjectConnection) {
  const filePath = getGitProjectConnectionPath(userDataPath, projectPath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(connection, null, 2)}\n`, 'utf8');
  return connection;
}

export async function clearGitProjectConnection(userDataPath: string, projectPath: string) {
  const filePath = getGitProjectConnectionPath(userDataPath, projectPath);
  try {
    await fsp.rm(filePath, { force: true });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw error;
  }
}
