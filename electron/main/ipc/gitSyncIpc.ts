import { app, ipcMain } from 'electron';
import { readGitSyncSettings, saveGitSyncSettings } from '../../services/gitSyncSettingsStore';
import { testGitRemoteConnection } from '../../services/gitRemoteTester';
import { connectProjectToRepository, getProjectConnectionStatus } from '../../services/gitProjectConnector';
import { readGitIdentity, saveGitIdentity } from '../../services/gitIdentityStore';
import { checkForUpdates, getSyncStatus, syncProject } from '../../services/gitSyncWorkflow';
import type { AiddSaveGitIdentityInput, AiddSaveGitSyncSettingsInput, AiddGitSyncTestInput } from '../../services/gitSyncTypes';
import { cancelGitReview, completeGitReview, listGitReviewFiles, readGitReviewFileContent, resolveGitReviewFile } from '../../services/gitReviewResolver';
import { readActiveGitReviewState } from '../../services/gitReviewPackageStore';
import { gitCredentialStore } from './saveSync';
import {
  AIDD_DEFAULT_BRANCH
} from '../domain/aiddProjectService';

export function registerGitSyncIpcHandlers() {
  ipcMain.handle('gitIdentity:read', async () => {
    return readGitIdentity(app.getPath('userData'));
  });

  ipcMain.handle('gitIdentity:save', async (_event, input: AiddSaveGitIdentityInput) => {
    return saveGitIdentity(app.getPath('userData'), input);
  });

  ipcMain.handle('gitSync:readSettings', async (_event, projectPath: string) => {
    if (!projectPath) return null;
    const settings = await readGitSyncSettings(app.getPath('userData'), projectPath);
    if (!settings) return null;
    return {
      ...settings,
      hasToken: await gitCredentialStore.hasToken(projectPath, settings.provider)
    };
  });

  ipcMain.handle('gitSync:saveSettings', async (_event, input: AiddSaveGitSyncSettingsInput) => {
    if (!input?.projectPath) throw new Error('Project path is required.');

    const saved = await saveGitSyncSettings(app.getPath('userData'), input.projectPath, {
      provider: input.provider,
      repoUrl: input.repoUrl || '',
      branch: AIDD_DEFAULT_BRANCH
    });

    if (input.token?.trim()) {
      await gitCredentialStore.saveToken(input.projectPath, saved.provider, input.token);
    }

    const settings = await readGitSyncSettings(app.getPath('userData'), input.projectPath, await gitCredentialStore.hasToken(input.projectPath, saved.provider));
    if (!settings) throw new Error('Repository sync settings could not be saved.');
    return settings;
  });

  ipcMain.handle('gitSync:testConnection', async (_event, input: AiddGitSyncTestInput) => {
    return testGitRemoteConnection({ ...input, branch: AIDD_DEFAULT_BRANCH }, gitCredentialStore);
  });

  ipcMain.handle('gitSync:clearToken', async (_event, projectPath: string) => {
    if (!projectPath) return null;
    const settings = await readGitSyncSettings(app.getPath('userData'), projectPath);
    if (!settings) return null;
    await gitCredentialStore.clearToken(projectPath, settings.provider);
    return {
      ...settings,
      hasToken: false
    };
  });

  ipcMain.handle('gitSync:getProjectConnectionStatus', async (_event, projectPath: string) => {
    return getProjectConnectionStatus({
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore: gitCredentialStore
    });
  });


  ipcMain.handle('gitSync:connectProject', async (_event, projectPath: string) => {
    return connectProjectToRepository({
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore: gitCredentialStore
    });
  });

  ipcMain.handle('gitSync:getSyncStatus', async (_event, projectPath: string) => {
    return getSyncStatus({
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore: gitCredentialStore
    });
  });

  ipcMain.handle('gitSync:checkForUpdates', async (_event, projectPath: string) => {
    return checkForUpdates({
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore: gitCredentialStore
    });
  });

  ipcMain.handle('gitSync:syncProject', async (_event, projectPath: string) => {
    return syncProject({
      userDataPath: app.getPath('userData'),
      projectPath,
      credentialStore: gitCredentialStore
    });
  });

  ipcMain.handle('gitSync:getReviewState', async (_event, projectPath: string) => {
    return readActiveGitReviewState(projectPath);
  });

  ipcMain.handle('gitSync:listReviewFiles', async (_event, projectPath: string) => {
    return listGitReviewFiles(projectPath);
  });

  ipcMain.handle('gitSync:readReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; kind: 'local' | 'remote' | 'base' }) => {
    return readGitReviewFileContent(input);
  });

  ipcMain.handle('gitSync:resolveReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; resolution: 'keep_local' | 'use_shared' | 'use_combined_draft'; combinedContent?: string }) => {
    return resolveGitReviewFile(input);
  });

  ipcMain.handle('gitSync:completeReview', async (_event, projectPath: string, reviewId: string) => {
    return completeGitReview(projectPath, reviewId);
  });

  ipcMain.handle('gitSync:cancelReview', async (_event, projectPath: string, reviewId: string) => {
    return cancelGitReview(projectPath, reviewId);
  });
}
