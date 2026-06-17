import matter from '../../frontmatter';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readCapability } from './capabilityReview';
import { readComponent } from './componentReview';
import { readComponentTechnicalChange } from './componentTechnicalChanges';
import { TEMPLATE_VERSION, exists, readEntities, readJson, slugify, writeJson } from './projectCore';
import { isSameOrInsideDiskPath, normaliseRelativePath } from './projectValidation';
import type {
  ChangeDetail,
  ChangePriority,
  ChangeReadiness,
  ChangeRecord,
  ChangeRisk,
  ChangeSection,
  ChangeSource,
  ChangeStatus,
  ChangeType,
  CreateChangeFromCapabilityInput,
  CreateChangeFromComponentInput,
  CreateChangeFromTechnicalChangeInput,
  CreateChangeInput,
  DeleteChangeInput,
  ReadChangeInput,
  SaveChangeInput,
  UpdateChangeStatusInput
} from './types';

export const CHANGE_TYPES = new Set<ChangeType>([
  'implement-capability',
  'update-capability',
  'component-change',
  'technical-refactor',
  'bug-fix',
  'ux-improvement',
  'documentation-standards-change',
  'spike-investigation'
]);

export const CHANGE_STATUSES = new Set<ChangeStatus>([
  'draft',
  'ready',
  'in-delivery',
  'in-review',
  'accepted',
  'rejected',
  'superseded'
]);

export const CHANGE_PRIORITIES = new Set<ChangePriority>(['low', 'normal', 'high', 'urgent']);
export const CHANGE_RISKS = new Set<ChangeRisk>(['low', 'medium', 'high', 'unknown']);
export const CHANGE_SOURCES = new Set<ChangeSource>(['manual', 'capability', 'component', 'component-technical-change', 'review-import']);

export const CHANGE_SECTIONS: Array<Omit<ChangeSection, 'body'>> = [
  { key: 'intent', fileName: 'intent.md', title: 'Intent', editable: true },
  { key: 'scope', fileName: 'scope.md', title: 'Scope', editable: true },
  { key: 'acceptance-criteria', fileName: 'acceptance-criteria.md', title: 'Acceptance criteria', editable: true },
  { key: 'linked-context', fileName: 'linked-context.md', title: 'Linked context', editable: true },
  { key: 'implementation-notes', fileName: 'implementation-notes.md', title: 'Implementation notes', editable: true },
  { key: 'decisions', fileName: 'decisions.md', title: 'Decisions', editable: true },
  { key: 'review', fileName: 'review.md', title: 'Review', editable: true }
];

const CHANGE_SECTION_BY_FILE = new Map(
  CHANGE_SECTIONS.map((section) => [normaliseRelativePath(section.fileName).toLowerCase(), section])
);

const CHANGE_STATUS_RANK: Record<ChangeStatus, number> = {
  draft: 0,
  ready: 1,
  'in-delivery': 2,
  'in-review': 3,
  accepted: 4,
  rejected: 5,
  superseded: 6
};

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  'implement-capability': 'Implement capability',
  'update-capability': 'Update capability',
  'component-change': 'Component change',
  'technical-refactor': 'Technical refactor',
  'bug-fix': 'Bug fix',
  'ux-improvement': 'UX improvement',
  'documentation-standards-change': 'Documentation/standards change',
  'spike-investigation': 'Spike investigation'
};

