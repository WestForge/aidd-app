import type { ZipEntryInput } from '../shared/zip';
import { readZipFile, safeZipEntryName, safeZipReadEntryName, writeZipFile } from '../shared/zip';
import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildComponentTechnicalReviewComponentMarkdown, isSafeComponentTechnicalReviewSegment, readComponent, readProjectName } from './componentReview';
import { collectDeliveryReviewSourceEntries } from './delivery';
import { copyDir, exists, readJson, slugify, writeJson } from './projectCore';
import { isSameOrInsideDiskPath, normaliseRelativePath } from './projectValidation';
import type { ComponentTechnicalChangeDetail, ComponentTechnicalChangeRecord, ComponentTechnicalChangeReviewPackageImportResult, ComponentTechnicalChangeReviewPackageInput, ComponentTechnicalChangeReviewPackageResult, ComponentTechnicalChangeRisk, ComponentTechnicalChangeSection, ComponentTechnicalChangeStatus, ComponentTechnicalReviewRecord, CreateComponentTechnicalChangeInput, ImportComponentTechnicalChangeReviewPackageInput, ReadComponentTechnicalChangeInput, SaveComponentTechnicalChangeInput, UpdateComponentTechnicalChangeStatusInput } from './types';

export async function readComponentTechnicalReviews(projectPath: string, slug: string): Promise<ComponentTechnicalReviewRecord[]> {
  const reviewsRoot = path.join(projectPath, 'components', slugify(slug), 'technical-reviews');
  if (!(await exists(reviewsRoot))) return [];

  const records: ComponentTechnicalReviewRecord[] = [];
  for (const entry of await fsp.readdir(reviewsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const recordPath = path.join(reviewsRoot, entry.name, 'technical-review.json');
    if (!(await exists(recordPath))) continue;
    try {
      const record = await readJson<ComponentTechnicalReviewRecord>(recordPath);
      if (record?.type !== 'component-technical-review-import') continue;
      records.push({
        ...record,
        reviewDirectory: record.reviewDirectory || normaliseRelativePath(path.relative(projectPath, path.dirname(recordPath))),
        importedFiles: Array.isArray(record.importedFiles) ? record.importedFiles.map(String) : [],
        skippedFiles: Array.isArray(record.skippedFiles) ? record.skippedFiles.map(String) : [],
        changes: Array.isArray(record.changes)
          ? record.changes.map((change: any) => ({
              id: String(change.id || ''),
              overviewPath: change.overviewPath ? String(change.overviewPath) : undefined,
              status: String(change.status || 'proposed'),
              patches: Array.isArray(change.patches) ? change.patches.map(String) : []
            })).filter((change) => change.id)
          : []
      });
    } catch {
      // Ignore malformed review records; the imported artefacts remain on disk for manual inspection.
    }
  }

  return records.sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
}

export const COMPONENT_TECHNICAL_CHANGE_STATUSES = new Set<ComponentTechnicalChangeStatus>([
  'draft',
  'proposed',
  'needs-review',
  'approved',
  'rejected',
  'superseded',
  'packaged',
  'delivered'
]);

export const COMPONENT_TECHNICAL_CHANGE_RISKS = new Set<ComponentTechnicalChangeRisk>(['low', 'medium', 'high', 'unknown']);

export const COMPONENT_TECHNICAL_CHANGE_SECTIONS: Array<Omit<ComponentTechnicalChangeSection, 'body'>> = [
  { key: 'overview', fileName: 'overview.md', title: 'Overview', editable: true },
  { key: 'affected-files', fileName: 'affected-files.md', title: 'Affected files', editable: true },
  { key: 'rationale', fileName: 'rationale.md', title: 'Rationale', editable: true },
  { key: 'verification', fileName: 'verification.md', title: 'Verification', editable: true },
  { key: 'review', fileName: 'review.md', title: 'Review', editable: true },
  { key: 'patch', fileName: 'patches/proposed.patch', title: 'Patch', editable: true },
  { key: 'patch-notes', fileName: 'patches/notes.md', title: 'Patch notes', editable: true }
];

export const COMPONENT_TECHNICAL_CHANGE_SECTION_BY_FILE = new Map(
  COMPONENT_TECHNICAL_CHANGE_SECTIONS.map((section) => [normaliseRelativePath(section.fileName).toLowerCase(), section])
);

export function normaliseComponentTechnicalChangeStatus(value: unknown, fallback: ComponentTechnicalChangeStatus = 'draft'): ComponentTechnicalChangeStatus {
  const status = String(value || '').trim().toLowerCase() as ComponentTechnicalChangeStatus;
  return COMPONENT_TECHNICAL_CHANGE_STATUSES.has(status) ? status : fallback;
}

export function normaliseComponentTechnicalChangeRisk(value: unknown): ComponentTechnicalChangeRisk {
  const risk = String(value || '').trim().toLowerCase() as ComponentTechnicalChangeRisk;
  return COMPONENT_TECHNICAL_CHANGE_RISKS.has(risk) ? risk : 'unknown';
}

export function componentTechnicalChangesRoot(projectPath: string, slug: string) {
  return path.join(projectPath, 'components', slugify(slug), 'technical-changes');
}

export function titleFromTechnicalChangeId(id: string) {
  return String(id || 'Technical change')
    .replace(/^TC-\d{1,5}-?/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || String(id || 'Technical change');
}

export function titleFromMarkdownHeading(raw: string, fallback: string) {
  const heading = raw.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  return heading || fallback;
}

export function patchFileNameLooksSupported(fileName: string) {
  return ['.patch', '.diff'].includes(path.extname(fileName).toLowerCase());
}

export function isSafeComponentTechnicalChangePatchFileName(fileName: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) return false;
  return fileName.toLowerCase() === 'notes.md' || patchFileNameLooksSupported(fileName);
}

export function resolveTechnicalChangePath(changeDir: string, relativePath: string) {
  const normalised = normaliseRelativePath(relativePath).replace(/^\/+/, '');
  const target = path.resolve(changeDir, normalised);
  if (!isSameOrInsideDiskPath(target, changeDir)) throw new Error(`Unsafe technical change path: ${relativePath}`);
  return target;
}

export async function countTechnicalChangePatches(changeDir: string) {
  const patchesDir = path.join(changeDir, 'patches');
  if (!(await exists(patchesDir))) return 0;
  const entries = await fsp.readdir(patchesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && patchFileNameLooksSupported(entry.name)).length;
}

export function normaliseTechnicalChangeRecord(input: any, projectPath: string, componentSlug: string, changeDir: string): ComponentTechnicalChangeRecord {
  const id = String(input?.id || path.basename(changeDir));
  return {
    id,
    title: String(input?.title || titleFromTechnicalChangeId(id)),
    componentSlug: String(input?.componentSlug || componentSlug),
    status: normaliseComponentTechnicalChangeStatus(input?.status, 'draft'),
    source: input?.source === 'technical-review' ? 'technical-review' : 'manual',
    createdAt: String(input?.createdAt || input?.updatedAt || ''),
    updatedAt: String(input?.updatedAt || input?.createdAt || ''),
    risk: normaliseComponentTechnicalChangeRisk(input?.risk),
    patchCount: Number.isFinite(Number(input?.patchCount)) ? Number(input.patchCount) : 0,
    linkedFindings: Array.isArray(input?.linkedFindings) ? input.linkedFindings.map(String).filter(Boolean) : [],
    linkedReviewPath: input?.linkedReviewPath ? String(input.linkedReviewPath) : null,
    deliveryPackageIds: Array.isArray(input?.deliveryPackageIds) ? input.deliveryPackageIds.map(String).filter(Boolean) : [],
    relativePath: normaliseRelativePath(input?.relativePath || path.relative(projectPath, changeDir))
  };
}

export async function readComponentTechnicalChanges(projectPath: string, slug: string): Promise<ComponentTechnicalChangeRecord[]> {
  const componentSlug = slugify(slug);
  const root = componentTechnicalChangesRoot(projectPath, componentSlug);
  if (!(await exists(root))) return [];

  const records: ComponentTechnicalChangeRecord[] = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const changeDir = path.join(root, entry.name);
    const metadataPath = path.join(changeDir, 'technical-change.json');
    if (!(await exists(metadataPath))) continue;
    try {
      const raw = await readJson<any>(metadataPath);
      const record = normaliseTechnicalChangeRecord(raw, projectPath, componentSlug, changeDir);
      const patchCount = await countTechnicalChangePatches(changeDir);
      records.push({
        ...record,
        patchCount,
        relativePath: normaliseRelativePath(path.relative(projectPath, changeDir))
      });
    } catch {
      // Ignore malformed technical-change records; the Markdown files remain inspectable on disk.
    }
  }

  return records.sort((a, b) => {
    const statusRank = (status: string) => status === 'needs-review' ? 0 : status === 'draft' ? 1 : status === 'approved' ? 2 : 3;
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function technicalChangeMetadata(record: ComponentTechnicalChangeRecord) {
  return {
    id: record.id,
    title: record.title,
    componentSlug: record.componentSlug,
    status: record.status,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    risk: record.risk,
    patchCount: record.patchCount,
    linkedFindings: record.linkedFindings,
    linkedReviewPath: record.linkedReviewPath,
    deliveryPackageIds: record.deliveryPackageIds
  };
}

export async function writeTechnicalChangeMetadata(changeDir: string, record: ComponentTechnicalChangeRecord) {
  await writeJson(path.join(changeDir, 'technical-change.json'), technicalChangeMetadata(record));
}

export async function uniqueTechnicalChangeId(root: string, preferredId: string) {
  const base = preferredId || 'TC-001-technical-change';
  let candidate = base;
  let suffix = 2;
  while (await exists(path.join(root, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function nextManualTechnicalChangeId(projectPath: string, componentSlug: string, title: string) {
  const root = componentTechnicalChangesRoot(projectPath, componentSlug);
  let nextNumber = 1;
  if (await exists(root)) {
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^TC-(\d{1,5})-/i);
      if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }
  }
  const name = slugify(title || 'technical-change') || 'technical-change';
  return uniqueTechnicalChangeId(root, `TC-${String(nextNumber).padStart(3, '0')}-${name}`);
}

export function technicalChangeMarkdownTemplates(title: string) {
  return {
    'overview.md': [
      `# ${title}`,
      '',
      '## Proposed Change',
      '',
      'TODO: Describe the technical change.',
      '',
      '## Linked Findings',
      '',
      '- None',
      ''
    ].join('\n'),
    'affected-files.md': [
      '# Affected Files',
      '',
      '- TODO: List source files, project files, tests, or documentation affected by this change.',
      ''
    ].join('\n'),
    'rationale.md': [
      '# Rationale',
      '',
      'TODO: Explain why this change should be made, including tradeoffs and risk.',
      ''
    ].join('\n'),
    'verification.md': [
      '# Verification',
      '',
      'TODO: Define the checks, tests, or manual verification required before delivery.',
      ''
    ].join('\n'),
    'review.md': [
      '# Review',
      '',
      '## Decision',
      '',
      'TODO: Capture approval notes, rejection reasons, or revision requests.',
      ''
    ].join('\n'),
    'patches/proposed.patch': [
      '# Add a unified diff here when this technical change has a concrete patch.',
      ''
    ].join('\n')
  };
}

export async function ensureTechnicalChangeMarkdownFiles(changeDir: string, title: string) {
  const templates = technicalChangeMarkdownTemplates(title);
  for (const [fileName, body] of Object.entries(templates)) {
    const filePath = resolveTechnicalChangePath(changeDir, fileName);
    if (!(await exists(filePath))) {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, body, 'utf8');
    }
  }
  await fsp.mkdir(path.join(changeDir, 'patches'), { recursive: true });
  const notesPath = path.join(changeDir, 'patches', 'notes.md');
  if (!(await exists(notesPath))) {
    await fsp.writeFile(notesPath, '# Patch Notes\n\n- None\n', 'utf8');
  }
}

export async function createComponentTechnicalChange(input: CreateComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeRecord> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  const component = await readComponent({ projectPath: input.projectPath, slug: input.slug });
  const title = String(input.title || '').trim() || 'New technical change';
  const root = componentTechnicalChangesRoot(input.projectPath, component.slug);
  await fsp.mkdir(root, { recursive: true });
  const id = await nextManualTechnicalChangeId(input.projectPath, component.slug, title);
  const changeDir = path.join(root, id);
  const now = new Date().toISOString();
  await fsp.mkdir(changeDir, { recursive: true });
  await ensureTechnicalChangeMarkdownFiles(changeDir, title);

  const record: ComponentTechnicalChangeRecord = {
    id,
    title,
    componentSlug: component.slug,
    status: normaliseComponentTechnicalChangeStatus(input.status, 'draft'),
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    risk: normaliseComponentTechnicalChangeRisk(input.risk || 'unknown'),
    patchCount: await countTechnicalChangePatches(changeDir),
    linkedFindings: [],
    linkedReviewPath: null,
    deliveryPackageIds: [],
    relativePath: normaliseRelativePath(path.relative(input.projectPath, changeDir))
  };
  await writeTechnicalChangeMetadata(changeDir, record);
  return record;
}

export async function updateComponentTechnicalChangeStatus(input: UpdateComponentTechnicalChangeStatusInput): Promise<ComponentTechnicalChangeRecord[]> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.id) throw new Error('Technical change id is required.');
  const componentSlug = slugify(input.slug);
  const status = normaliseComponentTechnicalChangeStatus(input.status, 'draft');
  const changeDir = path.join(componentTechnicalChangesRoot(input.projectPath, componentSlug), input.id);
  const metadataPath = path.join(changeDir, 'technical-change.json');
  if (!(await exists(metadataPath))) throw new Error(`Technical change not found: ${input.id}`);
  const raw = await readJson<any>(metadataPath);
  const current = normaliseTechnicalChangeRecord(raw, input.projectPath, componentSlug, changeDir);
  await writeTechnicalChangeMetadata(changeDir, {
    ...current,
    status,
    patchCount: await countTechnicalChangePatches(changeDir),
    updatedAt: new Date().toISOString()
  });
  return readComponentTechnicalChanges(input.projectPath, componentSlug);
}

export async function findComponentTechnicalChangeTarget(projectPath: string, slug: string, id: string) {
  const componentSlug = slugify(slug);
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new Error('Technical change id is required.');
  const changeDir = path.join(componentTechnicalChangesRoot(projectPath, componentSlug), cleanId);
  const metadataPath = path.join(changeDir, 'technical-change.json');
  if (!(await exists(metadataPath))) throw new Error(`Technical change not found: ${cleanId}`);
  const raw = await readJson<any>(metadataPath);
  const record = normaliseTechnicalChangeRecord(raw, projectPath, componentSlug, changeDir);
  return { componentSlug, changeDir, metadataPath, record };
}

export async function readComponentTechnicalChange(input: ReadComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeDetail> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.id) throw new Error('Technical change id is required.');
  const target = await findComponentTechnicalChangeTarget(input.projectPath, input.slug, input.id);
  await ensureTechnicalChangeMarkdownFiles(target.changeDir, target.record.title);
  const patchCount = await countTechnicalChangePatches(target.changeDir);
  const record = {
    ...target.record,
    patchCount,
    relativePath: normaliseRelativePath(path.relative(input.projectPath, target.changeDir))
  };
  const sections: ComponentTechnicalChangeSection[] = [];

  for (const section of COMPONENT_TECHNICAL_CHANGE_SECTIONS) {
    const filePath = resolveTechnicalChangePath(target.changeDir, section.fileName);
    const body = await exists(filePath) ? await fsp.readFile(filePath, 'utf8') : '';
    sections.push({ ...section, body });
  }

  return {
    ...record,
    sections
  };
}

export async function saveComponentTechnicalChange(input: SaveComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeDetail> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.id) throw new Error('Technical change id is required.');
  const target = await findComponentTechnicalChangeTarget(input.projectPath, input.slug, input.id);
  const now = new Date().toISOString();

  if (Array.isArray(input.sections)) {
    for (const section of input.sections) {
      const fileName = normaliseRelativePath(section.fileName || '').toLowerCase();
      if (!COMPONENT_TECHNICAL_CHANGE_SECTION_BY_FILE.has(fileName)) continue;
      const filePath = resolveTechnicalChangePath(target.changeDir, fileName);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, section.body || '', 'utf8');
    }
  }

  const updated: ComponentTechnicalChangeRecord = {
    ...target.record,
    title: String(input.title || target.record.title || target.record.id).trim() || target.record.id,
    status: input.status ? normaliseComponentTechnicalChangeStatus(input.status, target.record.status) : target.record.status,
    risk: input.risk ? normaliseComponentTechnicalChangeRisk(input.risk) : target.record.risk,
    patchCount: await countTechnicalChangePatches(target.changeDir),
    updatedAt: now
  };
  await writeTechnicalChangeMetadata(target.changeDir, updated);
  return readComponentTechnicalChange({ projectPath: input.projectPath, slug: target.componentSlug, id: updated.id });
}

