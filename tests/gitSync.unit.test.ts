import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createMemoryCredentialStore } from '../electron/services/gitCredentialStore';
import { getGitSyncSettingsPath, readGitSyncSettings, saveGitSyncSettings } from '../electron/services/gitSyncSettingsStore';
import { testGitRemoteConnection } from '../electron/services/gitRemoteTester';

async function run() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-git-sync-'));
  const userDataPath = path.join(tempRoot, 'user-data');
  const projectPath = path.join(tempRoot, 'workspace', 'example-project');
  const provider = 'github' as const;
  const token = 'fake-test-token';

  await fsp.mkdir(projectPath, { recursive: true });

  assert.equal(await readGitSyncSettings(userDataPath, projectPath), null, 'settings should start empty');

  await saveGitSyncSettings(userDataPath, projectPath, {
    provider,
    repoUrl: 'https://github.com/org/repo.git',
    branch: 'main'
  });

  const settingsPath = getGitSyncSettingsPath(userDataPath, projectPath);
  assert.equal(settingsPath.startsWith(projectPath), false, 'settings must not be stored inside the project workspace');

  const rawSettings = await fsp.readFile(settingsPath, 'utf8');
  assert.equal(rawSettings.includes(token), false, 'settings JSON must not contain the token');
  assert.equal(rawSettings.includes('hasToken'), false, 'hasToken should be derived, not persisted');

  const store = createMemoryCredentialStore();
  assert.equal(await store.hasToken(projectPath, provider), false, 'token should start missing');
  await store.saveToken(projectPath, provider, token);
  assert.equal(await store.getToken(projectPath, provider), token, 'token should round-trip through credential store');
  assert.equal(await store.hasToken(projectPath, provider), true, 'hasToken should reflect saved token');

  const readBack = await readGitSyncSettings(userDataPath, projectPath, await store.hasToken(projectPath, provider));
  assert.deepEqual(readBack, {
    provider,
    repoUrl: 'https://github.com/org/repo.git',
    branch: 'main',
    hasToken: true
  });

  assert.deepEqual(
    await testGitRemoteConnection({ projectPath, provider, repoUrl: 'git@github.com:org/repo.git', branch: 'main' }, store),
    { ok: false, code: 'INVALID_REPO_URL', message: 'Enter a valid HTTPS repository URL.' },
    'SSH URLs should be rejected in Phase 01'
  );

  assert.deepEqual(
    await testGitRemoteConnection({ projectPath, provider, repoUrl: 'https://github.com/org/repo.git', branch: 'main' }, store, async () => ['refs/heads/main', 'refs/heads/develop']),
    { ok: true, code: 'OK', message: 'Connected and found branch main.' },
    'saved token should be used when no new token is supplied'
  );

  assert.deepEqual(
    await testGitRemoteConnection({ projectPath, provider, repoUrl: 'https://github.com/org/repo.git', branch: 'main' }, store, async () => []),
    {
      ok: true,
      code: 'EMPTY_REPOSITORY',
      message: 'Connected. The repository is empty, so branch main has not been created yet. AIDD can create it during the first project sync.'
    },
    'blank repositories should be accepted as a warning state'
  );

  assert.deepEqual(
    await testGitRemoteConnection({ projectPath, provider, repoUrl: 'https://github.com/org/repo.git', branch: 'release' }, store, async () => ['refs/heads/main']),
    { ok: true, code: 'BRANCH_NOT_FOUND', message: 'Connected. Branch release was not found. AIDD can create it during the first project sync.' },
    'missing branch should be a warning state'
  );

  const authFailure = await testGitRemoteConnection(
    { projectPath, provider, repoUrl: 'https://github.com/org/repo.git', branch: 'main', token },
    store,
    async () => {
      const err = new Error(`auth failed for ${token}`) as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
  );
  assert.equal(authFailure.ok, false);
  assert.equal(authFailure.code, 'AUTH_FAILED');
  assert.equal(authFailure.message.includes(token), false, 'error message must not leak token');

  await store.clearToken(projectPath, provider);
  assert.equal(await store.getToken(projectPath, provider), null, 'clearToken should remove token');

  const missingTokenStore = createMemoryCredentialStore();
  assert.deepEqual(
    await testGitRemoteConnection({ projectPath, provider, repoUrl: 'https://github.com/org/repo.git', branch: 'main' }, missingTokenStore),
    { ok: false, code: 'MISSING_TOKEN', message: 'Enter or save an access token before testing the connection.' },
    'missing token should be reported before any network call'
  );

  await fsp.rm(tempRoot, { recursive: true, force: true });

  console.log('Git Sync Phase 01 unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
