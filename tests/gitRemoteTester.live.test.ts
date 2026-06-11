import assert from 'node:assert/strict';
import { testGitRemoteConnection, testConnection } from '../electron/services/gitRemoteTester';

async function run() {
  const invalidUrl = await testGitRemoteConnection({
    provider: 'gitlab',
    repoUrl: 'git@arcforge.westforge.net:legacy/test-aidd.git',
    branch: 'main',
    token: 'not-used',
  });

  assert.equal(invalidUrl.ok, false);
  assert.equal(invalidUrl.code, 'INVALID_REPO_URL');

  const missingToken = await testGitRemoteConnection({
    provider: 'gitlab',
    repoUrl: 'https://arcforge.westforge.net/legacy/test-aidd.git',
    branch: 'main',
  });

  assert.equal(missingToken.ok, false);
  assert.equal(missingToken.code, 'MISSING_TOKEN');

  const storeShape = {
    async getToken(projectKey: unknown, provider: unknown) {
      if (projectKey === 'project-1' && provider === 'gitlab') {
        return 'fake-token';
      }
      return null;
    },
  };

  const fromStore = await testGitRemoteConnection(
    {
      provider: 'gitlab',
      repoUrl: 'https://arcforge.westforge.net/legacy/test-aidd.git',
      branch: 'main',
      projectId: 'project-1',
    },
    storeShape
  );

  assert.notEqual(fromStore.code, 'MISSING_TOKEN');

  const aliasShape = await testConnection(
    'git@arcforge.westforge.net:legacy/test-aidd.git',
    'main',
    'not-used',
    'gitlab'
  );

  assert.equal(aliasShape.ok, false);
  assert.equal(aliasShape.code, 'INVALID_REPO_URL');

  console.log('Git remote tester unit tests passed.');

  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.log('Live GitLab connection test skipped because GITLAB_TOKEN is not set.');
    return;
  }

  const live = await testGitRemoteConnection(
    {
      provider: 'gitlab',
      repoUrl: process.env.GITLAB_REPO_URL || 'https://arcforge.westforge.net/legacy/test-aidd.git',
      branch: process.env.GITLAB_BRANCH || 'main',
    },
    token
  );

  console.log(live);

  if (!live.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