export async function readLinkedFindingsForImportedTechnicalChange(changeDir: string) {
  const linkedPath = path.join(changeDir, 'linked-findings.json');
  if (!(await exists(linkedPath))) return [] as string[];
  try {
    const raw = await readJson<any>(linkedPath);
    const findings = Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw) ? raw : [];
    return findings.map(String).filter(Boolean);
  } catch {
    return [];
  }
}

export async function createTechnicalChangeFromImportedReview(input: {
  projectPath: string;
  componentSlug: string;
  reviewRelativeDirectory: string;
  reviewDirectory: string;
  changeId: string;
  importedAt: string;
}): Promise<ComponentTechnicalChangeRecord | null> {
  const sourceDir = path.join(input.reviewDirectory, 'changes', input.changeId);
  if (!(await exists(sourceDir))) return null;

  const targetRoot = componentTechnicalChangesRoot(input.projectPath, input.componentSlug);
  await fsp.mkdir(targetRoot, { recursive: true });
  const preferredId = isSafeComponentTechnicalReviewSegment(input.changeId) ? input.changeId : slugify(input.changeId);
  const id = await uniqueTechnicalChangeId(targetRoot, preferredId || `TC-${input.importedAt.replace(/\D/g, '').slice(0, 12)}-technical-change`);
  const targetDir = path.join(targetRoot, id);
  await fsp.mkdir(targetDir, { recursive: true });

  for (const fileName of ['overview.md', 'affected-files.md', 'rationale.md', 'verification.md']) {
    const sourcePath = path.join(sourceDir, fileName);
    if (await exists(sourcePath)) await fsp.copyFile(sourcePath, path.join(targetDir, fileName));
  }
  const sourcePatchesDir = path.join(sourceDir, 'patches');
  if (await exists(sourcePatchesDir)) await copyDir(sourcePatchesDir, path.join(targetDir, 'patches'));

  const overviewPath = path.join(targetDir, 'overview.md');
  const overviewRaw = await exists(overviewPath) ? await fsp.readFile(overviewPath, 'utf8') : '';
  const title = titleFromMarkdownHeading(overviewRaw, titleFromTechnicalChangeId(id));
  await ensureTechnicalChangeMarkdownFiles(targetDir, title);

  const record: ComponentTechnicalChangeRecord = {
    id,
    title,
    componentSlug: input.componentSlug,
    status: 'needs-review',
    source: 'technical-review',
    createdAt: input.importedAt,
    updatedAt: input.importedAt,
    risk: 'unknown',
    patchCount: await countTechnicalChangePatches(targetDir),
    linkedFindings: await readLinkedFindingsForImportedTechnicalChange(sourceDir),
    linkedReviewPath: input.reviewRelativeDirectory,
    deliveryPackageIds: [],
    relativePath: normaliseRelativePath(path.relative(input.projectPath, targetDir))
  };
  await writeTechnicalChangeMetadata(targetDir, record);
  return record;
}

