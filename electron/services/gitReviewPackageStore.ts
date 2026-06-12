import path from 'node:path';
import fsp from 'node:fs/promises';

export type AiddGitReviewPackageStatus = 'none' | 'pending' | 'partially_resolved' | 'ready_to_complete' | 'completed';
export type AiddGitReviewFileStatus = 'unresolved' | 'resolved';
export type AiddGitReviewVersionKind = 'local' | 'remote' | 'base';

export interface AiddGitReviewFile {
  path: string;
  status: AiddGitReviewFileStatus;
  options: Array<'keep_local' | 'use_shared' | 'manual_review' | 'combined_draft'>;
}

export interface AiddGitReviewState {
  active: boolean;
  reviewId?: string;
  createdAt?: string;
  status: AiddGitReviewPackageStatus;
  message: string;
  files: AiddGitReviewFile[];
  packagePath?: string;
}

export interface AiddCreateGitReviewFileInput {
  path: string;
  localContent?: string | null;
  remoteContent?: string | null;
  baseContent?: string | null;
}

export interface AiddCreateGitReviewPackageInput {
  projectPath: string;
  reason: 'open' | 'save' | 'sync';
  message: string;
  files: AiddCreateGitReviewFileInput[];
}

export interface AiddReadGitReviewFileInput {
  projectPath: string;
  reviewId: string;
  kind: AiddGitReviewVersionKind;
  filePath: string;
}

const REVIEW_ROOT = path.join('.aidd-app', 'reviews');

function nowReviewId() {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}-sync-review`;
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
    throw new Error('Review packages must not include Git or app-private files.');
  }

  return normalised;
}

async function pathExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function reviewRootPath(projectPath: string) {
  return path.join(projectPath, REVIEW_ROOT);
}

function reviewPackagePath(projectPath: string, reviewId: string) {
  return path.join(reviewRootPath(projectPath), reviewId);
}

async function writeReviewVersion(packagePath: string, kind: AiddGitReviewVersionKind, filePath: string, content: string | null | undefined) {
  if (content === undefined || content === null) {
    return;
  }

  const safePath = normaliseReviewPath(filePath);
  const outputPath = path.join(packagePath, `${kind}-version`, safePath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, content, 'utf8');
}

function buildSummary(input: AiddCreateGitReviewPackageInput, reviewId: string) {
  const files = input.files.map((file) => `- ${normaliseReviewPath(file.path)}`).join('\n');

  return `# Sync Review Needed\n\nAIDD could not safely continue because shared project updates may overlap with your local work.\n\n## Review\n\n- Review ID: ${reviewId}\n- Trigger: ${input.reason}\n\n## What happened\n\n${input.message}\n\n## Files needing review\n\n${files || '- No files recorded'}\n\n## Recommended action\n\nReview the local and shared versions before saving or sharing this file again. AIDD has preserved the available versions in this review package.\n`;
}

export async function createGitReviewPackage(input: AiddCreateGitReviewPackageInput): Promise<AiddGitReviewState> {
  if (!input.projectPath) {
    throw new Error('Project path is required to create a review package.');
  }

  const reviewId = nowReviewId();
  const createdAt = new Date().toISOString();
  const packagePath = reviewPackagePath(input.projectPath, reviewId);
  await fsp.mkdir(packagePath, { recursive: true });

  const files: AiddGitReviewFile[] = [];

  for (const file of input.files) {
    const safePath = normaliseReviewPath(file.path);
    files.push({
      path: safePath,
      status: 'unresolved',
      options: ['keep_local', 'use_shared', 'manual_review', 'combined_draft'],
    });

    await writeReviewVersion(packagePath, 'local', safePath, file.localContent);
    await writeReviewVersion(packagePath, 'remote', safePath, file.remoteContent);
    await writeReviewVersion(packagePath, 'base', safePath, file.baseContent);
  }

  const state: AiddGitReviewState = {
    active: true,
    reviewId,
    createdAt,
    status: 'pending',
    message: input.message,
    files,
    packagePath,
  };

  await fsp.writeFile(path.join(packagePath, 'summary.md'), buildSummary(input, reviewId), 'utf8');
  await fsp.writeFile(path.join(packagePath, 'changed-files.json'), `${JSON.stringify(files, null, 2)}\n`, 'utf8');
  await fsp.writeFile(path.join(packagePath, 'review-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  return state;
}

export async function readGitReviewState(projectPath: string, reviewId: string): Promise<AiddGitReviewState | null> {
  const filePath = path.join(reviewPackagePath(projectPath, reviewId), 'review-state.json');

  if (!(await pathExists(filePath))) {
    return null;
  }

  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as AiddGitReviewState;
}

export async function readActiveGitReviewState(projectPath: string): Promise<AiddGitReviewState> {
  const root = reviewRootPath(projectPath);

  if (!(await pathExists(root))) {
    return {
      active: false,
      status: 'none',
      message: 'No review is currently needed.',
      files: [],
    };
  }

  const entries = await fsp.readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const reviewId of candidates) {
    const state = await readGitReviewState(projectPath, reviewId);
    if (state && state.status !== 'completed') {
      return state;
    }
  }

  return {
    active: false,
    status: 'none',
    message: 'No review is currently needed.',
    files: [],
  };
}

export async function readGitReviewFile(input: AiddReadGitReviewFileInput): Promise<string> {
  const safePath = normaliseReviewPath(input.filePath);
  const filePath = path.join(reviewPackagePath(input.projectPath, input.reviewId), `${input.kind}-version`, safePath);
  return fsp.readFile(filePath, 'utf8');
}
