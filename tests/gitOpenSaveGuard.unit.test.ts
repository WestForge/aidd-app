import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import git from 'isomorphic-git';
import { createMemoryCredentialStore } from '../electron/services/gitCredentialStore';
import { saveGitSyncSettings } from '../electron/services/gitSyncSettingsStore';
import { checkFileSaveSafety } from '../electron/services/gitOpenSaveGuard';

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-open-save-guard-'));
  const userDataPath = path.join(root, 'user-data');
  const projectPath = path.join(root, 'project');
  const filePath = path.join(projectPath, 'foundation', '02-product-definition.md');

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(path.join(projectPath, 'aidd.config.json'), '{"name":"Test"}\n', 'utf8');
  await fsp.writeFile(filePath, '# Base\n', 'utf8');
  await git.init({ fs, dir: projectPath, defaultBranch: 'main' });
  await git.setConfig({ fs, dir: projectPath, path: 'user.name', value: 'Test User' });
  await git.setConfig({ fs, dir: projectPath, path: 'user.email', value: 'test@example.com' });
  await git.add({ fs, dir: projectPath, filepath: 'aidd.config.json' });
  await git.add({ fs, dir: projectPath, filepath: 'foundation/02-product-definition.md' });
  await git.commit({ fs, dir: projectPath, message: 'Initial', author: { name: 'Test User', email: 'test@example.com' } });

  await saveGitSyncSettings(userDataPath, projectPath, {
    provider: 'gitlab',
    repoUrl: 'https://gitlab.example.com/group/repo.git',
    branch: 'main',
  });

  const credentialStore = createMemoryCredentialStore();
  await credentialStore.saveToken(projectPath, 'gitlab', 'fake-token');

  const safe = await checkFileSaveSafety({
    userDataPath,
    filePath,
    credentialStore,
    pendingContent: '# Local edit\n',
    hooks: {
      fetchRemote: async () => undefined,
      getLocalOid: () => 'local',
      getRemoteOid: () => 'remote',
      readBlobAtCommit: ({ oid }) => (oid === 'local' ? '# Base\n' : '# Base\n'),
    },
  });

  assert.equal(safe.safe, true);
  assert.equal(safe.code, 'REMOTE_FILE_UNCHANGED');

  const blocked = await checkFileSaveSafety({
    userDataPath,
    filePath,
    credentialStore,
    pendingContent: '# Local edit\n',
    hooks: {
      fetchRemote: async () => undefined,
      getLocalOid: () => 'local',
      getRemoteOid: () => 'remote',
      readBlobAtCommit: ({ oid }) => (oid === 'local' ? '# Base\n' : '# Remote edit\n'),
    },
  });

  assert.equal(blocked.safe, false);
  assert.equal(blocked.code, 'REVIEW_NEEDED');
  assert.ok(blocked.review?.reviewId);
  assert.equal(blocked.review?.files[0].path, 'foundation/02-product-definition.md');

  const reviewRoot = path.join(projectPath, '.aidd-app', 'reviews', blocked.review!.reviewId!);
  const localVersion = await fsp.readFile(path.join(reviewRoot, 'local-version', 'foundation', '02-product-definition.md'), 'utf8');
  const remoteVersion = await fsp.readFile(path.join(reviewRoot, 'remote-version', 'foundation', '02-product-definition.md'), 'utf8');

  assert.equal(localVersion, '# Local edit\n');
  assert.equal(remoteVersion, '# Remote edit\n');

  await fsp.rm(root, { recursive: true, force: true });

  console.log('Git open/save guard unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
