import path from 'node:path';
import { app } from 'electron';
import { createCheckpointIfNeeded, syncProject } from './gitSyncWorkflow';
import type { GitCredentialStore } from './gitCredentialStore';

export interface SaveSyncServiceOptions {
  credentialStore: GitCredentialStore;
}

export interface SaveSyncResult {
  ok: boolean;
  code: 'SHARED' | 'LOCAL_CHECKPOINT' | 'SKIPPED' | 'NEEDS_REVIEW' | 'ERROR';
  message: string;
  projectPath?: string;
  checkpointCreated?: boolean;
  checkpointLabel?: string;
}

function isLocalOnlySyncFailure(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

export function shouldSkipSaveCheckpointPath(filePath: string) {
  const normalised = path.resolve(filePath || '').replace(/\\/g, '/');

  return (
    normalised.includes('/.git/') ||
    normalised.includes('/.aidd-app/') ||
    normalised.includes('/.aidd/drag-files/') ||
    normalised.endsWith('/.env') ||
    normalised.includes('/node_modules/') ||
    normalised.includes('/dist/') ||
    normalised.includes('/build/')
  );
}

export async function findAiddProjectRootForSavedFile(filePath: string, exists: (targetPath: string) => Promise<boolean>) {
  const resolved = path.resolve(filePath || '');

  if (!resolved || shouldSkipSaveCheckpointPath(resolved)) {
    return null;
  }

  let current = path.dirname(resolved);

  while (true) {
    if (await exists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    if (await exists(path.join(current, '.git'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) {
      break;
    }

    current = next;
  }

  return null;
}

export function createSaveSyncService(options: SaveSyncServiceOptions) {
  const { credentialStore } = options;

  async function checkpointAndShareProjectAfterSave(projectPath: string): Promise<SaveSyncResult> {
    if (!projectPath) {
      return {
        ok: true,
        code: 'SKIPPED',
        message: 'No active project path was available for save sync.',
      };
    }

    const syncOptions = {
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore,
    };

    try {
      const syncResult = await syncProject(syncOptions);

      if (syncResult.ok) {
        return {
          ok: true,
          code: 'SHARED',
          message: syncResult.message,
          projectPath,
        };
      }

      const checkpoint = await createCheckpointIfNeeded(syncOptions);

      if (checkpoint.created) {
        return {
          ok: true,
          code: isLocalOnlySyncFailure(syncResult.code) ? 'LOCAL_CHECKPOINT' : 'NEEDS_REVIEW',
          message: isLocalOnlySyncFailure(syncResult.code)
            ? `Saved locally. ${syncResult.message}`
            : `Saved locally, but sharing needs review: ${syncResult.message}`,
          projectPath,
          checkpointCreated: true,
          checkpointLabel: checkpoint.label,
        };
      }

      return {
        ok: !isLocalOnlySyncFailure(syncResult.code),
        code: isLocalOnlySyncFailure(syncResult.code) ? 'LOCAL_CHECKPOINT' : 'NEEDS_REVIEW',
        message: syncResult.message,
        projectPath,
        checkpointCreated: false,
      };
    } catch (error) {
      try {
        const checkpoint = await createCheckpointIfNeeded(syncOptions);

        if (checkpoint.created) {
          return {
            ok: true,
            code: 'LOCAL_CHECKPOINT',
            message: `Saved locally after sharing failed: ${error instanceof Error ? error.message : String(error)}`,
            projectPath,
            checkpointCreated: true,
            checkpointLabel: checkpoint.label,
          };
        }
      } catch {
        // Return the original save/share error below.
      }

      return {
        ok: false,
        code: 'ERROR',
        message: `Saved, but checkpoint/share did not complete: ${error instanceof Error ? error.message : String(error)}`,
        projectPath,
      };
    }
  }

  async function withProjectSaveSync<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
    const result = await work();
    const saveSyncResult = await checkpointAndShareProjectAfterSave(projectPath);

    if (saveSyncResult.code === 'ERROR') {
      console.warn(`[AIDD save-sync] ${saveSyncResult.message}`);
    } else {
      console.log(`[AIDD save-sync] ${saveSyncResult.message}`);
    }

    return result;
  }

  return {
    checkpointAndShareProjectAfterSave,
    withProjectSaveSync,
  };
}
