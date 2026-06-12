import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import git from 'isomorphic-git';
import { createMemoryCredentialStore } from '../electron/services/gitCredentialStore';
import { connectProjectToRepository } from '../electron/services/gitProjectConnector';
import { saveGitIdentity } from '../electron/services/gitIdentityStore';
import { saveGitSyncSettings } from '../electron/services/gitSyncSettingsStore';
import { createCheckpointIfNeeded, getSyncStatus, syncProject } from '../electron/services/gitSyncWorkflow';

async function getCommitCount(projectPath: string) {
  try {
    return (await git.log({ fs, dir: projectPath })).length;
  } catch {
    return 0;
  }
}

async function run() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-git-sync-workflow-'));
  const userDataPath = path.join(tempRoot, 'user-data');
  const projectPath = path.join(tempRoot, 'workspace', 'example-project');

  await fsp.mkdir(path.join(projectPath, 'foundation'), { recursive: true });
  await fsp.writeFile(path.join(projectPath, 'README.md'), '# Test AIDD Project\n', 'utf8');
  await fsp.writeFile(path.join(projectPath, 'aidd.config.json'), '{"name":"Test"}\n', 'utf8');
  await fsp.writeFile(path.join(projectPath, 'foundation', 'index.md'), '# Foundation\n', 'utf8');
  await fsp.mkdir(path.join(projectPath, '.aidd-app'), { recursive: true });
  await fsp.writeFile(path.join(projectPath, '.aidd-app', 'secret-state.json'), '{"token":"do-not-commit"}\n', 'utf8');

  const credentialStore = createMemoryCredentialStore();
  await saveGitIdentity(userDataPath, { authorName: 'Francis', authorEmail: 'francis@example.com' });
  await saveGitSyncSettings(userDataPath, projectPath, {
    provider: 'gitlab',
    repoUrl: 'https://arcforge.westforge.net/legacy/test-aidd.git',
    branch: 'main',
  });
  await credentialStore.saveToken(projectPath, 'gitlab', 'fake-test-token');

  const connection = await connectProjectToRepository({ userDataPath, projectPath, credentialStore });
  assert.equal(connection.ok, true);

  const beforeCheckpoint = await getCommitCount(projectPath);
  await fsp.appendFile(path.join(projectPath, 'foundation', 'index.md'), '\nUpdated locally.\n', 'utf8');

  const checkpoint = await createCheckpointIfNeeded({ userDataPath, projectPath, credentialStore });
  assert.equal(checkpoint.created, true);
  assert.ok(checkpoint.label?.startsWith('AIDD sync checkpoint:'));

  const afterCheckpoint = await getCommitCount(projectPath);
  assert.equal(afterCheckpoint, beforeCheckpoint + 1);

  const config = await fsp.readFile(path.join(projectPath, '.git', 'config'), 'utf8');
  assert.equal(config.includes('fake-test-token'), false, 'token must not appear in .git/config');

  await fsp.appendFile(path.join(projectPath, 'README.md'), '\nAnother local update.\n', 'utf8');

  let pushed = false;
  const sync = await syncProject(
    { userDataPath, projectPath, credentialStore },
    {
      listRemoteRefs: async () => [],
      pushBranch: async (_input, token) => {
        assert.equal(token, 'fake-test-token');
        pushed = true;
      },
    }
  );

  assert.equal(sync.ok, true);
  assert.equal(sync.code, 'OK');
  assert.equal(sync.status.state, 'synced');
  assert.equal(pushed, true, 'sync should push when the remote repository has no branch yet');

  const status = await getSyncStatus({ userDataPath, projectPath, credentialStore });
  assert.equal(status.state, 'synced');

  await fsp.rm(tempRoot, { recursive: true, force: true });

  console.log('Git sync workflow unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
