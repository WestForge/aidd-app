import { testGitRemoteConnection } from '../electron/services/gitRemoteTester';

async function run() {
  const token = process.env.GITLAB_TOKEN;
  const repoUrl = process.env.GITLAB_REPO_URL || 'https://arcforge.westforge.net/legacy/test-aidd.git';
  const branch = process.env.GITLAB_BRANCH || 'main';

  if (!token) {
    console.log('Live GitLab connection test skipped because GITLAB_TOKEN is not set.');
    console.log('Set GITLAB_TOKEN to run the live connection check.');
    return;
  }

  const result = await testGitRemoteConnection({
    provider: 'gitlab',
    repoUrl,
    branch,
    token,
  });

  console.log(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