export function buildTechnicalChangeReviewReadme(input: {
  projectName: string;
  component: Awaited<ReturnType<typeof readComponent>>;
  change: ComponentTechnicalChangeDetail;
  sourceRootCount: number;
  sourceFileCount: number;
  warnings: string[];
}) {
  const lines = [
    '# AIDD Technical Change Review',
    '',
    'This zip was generated by AIDD for review of one managed technical change.',
    '',
    '## Scope',
    '',
    `Project: ${input.projectName}`,
    `Component: ${input.component.title} (\`${input.component.slug}\`)`,
    `Technical change: ${input.change.title} (\`${input.change.id}\`)`,
    `Status: \`${input.change.status}\``,
    '',
    '## Bundle layout',
    '',
    '- `instructions/review.md` - review task and constraints',
    '- `instructions/return-format.md` - required return zip shape',
    '- `context/component.md` - generated component documentation snapshot',
    '- `technical-change/` - editable technical change proposal files',
    '- `src/` - read-only source-code snapshot',
    '',
    '## Return package rule',
    '',
    'Return a zip containing only `technical-change/` files and optional `REVIEW.md`.',
    'Do not include edited source files.',
    '',
    '## Package summary',
    '',
    `- Source roots: ${input.sourceRootCount}`,
    `- Source files: ${input.sourceFileCount}`,
    `- Patch files: ${input.change.patchCount}`,
    ''
  ];

  if (input.warnings.length) {
    lines.push('## Warnings', '', ...input.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildTechnicalChangeReviewInstructions(change: ComponentTechnicalChangeDetail) {
  return [
    '# Technical Change Review Instructions',
    '',
    `Review technical change: ${change.title} (\`${change.id}\`)`,
    '',
    '## Goals',
    '',
    '- Check whether the proposed change is clear, bounded, and safe to approve.',
    '- Improve the change description, affected files, rationale, verification, and review notes where useful.',
    '- Provide or refine patch files only under `technical-change/patches/`.',
    '- Keep source files read-only. Do not return edited source files.',
    '',
    '## Decision guidance',
    '',
    '- Use `technical-change/review.md` for approval notes, rejection reasons, or requested revisions.',
    '- If the change is unsafe or incomplete, explain the concern rather than forcing a patch.',
    ''
  ].join('\n');
}

export function buildTechnicalChangeReviewReturnFormat(change: ComponentTechnicalChangeDetail) {
  return [
    '# Return Format',
    '',
    'Returned zips may contain these files only:',
    '',
    '```text',
    'REVIEW.md',
    'technical-change/overview.md',
    'technical-change/affected-files.md',
    'technical-change/rationale.md',
    'technical-change/verification.md',
    'technical-change/review.md',
    'technical-change/patches/proposed.patch',
    'technical-change/patches/<name>.patch',
    'technical-change/patches/<name>.diff',
    'technical-change/patches/notes.md',
    '```',
    '',
    `Technical change id: ${change.id}`,
    ''
  ].join('\n');
}

export async function createComponentTechnicalChangeReviewPackage(input: ComponentTechnicalChangeReviewPackageInput): Promise<ComponentTechnicalChangeReviewPackageResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.id) throw new Error('Technical change id is required.');
  const root = path.resolve(input.projectPath);
  const component = await readComponent({ projectPath: root, slug: input.slug });
  const change = await readComponentTechnicalChange({ projectPath: root, slug: component.slug, id: input.id });
  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-${component.slug}-${slugify(change.id)}-technical-change-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'components', component.slug, 'technical-changes');
  const filePath = path.join(outputDir, fileName);
  const warnings: string[] = [];
  const source = await collectDeliveryReviewSourceEntries(root, [component]);
  warnings.push(...source.warnings);

  const entries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildTechnicalChangeReviewReadme({
      projectName,
      component,
      change,
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length,
      warnings
    }), 'utf8') },
    { name: 'instructions/review.md', data: Buffer.from(buildTechnicalChangeReviewInstructions(change), 'utf8') },
    { name: 'instructions/return-format.md', data: Buffer.from(buildTechnicalChangeReviewReturnFormat(change), 'utf8') },
    { name: 'context/component.md', data: Buffer.from(buildComponentTechnicalReviewComponentMarkdown({ projectName, component }), 'utf8') },
    { name: 'technical-change/technical-change.json', data: Buffer.from(`${JSON.stringify(technicalChangeMetadata(change), null, 2)}\n`, 'utf8') },
    ...change.sections.map((section) => ({
      name: `technical-change/${normaliseRelativePath(section.fileName)}`,
      data: Buffer.from(section.body || '', 'utf8')
    })),
    ...source.entries
  ];

  const manifest = {
    bundleType: 'component-technical-change-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    componentSlug: component.slug,
    componentTitle: component.title,
    technicalChange: technicalChangeMetadata(change),
    sourceSnapshot: {
      directory: 'src',
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length
    },
    warnings,
    returnInstructions: {
      returnedZipShouldContainOnly: ['REVIEW.md', 'technical-change/'],
      sourceCodeIsContextOnly: true,
      doNotReturnEditedSourceFiles: true
    }
  };
  entries.push({ name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });

  const uniqueEntries = new Map<string, ZipEntryInput>();
  for (const entry of entries) {
    const name = safeZipEntryName(entry.name);
    if (!uniqueEntries.has(name)) uniqueEntries.set(name, { ...entry, name });
  }

  await writeZipFile(filePath, Array.from(uniqueEntries.values()));
  return {
    filePath,
    fileName,
    componentSlug: component.slug,
    technicalChangeId: change.id,
    sectionFileCount: change.sections.length,
    patchCount: change.patchCount,
    sourceRootCount: source.roots.length,
    sourceFileCount: source.includedFiles.length,
    entryCount: uniqueEntries.size,
    warnings
  };
}

