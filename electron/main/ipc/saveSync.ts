import { app } from 'electron';
import path from 'node:path';
import { createKeytarCredentialStore } from '../../services/gitCredentialStore';
import { createCheckpointIfNeeded, syncProject } from '../../services/gitSyncWorkflow';
import { exists } from '../domain/aiddProjectService';

export const gitCredentialStore = createKeytarCredentialStore();

function isLocalOnlySyncFailureAfterSave(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function shouldSkipSaveCheckpointPath(filePath: string) {
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

export async function findAiddProjectRootForSavedFile(filePath: string) {
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

export async function checkpointAndShareProjectAfterSave(projectPath: string) {
  if (!projectPath) {
    return;
  }

  const options = {
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore,
  };

  try {
    const syncResult = await syncProject(options);

    if (syncResult.ok) {
      console.log(`[AIDD save-sync] Saved, checkpointed and shared: ${syncResult.message}`);
      return;
    }

    const checkpoint = await createCheckpointIfNeeded(options);

    if (checkpoint.created) {
      console.log(`[AIDD save-sync] Saved and checkpointed locally: ${checkpoint.label}`);
    }

    if (isLocalOnlySyncFailureAfterSave(syncResult.code)) {
      console.log(`[AIDD save-sync] Remote share skipped: ${syncResult.message}`);
      return;
    }

    console.warn(`[AIDD save-sync] Remote share needs attention: ${syncResult.message}`);
  } catch (error) {
    try {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.warn(`[AIDD save-sync] Saved and checkpointed locally after share failed: ${checkpoint.label}`);
        return;
      }
    } catch (checkpointError) {
      console.warn(`[AIDD save-sync] Checkpoint failed after save: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
    }

    console.warn(`[AIDD save-sync] Saved, but checkpoint/share did not complete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function withProjectSaveSync<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSave(projectPath);
  return result;
}