export function changesIndexMarkdown() {
  return matter.stringify([
    '# Changes',
    '',
    'Changes describe intended product, component, technical, documentation, or investigation work before it is scheduled for delivery.',
    '',
    '## Active changes',
    '',
    'No changes yet.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'changes-index',
      id: 'changes',
      title: 'Changes',
      status: 'active',
      required: true,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

export function changesRoot(projectPath: string) {
  return path.join(projectPath, 'changes');
}

export async function ensureChangesIndex(projectPath: string) {
  const root = changesRoot(projectPath);
  await fsp.mkdir(root, { recursive: true });
  const indexPath = path.join(root, 'index.md');
  if (!(await exists(indexPath))) {
    await fsp.writeFile(indexPath, changesIndexMarkdown(), 'utf8');
  }
}

export function normaliseChangeType(value: unknown, fallback: ChangeType = 'implement-capability'): ChangeType {
  const type = String(value || '').trim().toLowerCase() as ChangeType;
  return CHANGE_TYPES.has(type) ? type : fallback;
}

export function normaliseChangeStatus(value: unknown, fallback: ChangeStatus = 'draft'): ChangeStatus {
  const status = String(value || '').trim().toLowerCase() as ChangeStatus;
  return CHANGE_STATUSES.has(status) ? status : fallback;
}

export function normaliseChangePriority(value: unknown, fallback: ChangePriority = 'normal'): ChangePriority {
  const priority = String(value || '').trim().toLowerCase() as ChangePriority;
  return CHANGE_PRIORITIES.has(priority) ? priority : fallback;
}

export function normaliseChangeRisk(value: unknown, fallback: ChangeRisk = 'unknown'): ChangeRisk {
  const risk = String(value || '').trim().toLowerCase() as ChangeRisk;
  return CHANGE_RISKS.has(risk) ? risk : fallback;
}

export function normaliseChangeSource(value: unknown, fallback: ChangeSource = 'manual'): ChangeSource {
  const source = String(value || '').trim().toLowerCase() as ChangeSource;
  return CHANGE_SOURCES.has(source) ? source : fallback;
}

function uniqueStrings(values: unknown[] | undefined) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

export function changeTypeLabel(type: ChangeType) {
  return CHANGE_TYPE_LABELS[type] || type.replace(/-/g, ' ');
}

export function titleFromChangeId(id: string) {
  return String(id || 'Change')
    .replace(/^CHG-\d{1,5}-?/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || String(id || 'Change');
}

export function resolveChangePath(changeDir: string, relativePath: string) {
  const normalised = normaliseRelativePath(relativePath).replace(/^\/+/, '');
  const target = path.resolve(changeDir, normalised);
  if (!isSameOrInsideDiskPath(target, changeDir)) throw new Error(`Unsafe change path: ${relativePath}`);
  return target;
}

export async function uniqueChangeId(root: string, preferredId: string) {
  const base = preferredId || 'CHG-001-change';
  let candidate = base;
  let suffix = 2;
  while (await exists(path.join(root, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function nextChangeId(projectPath: string, title: string) {
  const root = changesRoot(projectPath);
  let nextNumber = 1;
  if (await exists(root)) {
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^CHG-(\d{1,5})-/i);
      if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }
  }
  const name = slugify(title || 'change') || 'change';
  return uniqueChangeId(root, `CHG-${String(nextNumber).padStart(3, '0')}-${name}`);
}

export function changeMetadata(record: ChangeRecord) {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    status: record.status,
    priority: record.priority,
    risk: record.risk,
    linkedCapabilities: record.linkedCapabilities,
    linkedComponents: record.linkedComponents,
    deliveryPackageIds: record.deliveryPackageIds,
    source: record.source,
    legacyTechnicalChange: record.legacyTechnicalChange || null,
    relativePath: record.relativePath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function normaliseChangeRecord(input: any, projectPath: string, changeDir: string): ChangeRecord {
  const id = String(input?.id || path.basename(changeDir)).trim();
  const legacyTechnicalChange = input?.legacyTechnicalChange && typeof input.legacyTechnicalChange === 'object'
    ? {
        componentSlug: String(input.legacyTechnicalChange.componentSlug || '').trim(),
        technicalChangeId: String(input.legacyTechnicalChange.technicalChangeId || '').trim()
      }
    : null;

  return {
    id,
    title: String(input?.title || titleFromChangeId(id)).trim() || id,
    type: normaliseChangeType(input?.type),
    status: normaliseChangeStatus(input?.status),
    priority: normaliseChangePriority(input?.priority),
    risk: normaliseChangeRisk(input?.risk),
    linkedCapabilities: uniqueStrings(input?.linkedCapabilities),
    linkedComponents: uniqueStrings(input?.linkedComponents),
    deliveryPackageIds: uniqueStrings(input?.deliveryPackageIds),
    source: normaliseChangeSource(input?.source),
    legacyTechnicalChange: legacyTechnicalChange?.componentSlug && legacyTechnicalChange?.technicalChangeId ? legacyTechnicalChange : null,
    relativePath: normaliseRelativePath(input?.relativePath || path.relative(projectPath, changeDir)),
    createdAt: String(input?.createdAt || input?.updatedAt || ''),
    updatedAt: String(input?.updatedAt || input?.createdAt || '')
  };
}

function defaultSectionBody(input: {
  title: string;
  type: ChangeType;
  linkedCapabilities: string[];
  linkedComponents: string[];
}) {
  const typeLabel = changeTypeLabel(input.type);
  return {
    'intent.md': [
      `# ${input.title} Intent`,
      '',
      `Change type: ${typeLabel}`,
      '',
      'TODO: Describe the intended outcome and why this work should happen.',
      ''
    ].join('\n'),
    'scope.md': [
      '# Scope',
      '',
      '## In scope',
      '',
      '- TODO',
      '',
      '## Out of scope',
      '',
      '- TODO',
      '',
      '## Assumptions',
      '',
      '- TODO',
      ''
    ].join('\n'),
    'acceptance-criteria.md': [
      '# Acceptance Criteria',
      '',
      '- [ ] TODO: Define the observable result that makes this change acceptable.',
      ''
    ].join('\n'),
    'linked-context.md': [
      '# Linked Context',
      '',
      '## Capabilities',
      '',
      input.linkedCapabilities.length ? input.linkedCapabilities.map((slug) => `- ${slug}`).join('\n') : '- None yet',
      '',
      '## Components',
      '',
      input.linkedComponents.length ? input.linkedComponents.map((slug) => `- ${slug}`).join('\n') : '- None yet',
      ''
    ].join('\n'),
    'implementation-notes.md': [
      '# Implementation Notes',
      '',
      typeSpecificImplementationPrompt(input.type),
      '',
      '## Notes',
      '',
      '- TODO',
      ''
    ].join('\n'),
    'decisions.md': [
      '# Decisions',
      '',
      '- No decisions recorded yet.',
      ''
    ].join('\n'),
    'review.md': [
      '# Review',
      '',
      '## Readiness review',
      '',
      '- TODO: Capture review notes before marking the change ready.',
      ''
    ].join('\n')
  };
}

function typeSpecificImplementationPrompt(type: ChangeType) {
  switch (type) {
    case 'implement-capability':
      return 'Implement only the capability slice described by this Change. Do not implement the whole capability unless scope explicitly says so.';
    case 'update-capability':
      return 'Update existing capability behaviour while preserving documented behaviour that is outside this Change scope.';
    case 'component-change':
      return 'Respect component ownership, interfaces, dependencies, and source mapping while making the requested component change.';
    case 'technical-refactor':
      return 'Preserve product behaviour unless this Change explicitly authorises a behaviour change.';
    case 'bug-fix':
      return 'Capture observed behaviour, expected behaviour, reproduction steps, and regression checks before implementation.';
    case 'ux-improvement':
      return 'Describe user-facing states, feedback, accessibility expectations, and acceptance checks.';
    case 'documentation-standards-change':
      return 'Update documentation or standards without changing product/runtime behaviour unless separately scoped.';
    case 'spike-investigation':
      return 'Answer the investigation question and record follow-up decisions or Changes. Do not make production changes unless explicitly authorised.';
    default:
      return 'Keep implementation bounded to this Change.';
  }
}

export function changeMarkdownTemplates(input: {
  title: string;
  type: ChangeType;
  linkedCapabilities?: string[];
  linkedComponents?: string[];
  sectionBodies?: Partial<Record<string, string>>;
}) {
  const defaults = defaultSectionBody({
    title: input.title,
    type: input.type,
    linkedCapabilities: input.linkedCapabilities || [],
    linkedComponents: input.linkedComponents || []
  });

  return Object.fromEntries(
    Object.entries(defaults).map(([fileName, body]) => [fileName, input.sectionBodies?.[fileName] || body])
  );
}

export async function ensureChangeMarkdownFiles(changeDir: string, input: {
  title: string;
  type: ChangeType;
  linkedCapabilities?: string[];
  linkedComponents?: string[];
  sectionBodies?: Partial<Record<string, string>>;
}) {
  const templates = changeMarkdownTemplates(input);
  for (const section of CHANGE_SECTIONS) {
    const filePath = resolveChangePath(changeDir, section.fileName);
    if (!(await exists(filePath))) {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, templates[section.fileName] || '', 'utf8');
    }
  }
}

export function bodyHasSubstantialContent(body: string) {
  const cleaned = String(body || '')
    .replace(/^---[\s\S]*?---\s*/m, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s+.*$/gm, ' ')
    .replace(/-\s*\[[ xX]\]\s*/g, ' ')
    .replace(/\bTODO\b:?/gi, ' ')
    .replace(/\bTBD\b/gi, ' ')
    .replace(/\bN\/A\b/gi, ' ')
    .replace(/\bnone yet\b/gi, ' ')
    .replace(/[>#*_`\-\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;
  if (/^(todo|tbd|n\/?a|none|none yet|not provided|placeholder)$/i.test(cleaned)) return false;
  return cleaned.split(/\s+/).filter(Boolean).length >= 6;
}

export function evaluateChangeReadiness(change: ChangeDetail): ChangeReadiness {
  const blockers: string[] = [];
  const section = (key: string) => change.sections.find((item) => item.key === key);

  if (!change.title.trim()) blockers.push('Add a title.');
  if (!CHANGE_TYPES.has(change.type)) blockers.push('Choose a valid change type.');
  if (!bodyHasSubstantialContent(section('intent')?.body || '')) blockers.push('Describe the intent.');
  if (!bodyHasSubstantialContent(section('scope')?.body || '')) blockers.push('Define the scope.');
  if (!bodyHasSubstantialContent(section('acceptance-criteria')?.body || '')) blockers.push('Define acceptance criteria.');
  if (!change.linkedCapabilities.length && !change.linkedComponents.length) blockers.push('Link at least one capability or component.');

  return {
    ready: blockers.length === 0,
    blockers
  };
}

export async function findChangeTarget(projectPath: string, id: string) {
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new Error('Change id is required.');
  const root = changesRoot(projectPath);
  const changeDir = path.resolve(root, cleanId);
  if (!isSameOrInsideDiskPath(changeDir, root) || changeDir === path.resolve(root)) {
    throw new Error(`Unsafe change id: ${id}`);
  }
  const metadataPath = path.join(changeDir, 'change.json');
  if (!(await exists(metadataPath))) throw new Error(`Change not found: ${cleanId}`);
  const raw = await readJson<any>(metadataPath);
  const record = normaliseChangeRecord(raw, projectPath, changeDir);
  return { root, changeDir, metadataPath, record };
}

export async function readChanges(projectPath: string): Promise<ChangeRecord[]> {
  await ensureChangesIndex(projectPath);
  const root = changesRoot(projectPath);
  const records: ChangeRecord[] = [];

  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const changeDir = path.join(root, entry.name);
    const metadataPath = path.join(changeDir, 'change.json');
    if (!(await exists(metadataPath))) continue;
    try {
      const raw = await readJson<any>(metadataPath);
      records.push(normaliseChangeRecord(raw, projectPath, changeDir));
    } catch {
      // Leave malformed records for Health Check/Repair; do not hide the whole page.
    }
  }

  return records.sort((a, b) => {
    const byStatus = CHANGE_STATUS_RANK[a.status] - CHANGE_STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export async function readChange(input: ReadChangeInput): Promise<ChangeDetail> {
  if (!input.projectPath || !input.id) throw new Error('Project path and change id are required.');
  const target = await findChangeTarget(input.projectPath, input.id);
  await ensureChangeMarkdownFiles(target.changeDir, {
    title: target.record.title,
    type: target.record.type,
    linkedCapabilities: target.record.linkedCapabilities,
    linkedComponents: target.record.linkedComponents
  });

  const sections: ChangeSection[] = [];
  for (const section of CHANGE_SECTIONS) {
    const filePath = resolveChangePath(target.changeDir, section.fileName);
    const body = await exists(filePath) ? await fsp.readFile(filePath, 'utf8') : '';
    sections.push({ ...section, body });
  }

  const detail = {
    ...target.record,
    relativePath: normaliseRelativePath(path.relative(input.projectPath, target.changeDir)),
    sections,
    readiness: { ready: false, blockers: [] }
  };
  return {
    ...detail,
    readiness: evaluateChangeReadiness(detail)
  };
}

function sectionsToBodies(sections?: ChangeSection[]) {
  const bodies: Partial<Record<string, string>> = {};
  for (const section of sections || []) {
    const fileName = normaliseRelativePath(section.fileName || '').toLowerCase();
    if (!CHANGE_SECTION_BY_FILE.has(fileName)) continue;
    bodies[fileName] = section.body || '';
  }
  return bodies;
}

export async function createChange(input: CreateChangeInput): Promise<ChangeDetail> {
  if (!input.projectPath) throw new Error('Project path is required.');
  const title = String(input.title || '').trim() || 'New change';
  const type = normaliseChangeType(input.type);
  const root = changesRoot(input.projectPath);
  await ensureChangesIndex(input.projectPath);
  const id = await nextChangeId(input.projectPath, title);
  const changeDir = path.join(root, id);
  if (await exists(changeDir)) throw new Error(`Change already exists: ${id}`);

  const linkedCapabilities = uniqueStrings(input.linkedCapabilities);
  const linkedComponents = uniqueStrings(input.linkedComponents);
  const now = new Date().toISOString();
  await fsp.mkdir(changeDir, { recursive: true });
  await ensureChangeMarkdownFiles(changeDir, {
    title,
    type,
    linkedCapabilities,
    linkedComponents,
    sectionBodies: sectionsToBodies(input.sections)
  });

  const record: ChangeRecord = {
    id,
    title,
    type,
    status: normaliseChangeStatus(input.status),
    priority: normaliseChangePriority(input.priority),
    risk: normaliseChangeRisk(input.risk),
    linkedCapabilities,
    linkedComponents,
    deliveryPackageIds: [],
    source: normaliseChangeSource(input.source),
    legacyTechnicalChange: input.legacyTechnicalChange || null,
    relativePath: normaliseRelativePath(path.relative(input.projectPath, changeDir)),
    createdAt: now,
    updatedAt: now
  };

  const created = await readChangeFromRecord(input.projectPath, changeDir, record);
  if (record.status === 'ready' && !created.readiness.ready) {
    throw new Error(`Change is not ready: ${created.readiness.blockers.join('; ')}`);
  }

  await writeJson(path.join(changeDir, 'change.json'), changeMetadata(record));
  return readChange({ projectPath: input.projectPath, id });
}

async function readChangeFromRecord(projectPath: string, changeDir: string, record: ChangeRecord): Promise<ChangeDetail> {
  const sections: ChangeSection[] = [];
  for (const section of CHANGE_SECTIONS) {
    const filePath = resolveChangePath(changeDir, section.fileName);
    const body = await exists(filePath) ? await fsp.readFile(filePath, 'utf8') : '';
    sections.push({ ...section, body });
  }
  const detail = { ...record, sections, readiness: { ready: false, blockers: [] } };
  return { ...detail, readiness: evaluateChangeReadiness(detail) };
}

export async function saveChange(input: SaveChangeInput): Promise<ChangeDetail> {
  if (!input.projectPath || !input.id) throw new Error('Project path and change id are required.');
  const target = await findChangeTarget(input.projectPath, input.id);
  const nextSections = Array.isArray(input.sections)
    ? CHANGE_SECTIONS.map((template) => {
        const provided = input.sections?.find((section) => normaliseRelativePath(section.fileName).toLowerCase() === template.fileName.toLowerCase());
        return { ...template, body: provided?.body ?? '' };
      })
    : (await readChange({ projectPath: input.projectPath, id: input.id })).sections;

  const updated: ChangeRecord = {
    ...target.record,
    title: typeof input.title === 'string' ? (input.title.trim() || target.record.title) : target.record.title,
    type: typeof input.type === 'string' ? normaliseChangeType(input.type, target.record.type) : target.record.type,
    status: typeof input.status === 'string' ? normaliseChangeStatus(input.status, target.record.status) : target.record.status,
    priority: typeof input.priority === 'string' ? normaliseChangePriority(input.priority, target.record.priority) : target.record.priority,
    risk: typeof input.risk === 'string' ? normaliseChangeRisk(input.risk, target.record.risk) : target.record.risk,
    linkedCapabilities: Array.isArray(input.linkedCapabilities) ? uniqueStrings(input.linkedCapabilities) : target.record.linkedCapabilities,
    linkedComponents: Array.isArray(input.linkedComponents) ? uniqueStrings(input.linkedComponents) : target.record.linkedComponents,
    updatedAt: new Date().toISOString()
  };

  const nextDetail = {
    ...updated,
    sections: nextSections,
    readiness: { ready: false, blockers: [] }
  };
  const readiness = evaluateChangeReadiness(nextDetail);
  if (updated.status === 'ready' && !readiness.ready) {
    throw new Error(`Change is not ready: ${readiness.blockers.join('; ')}`);
  }

  if (Array.isArray(input.sections)) {
    for (const section of input.sections) {
      const fileName = normaliseRelativePath(section.fileName || '').toLowerCase();
      if (!CHANGE_SECTION_BY_FILE.has(fileName)) continue;
      const filePath = resolveChangePath(target.changeDir, fileName);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, section.body || '', 'utf8');
    }
  }

  await writeJson(target.metadataPath, changeMetadata(updated));
  return readChange({ projectPath: input.projectPath, id: input.id });
}

export async function updateChangeStatus(input: UpdateChangeStatusInput): Promise<ChangeRecord[]> {
  if (!input.projectPath || !input.id || !input.status) throw new Error('Project path, change id, and status are required.');
  await saveChange({ projectPath: input.projectPath, id: input.id, status: input.status });
  return readChanges(input.projectPath);
}

export async function deleteChange(input: DeleteChangeInput): Promise<ChangeRecord[]> {
  if (!input.projectPath || !input.id) throw new Error('Project path and change id are required.');
  const target = await findChangeTarget(input.projectPath, input.id);
  if (target.changeDir === target.root || !isSameOrInsideDiskPath(target.changeDir, target.root)) {
    throw new Error('Change delete rejected: unsafe change path.');
  }
  await fsp.rm(target.changeDir, { recursive: true, force: false });
  return readChanges(input.projectPath);
}

function sectionBody(sections: Array<{ key: string; body?: string }>, key: string) {
  return sections.find((section) => section.key === key)?.body?.trim() || '';
}

export async function createChangeFromCapability(input: CreateChangeFromCapabilityInput): Promise<ChangeDetail> {
  if (!input.projectPath || !input.capabilitySlug) throw new Error('Project path and capability slug are required.');
  const capability = await readCapability({ projectPath: input.projectPath, slug: input.capabilitySlug });
  const type = input.type || 'implement-capability';
  const title = `${type === 'update-capability' ? 'Update' : 'Implement'} ${capability.title}`;
  const sections = capability.sections || [];
  const outcomes = sectionBody(sections, 'outcomes') || capability.description || '';
  const scope = sectionBody(sections, 'scope');
  const acceptance = sectionBody(sections, 'validation') || sectionBody(sections, 'functional-requirements');
  const linkedComponents = uniqueStrings(capability.components);

  return createChange({
    projectPath: input.projectPath,
    title,
    type,
    linkedCapabilities: [capability.slug],
    linkedComponents,
    source: 'capability',
    sections: [
      { ...CHANGE_SECTIONS[0], body: `# Intent\n\n${outcomes || `Implement the capability ${capability.title}.`}\n` },
      { ...CHANGE_SECTIONS[1], body: `# Scope\n\n${scope || 'TODO: Define the delivery slice for this capability.'}\n` },
      { ...CHANGE_SECTIONS[2], body: `# Acceptance Criteria\n\n${acceptance || '- [ ] TODO: Define acceptance checks for this change.'}\n` },
      { ...CHANGE_SECTIONS[3], body: ['# Linked Context', '', `- Capability: ${capability.slug}`, ...linkedComponents.map((slug) => `- Suggested component: ${slug}`), ''].join('\n') }
    ]
  });
}

export async function createChangeFromComponent(input: CreateChangeFromComponentInput): Promise<ChangeDetail> {
  if (!input.projectPath || !input.componentSlug) throw new Error('Project path and component slug are required.');
  const component = await readComponent({ projectPath: input.projectPath, slug: input.componentSlug });
  const type = input.type || 'component-change';
  const title = `${changeTypeLabel(type)}: ${component.title}`;
  const sections = component.sections || [];
  const purpose = sectionBody(sections, 'purpose') || component.description || '';
  const boundaries = sectionBody(sections, 'boundaries');
  const standards = sectionBody(sections, 'standards') || sectionBody(sections, 'risks');

  return createChange({
    projectPath: input.projectPath,
    title,
    type,
    linkedCapabilities: uniqueStrings(component.capabilities),
    linkedComponents: [component.slug],
    source: 'component',
    sections: [
      { ...CHANGE_SECTIONS[0], body: `# Intent\n\n${purpose || `Change component ${component.title}.`}\n` },
      { ...CHANGE_SECTIONS[1], body: `# Scope\n\n${boundaries || 'TODO: Define the component scope.'}\n` },
      { ...CHANGE_SECTIONS[2], body: `# Acceptance Criteria\n\n${standards || '- [ ] TODO: Define component acceptance checks.'}\n` },
      { ...CHANGE_SECTIONS[3], body: ['# Linked Context', '', `- Component: ${component.slug}`, ...uniqueStrings(component.capabilities).map((slug) => `- Supported capability: ${slug}`), ''].join('\n') }
    ]
  });
}

export async function createChangeFromTechnicalChange(input: CreateChangeFromTechnicalChangeInput): Promise<ChangeDetail> {
  if (!input.projectPath || !input.componentSlug || !input.technicalChangeId) {
    throw new Error('Project path, component slug, and technical change id are required.');
  }
  const component = await readComponent({ projectPath: input.projectPath, slug: input.componentSlug });
  const technicalChange = await readComponentTechnicalChange({
    projectPath: input.projectPath,
    slug: component.slug,
    id: input.technicalChangeId
  });
  const overview = sectionBody(technicalChange.sections, 'overview');
  const affectedFiles = sectionBody(technicalChange.sections, 'affected-files');
  const rationale = sectionBody(technicalChange.sections, 'rationale');
  const verification = sectionBody(technicalChange.sections, 'verification');

  return createChange({
    projectPath: input.projectPath,
    title: technicalChange.title,
    type: 'technical-refactor',
    priority: 'normal',
    risk: normaliseChangeRisk(technicalChange.risk),
    linkedCapabilities: uniqueStrings(component.capabilities),
    linkedComponents: [component.slug],
    source: 'component-technical-change',
    legacyTechnicalChange: {
      componentSlug: component.slug,
      technicalChangeId: technicalChange.id
    },
    sections: [
      { ...CHANGE_SECTIONS[0], body: `# Intent\n\n${overview || technicalChange.title}\n\n${rationale ? `## Rationale\n\n${rationale}\n` : ''}` },
      { ...CHANGE_SECTIONS[1], body: `# Scope\n\n${affectedFiles || 'TODO: Define affected files and technical scope.'}\n` },
      { ...CHANGE_SECTIONS[2], body: `# Acceptance Criteria\n\n${verification || '- [ ] TODO: Define verification for this technical change.'}\n` },
      {
        ...CHANGE_SECTIONS[3],
        body: [
          '# Linked Context',
          '',
          `- Component: ${component.slug}`,
          `- Legacy technical change: ${technicalChange.id}`,
          `- Legacy path: ${technicalChange.relativePath}`,
          ...uniqueStrings(component.capabilities).map((slug) => `- Supported capability: ${slug}`),
          ''
        ].join('\n')
      }
    ]
  });
}

export async function readChangesForCapability(input: { projectPath: string; capabilitySlug: string }) {
  const slug = String(input.capabilitySlug || '').trim();
  return (await readChanges(input.projectPath)).filter((change) => change.linkedCapabilities.includes(slug));
}

export async function readChangesForComponent(input: { projectPath: string; componentSlug: string }) {
  const slug = String(input.componentSlug || '').trim();
  return (await readChanges(input.projectPath)).filter((change) => change.linkedComponents.includes(slug));
}

export async function appendDeliveryPackageToChanges(projectPath: string, changeIds: string[], packageId: string) {
  for (const changeId of changeIds) {
    const detail = await readChange({ projectPath, id: changeId });
    const deliveryPackageIds = Array.from(new Set([...detail.deliveryPackageIds, packageId]));
    await saveChange({
      projectPath,
      id: changeId,
      status: 'in-delivery',
      linkedCapabilities: detail.linkedCapabilities,
      linkedComponents: detail.linkedComponents,
      sections: detail.sections,
      title: detail.title,
      type: detail.type,
      priority: detail.priority,
      risk: detail.risk
    });
    const target = await findChangeTarget(projectPath, changeId);
    await writeJson(target.metadataPath, changeMetadata({
      ...target.record,
      status: 'in-delivery',
      deliveryPackageIds,
      updatedAt: new Date().toISOString()
    }));
  }
}

export async function readKnownChangeLinks(projectPath: string) {
  const changes = await readChanges(projectPath);
  return {
    capabilitySlugs: new Set((await readEntities(projectPath, 'capabilities', 'capability.json')).map((item: any) => String(item.slug || item.id || '').trim()).filter(Boolean)),
    componentSlugs: new Set((await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json')).map((item: any) => String(item.slug || item.id || '').trim()).filter(Boolean)),
    deliveryPackageIds: new Set((await readEntities(projectPath, 'delivery/packages', 'package.json')).concat(await readEntities(projectPath, 'delivery/bundles', 'bundle.json')).map((item: any) => String(item.id || item.slug || '').trim()).filter(Boolean)),
    changes
  };
}
