import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createGitReviewPackage, readActiveGitReviewState, readGitReviewFile } from '../electron/services/gitReviewPackageStore';

async function run() {
  const projectPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-review-package-'));

  const state = await createGitReviewPackage({
    projectPath,
    reason: 'save',
    message: 'Shared updates changed this file.',
    files: [
      {
        path: 'foundation/02-product-definition.md',
        baseContent: '# Base\n',
        localContent: '# Local\n',
        remoteContent: '# Remote\n',
      },
    ],
  });

  assert.equal(state.active, true);
  assert.equal(state.status, 'pending');
  assert.equal(state.files.length, 1);
  assert.ok(state.reviewId);
  assert.ok(state.packagePath);

  const active = await readActiveGitReviewState(projectPath);
  assert.equal(active.active, true);
  assert.equal(active.reviewId, state.reviewId);
  assert.equal(active.files[0].path, 'foundation/02-product-definition.md');

  const local = await readGitReviewFile({
    projectPath,
    reviewId: state.reviewId!,
    kind: 'local',
    filePath: 'foundation/02-product-definition.md',
  });

  const remote = await readGitReviewFile({
    projectPath,
    reviewId: state.reviewId!,
    kind: 'remote',
    filePath: 'foundation/02-product-definition.md',
  });

  assert.equal(local, '# Local\n');
  assert.equal(remote, '# Remote\n');

  await assert.rejects(
    () =>
      createGitReviewPackage({
        projectPath,
        reason: 'save',
        message: 'Should reject app-private files.',
        files: [{ path: '.git/config', localContent: 'secret' }],
      }),
    /must not include Git or app-private files/
  );

  const allText = await fsp.readFile(path.join(state.packagePath!, 'review-state.json'), 'utf8');
  assert.equal(allText.includes('glpat-'), false, 'review state should not contain GitLab tokens');

  await fsp.rm(projectPath, { recursive: true, force: true });

  console.log('Git review package store unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
