import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import git from 'isomorphic-git';
import { createMemoryCredentialStore } from '../electron/services/gitCredentialStore';
import { connectProjectToRepository, getProjectConnectionStatus } from '../electron/services/gitProjectConnector';
import { saveGitIdentity } from '../electron/services/gitIdentityStore';
import { saveGitSyncSettings } from '../electron/services/gitSyncSettingsStore';

async function getLocalConfig(projectPath: string, configPath: string) {
  try {
    const value = await git.getConfig({ fs, dir: projectPath, path: configPath });
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function run() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-git-project-connect-'));
  const userDataPath = path.join(tempRoot, 'user-data');
  const projectPath = path.join(tempRoot, 'workspace', 'example-project');

  await fsp.mkdir(projectPath, { recursive: true });
  await fsp.writeFile(path.join(projectPath, 'README.md'), '# Test AIDD Project\n', 'utf8');

  const credentialStore = createMemoryCredentialStore();

  /**
   * The connector may either:
   *
   * - fail with MISSING_IDENTITY when neither AIDD nor global Git identity exists, or
   * - succeed with LOCAL_READY when the developer machine has global Git user.name/user.email.
   *
   * Both behaviours are valid because AIDD intentionally uses global Git identity as a first-run fallback.
   */
  const firstRun = await connectProjectToRepository({
    userDataPath,
    projectPath,
    credentialStore,
  });

  if (firstRun.ok) {
    assert.equal(firstRun.code, 'LOCAL_READY');
    assert.equal(firstRun.status.state, 'local_ready');
    assert.equal(firstRun.status.hasLocalRepository, true);
    assert.ok(firstRun.status.authorName, 'global Git identity should provide authorName when first run succeeds');
    assert.ok(firstRun.status.authorEmail, 'global Git identity should provide authorEmail when first run succeeds');
  } else {
    assert.equal(firstRun.code, 'MISSING_IDENTITY');
    assert.equal(firstRun.status.state, 'missing_identity');
  }

  await saveGitIdentity(userDataPath, {
    authorName: 'Francis',
    authorEmail: 'francis@example.com',
  });

  const localOnly = await connectProjectToRepository({
    userDataPath,
    projectPath,
    credentialStore,
  });

  assert.equal(localOnly.ok, true);
  assert.equal(localOnly.code, 'LOCAL_READY');
  assert.equal(localOnly.status.state, 'local_ready');
  assert.equal(localOnly.status.authorName, 'Francis');
  assert.equal(localOnly.status.authorEmail, 'francis@example.com');

  assert.equal(await getLocalConfig(projectPath, 'user.name'), 'Francis');
  assert.equal(await getLocalConfig(projectPath, 'user.email'), 'francis@example.com');

  await saveGitSyncSettings(userDataPath, projectPath, {
    provider: 'gitlab',
    repoUrl: 'https://arcforge.westforge.net/legacy/test-aidd.git',
    branch: 'main',
  });
  await credentialStore.saveToken(projectPath, 'gitlab', 'fake-test-token');

  const connected = await connectProjectToRepository({
    userDataPath,
    projectPath,
    credentialStore,
  });

  assert.equal(connected.ok, true);
  assert.equal(connected.code, 'OK');
  assert.equal(connected.status.connected, true);
  assert.equal(connected.status.state, 'connected');

  const remoteUrl = await getLocalConfig(projectPath, 'remote.origin.url');
  const remoteFetch = await getLocalConfig(projectPath, 'remote.origin.fetch');

  assert.equal(remoteUrl, 'https://arcforge.westforge.net/legacy/test-aidd.git');
  assert.equal(remoteFetch, '+refs/heads/*:refs/remotes/origin/*');
  assert.equal(String(remoteUrl).includes('fake-test-token'), false, 'remote URL must not contain the token');

  assert.equal(await getLocalConfig(projectPath, 'user.name'), 'Francis');
  assert.equal(await getLocalConfig(projectPath, 'user.email'), 'francis@example.com');

  const configFile = await fsp.readFile(path.join(projectPath, '.git', 'config'), 'utf8');
  assert.equal(configFile.includes('fake-test-token'), false, 'token must not be written to .git/config');

  const status = await getProjectConnectionStatus({ userDataPath, projectPath, credentialStore });
  assert.equal(status.connected, true);
  assert.equal(status.state, 'connected');
  assert.equal(status.authorName, 'Francis');
  assert.equal(status.authorEmail, 'francis@example.com');

  await fsp.rm(tempRoot, { recursive: true, force: true });

  console.log('Git project connection unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