export function componentTechnicalChangeReviewReturnPath(entryName: string, changeId: string) {
  const normalised = safeZipReadEntryName(entryName);
  if (!normalised) return null;
  let clean = normalised.replace(/^component-technical-change-review-return\//, '');
  if (clean.startsWith('technical-change/')) clean = clean.slice('technical-change/'.length);
  const changePrefix = `changes/${changeId}/`;
  if (clean.startsWith(changePrefix)) clean = clean.slice(changePrefix.length);
  clean = clean.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  if (clean.toLowerCase() === 'review.md') return 'review.md';
  if (clean.toLowerCase() === 'review.md' || clean.toLowerCase() === 'summary.md') return null;
  return clean;
}

export function isSafeTechnicalChangeReviewReturnPath(relativePath: string) {
  const lower = normaliseRelativePath(relativePath).toLowerCase();
  if (COMPONENT_TECHNICAL_CHANGE_SECTION_BY_FILE.has(lower)) return true;
  const parts = lower.split('/');
  if (parts.length === 2 && parts[0] === 'patches') {
    return isSafeComponentTechnicalChangePatchFileName(parts[1]);
  }
  return false;
}

export async function importComponentTechnicalChangeReviewPackage(input: ImportComponentTechnicalChangeReviewPackageInput): Promise<ComponentTechnicalChangeReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.id) throw new Error('Technical change id is required.');
  if (!input.zipPath) throw new Error('Technical change review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(zipPath))) throw new Error(`Technical change review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Technical change review response must be a .zip file.');

  const target = await findComponentTechnicalChangeTarget(root, input.slug, input.id);
  const entries = await readZipFile(zipPath);
  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.directory) continue;
    let relativePath = componentTechnicalChangeReviewReturnPath(entry.name, target.record.id);
    if (!relativePath && normaliseRelativePath(entry.name).toLowerCase() === 'review.md') relativePath = 'review.md';
    if (!relativePath || !isSafeTechnicalChangeReviewReturnPath(relativePath)) {
      skippedFiles.push(normaliseRelativePath(entry.name));
      continue;
    }
    if (seen.has(relativePath)) {
      skippedFiles.push(`${relativePath} was skipped because it appeared more than once.`);
      continue;
    }
    const filePath = resolveTechnicalChangePath(target.changeDir, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, entry.data);
    importedFiles.push(relativePath);
    seen.add(relativePath);
  }

  if (!importedFiles.length) {
    throw new Error('Technical change review response did not contain importable files. Expected technical-change/overview.md, technical-change/review.md, or technical-change/patches/ files.');
  }

  const patchCount = await countTechnicalChangePatches(target.changeDir);
  await writeTechnicalChangeMetadata(target.changeDir, {
    ...target.record,
    patchCount,
    status: target.record.status === 'draft' ? 'needs-review' : target.record.status,
    updatedAt: new Date().toISOString()
  });

  return {
    accepted: true,
    zipPath,
    componentSlug: target.componentSlug,
    technicalChangeId: target.record.id,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    patchCount
  };
}
