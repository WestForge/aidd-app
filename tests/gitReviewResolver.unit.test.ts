import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { createGitReviewPackage, readActiveGitReviewState } from '../electron/services/gitReviewPackageStore';
import { cancelGitReview, completeGitReview, resolveGitReviewFile } from '../electron/services/gitReviewResolver';

async function readText(filePath: string) {
  return fsp.readFile(filePath, 'utf8');
}

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aidd-review-resolver-'));
  const projectPath = path.join(root, 'project');
  await fsp.mkdir(projectPath, { recursive: true });
  await fsp.writeFile(path.join(projectPath, 'aidd.config.json'), '{}\n', 'utf8');
  await fsp.mkdir(path.join(projectPath, 'foundation'), { recursive: true });
  await fsp.writeFile(path.join(projectPath, 'foundation', 'intro.md'), 'current project content\n', 'utf8');

  const review = await createGitReviewPackage({
    projectPath,
    reason: 'save',
    message: 'Overlapping shared changes need review.',
    files: [
      {
        path: 'foundation/intro.md',
        localContent: 'my version\n',
        remoteContent: 'shared version\n',
        baseContent: 'base version\n',
      },
    ],
  });

  assert.equal(review.active, true);
  assert.equal(review.status, 'pending');

  const resolved = await resolveGitReviewFile({
    projectPath,
    reviewId: review.reviewId!,
    filePath: 'foundation/intro.md',
    resolution: 'use_shared',
  });

  assert.equal(resolved.status, 'ready_to_complete');
  assert.equal(resolved.files[0].status, 'resolved');
  assert.equal(await readText(path.join(projectPath, 'foundation', 'intro.md')), 'shared version\n');

  const completed = await completeGitReview(projectPath, review.reviewId!);
  assert.equal(completed.active, false);
  assert.equal(completed.status, 'completed');

  const activeAfterComplete = await readActiveGitReviewState(projectPath);
  assert.equal(activeAfterComplete.active, false);

  const second = await createGitReviewPackage({
    projectPath,
    reason: 'open',
    message: 'Another review.',
    files: [
      {
        path: 'foundation/intro.md',
        localContent: 'local draft\n',
        remoteContent: 'remote draft\n',
        baseContent: 'base draft\n',
      },
    ],
  });

  const combined = await resolveGitReviewFile({
    projectPath,
    reviewId: second.reviewId!,
    filePath: 'foundation/intro.md',
    resolution: 'use_combined_draft',
    combinedContent: 'combined draft\n',
  });

  assert.equal(combined.status, 'ready_to_complete');
  assert.equal(await readText(path.join(projectPath, 'foundation', 'intro.md')), 'combined draft\n');

  const cancelled = await cancelGitReview(projectPath, second.reviewId!);
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.status, 'completed');

  await assert.rejects(
    () => resolveGitReviewFile({
      projectPath,
      reviewId: second.reviewId!,
      filePath: '../outside.md',
      resolution: 'keep_local',
    }),
    /inside the project|Invalid review file path|app-private/
  );

  await fsp.rm(root, { recursive: true, force: true });

  console.log('Git review resolver unit tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
