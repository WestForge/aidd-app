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
import type { GitProvider } from '../electron/services/gitSyncTypes';

function isWindows() {
  return process.platform === 'win32';
}

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function envAllowBlank(name: string, fallback = ''): string {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

function boolEnv(name: string): boolean {
  return process.env[name] === '1' || process.env[name]?.toLowerCase() === 'true';
}

function providerEnv(value: string): GitProvider {
  if (value === 'github' || value === 'gitlab') return value;
  throw new Error(`Invalid provider '${value}'. Use 'github' or 'gitlab'.`);
}

function assertResetIsExplicit(projectPath: string) {
  const expected = path.resolve(projectPath);
  const confirmation = process.env.AIDD_TEST_RESET_CONFIRM_PATH
    ? path.resolve(process.env.AIDD_TEST_RESET_CONFIRM_PATH)
    : '';

  if (confirmation !== expected) {
    throw new Error(
      [
        'Refusing to reset/delete the test project because the reset target was not confirmed.',
        `Expected confirmation path: ${expected}`,
        `Received confirmation path: ${confirmation || '<empty>'}`,
        'Use scripts/test-phase2-create-local-repo.ps1, which sets this automatically.',
      ].join('\n')
    );
  }

  const parsed = path.parse(expected);
  if (expected === parsed.root) {
    throw new Error(`Refusing to delete a filesystem root: ${expected}`);
  }
}

async function writeFileEnsuringDirectory(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');
}

async function createMinimalAiddWorkspace(projectPath: string) {
  await fsp.mkdir(projectPath, { recursive: true });

  await writeFileEnsuringDirectory(
    path.join(projectPath, 'README.md'),
    '# AIDD Phase 02 Local Repo Test\n\nThis workspace was created by the Phase 02 local repo setup test.\n'
  );

  await writeFileEnsuringDirectory(
    path.join(projectPath, 'aidd.config.json'),
    JSON.stringify({ name: 'Phase 02 Local Repo Test' }, null, 2) + '\n'
  );

  await writeFileEnsuringDirectory(
    path.join(projectPath, 'foundation', 'index.md'),
    '# Foundation\n\nTest foundation document.\n'
  );
}

async function readGitConfig(projectPath: string, configPath: string): Promise<string | undefined> {
  try {
    const value = await git.getConfig({ fs, dir: projectPath, path: configPath });
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readConfigFile(projectPath: string): Promise<string> {
  return fsp.readFile(path.join(projectPath, '.git', 'config'), 'utf8');
}

async function main() {
  if (!boolEnv('AIDD_TEST_ALLOW_WRITE')) {
    throw new Error(
      [
        'This test creates and configures a local Git repository.',
        'Set AIDD_TEST_ALLOW_WRITE=1 to confirm this is intentional.',
      ].join('\n')
    );
  }

  const rootPath = path.resolve(env('AIDD_TEST_ROOT', isWindows() ? 'C:\\tmp\\aiddtest' : path.join(os.tmpdir(), 'aiddtest')));
  const repoName = env('AIDD_TEST_REPO_NAME', 'phase-02-local-repo');

  if (!repoName || repoName === '.' || repoName === '..' || repoName.includes('/') || repoName.includes('\\')) {
    throw new Error('AIDD_TEST_REPO_NAME must be a single directory name, not a path.');
  }

  const projectPath = path.resolve(rootPath, repoName);
  const userDataPath = path.resolve(rootPath, '.user-data');

  const provider = providerEnv(env('AIDD_TEST_PROVIDER', 'gitlab'));
  const repoUrl = envAllowBlank('AIDD_TEST_REPO_URL', 'https://arcforge.westforge.net/legacy/test-aidd.git').trim();
  const authorName = env('AIDD_TEST_AUTHOR_NAME', 'Francis West');
  const authorEmail = env('AIDD_TEST_AUTHOR_EMAIL', 'francis@westforge.net');
  const token = env('AIDD_TEST_TOKEN', 'fake-token-for-local-only-test');

  if (boolEnv('AIDD_TEST_RESET')) {
    assertResetIsExplicit(projectPath);
    await fsp.rm(projectPath, { recursive: true, force: true });
  }

  await createMinimalAiddWorkspace(projectPath);
  await fsp.mkdir(userDataPath, { recursive: true });

  await saveGitIdentity(userDataPath, { authorName, authorEmail });

  if (repoUrl.trim()) {
    await saveGitSyncSettings(userDataPath, projectPath, {
      provider,
      repoUrl,
      branch: 'main',
    });
  }

  const credentialStore = createMemoryCredentialStore();
  await credentialStore.saveToken(projectPath, provider, token);

  console.log('');
  console.log('Phase 02 create local repo test');
  console.log('-------------------------------');
  console.log(`Root:        ${rootPath}`);
  console.log(`Project:     ${projectPath}`);
  console.log(`Repository:  ${repoUrl || '<none>'}`);
  console.log(`Provider:    ${provider}`);
  console.log('Branch:      main');
  console.log('Remote:      not checked by this automated test');
  console.log('');

  const before = await getProjectConnectionStatus({
    userDataPath,
    projectPath,
    credentialStore,
  });

  console.log('Before connect:');
  console.log(JSON.stringify(before, null, 2));
  console.log('');

  const result = await connectProjectToRepository({
    userDataPath,
    projectPath,
    credentialStore,
  });

  console.log('Connect result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  assert.equal(result.ok, true, result.message);

  const gitDirPath = path.join(projectPath, '.git');
  assert.equal(fs.existsSync(gitDirPath), true, '.git directory was not created');

  const originUrl = await readGitConfig(projectPath, 'remote.origin.url');
  const originFetch = await readGitConfig(projectPath, 'remote.origin.fetch');
  const localUserName = await readGitConfig(projectPath, 'user.name');
  const localUserEmail = await readGitConfig(projectPath, 'user.email');

  if (repoUrl.trim()) {
    assert.equal(originUrl, repoUrl, 'remote.origin.url was not written correctly');
    assert.equal(originFetch, '+refs/heads/*:refs/remotes/origin/*', 'remote.origin.fetch was not written correctly');
  }

  assert.equal(localUserName, authorName, 'local user.name was not written correctly');
  assert.equal(localUserEmail, authorEmail, 'local user.email was not written correctly');

  const configFile = await readConfigFile(projectPath);
  assert.equal(configFile.includes(token), false, 'token leaked into .git/config');
  assert.equal(originUrl?.includes(token), false, 'token leaked into remote.origin.url');

  const after = await getProjectConnectionStatus({
    userDataPath,
    projectPath,
    credentialStore,
  });

  console.log('After connect:');
  console.log(JSON.stringify(after, null, 2));
  console.log('');

  console.log('.git/config contains:');
  console.log(configFile.trim());
  console.log('');

  console.log('Verified local Git config:');
  console.log(`remote.origin.url=${originUrl || '<none>'}`);
  console.log(`remote.origin.fetch=${originFetch || '<none>'}`);
  console.log(`user.name=${localUserName}`);
  console.log(`user.email=${localUserEmail}`);
  console.log('');

  console.log('Phase 02 create local repo test passed.');
}

main().catch((error) => {
  console.error('');
  console.error('Phase 02 create local repo test failed.');
  console.error(error);
  process.exit(1);
});
