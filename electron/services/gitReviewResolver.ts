import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  readActiveGitReviewState,
  readGitReviewFile,
  readGitReviewState,
  type AiddGitReviewFile,
  type AiddGitReviewState,
} from './gitReviewPackageStore';

export type AiddGitReviewResolution = 'keep_local' | 'use_shared' | 'use_combined_draft';

export interface AiddGitResolveReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  resolution: AiddGitReviewResolution;
  combinedContent?: string;
}

export interface AiddGitReviewFileContentInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  kind: 'local' | 'remote' | 'base';
}

function normaliseReviewPath(filePath: string) {
  const normalised = filePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!normalised || normalised === '.' || normalised.includes('\0')) {
    throw new Error('Invalid review file path.');
  }

  if (normalised.startsWith('../') || normalised.includes('/../') || path.isAbsolute(normalised)) {
    throw new Error('Review file path must stay inside the project.');
  }

  if (
    normalised === '.git' ||
    normalised.startsWith('.git/') ||
    normalised === '.aidd-app' ||
    normalised.startsWith('.aidd-app/')
  ) {
    throw new Error('Review resolution cannot write Git or app-private files.');
  }

  return normalised;
}

function reviewPackagePath(projectPath: string, reviewId: string) {
  return path.join(projectPath, '.aidd-app', 'reviews', reviewId);
}

async function writeReviewState(projectPath: string, reviewId: string, state: AiddGitReviewState) {
  const packagePath = reviewPackagePath(projectPath, reviewId);
  await fsp.writeFile(path.join(packagePath, 'review-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fsp.writeFile(path.join(packagePath, 'changed-files.json'), `${JSON.stringify(state.files, null, 2)}\n`, 'utf8');
}

function updateReviewFileStatus(files: AiddGitReviewFile[], filePath: string): AiddGitReviewFile[] {
  return files.map((file) => file.path === filePath ? { ...file, status: 'resolved' } : file);
}

function nextReviewStatus(files: AiddGitReviewFile[]): AiddGitReviewState['status'] {
  if (files.length === 0) return 'completed';
  if (files.every((file) => file.status === 'resolved')) return 'ready_to_complete';
  if (files.some((file) => file.status === 'resolved')) return 'partially_resolved';
  return 'pending';
}

async function readResolutionContent(input: AiddGitResolveReviewFileInput): Promise<string> {
  if (input.resolution === 'keep_local') {
    return readGitReviewFile({
      projectPath: input.projectPath,
      reviewId: input.reviewId,
      kind: 'local',
      filePath: input.filePath,
    });
  }

  if (input.resolution === 'use_shared') {
    return readGitReviewFile({
      projectPath: input.projectPath,
      reviewId: input.reviewId,
      kind: 'remote',
      filePath: input.filePath,
    });
  }

  if (input.resolution === 'use_combined_draft') {
    if (input.combinedContent === undefined) {
      throw new Error('Combined draft content is required.');
    }

    return input.combinedContent;
  }

  throw new Error('Unsupported review resolution.');
}

export async function listGitReviewFiles(projectPath: string): Promise<AiddGitReviewFile[]> {
  const state = await readActiveGitReviewState(projectPath);
  return state.files;
}

export async function readGitReviewFileContent(input: AiddGitReviewFileContentInput): Promise<string> {
  return readGitReviewFile(input);
}

export async function resolveGitReviewFile(input: AiddGitResolveReviewFileInput): Promise<AiddGitReviewState> {
  const safePath = normaliseReviewPath(input.filePath);
  const state = await readGitReviewState(input.projectPath, input.reviewId);

  if (!state || !state.active) {
    throw new Error('Review is no longer active.');
  }

  const target = state.files.find((file) => file.path === safePath);

  if (!target) {
    throw new Error('Review file was not found.');
  }

  const content = await readResolutionContent({ ...input, filePath: safePath });
  const outputPath = path.join(input.projectPath, safePath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, content, 'utf8');

  const files = updateReviewFileStatus(state.files, safePath);
  const status = nextReviewStatus(files);

  const nextState: AiddGitReviewState = {
    ...state,
    active: status !== 'completed',
    status,
    message:
      status === 'ready_to_complete'
        ? 'All review files have been resolved. Complete the review to continue sharing.'
        : 'Review file resolved. Continue resolving the remaining files.',
    files,
  };

  await writeReviewState(input.projectPath, input.reviewId, nextState);
  return nextState;
}

export async function completeGitReview(projectPath: string, reviewId: string): Promise<AiddGitReviewState> {
  const state = await readGitReviewState(projectPath, reviewId);

  if (!state) {
    throw new Error('Review was not found.');
  }

  const unresolved = state.files.filter((file) => file.status !== 'resolved');

  if (unresolved.length > 0) {
    throw new Error('Resolve all review files before completing the review.');
  }

  const nextState: AiddGitReviewState = {
    ...state,
    active: false,
    status: 'completed',
    message: 'Review completed. The selected versions have been applied to the project.',
  };

  await writeReviewState(projectPath, reviewId, nextState);
  return nextState;
}

export async function cancelGitReview(projectPath: string, reviewId: string): Promise<AiddGitReviewState> {
  const state = await readGitReviewState(projectPath, reviewId);

  if (!state) {
    throw new Error('Review was not found.');
  }

  const nextState: AiddGitReviewState = {
    ...state,
    active: false,
    status: 'completed',
    message: 'Review cancelled. No automatic resolution was applied.',
  };

  await writeReviewState(projectPath, reviewId, nextState);
  return nextState;
}
