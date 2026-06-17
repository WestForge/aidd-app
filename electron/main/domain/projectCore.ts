import { app, Notification } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { normaliseDiskPath, normaliseRelativePath } from './projectValidation';
import type { NotifyInput, SetupStepStatus, TrackedProject } from './types';

export const TEMPLATE_ID = 'aidd-default';

export const TEMPLATE_VERSION = '0.8.0';

export const AIDD_DEFAULT_BRANCH = 'main';

export const OBSOLETE_TEMPLATE_FILES = new Set([
  'capability/05-non-functional-requirements.md',
  'capability/06-data-model.md',
  'capability/07-integrations.md',
  'capability/08-architecture.md',
  'capability/09-ux-ui.md',
  'capability/10-risks.md',
  'capability/11-validation.md',
  'component/04-dependencies.md',
  'component/05-architecture.md',
  'component/06-standards.md',
  'component/07-decisions.md',
  'module/01-purpose.md',
  'module/02-boundaries.md',
  'module/03-interfaces.md',
  'module/04-dependencies.md',
  'module/05-architecture.md',
  'module/06-standards.md',
  'module/07-decisions.md',
  'module/08-risks.md',
  'module/index.md',
  'module/module.json'
]);

export const OBSOLETE_COMPONENT_SECTION_FILES = [
  '04-dependencies.md',
  '05-architecture.md',
  '06-standards.md',
  '07-decisions.md',
  '05-dependencies-and-integrations.md',
  '06-internal-design.md',
  '07-quality-requirements.md',
  'technical-shape.md'
];

export const OBSOLETE_CAPABILITY_SECTION_FILES = [
  '05-non-functional-requirements.md',
  '06-data-model.md',
  '07-integrations.md',
  '08-architecture.md',
  '09-ux-ui.md',
  '10-risks.md',
  '11-validation.md'
];

export function isObsoleteTemplateFile(relativePath: string) {
  return OBSOLETE_TEMPLATE_FILES.has(normaliseRelativePath(relativePath));
}

export function showNativeNotification(input: Partial<NotifyInput> = {}) {
  if (!Notification.isSupported()) return false;
  const title = input.title?.trim() || 'AIDD';
  const body = input.body?.trim();
  new Notification({ title, ...(body ? { body } : {}) }).show();
  return true;
}

export function projectsStorePath() {
  return path.join(app.getPath('userData'), 'projects.json');
}

export async function readProjects(): Promise<TrackedProject[]> {
  try {
    return JSON.parse(await fsp.readFile(projectsStorePath(), 'utf8'));
  } catch {
    return [];
  }
}

export async function writeProjects(projects: TrackedProject[]) {
  await fsp.mkdir(path.dirname(projectsStorePath()), { recursive: true });
  await fsp.writeFile(projectsStorePath(), JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

export async function updateTrackedProject(projectIdOrPath: string, updater: (project: TrackedProject) => TrackedProject) {
  const projects = await readProjects();
  const index = projects.findIndex((project) => project.id === projectIdOrPath || project.path === projectIdOrPath);
  if (index === -1) throw new Error('Tracked project was not found.');
  const updated = updater({ ...projects[index] });
  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

export async function readTrackedProjectByPath(projectPath: string) {
  const resolvedProjectPath = normaliseDiskPath(projectPath);
  return (await readProjects()).find((project) => normaliseDiskPath(project.path) === resolvedProjectPath) || null;
}

export async function readWorkspacePathForProject(projectPath: string) {
  const trackedProject = await readTrackedProjectByPath(projectPath);
  return trackedProject?.workspacePath?.trim() || '';
}

export function templatePathCandidates() {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = [
    path.join(process.cwd(), 'resources', 'templates', 'aidd-default'),
    resourcesPath ? path.join(resourcesPath, 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'resources', 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'app', 'resources', 'templates', 'aidd-default') : '',
    path.join(app.getAppPath(), 'resources', 'templates', 'aidd-default')
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

export function resolveTemplatePath() {
  const candidates = templatePathCandidates();
  const selected = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  return { selected, candidates };
}

export function templatePath() {
  return resolveTemplatePath().selected;
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'aidd-project';
}

export function packageName(value: string) {
  return slugify(value).replace(/^-+/, '').replace(/-+$/, '');
}

export async function exists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(from: string, to: string) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else await fsp.copyFile(source, target);
  }
}

export async function replaceInTree(root: string, replacements: Record<string, string>) {
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await replaceInTree(full, replacements);
      continue;
    }
    if (!/\.(md|json|mjs|txt)$/i.test(entry.name)) continue;
    let content = await fsp.readFile(full, 'utf8');
    for (const [from, to] of Object.entries(replacements)) content = content.split(from).join(to);
    await fsp.writeFile(full, content, 'utf8');
  }
}

export async function writeJson(filePath: string, data: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

export async function readEntities(root: string, dirName: string, manifest: string) {
  const dir = path.join(root, dirName);
  if (!(await exists(dir))) return [] as any[];
  const out: any[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const mf = path.join(dir, entry.name, manifest);
    if (await exists(mf)) out.push(await readJson(mf));
  }
  return out.sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
}

export function parseFrontmatter(content: string): { status: SetupStepStatus; title?: string; id?: string; required: boolean; body: string } {
  const defaults = { status: 'not-started' as SetupStepStatus, required: true };
  if (!content.startsWith('---')) return { ...defaults, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { ...defaults, body: content };
  const frontmatter = content.slice(3, end);
  const body = content.slice(end + 4).replace(/^\s*\n/, '');
  const status = (frontmatter.match(/status:\s*([^\n]+)/)?.[1]?.trim() || defaults.status) as SetupStepStatus;
  const title = frontmatter.match(/title:\s*([^\n]+)/)?.[1]?.trim();
  const id = frontmatter.match(/id:\s*([^\n]+)/)?.[1]?.trim();
  const requiredText = frontmatter.match(/required:\s*([^\n]+)/)?.[1]?.trim();
  return { status, title, id, required: requiredText !== 'false', body };
}

export function buildFoundationMarkdown(doc: { id: string; title: string; status: SetupStepStatus; required?: boolean; body: string }) {
  return `---\naidd:\n  type: foundation\n  id: ${doc.id}\n  title: ${doc.title}\n  status: ${doc.status}\n  required: ${doc.required !== false}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${doc.body.trim()}\n`;
}

export function buildStandardsMarkdown(status: SetupStepStatus, body: string) {
  return `---\naidd:\n  type: standards\n  id: project-standards\n  title: Project Standards\n  status: ${status}\n  required: true\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${body.trim()}\n`;
}
