import { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import git from 'isomorphic-git';
import matter from 'gray-matter';
import { createKeytarCredentialStore } from './services/gitCredentialStore';
import { readGitSyncSettings, saveGitSyncSettings } from './services/gitSyncSettingsStore';
import { testGitRemoteConnection } from './services/gitRemoteTester';
import { connectProjectToRepository, getProjectConnectionStatus } from './services/gitProjectConnector';
import { readGitIdentity, requireGitIdentity, saveGitIdentity } from './services/gitIdentityStore';
import { checkForUpdates, createCheckpointIfNeeded, getSyncStatus, syncProject } from './services/gitSyncWorkflow';
import type { AiddSaveGitIdentityInput, AiddSaveGitSyncSettingsInput, AiddGitSyncTestInput } from './services/gitSyncTypes';
import { cancelGitReview, completeGitReview, listGitReviewFiles, readGitReviewFileContent, resolveGitReviewFile } from './services/gitReviewResolver';
import { readActiveGitReviewState } from './services/gitReviewPackageStore';

const isDev = process.env.NODE_ENV !== 'production';
const TEMPLATE_ID = 'aidd-default';
const TEMPLATE_VERSION = '0.8.0';
const AIDD_DEFAULT_BRANCH = 'main';


interface NotifyInput {
  title: string;
  body?: string;
}

function showNativeNotification(input: Partial<NotifyInput> = {}) {
  if (!Notification.isSupported()) return false;
  const title = input.title?.trim() || 'AIDD';
  const body = input.body?.trim();
  new Notification({ title, ...(body ? { body } : {}) }).show();
  return true;
}

interface CreateProjectInput {
  name: string;
  description: string;
  parentLocation: string;
  authorName?: string;
  authorEmail?: string;
  initializeGit?: boolean;
}

interface TrackedProject {
  id: string;
  name: string;
  description: string;
  path: string;
  templateId: string;
  templateVersion: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface ProjectStatusItem {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
}

interface ProjectStatus {
  status: 'draft' | 'setting-up' | 'ready-for-planning' | 'ready-for-ai-delivery' | 'active' | 'needs-attention';
  label: string;
  completed: number;
  total: number;
  templateVersion: string;
  gitInitialized: boolean;
  componentCount: number;
  capabilityCount: number;
  bundleCount: number;
  foundation: ProjectStatusItem[];
  setup: ProjectStatusItem[];
  nextAction: string;
}

interface HomeWorkDeliveryItem {
  id: string;
  title: string;
  status: string;
  sourceCapability?: string;
  components: string[];
  phaseCount: number;
  priority?: number;
  reason: string;
}

interface HomeWorkCapabilityItem {
  slug: string;
  title: string;
  status: string;
  components: string[];
  incompleteSections: number;
  reason: string;
}

interface HomeWorkComponentItem {
  slug: string;
  title: string;
  status: string;
  sourceProjects: string[];
  capabilities: string[];
  reason: string;
}

interface HomeWork {
  delivery: HomeWorkDeliveryItem[];
  capabilities: HomeWorkCapabilityItem[];
  components: HomeWorkComponentItem[];
  total: number;
}


type ProjectValidationSeverity = 'success' | 'info' | 'warning' | 'error';

interface ProjectValidationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  severity: ProjectValidationSeverity;
  path?: string;
  action?: string;
}

interface ProjectValidationSection {
  id: string;
  title: string;
  items: ProjectValidationItem[];
}

interface ProjectValidationReport {
  generatedAt: string;
  status: 'pass' | 'warning' | 'fail';
  score: number;
  canCreateDeliveryPackage: boolean;
  summary: { total: number; errors: number; warnings: number; info: number; success: number };
  sections: ProjectValidationSection[];
  nextActions: string[];
}

interface ProjectTemplateUpgradeReport {
  generatedAt: string;
  changed: boolean;
  preUpgradeCommit?: string;
  upgradeCommit?: string;
  changes: string[];
  warnings: string[];
  validation: ProjectValidationReport;
}


type SetupStepStatus = 'not-started' | 'draft' | 'in-review' | 'active' | 'deprecated' | 'complete' | 'skipped';

interface WorkflowDocument {
  id: string;
  title: string;
  type: string;
  status: SetupStepStatus;
  required: boolean;
  relativePath: string;
  filePath: string;
  body: string;
  updatedAt?: string;
}

interface SaveWorkflowDocumentInput {
  projectPath: string;
  relativePath: string;
  title: string;
  status: SetupStepStatus;
  body: string;
}

interface FoundationDocument {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  status: SetupStepStatus;
  required: boolean;
  body: string;
}

interface ProjectSetupState {
  foundation: FoundationDocument[];
  standards: { status: SetupStepStatus; filePath: string; body: string; profiles: string[] };
  components: Array<{ slug: string; title: string; status?: string; sourceProjects?: string[] }>;
  capabilities: Array<{ slug: string; title: string; status?: string; components?: string[] }>;
  gitInitialized: boolean;
}

interface SourceCodeProject {
  id: string;
  name: string;
  path: string;
  detectedType: string;
  indicators: string[];
  createdAt: string;
  updatedAt: string;
}

interface SaveFoundationInput {
  projectPath: string;
  fileName: string;
  status: SetupStepStatus;
  body: string;
}

interface PrepareFoundationDragFileInput {
  projectPath: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus;
  body: string;
}

interface PrepareMarkdownDragFileInput {
  projectPath: string;
  directory?: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus | string;
  body: string;
  metadata?: Record<string, unknown>;
}

interface ComponentSectionInput {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: SetupStepStatus;
}

interface CreateComponentInput {
  projectPath: string;
  title: string;
  description?: string;
  status?: SetupStepStatus | 'active' | 'deprecated';
  sourceProjects?: string[];
  capabilities?: string[];
  sections?: ComponentSectionInput[];
}

interface ReadComponentInput {
  projectPath: string;
  slug: string;
}

interface UpdateComponentInput {
  projectPath: string;
  slug: string;
  title: string;
  description?: string;
  status?: SetupStepStatus | 'active' | 'deprecated';
  sourceProjects?: string[];
  capabilities?: string[];
  sections?: ComponentSectionInput[];
}

interface CapabilitySectionInput {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: SetupStepStatus;
}

interface CreateCapabilityInput {
  projectPath: string;
  title: string;
  description?: string;
  outcome?: string;
  componentSlugs?: string[];
  notes?: string;
  status?: SetupStepStatus;
  inlineComponent?: { title: string; description?: string };
  sections?: CapabilitySectionInput[];
}


interface ReadCapabilityInput {
  projectPath: string;
  slug: string;
}

interface UpdateCapabilityInput {
  projectPath: string;
  slug: string;
  title: string;
  description?: string;
  outcome?: string;
  notes?: string;
  status?: SetupStepStatus;
  componentSlugs?: string[];
  sections?: CapabilitySectionInput[];
}

interface CreateDeliveryPackageFromCapabilityInput {
  projectPath: string;
  capabilitySlug: string;
}

interface DeliveryPackageSummary {
  id: string;
  title: string;
  status: string;
  sourceCapability?: string;
  components: string[];
  createdAt?: string;
  packaged: boolean;
  phaseCount: number;
  priority?: number;
}

interface DeleteDeliveryPackageInput {
  projectPath: string;
  id: string;
}

interface DeliveryPackagePhaseDetail {
  id: string;
  title: string;
  status: string;
  fileName: string;
  body: string;
}

interface DeliveryPackageFileDetail {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  extension?: string;
  editable: boolean;
}

interface DeliveryPackageDetail extends DeliveryPackageSummary {
  packagePath: string;
  snapshotBody: string;
  strategyBody: string;
  packagedBody: string;
  phases: DeliveryPackagePhaseDetail[];
  files: DeliveryPackageFileDetail[];
}

interface SaveDeliveryPackageInput {
  projectPath: string;
  id: string;
  status?: string;
  title?: string;
  strategyBody?: string;
  snapshotBody?: string;
  phases?: DeliveryPackagePhaseDetail[];
}

interface CreateDeliveryPackagePhaseInput {
  projectPath: string;
  packageId: string;
  title: string;
  body?: string;
}

interface DefineStandardsInput {
  projectPath: string;
  body: string;
  status: SetupStepStatus;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'AIDD',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function projectsStorePath() {
  return path.join(app.getPath('userData'), 'projects.json');
}

async function readProjects(): Promise<TrackedProject[]> {
  try {
    return JSON.parse(await fsp.readFile(projectsStorePath(), 'utf8'));
  } catch {
    return [];
  }
}

async function writeProjects(projects: TrackedProject[]) {
  await fsp.mkdir(path.dirname(projectsStorePath()), { recursive: true });
  await fsp.writeFile(projectsStorePath(), JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

function templatePath() {
  const devPath = path.join(process.cwd(), 'resources', 'templates', 'aidd-default');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(app.getAppPath(), 'resources', 'templates', 'aidd-default');
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'aidd-project';
}

function packageName(value: string) {
  return slugify(value).replace(/^-+/, '').replace(/-+$/, '');
}

async function exists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(from: string, to: string) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else await fsp.copyFile(source, target);
  }
}

async function replaceInTree(root: string, replacements: Record<string, string>) {
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

async function writeJson(filePath: string, data: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function readEntities(root: string, dirName: string, manifest: string) {
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


function parseFrontmatter(content: string): { status: SetupStepStatus; title?: string; id?: string; required: boolean; body: string } {
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

function buildFoundationMarkdown(doc: { id: string; title: string; status: SetupStepStatus; required?: boolean; body: string }) {
  return `---\naidd:\n  type: foundation\n  id: ${doc.id}\n  title: ${doc.title}\n  status: ${doc.status}\n  required: ${doc.required !== false}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${doc.body.trim()}\n`;
}

function buildStandardsMarkdown(status: SetupStepStatus, body: string) {
  return `---\naidd:\n  type: standards\n  id: project-standards\n  title: Project Standards\n  status: ${status}\n  required: true\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${body.trim()}\n`;
}

async function fileStatus(filePath: string): Promise<SetupStepStatus> {
  if (!(await exists(filePath))) return 'not-started';
  const parsed = parseFrontmatter(await fsp.readFile(filePath, 'utf8'));
  return parsed.status;
}

async function readFoundationDocuments(projectPath: string): Promise<FoundationDocument[]> {
  const foundationDir = await exists(path.join(projectPath, 'foundation')) ? 'foundation' : 'common';
  const definitions = [
    ['product-definition', 'Product definition', '02-product-definition.md'],
    ['audience-and-users', 'Audience & users', '03-audience-and-users.md'],
    ['goals-and-success-metrics', 'Goals & Success Metrics', '04-goals-and-success-metrics.md']
  ] as const;
  const docs: FoundationDocument[] = [];
  for (const [id, fallbackTitle, fileName] of definitions) {
    const filePath = path.join(projectPath, foundationDir, fileName);
    const raw = await exists(filePath) ? await fsp.readFile(filePath, 'utf8') : '';
    const parsed = parseFrontmatter(raw || `# ${fallbackTitle}\n\nTODO\n`);
    docs.push({ id: parsed.id || id, title: parsed.title || fallbackTitle, fileName, filePath, status: parsed.status, required: parsed.required, body: parsed.body });
  }
  return docs;
}


function isTextWorkflowMarkdown(relativePath: string) {
  const normal = relativePath.split('\\').join('/');
  if (!normal.endsWith('.md')) return false;
  if (normal.includes('/.git/') || normal.startsWith('.git/')) return false;
  if (normal.includes('/node_modules/') || normal.startsWith('node_modules/')) return false;
  if (normal.includes('/.aidd/templates/') || normal.startsWith('.aidd/templates/')) return false;
  if (normal.includes('/.aidd-app/') || normal.startsWith('.aidd-app/')) return false;
  return true;
}

async function collectMarkdownFiles(root: string, current = root): Promise<string[]> {
  const ignored = new Set(['.git', 'node_modules', '.aidd-app']);
  const out: string[] = [];
  if (!(await exists(current))) return out;
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    const relative = path.relative(root, full).split('\\').join('/');
    if (entry.isDirectory()) {
      if (relative === '.aidd/templates') continue;
      out.push(...await collectMarkdownFiles(root, full));
    } else if (isTextWorkflowMarkdown(relative)) {
      out.push(relative);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function inferDocumentType(relativePath: string, data: Record<string, any>) {
  const fromMatter = data?.aidd?.type || data?.type;
  if (fromMatter) return String(fromMatter);
  if (relativePath.startsWith('foundation/')) return 'foundation';
  if (relativePath.startsWith('components/')) return 'component';
  if (relativePath.startsWith('modules/')) return 'component';
  if (relativePath.startsWith('capabilities/')) return 'capability';
  if (relativePath.startsWith('delivery/')) return 'delivery';
  if (relativePath.startsWith('reviews/')) return 'review';
  return 'document';
}

function inferDocumentTitle(relativePath: string, body: string, data: Record<string, any>) {
  const fromMatter = data?.aidd?.title || data?.title;
  if (fromMatter) return String(fromMatter);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(relativePath, '.md').replace(/^\d+-/, '').split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function normalizeSetupStatus(value: unknown): SetupStepStatus {
  const valid: SetupStepStatus[] = ['not-started', 'draft', 'in-review', 'complete', 'skipped'];
  return valid.includes(value as SetupStepStatus) ? value as SetupStepStatus : 'not-started';
}

async function readWorkflowDocuments(projectPath: string): Promise<WorkflowDocument[]> {
  const files = await collectMarkdownFiles(projectPath);
  const docs: WorkflowDocument[] = [];
  for (const relativePath of files) {
    const filePath = path.join(projectPath, relativePath);
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const data: any = parsed.data || {};
    const aidd = data.aidd || {};
    docs.push({
      id: String(aidd.id || data.id || relativePath.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()),
      title: inferDocumentTitle(relativePath, parsed.content, data),
      type: inferDocumentType(relativePath, data),
      status: normalizeSetupStatus(aidd.status || data.status),
      required: aidd.required !== false && data.required !== false,
      relativePath,
      filePath,
      body: parsed.content.replace(/^\s*\n/, ''),
      updatedAt: aidd.updatedAt || data.updatedAt
    });
  }
  return docs;
}

async function saveWorkflowDocument(input: SaveWorkflowDocumentInput): Promise<WorkflowDocument[]> {
  const relativePath = input.relativePath.split('\\').join('/');
  if (!isTextWorkflowMarkdown(relativePath)) throw new Error('Only Markdown workflow documents can be saved.');
  const filePath = path.join(input.projectPath, relativePath);
  if (!(await exists(filePath))) throw new Error(`Document not found: ${relativePath}`);
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = matter(raw);
  const data: any = parsed.data || {};
  data.aidd = {
    ...(data.aidd || {}),
    id: data.aidd?.id || data.id || relativePath.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    title: input.title.trim() || inferDocumentTitle(relativePath, input.body, data),
    type: data.aidd?.type || inferDocumentType(relativePath, data),
    status: input.status,
    required: data.aidd?.required ?? data.required ?? true,
    templateVersion: data.aidd?.templateVersion || TEMPLATE_VERSION,
    updatedAt: new Date().toISOString()
  };
  const next = matter.stringify(input.body.trim() + '\n', data);
  await fsp.writeFile(filePath, next, 'utf8');
  return readWorkflowDocuments(input.projectPath);
}

async function readProjectSetup(projectPath: string): Promise<ProjectSetupState> {
  const standardsPath = path.join(projectPath, 'foundation', 'standards', 'index.md');
  const standardsRaw = await exists(standardsPath) ? await fsp.readFile(standardsPath, 'utf8') : '# Standards\n\nTODO\n';
  const standardsParsed = parseFrontmatter(standardsRaw);
  let profiles: string[] = [];
  try {
    const standardsJson = await readJson<any>(path.join(projectPath, 'foundation', 'standards', 'standards.json'));
    profiles = Array.isArray(standardsJson.profiles) ? standardsJson.profiles : [];
  } catch {}
  return {
    foundation: await readFoundationDocuments(projectPath),
    standards: { status: standardsParsed.status, filePath: standardsPath, body: standardsParsed.body, profiles },
    components: (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json')),
    capabilities: (await readEntities(projectPath, 'capabilities', 'capability.json')).map((cap: any) => ({ ...cap, components: cap.components || cap.modules || [] })),
    gitInitialized: await exists(path.join(projectPath, '.git'))
  };
}

async function fileHasUsefulContent(filePath: string) {
  if (!(await exists(filePath))) return false;
  const content = await fsp.readFile(filePath, 'utf8');
  const parsed = parseFrontmatter(content);
  if (parsed.status === 'complete') return true;
  if (parsed.status === 'skipped') return false;
  const body = parsed.body
    .replace(/^#.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .trim();
  return body.length > 48;
}

async function dirCount(root: string, dirName: string, manifest: string) {
  return (await readEntities(root, dirName, manifest)).length;
}

async function deliveryBundleCount(root: string) {
  return (await readEntities(root, 'delivery/packages', 'package.json')).length || (await readEntities(root, 'delivery/bundles', 'bundle.json')).length;
}


function isTerminalHomeStatus(status?: string) {
  return ['active', 'accepted', 'complete', 'deprecated', 'skipped', 'superseded'].includes(String(status || '').toLowerCase());
}

function isTerminalDeliveryStatus(status?: string) {
  return ['accepted', 'complete', 'deprecated', 'skipped', 'superseded'].includes(String(status || '').toLowerCase());
}

async function readCapabilityIncompleteSectionCount(projectPath: string, capability: any) {
  const slug = String(capability.slug || capability.id || '').trim();
  if (!slug) return 0;
  const capabilityDir = path.join(projectPath, 'capabilities', slug);
  const templateFiles = Array.isArray(capability.template?.sectionFiles) ? capability.template.sectionFiles : CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName);
  let incomplete = 0;
  for (const fileName of templateFiles) {
    const sectionPath = path.join(capabilityDir, String(fileName));
    if (!(await exists(sectionPath))) {
      incomplete += 1;
      continue;
    }
    const raw = await fsp.readFile(sectionPath, 'utf8');
    const parsed = matter(raw);
    const aidd = (parsed.data as any)?.aidd || {};
    const sectionStatus = String(aidd.status || 'not-started');
    const body = sectionBodyFromMarkdown(raw);
    if (!['complete', 'skipped'].includes(sectionStatus) || !body.trim()) incomplete += 1;
  }
  return incomplete;
}

async function readHomeWork(projectPath: string): Promise<HomeWork> {
  const componentsRaw = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));
  const capabilitiesRaw = (await readEntities(projectPath, 'capabilities', 'capability.json')).map((capability: any) => ({
    ...capability,
    components: Array.isArray(capability.components) ? capability.components : Array.isArray(capability.modules) ? capability.modules : []
  }));
  const deliveriesRaw = (await readEntities(projectPath, 'delivery/packages', 'package.json')).concat(await readEntities(projectPath, 'delivery/bundles', 'bundle.json'));

  const capabilityByComponent = new Map<string, string[]>();
  for (const capability of capabilitiesRaw) {
    const title = String(capability.title || capability.slug || capability.id || 'Untitled capability');
    for (const componentSlug of capability.components || []) {
      const list = capabilityByComponent.get(componentSlug) || [];
      list.push(title);
      capabilityByComponent.set(componentSlug, list);
    }
  }

  const components: HomeWorkComponentItem[] = componentsRaw
    .map((component: any) => {
      const slug = String(component.slug || component.id || '').trim();
      const status = String(component.status || component.lifecycle || 'draft');
      const sourceProjects = Array.isArray(component.sourceProjects) ? component.sourceProjects : [];
      const capabilities = capabilityByComponent.get(slug) || [];
      const reasons: string[] = [];
      if (!isTerminalHomeStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
      if (!sourceProjects.length) reasons.push('No source mapping');
      if (!capabilities.length) reasons.push('No capability mapping');
      return {
        slug,
        title: String(component.title || slug || 'Untitled component'),
        status,
        sourceProjects,
        capabilities,
        reason: reasons.join(' · ') || 'Needs review'
      };
    })
    .filter((component) => !isTerminalHomeStatus(component.status) || !component.sourceProjects.length || !component.capabilities.length)
    .sort((a, b) => a.title.localeCompare(b.title));

  const capabilities: HomeWorkCapabilityItem[] = [];
  for (const capability of capabilitiesRaw) {
    const slug = String(capability.slug || capability.id || '').trim();
    const status = String(capability.status || capability.lifecycle || 'draft');
    const components = Array.isArray(capability.components) ? capability.components : [];
    const incompleteSections = await readCapabilityIncompleteSectionCount(projectPath, capability);
    const reasons: string[] = [];
    if (!isTerminalHomeStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
    if (!components.length) reasons.push('No components selected');
    if (incompleteSections > 0) reasons.push(`${incompleteSections} section${incompleteSections === 1 ? '' : 's'} incomplete`);
    if (reasons.length) {
      capabilities.push({
        slug,
        title: String(capability.title || slug || 'Untitled capability'),
        status,
        components,
        incompleteSections,
        reason: reasons.join(' · ')
      });
    }
  }
  capabilities.sort((a, b) => a.title.localeCompare(b.title));

  const delivery: HomeWorkDeliveryItem[] = deliveriesRaw
    .map((pkg: any) => {
      const status = String(pkg.status || 'draft');
      const components = Array.isArray(pkg.components) ? pkg.components : [];
      const phaseCount = Array.isArray(pkg.phases) ? pkg.phases.length : Number(pkg.phaseCount || 0);
      const reasons: string[] = [];
      if (!isTerminalDeliveryStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
      if (!components.length) reasons.push('No components captured');
      if (!phaseCount && status !== 'draft') reasons.push('No phases defined');
      return {
        id: String(pkg.id || pkg.slug || 'delivery-package'),
        title: String(pkg.title || pkg.name || 'Untitled delivery package'),
        status,
        sourceCapability: pkg.sourceCapability ? String(pkg.sourceCapability) : undefined,
        components,
        phaseCount,
        priority: typeof pkg.priority === 'number' ? pkg.priority : undefined,
        reason: reasons.join(' · ') || 'Delivery package needs attention'
      };
    })
    .filter((pkg) => !isTerminalDeliveryStatus(pkg.status))
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.id.localeCompare(b.id));

  return {
    delivery,
    capabilities,
    components,
    total: delivery.length + capabilities.length + components.length
  };
}

async function readProjectStatus(projectPath: string): Promise<ProjectStatus> {
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  const foundationDir = await exists(path.join(projectPath, 'foundation')) ? 'foundation' : 'common';
  const foundationFiles = [
    ['product', 'Product definition', '02-product-definition.md', 'Defines the product intent future work inherits.'],
    ['audience', 'Audience & users', '03-audience-and-users.md', 'Identifies who the product is for.'],
    ['goals', 'Goals & success metrics', '04-goals-and-success-metrics.md', 'Defines measurable outcomes used to judge delivery success.']
  ] as const;
  const foundation: ProjectStatusItem[] = [];
  const foundationStatuses: SetupStepStatus[] = [];
  for (const [id, label, file, detail] of foundationFiles) {
    const status = await fileStatus(path.join(projectPath, foundationDir, file));
    foundationStatuses.push(status);
    foundation.push({ id, label, complete: status === 'complete', detail });
  }
  const componentCount = await dirCount(projectPath, 'components', 'component.json') || await dirCount(projectPath, 'modules', 'module.json');
  const capabilityCount = await dirCount(projectPath, 'capabilities', 'capability.json');
  const bundleCount = await deliveryBundleCount(projectPath);
  const gitInitialized = await exists(path.join(projectPath, '.git'));
  const standardsStatus = await fileStatus(path.join(projectPath, 'foundation', 'standards', 'index.md'));
  const standardsComplete = standardsStatus === 'complete';

  const setup: ProjectStatusItem[] = [
    { id: 'foundation', label: 'Project Foundation started', complete: foundationStatuses.some((status) => status !== 'not-started'), detail: 'Shared context exists for the project.' },
    { id: 'foundation-complete', label: 'Project Foundation complete', complete: foundation.every((item) => item.complete), detail: 'All required foundation sections have useful content.' },
    { id: 'standards', label: 'Project Standards defined', complete: standardsComplete, detail: standardsComplete ? 'Standards are marked complete.' : 'Define standards before creating components and capabilities.' },
    { id: 'capability', label: 'First capability created', complete: capabilityCount > 0, detail: `${capabilityCount} capabilit${capabilityCount === 1 ? 'y' : 'ies'} found.` },
    { id: 'component', label: 'First component created', complete: componentCount > 0, detail: `${componentCount} component${componentCount === 1 ? '' : 's'} found.` },
    { id: 'git', label: 'Git versioning initialised', complete: gitInitialized, detail: gitInitialized ? 'Local Git repository exists.' : 'No local Git repository found.' },
    { id: 'package', label: 'First delivery package created', complete: bundleCount > 0, detail: `${bundleCount} delivery package${bundleCount === 1 ? '' : 's'} found.` }
  ];

  const completed = setup.filter((item) => item.complete).length;
  const total = setup.length;
  let status: ProjectStatus['status'] = 'draft';
  let label = 'Draft';
  let nextAction = 'Complete the project overview.';

  if (!gitInitialized) {
    status = 'needs-attention';
    label = 'Needs attention';
    nextAction = 'Initialise Git versioning for the project.';
  } else if (!foundation.every((item) => item.complete)) {
    status = 'setting-up';
    label = 'Setting up';
    nextAction = 'Complete the Project Foundation.';
  } else if (!standardsComplete) {
    status = 'setting-up';
    label = 'Setting up';
    nextAction = 'Define the project standards.';
  } else if (capabilityCount === 0 || componentCount === 0) {
    status = 'ready-for-planning';
    label = 'Ready for planning';
    nextAction = capabilityCount === 0 ? 'Create the first capability.' : 'Create the first component.';
  } else if (bundleCount === 0) {
    status = 'ready-for-ai-delivery';
    label = 'Ready for AI delivery';
    nextAction = 'Create the first delivery package.';
  } else {
    status = 'active';
    label = 'Active';
    nextAction = 'Review active delivery packages and move approved work through AI review and verification.';
  }

  return {
    status,
    label,
    completed,
    total,
    templateVersion: manifest.templateVersion || 'unknown',
    gitInitialized,
    componentCount,
    capabilityCount,
    bundleCount,
    foundation,
    setup,
    nextAction
  };
}


function validationSection(id: string, title: string): ProjectValidationSection {
  return { id, title, items: [] };
}

function pushValidation(section: ProjectValidationSection, item: Omit<ProjectValidationItem, 'category'>) {
  section.items.push({ ...item, category: section.title });
}

function bodyLooksUseful(body: string) {
  const cleaned = body
    .replace(/^#.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .replace(/_No content captured\._/gi, '')
    .trim();
  return cleaned.length >= 40;
}

function normaliseRelativePath(value: string) {
  return value.split('\\').join('/');
}

function isSkippedHealthPath(relativePath: string) {
  const normal = normaliseRelativePath(relativePath);
  return (
    normal.startsWith('.git/') ||
    normal.startsWith('node_modules/') ||
    normal.startsWith('.aidd-app/') ||
    normal.startsWith('.aidd/drag-files/') ||
    normal.startsWith('.aidd/template-archive/') ||
    normal.startsWith('_archive/') ||
    normal.startsWith('dist/') ||
    normal.startsWith('build/') ||
    normal.startsWith('out/')
  );
}

async function collectRelativeFiles(root: string, current = root): Promise<string[]> {
  if (!(await exists(current))) return [];
  const out: string[] = [];
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    const relative = normaliseRelativePath(path.relative(root, full));
    if (entry.isDirectory()) {
      if (isSkippedHealthPath(relative + '/')) continue;
      out.push(...await collectRelativeFiles(root, full));
      continue;
    }
    if (!isSkippedHealthPath(relative)) out.push(relative);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function collectProjectMarkdownFiles(projectPath: string) {
  return (await collectRelativeFiles(projectPath)).filter((relativePath) => relativePath.endsWith('.md'));
}

async function validateTemplateFiles(projectPath: string, section: ProjectValidationSection) {
  const expectedRoot = path.join(templatePath(), '.aidd', 'templates');
  const actualRoot = path.join(projectPath, '.aidd', 'templates');

  if (!(await exists(expectedRoot))) {
    pushValidation(section, {
      id: 'app-template-root-missing',
      title: 'Bundled template files could not be found',
      message: `The app template folder was not found at ${expectedRoot}`,
      severity: 'error',
      action: 'Reinstall or rebuild the app template resources.'
    });
    return;
  }

  if (!(await exists(actualRoot))) {
    pushValidation(section, {
      id: 'project-template-root-missing',
      title: 'Project template folder missing',
      message: 'The project does not contain .aidd/templates.',
      severity: 'error',
      path: '.aidd/templates',
      action: 'Run the template upgrade to restore missing template files.'
    });
    return;
  }

  const expectedFiles = await collectRelativeFiles(expectedRoot);
  const actualFiles = await collectRelativeFiles(actualRoot);
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);
  let issueCount = 0;

  for (const relativePath of expectedFiles) {
    if (actual.has(relativePath)) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-missing-${relativePath}`,
      title: 'Template file missing',
      message: `${relativePath} exists in the app template but is missing from this project.`,
      severity: 'error',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run the template upgrade to restore missing template files.'
    });
  }

  for (const relativePath of actualFiles) {
    if (expected.has(relativePath)) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-extra-${relativePath}`,
      title: 'Unexpected template file',
      message: `${relativePath} is not part of the current app template.`,
      severity: 'warning',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run the template upgrade to archive template files that should not be there.'
    });
  }

  for (const relativePath of actualFiles.filter((item) => item.endsWith('.md') && expected.has(item))) {
    const raw = await fsp.readFile(path.join(actualRoot, relativePath), 'utf8');
    const parsed = matter(raw);
    const aidd = (parsed.data as any)?.aidd;
    const version = aidd?.templateVersion;
    if (!aidd || version === TEMPLATE_VERSION) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-version-${relativePath}`,
      title: 'Template front matter is out of sync',
      message: `${relativePath} uses templateVersion ${version || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run the template upgrade to update front matter versions.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'template-files-current',
      title: 'Template files match the app template',
      message: `.aidd/templates has all expected files, no unexpected files, and current front matter versions (${TEMPLATE_VERSION}).`,
      severity: 'success',
      path: '.aidd/templates'
    });
  }
}

async function validateProjectFrontmatterVersions(projectPath: string, section: ProjectValidationSection) {
  const markdownFiles = await collectProjectMarkdownFiles(projectPath);
  let issueCount = 0;

  for (const relativePath of markdownFiles) {
    const raw = await fsp.readFile(path.join(projectPath, relativePath), 'utf8');
    const parsed = matter(raw);
    const aidd = (parsed.data as any)?.aidd;
    if (!aidd) continue;
    const version = aidd.templateVersion;
    if (version === TEMPLATE_VERSION) continue;
    issueCount++;
    pushValidation(section, {
      id: `frontmatter-version-${relativePath}`,
      title: 'AIDD front matter version is out of sync',
      message: `${relativePath} uses templateVersion ${version || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Run the template upgrade to update front matter versions.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'frontmatter-current',
      title: 'Project document front matter is current',
      message: `All AIDD Markdown files with front matter use templateVersion ${TEMPLATE_VERSION}.`,
      severity: 'success'
    });
  }
}

function isGitMatrixRowChanged(row: Awaited<ReturnType<typeof git.statusMatrix>>[number]) {
  const [, head, workdir, stage] = row;
  return head !== workdir || workdir !== stage;
}

function shouldSkipGitCheckpointPath(filePath: string) {
  const normal = normaliseRelativePath(filePath);
  const fileName = path.posix.basename(normal);
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') return true;
  return (
    normal.startsWith('.git/') ||
    normal.startsWith('node_modules/') ||
    normal.startsWith('.aidd/drag-files/') ||
    normal.startsWith('.aidd-app/') ||
    normal.startsWith('dist/') ||
    normal.startsWith('build/') ||
    normal.startsWith('out/')
  );
}

async function listProjectGitChanges(projectPath: string) {
  if (!(await exists(path.join(projectPath, '.git')))) return [];
  const matrix = await git.statusMatrix({ fs, dir: projectPath });
  return matrix.filter((row) => isGitMatrixRowChanged(row)).filter(([filePath]) => !shouldSkipGitCheckpointPath(filePath));
}

async function validateGitWorkingTree(projectPath: string, section: ProjectValidationSection) {
  if (!(await exists(path.join(projectPath, '.git')))) return;
  const changed = await listProjectGitChanges(projectPath);
  if (changed.length === 0) {
    pushValidation(section, {
      id: 'git-working-tree-clean',
      title: 'Git working tree is clean',
      message: 'No uncommitted project changes were found.',
      severity: 'success',
      path: '.git'
    });
    return;
  }

  pushValidation(section, {
    id: 'git-working-tree-dirty',
    title: 'Uncommitted project changes found',
    message: `${changed.length} file${changed.length === 1 ? '' : 's'} have outstanding changes. The template upgrade will commit these first before changing front matter.`,
    severity: 'warning',
    path: '.git',
    action: 'Review or commit outstanding work, or let the template upgrade create a checkpoint commit first.'
  });
}

async function getProjectGitAuthor(projectPath: string) {
  const saved = await readGitIdentity(app.getPath('userData'));
  if (saved) return { name: saved.authorName, email: saved.authorEmail };

  const name = await git.getConfig({ fs, dir: projectPath, path: 'user.name' });
  const email = await git.getConfig({ fs, dir: projectPath, path: 'user.email' });
  if (typeof name === 'string' && typeof email === 'string' && name.trim() && email.trim()) {
    return { name: name.trim(), email: email.trim() };
  }

  throw new Error('AIDD author identity is required before the template upgrade can create Git commits. Set it in Settings first.');
}

async function commitProjectChanges(projectPath: string, message: string, author: { name: string; email: string }) {
  const changed = await listProjectGitChanges(projectPath);
  if (changed.length === 0) return { created: false, changedFiles: [] as string[], oid: undefined as string | undefined };

  for (const [filePath, _head, workdir] of changed) {
    if (workdir === 0) await git.remove({ fs, dir: projectPath, filepath: filePath });
    else await git.add({ fs, dir: projectPath, filepath: filePath });
  }

  const oid = await git.commit({ fs, dir: projectPath, message, author });
  return { created: true, changedFiles: changed.map(([filePath]) => filePath), oid };
}

async function syncBundledTemplateFiles(projectPath: string, changes: string[], warnings: string[], stamp: string) {
  const expectedRoot = path.join(templatePath(), '.aidd', 'templates');
  const actualRoot = path.join(projectPath, '.aidd', 'templates');

  if (!(await exists(expectedRoot))) {
    warnings.push(`Bundled app template folder was not found: ${expectedRoot}`);
    return;
  }

  await fsp.mkdir(actualRoot, { recursive: true });
  const expectedFiles = await collectRelativeFiles(expectedRoot);
  const actualFiles = await collectRelativeFiles(actualRoot);
  const expected = new Set(expectedFiles);

  for (const relativePath of expectedFiles) {
    const target = path.join(actualRoot, relativePath);
    if (await exists(target)) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(path.join(expectedRoot, relativePath), target);
    changes.push(`Restored missing template file .aidd/templates/${relativePath}`);
  }

  for (const relativePath of actualFiles) {
    if (expected.has(relativePath)) continue;
    const source = path.join(actualRoot, relativePath);
    if (!(await exists(source))) continue;
    const archivePath = path.join(projectPath, '.aidd', 'template-archive', stamp, relativePath);
    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    await fsp.rename(source, archivePath);
    changes.push(`Archived unexpected template file .aidd/templates/${relativePath}`);
  }
}

async function upgradeMarkdownFrontmatterVersions(projectPath: string, changes: string[], now: string) {
  const markdownFiles = await collectProjectMarkdownFiles(projectPath);

  for (const relativePath of markdownFiles) {
    const filePath = path.join(projectPath, relativePath);
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const data = (parsed.data || {}) as any;
    if (!data.aidd) continue;
    if (data.aidd.templateVersion === TEMPLATE_VERSION) continue;

    data.aidd = {
      ...data.aidd,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: now
    };
    await fsp.writeFile(filePath, matter.stringify(parsed.content.replace(/^\s*\n/, ''), data), 'utf8');
    changes.push(`Updated front matter version in ${relativePath}`);
  }
}

async function upgradeTemplateManifest(projectPath: string, changes: string[], now: string) {
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  const next = {
    ...manifest,
    templateId: manifest.templateId || TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    upgradedAt: now
  };

  if (JSON.stringify(manifest) === JSON.stringify(next)) return;
  await writeJson(manifestPath, next);
  changes.push('Updated aidd.template.json to the current template version');
}

async function upgradeProjectTemplates(projectPath: string): Promise<ProjectTemplateUpgradeReport> {
  if (!projectPath || !(await exists(projectPath))) throw new Error(`Project path does not exist: ${projectPath}`);

  const changes: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');
  const gitAvailable = await exists(path.join(projectPath, '.git'));
  let author: { name: string; email: string } | null = null;
  let preUpgradeCommit: string | undefined;
  let upgradeCommit: string | undefined;

  if (gitAvailable) {
    author = await getProjectGitAuthor(projectPath);
    const preCommit = await commitProjectChanges(projectPath, 'chore(project): checkpoint before AIDD template upgrade', author);
    if (preCommit.created) {
      preUpgradeCommit = preCommit.oid;
      changes.push(`Committed ${preCommit.changedFiles.length} outstanding file${preCommit.changedFiles.length === 1 ? '' : 's'} before template upgrade.`);
    }
  } else {
    warnings.push('No local Git repository was found, so the upgrade could not create before/after commits. Initialise Git before team use.');
  }

  await syncBundledTemplateFiles(projectPath, changes, warnings, stamp);
  await upgradeMarkdownFrontmatterVersions(projectPath, changes, now);
  await upgradeTemplateManifest(projectPath, changes, now);

  if (gitAvailable && author) {
    const postCommit = await commitProjectChanges(projectPath, 'chore(project): upgrade AIDD template front matter', author);
    if (postCommit.created) {
      upgradeCommit = postCommit.oid;
      changes.push(`Committed ${postCommit.changedFiles.length} template upgrade file${postCommit.changedFiles.length === 1 ? '' : 's'}.`);
    } else {
      changes.push('No template upgrade file changes were needed after the pre-upgrade checkpoint.');
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    changed: changes.length > 0,
    preUpgradeCommit,
    upgradeCommit,
    changes,
    warnings,
    validation: await validateProject(projectPath)
  };
}

async function validateProject(projectPath: string): Promise<ProjectValidationReport> {
  const structure = validationSection('structure', 'Project structure');
  const templateSection = validationSection('templates', 'Template files');
  const frontmatterSection = validationSection('frontmatter', 'Template front matter');
  const foundationSection = validationSection('foundation', 'Foundation');
  const modelSection = validationSection('model', 'Capabilities and components');
  const sourceSection = validationSection('source-code', 'Source code references');
  const deliverySection = validationSection('delivery', 'Delivery packages');

  if (!(await exists(projectPath))) {
    pushValidation(structure, {
      id: 'project-path-missing',
      title: 'Project folder not found',
      message: `The selected project folder does not exist: ${projectPath}`,
      severity: 'error',
      action: 'Open a valid AIDD project from the Projects screen.'
    });
  }

  const manifestPath = path.join(projectPath, 'aidd.template.json');
  if (await exists(manifestPath)) {
    const manifest = await readJson<any>(manifestPath);
    pushValidation(structure, {
      id: 'template-manifest',
      title: 'Template manifest found',
      message: `${manifest.templateId || 'unknown'}@${manifest.templateVersion || 'unknown'}`,
      severity: 'success',
      path: 'aidd.template.json'
    });
    if (manifest.templateVersion && manifest.templateVersion !== TEMPLATE_VERSION) {
      pushValidation(structure, {
        id: 'template-version-drift',
        title: 'Template version differs from app version',
        message: `Project uses ${manifest.templateVersion}; app expects ${TEMPLATE_VERSION}.`,
        severity: 'warning',
        path: 'aidd.template.json',
        action: 'A project upgrade/repair flow should be run when available.'
      });
    }
  } else {
    pushValidation(structure, {
      id: 'template-manifest-missing',
      title: 'Template manifest missing',
      message: 'The project does not contain aidd.template.json.',
      severity: 'error',
      action: 'Open an AIDD project or repair the project structure.'
    });
  }

  if (await exists(path.join(projectPath, '.git'))) {
    pushValidation(structure, { id: 'git-present', title: 'Git repository found', message: 'Local Git versioning is initialised.', severity: 'success', path: '.git' });
    await validateGitWorkingTree(projectPath, structure);
  } else {
    pushValidation(structure, { id: 'git-missing', title: 'Git repository missing', message: 'This project is not currently versioned with Git.', severity: 'error', action: 'Initialise Git versioning before team use.' });
  }

  await validateTemplateFiles(projectPath, templateSection);
  await validateProjectFrontmatterVersions(projectPath, frontmatterSection);

  const foundation = await readFoundationDocuments(projectPath);
  for (const doc of foundation) {
    const useful = bodyLooksUseful(doc.body);
    if (doc.status === 'complete' && useful) {
      pushValidation(foundationSection, { id: `foundation-${doc.id}`, title: `${doc.title} complete`, message: 'Marked complete and contains useful content.', severity: 'success', path: `foundation/${doc.fileName}` });
    } else if (doc.required !== false) {
      pushValidation(foundationSection, { id: `foundation-${doc.id}`, title: `${doc.title} is not ready`, message: `Status is ${doc.status.replace(/-/g, ' ')}${useful ? '' : ' and content looks incomplete'}.`, severity: 'error', path: `foundation/${doc.fileName}`, action: 'Complete this Foundation document before creating delivery packages.' });
    } else {
      pushValidation(foundationSection, { id: `foundation-${doc.id}`, title: `${doc.title} optional`, message: `Status is ${doc.status.replace(/-/g, ' ')}.`, severity: 'info', path: `foundation/${doc.fileName}` });
    }
  }

  const standardsPath = path.join(projectPath, 'foundation', 'standards', 'index.md');
  if (await exists(standardsPath)) {
    const standards = parseFrontmatter(await fsp.readFile(standardsPath, 'utf8'));
    const useful = bodyLooksUseful(standards.body);
    pushValidation(foundationSection, {
      id: 'standards',
      title: standards.status === 'complete' && useful ? 'Standards complete' : 'Standards not ready',
      message: standards.status === 'complete' && useful ? 'Project standards are complete.' : `Status is ${standards.status.replace(/-/g, ' ')}${useful ? '' : ' and content looks incomplete'}.`,
      severity: standards.status === 'complete' && useful ? 'success' : 'error',
      path: 'foundation/standards/index.md',
      action: standards.status === 'complete' && useful ? undefined : 'Complete Standards before creating delivery packages.'
    });
  } else {
    pushValidation(foundationSection, { id: 'standards-missing', title: 'Standards file missing', message: 'foundation/standards/index.md does not exist.', severity: 'error', action: 'Define Standards in the Foundation workflow.' });
  }

  const deliveryPlanningPath = path.join(projectPath, 'foundation', 'delivery-planning', 'index.md');
  if (await exists(deliveryPlanningPath)) {
    const deliveryPlanning = parseFrontmatter(await fsp.readFile(deliveryPlanningPath, 'utf8'));
    pushValidation(foundationSection, {
      id: 'delivery-planning',
      title: deliveryPlanning.status === 'complete' ? 'Delivery planning profile complete' : 'Delivery planning profile is not complete',
      message: `Status is ${deliveryPlanning.status.replace(/-/g, ' ')}.`,
      severity: deliveryPlanning.status === 'complete' ? 'success' : 'warning',
      path: 'foundation/delivery-planning/index.md'
    });
  } else {
    pushValidation(foundationSection, { id: 'delivery-planning-missing', title: 'Delivery planning profile not configured', message: 'Delivery planning will define how capabilities are broken down, implemented, tested, and reviewed.', severity: 'warning', action: 'Add Delivery Planning to Foundation after Standards.' });
  }

  const components = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));
  const capabilities = (await readEntities(projectPath, 'capabilities', 'capability.json')).map((cap: any) => ({ ...cap, components: cap.components || cap.modules || [] }));
  const componentSlugs = new Set(components.map((component: any) => component.slug));

  if (!capabilities.length) {
    pushValidation(modelSection, { id: 'no-capabilities', title: 'No capabilities defined', message: 'At least one capability is needed before delivery packages can be planned.', severity: 'warning', action: 'Create a capability.' });
  }
  if (!components.length) {
    pushValidation(modelSection, { id: 'no-components', title: 'No components defined', message: 'Components help map capabilities to the system parts and source code they touch.', severity: 'warning', action: 'Create or link a component.' });
  }

  for (const capability of capabilities) {
    const linkedComponents = Array.isArray(capability.components) ? capability.components : [];
    const missing = linkedComponents.filter((slug: string) => !componentSlugs.has(slug));
    if (missing.length) {
      pushValidation(modelSection, { id: `capability-${capability.slug}-missing-components`, title: `${capability.title} has missing component links`, message: `Missing components: ${missing.join(', ')}`, severity: 'error', path: `capabilities/${capability.slug}/capability.json`, action: 'Fix the component mappings for this capability.' });
    } else if (!linkedComponents.length) {
      pushValidation(modelSection, { id: `capability-${capability.slug}-no-components`, title: `${capability.title} has no components linked`, message: 'This is allowed early, but delivery planning is stronger when the touched components are known.', severity: 'warning', path: `capabilities/${capability.slug}/capability.json` });
    } else {
      pushValidation(modelSection, { id: `capability-${capability.slug}-components`, title: `${capability.title} has component mappings`, message: `${linkedComponents.length} component${linkedComponents.length === 1 ? '' : 's'} linked.`, severity: 'success', path: `capabilities/${capability.slug}/capability.json` });
    }
  }

  const sourceProjects = await readSourceProjects(projectPath);
  const sourceIds = new Set(sourceProjects.map((project) => project.id));
  if (!sourceProjects.length) {
    pushValidation(sourceSection, { id: 'no-source-projects', title: 'No source code projects referenced', message: 'Source references are needed if AI will review source code against a capability.', severity: 'warning', action: 'Add at least one Source Code project.' });
  }
  for (const sourceProject of sourceProjects) {
    const pathExists = await exists(sourceProject.path);
    pushValidation(sourceSection, {
      id: `source-${sourceProject.id}`,
      title: pathExists ? `${sourceProject.name} is reachable` : `${sourceProject.name} path is missing`,
      message: pathExists ? `${sourceProject.detectedType} · ${sourceProject.path}` : `Could not access ${sourceProject.path}`,
      severity: pathExists ? 'success' : 'error',
      path: `source-code/projects/${sourceProject.id}/source-project.json`,
      action: pathExists ? undefined : 'Update or remove this source reference.'
    });
    if (sourceProject.detectedType.startsWith('Unknown')) {
      pushValidation(sourceSection, { id: `source-${sourceProject.id}-unknown`, title: `${sourceProject.name} type could not be identified`, message: 'The source scanner did not find strong project indicators.', severity: 'warning', path: `source-code/projects/${sourceProject.id}/source-project.json` });
    }
  }
  for (const component of components) {
    const mappedSources = Array.isArray(component.sourceProjects) ? component.sourceProjects : [];
    const missing = mappedSources.filter((id: string) => !sourceIds.has(id));
    if (missing.length) {
      pushValidation(sourceSection, { id: `component-${component.slug}-missing-source`, title: `${component.title} has missing source mappings`, message: `Missing source projects: ${missing.join(', ')}`, severity: 'error', path: `components/${component.slug}/component.json` });
    } else if (!mappedSources.length) {
      pushValidation(sourceSection, { id: `component-${component.slug}-no-source`, title: `${component.title} has no source project mapped`, message: 'This is fine for conceptual components, but source-backed components should be mapped.', severity: 'info', path: `components/${component.slug}/component.json` });
    }
  }

  const deliveryPackages = await readEntities(projectPath, 'delivery/packages', 'package.json');
  if (!deliveryPackages.length) {
    pushValidation(deliverySection, { id: 'no-delivery-packages', title: 'No delivery packages created yet', message: 'Delivery packages can be created once Foundation and Standards are complete.', severity: 'info' });
  }
  for (const pkg of deliveryPackages) {
    const pkgDir = path.join(projectPath, 'delivery', 'packages', pkg.id);
    const snapshotExists = await exists(path.join(pkgDir, 'snapshot.md'));
    const strategyExists = await exists(path.join(pkgDir, 'implementation-strategy.md'));
    if (snapshotExists && strategyExists) {
      pushValidation(deliverySection, { id: `package-${pkg.id}`, title: `${pkg.id} files are present`, message: 'Snapshot and implementation strategy files exist.', severity: 'success', path: `delivery/packages/${pkg.id}` });
    } else {
      pushValidation(deliverySection, { id: `package-${pkg.id}-missing-files`, title: `${pkg.id} is missing required files`, message: `${snapshotExists ? '' : 'snapshot.md missing. '}${strategyExists ? '' : 'implementation-strategy.md missing.'}`.trim(), severity: 'error', path: `delivery/packages/${pkg.id}`, action: 'Repair or recreate this delivery package.' });
    }
  }

  const sections = [structure, templateSection, frontmatterSection, foundationSection, modelSection, sourceSection, deliverySection];
  const items = sections.flatMap((section) => section.items);
  const summary = {
    total: items.length,
    errors: items.filter((item) => item.severity === 'error').length,
    warnings: items.filter((item) => item.severity === 'warning').length,
    info: items.filter((item) => item.severity === 'info').length,
    success: items.filter((item) => item.severity === 'success').length
  };
  const blockingIds = new Set(['git-missing', 'standards', 'standards-missing']);
  const foundationErrors = foundationSection.items.filter((item) => item.severity === 'error').length;
  const canCreateDeliveryPackage = foundationErrors === 0 && !(structure.items.some((item) => item.severity === 'error' && blockingIds.has(item.id)));
  const score = summary.total ? Math.max(0, Math.round(((summary.success + summary.info * 0.5) / summary.total) * 100)) : 0;
  const nextActions = items
    .filter((item) => item.severity === 'error' || item.severity === 'warning')
    .map((item) => item.action || item.title)
    .filter((value, index, array) => value && array.indexOf(value) === index)
    .slice(0, 5) as string[];

  return {
    generatedAt: new Date().toISOString(),
    status: summary.errors ? 'fail' : summary.warnings ? 'warning' : 'pass',
    score,
    canCreateDeliveryPackage,
    summary,
    sections,
    nextActions
  };
}


interface ProjectRepairReport {
  generatedAt: string;
  changed: boolean;
  changes: string[];
  warnings: string[];
  validation: ProjectValidationReport;
}

function hasWorkflowFrontmatter(content: string) {
  return content.startsWith('---\n') || content.startsWith('---\r\n');
}

function contentLooksComplete(content: string) {
  const stripped = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
  if (!stripped) return false;
  if (/TODO:/i.test(stripped)) return false;
  if (/^#\s+.+\n\s*$/m.test(stripped) && stripped.split(/\r?\n/).length <= 3) return false;
  return true;
}

function buildWorkflowMarkdown(type: string, id: string, title: string, status: SetupStepStatus, body: string, required = true) {
  return `---\naidd:\n  type: ${type}\n  id: ${id}\n  title: ${title}\n  status: ${status}\n  required: ${required}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${body.trim()}\n`;
}

async function repairProject(projectPath: string): Promise<ProjectRepairReport> {
  if (!projectPath || !(await exists(projectPath))) throw new Error(`Project path does not exist: ${projectPath}`);
  const changes: string[] = [];
  const warnings: string[] = [];
  const rel = (target: string) => path.relative(projectPath, target).split('\\').join('/');

  async function ensureDir(relativePath: string) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) {
      await fsp.mkdir(target, { recursive: true });
      changes.push(`Created directory ${relativePath}`);
    }
  }

  async function writeRepairFile(relativePath: string, content: string) {
    const target = path.join(projectPath, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, 'utf8');
    changes.push(`Wrote ${relativePath}`);
  }

  async function migrateFolder(oldRelative: string, newRelative: string) {
    const oldPath = path.join(projectPath, oldRelative);
    const newPath = path.join(projectPath, newRelative);
    if ((await exists(oldPath)) && !(await exists(newPath))) {
      await fsp.mkdir(path.dirname(newPath), { recursive: true });
      await fsp.rename(oldPath, newPath);
      changes.push(`Renamed ${oldRelative} to ${newRelative}`);
    }
  }

  async function ensureJson(relativePath: string, fallback: unknown) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) {
      await writeRepairFile(relativePath, JSON.stringify(fallback, null, 2) + '\n');
      return;
    }
    try {
      JSON.parse(await fsp.readFile(target, 'utf8'));
    } catch {
      warnings.push(`${relativePath} exists but is not valid JSON. It was left unchanged.`);
    }
  }

  async function ensureMarkdown(relativePath: string, type: string, id: string, title: string, body: string, required = true) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) {
      await writeRepairFile(relativePath, buildWorkflowMarkdown(type, id, title, 'draft', body, required));
      return;
    }
    const current = await fsp.readFile(target, 'utf8');
    if (!hasWorkflowFrontmatter(current)) {
      const status: SetupStepStatus = contentLooksComplete(current) ? 'complete' : 'draft';
      await writeRepairFile(relativePath, buildWorkflowMarkdown(type, id, title, status, current.trim() || body, required));
    }
  }

  async function archiveObsoleteFoundation(relativePath: string) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) return;
    const content = await fsp.readFile(target, 'utf8');
    const userContent = content.replace(/^---[\s\S]*?---\s*/m, '').replace(/^#.*$/m, '').trim();
    if (!userContent || /^TODO:/i.test(userContent)) {
      const archivePath = path.join(projectPath, '_archive', relativePath);
      await fsp.mkdir(path.dirname(archivePath), { recursive: true });
      await fsp.rename(target, archivePath);
      changes.push(`Archived obsolete empty file ${relativePath}`);
    } else {
      warnings.push(`${relativePath} is obsolete but contains content. Review it manually before archiving.`);
    }
  }

  await migrateFolder('common', 'foundation');
  await migrateFolder('modules', 'components');
  await migrateFolder('bundles', 'delivery/packages');

  for (const dir of ['foundation', 'foundation/standards', 'foundation/delivery-planning', 'capabilities', 'components', 'delivery', 'delivery/packages', 'source-code', 'source-code/projects', '.aidd']) {
    await ensureDir(dir);
  }

  await ensureJson('aidd.template.json', {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    repairedAt: new Date().toISOString(),
    project: { name: path.basename(projectPath), description: '' }
  });

  await ensureMarkdown(
    'foundation/02-product-definition.md',
    'foundation',
    'product-definition',
    'Product Definition',
    '# Product Definition\n\nDescribe what the system is, what it should make possible, and the product context every delivery package should inherit.'
  );

  await ensureMarkdown(
    'foundation/03-audience-and-users.md',
    'foundation',
    'audience-and-users',
    'Audience & Users',
    '# Audience and Users\n\nDescribe who uses the system, who maintains it, and what outcomes matter to them.'
  );

  await ensureMarkdown(
    'foundation/04-goals-and-success-metrics.md',
    'foundation',
    'goals-and-success-metrics',
    'Goals & Success Metrics',
    '# Goals & Success Metrics\n\nDescribe the measurable goals, outcomes, or success signals this project should optimise for.'
  );

  await ensureMarkdown(
    'foundation/standards/index.md',
    'standards',
    'project-standards',
    'Project Standards',
    '# Project Standards\n\n## Software Types\n\n- TODO: Select the software types used by this project.\n\n## Design Standards\n\n- TODO: Select the software design standards that apply.\n\n## Coding, Testing, and Quality\n\n- TODO: Define coding style, testing expectations, and quality checks.'
  );

  await ensureMarkdown(
    'foundation/delivery-planning/index.md',
    'delivery-planning',
    'delivery-planning',
    'Delivery Planning',
    '# Delivery Planning\n\n## Breakdown Approach\n\nDefine how capabilities should be broken into delivery packages.\n\n## Source Code Review\n\nDefine how mapped source code should be reviewed before implementation planning.\n\n## Implementation Strategy\n\nDefine how implementation plans should be created.\n\n## Testing Strategy\n\nDefine how standards influence testing and verification.\n\n## AI Review Criteria\n\nDefine how AI output should be reviewed against source code, capabilities, components, and standards.\n\n## Required Evidence\n\nDefine what evidence is required before a delivery package can be accepted.'
  );

  await archiveObsoleteFoundation('foundation/01-project-overview.md');
  await archiveObsoleteFoundation('foundation/04-decisions.md');
  await archiveObsoleteFoundation('foundation/05-decision-ledger.md');
  await archiveObsoleteFoundation('foundation/06-delivery-rules.md');

  if (!(await exists(path.join(projectPath, '.git')))) {
    try {
      const identity = await readGitIdentity(app.getPath('userData'));

      if (!identity) {
        warnings.push('Could not initialise Git automatically because AIDD author identity has not been set.');
      } else {
        await initialiseGit(projectPath, path.basename(projectPath), identity);
        changes.push('Initialised local Git repository');
      }
    } catch (error) {
      warnings.push(`Could not initialise Git automatically: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const reportText = [
    '# AIDD Repair Report',
    '',
    `Project: ${projectPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Changes',
    '',
    ...(changes.length ? changes.map((item) => `- ${item}`) : ['- No changes required.']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ['- No warnings.']),
    ''
  ].join('\n');

  await fsp.mkdir(path.join(projectPath, '.aidd'), { recursive: true });
  await fsp.writeFile(path.join(projectPath, '.aidd', 'repair-report.md'), reportText, 'utf8');
  if (!changes.includes('Wrote .aidd/repair-report.md')) changes.push('Wrote .aidd/repair-report.md');

  return {
    generatedAt: new Date().toISOString(),
    changed: changes.length > 0,
    changes,
    warnings,
    validation: await validateProject(projectPath)
  };
}

async function refreshComponentsIndex(root: string) {
  const components = (await readEntities(root, 'components', 'component.json')).concat(await readEntities(root, 'modules', 'module.json'));
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((c: any) => ({ ...c, components: c.components || c.modules || [] }));
  const lines = [
    '# Components',
    '',
    'Components are the apps, plugins, modules, services, libraries, workflows, integrations, tools, data stores, or subsystems that help deliver capabilities.',
    '',
    '## Active components',
    '',
    components.length
      ? components.map((component) => `- [${component.title}](./${component.slug}/index.md)${caps.filter((c) => (c.components || []).includes(component.slug)).length ? ' — capabilities: ' + caps.filter((c) => (c.components || []).includes(component.slug)).map((c) => `[${c.title}](../capabilities/${c.slug}/index.md)`).join(', ') : ''}`).join('\n')
      : 'No active components yet.',
    '',
    '## Deprecated components',
    '',
    'No deprecated components.',
    '',
    '## Archived components',
    '',
    'No archived components.',
    ''
  ];
  await fsp.mkdir(path.join(root, 'components'), { recursive: true });
  await fsp.writeFile(path.join(root, 'components', 'index.md'), lines.join('\n'), 'utf8');
}

async function refreshCapabilitiesIndex(root: string) {
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((c: any) => ({ ...c, components: c.components || c.modules || [] }));
  const lines = [
    '# Capabilities',
    '',
    'Capabilities describe things the system can do. They are user-value focused and may touch one or many components.',
    '',
    '## Active capabilities',
    '',
    caps.length ? caps.map((c) => `- [${c.title}](./${c.slug}/index.md)${(c.components || []).length ? ' — components: ' + c.components.join(', ') : ''}`).join('\n') : 'No active capabilities yet.',
    '',
    '## Deprecated capabilities',
    '',
    'No deprecated capabilities.',
    '',
    '## Archived capabilities',
    '',
    'No archived capabilities.',
    ''
  ];
  await fsp.writeFile(path.join(root, 'capabilities', 'index.md'), lines.join('\n'), 'utf8');
}

const COMPONENT_TEMPLATE_SECTIONS = [
  {
    key: 'purpose',
    fileName: '01-purpose.md',
    title: 'Purpose',
    prompt: 'Define why this component exists and which outcomes it supports.',
    body: `## Purpose
TODO: Define why this component exists.

## Responsibilities

- TODO

## Outcomes Supported

- TODO

## Capabilities Supported

List capabilities this component helps deliver. Do not copy capability behaviour into this file.

- TODO`
  },
  {
    key: 'boundaries',
    fileName: '02-boundaries.md',
    title: 'Boundaries',
    prompt: 'Define ownership, consumers, exposed contracts, and forbidden coupling.',
    body: `## Owns

- TODO: List responsibilities, state, assets, or services this component owns.

## Does Not Own

- TODO: List responsibilities owned by other components or systems.

## May Depend On

- TODO: List allowed component or platform dependencies.

## May Be Used By

- TODO: List expected consumers.

## Exposes

- TODO: List public interfaces, events, data contracts, services, tools, or extension points.

## Forbidden Coupling

- TODO: List things implementations must not do across this boundary.

## Boundary Change Rules

Changing this component boundary requires a decision record when:

- a new component dependency is introduced
- ownership of runtime state moves between components
- another component starts writing component-owned state
- this component starts directly controlling another component's responsibilities
- a capability requires behaviour that does not fit the existing boundary`
  },
  {
    key: 'interfaces',
    fileName: '03-interfaces.md',
    title: 'Interfaces',
    prompt: 'Capture public and consumed contracts owned by this component.',
    body: `## Purpose

Define the public and consumed technical contracts for this component.

## Public Interfaces

- TODO: APIs, services, events, extension points, asset contracts, messages, commands, or UI/tooling entry points exposed by this component.

## Consumed Interfaces

- TODO: Interfaces this component consumes from other components or platform systems.

## Contract Rules

- TODO: Versioning, compatibility, validation, error behaviour, and ownership rules.

## Capability Relationship

Capabilities may require new or changed interfaces, but the interface definition belongs here when this component owns it.`
  },
  {
    key: 'data-and-state',
    fileName: '04-data-and-state.md',
    title: 'Data & State',
    prompt: 'Define owned data, state, validation rules, and persistence boundaries.',
    body: `## Purpose

Define data, state, persistence, and invariants owned by this component.

## Owned State

- TODO: Runtime state this component owns.

## Owned Data Assets / Documents

- TODO: Assets, files, records, schemas, tables, or documents this component owns.

## External Data Consumed

- TODO: Data read from other components or services.

## Data Not Owned

- TODO: Data this component must not write or treat as authoritative.

## Validation and Invariants

- TODO: Required validation, consistency rules, failure modes, and integrity checks.

## Persistence and Migration

- TODO: Persistence rules, migration rules, compatibility concerns, or versioning constraints.

## Capability Relationship

Capabilities can say what data is needed for behaviour. Ownership, schema shape, persistence, and invariants belong in this component file.`
  },
  {
    key: 'dependencies',
    fileName: '05-dependencies.md',
    title: 'Dependencies & Integrations',
    prompt: 'Define allowed dependencies, integrations, and dependency direction rules.',
    body: `## Purpose

Define allowed dependencies and integration points for this component.

## Allowed Dependencies

- TODO

## Forbidden Dependencies

- TODO

## Integrations

- TODO: Services, APIs, files, tools, engine systems, or other components this component integrates with.

## Required Dependency Direction

\`\`\`text
TODO: ComponentA -> ComponentB
\`\`\`

## Dependency Change Rule

Any new dependency or integration that crosses component, runtime/editor, product/platform, or generic/project-specific boundaries requires a decision record before implementation.`
  },
  {
    key: 'architecture',
    fileName: '06-architecture.md',
    title: 'Internal Design',
    prompt: 'Describe the component internal shape, flows, and failure model.',
    body: `## Purpose

Define the internal technical design of this component without turning the capability into architecture.

## Role in the System

TODO: Explain this component's role and where it fits.

## Main Areas

### Area 1

TODO

### Area 2

TODO

## Internal Flow

TODO: Describe important internal flows, lifecycle, ownership handoffs, or extension points.

## Failure Model

TODO: Describe expected failure handling, fallback behaviour, diagnostics, and recovery rules.

## Design Change Rule

Design changes that affect ownership, dependencies, state, or public interfaces require a component decision record and should be referenced by the delivery slice implementing the change.`
  },
  {
    key: 'standards',
    fileName: '07-standards.md',
    title: 'Quality Requirements',
    prompt: 'Define component-specific NFRs, quality attributes, testing expectations, and AI-agent rules.',
    body: `## Component Quality Attributes

- Performance:
- Reliability:
- Security:
- Accessibility:
- Observability:

## Testing and Verification Expectations

- TODO

## Documentation Expectations

- TODO

## Inherited Standards

Reference global standards from Foundation. Do not duplicate project-wide standards here unless this component has stricter requirements.

## AI Agent Rules

- Stay inside the delivery slice scope.
- Respect component boundaries and dependency direction.
- Do not move architecture, integrations, or data ownership into capability docs.
- Report missing component dependencies or boundary conflicts instead of silently introducing coupling.`
  },
  {
    key: 'risks',
    fileName: '08-risks.md',
    title: 'Risks',
    prompt: 'Capture component risks, unknowns, coupling risks, and operational concerns.',
    body: `## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns

- TODO

## Boundary / Coupling Risks

- TODO

## Operational Risks

- TODO`
  }
];

function normaliseComponentSections(inputSections?: ComponentSectionInput[], fallback?: Partial<Record<string, string>>) {
  const byKey = new Map<string, ComponentSectionInput>();
  for (const section of inputSections || []) {
    if (!section?.key) continue;
    byKey.set(section.key, section);
  }

  return COMPONENT_TEMPLATE_SECTIONS.map((template) => {
    const input = byKey.get(template.key);
    const body = input?.body ?? fallback?.[template.key] ?? template.body ?? '';
    return {
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: input?.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      prompt: template.prompt
    };
  });
}

function buildComponentSectionMarkdown(input: { slug: string; componentTitle: string; section: ReturnType<typeof normaliseComponentSections>[number]; status: string; sourceProjects: string[]; capabilities: string[] }) {
  const body = input.section.body?.trim() || input.section.prompt;
  return matter.stringify([
    `# ${input.componentTitle} ${input.section.title}`,
    '',
    body,
    ''
  ].join('\n'), {
    aidd: {
      type: 'component-section',
      id: `${input.slug}-${input.section.key}`,
      title: `${input.componentTitle} ${input.section.title}`,
      status: input.section.status || 'not-started',
      required: true,
      component: input.slug,
      section: input.section.key,
      sourceProjects: input.sourceProjects,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

function buildComponentIndexMarkdown(input: { slug: string; title: string; status: string; sourceProjects: string[]; capabilities: string[]; sections: ReturnType<typeof normaliseComponentSections> }) {
  return matter.stringify([
    `# ${input.title}`,
    '',
    'This component is managed by AIDD as a set of template-backed section files.',
    '',
    '## Sections',
    '',
    ...input.sections.map((section) => `- [${section.title}](./${section.fileName})`),
    '',
    '## Source Projects',
    '',
    input.sourceProjects.length ? input.sourceProjects.map((project) => `- ${project}`).join('\n') : 'No source projects linked yet.',
    '',
    '## Capabilities Supported',
    '',
    input.capabilities.length ? input.capabilities.map((capability) => `- ${capability}`).join('\n') : 'No capabilities linked yet.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'component',
      id: input.slug,
      title: input.title,
      status: input.status || 'draft',
      required: true,
      sourceProjects: input.sourceProjects,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

const CAPABILITY_TEMPLATE_SECTIONS = [
  {
    key: 'outcomes',
    fileName: '01-outcomes.md',
    title: 'Outcomes',
    prompt: 'Describe what this capability should make possible for users or the business.',
    body: `## Purpose
Describe the user or business outcome this capability must enable.

## Success Criteria
- [ ] The capability has a clear reason to exist.
- [ ] Success can be observed or measured.
- [ ] The expected behaviour is specific enough for delivery work.

## Notes
- Primary users:
- Main problem solved:
- Expected result:`
  },
  {
    key: 'scope',
    fileName: '02-scope.md',
    title: 'Scope',
    prompt: 'Define what is in scope and out of scope for this capability.',
    body: `## In Scope
- 

## Out of Scope
- 

## Assumptions
- 

## Boundaries
Describe where this capability starts and stops, especially where another capability or component takes over.`
  },
  {
    key: 'user-journeys',
    fileName: '03-user-journeys.md',
    title: 'User Journeys',
    prompt: 'Describe the user journeys or workflows this capability supports.',
    body: `## Primary Journey
1. The user starts by...
2. The system responds by...
3. The user completes the task when...

## Alternate Journeys
- 

## Error / Recovery Journeys
- `
  },
  {
    key: 'functional-requirements',
    fileName: '04-functional-requirements.md',
    title: 'Functional Requirements',
    prompt: 'List the required product behaviours and rules.',
    body: `## Required Behaviours
- [ ] The system shall...
- [ ] The user can...
- [ ] The capability prevents...

## Rules
- 

## Acceptance Notes
Describe the minimum product behaviour required before implementation can be accepted.`
  },
  {
    key: 'ux-ui',
    fileName: '05-ux-ui.md',
    title: 'UX/UI',
    prompt: 'Describe user-facing screens, feedback, inspection tools, or UX expectations.',
    body: `## User Interface
Describe screens, panels, controls, messages, empty states, and error states.

## User Feedback
- Success feedback:
- Failure feedback:
- Progress / loading feedback:

## Accessibility Notes
- `
  },
  {
    key: 'risks',
    fileName: '06-risks.md',
    title: 'Risks',
    prompt: 'Capture product risks, unknowns, edge cases, and failure modes.',
    body: `## Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns
- 

## Edge Cases
- `
  },
  {
    key: 'validation',
    fileName: '07-validation.md',
    title: 'Validation',
    prompt: 'Describe how this capability should be verified.',
    body: `## Verification Approach
Describe how this capability will be checked before it is considered ready.

## Acceptance Checks
- [ ] 
- [ ] 
- [ ] 

## Test Notes
- User checks:
- Regression risks:
- Evidence required:`
  }
];
const COMPONENT_LEGACY_SECTION_FILES: Record<string, string[]> = {
  dependencies: ['05-dependencies-and-integrations.md'],
  architecture: ['06-internal-design.md'],
  standards: ['07-quality-requirements.md']
};

const CAPABILITY_LEGACY_SECTION_FILES: Record<string, string[]> = {
  'ux-ui': ['09-ux-ui.md'],
  risks: ['10-risks.md'],
  validation: ['11-validation.md']
};

async function readSectionFromFirstExistingFile(dir: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    const filePath = path.join(dir, fileName);
    if (!(await exists(filePath))) continue;
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const sectionAidd = (parsed.data as any)?.aidd || {};
    const body = sectionBodyFromMarkdown(raw);
    return {
      body,
      status: sectionAidd.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus
    };
  }
  return null;
}

function normaliseCapabilitySections(inputSections?: CapabilitySectionInput[], fallback?: Partial<Record<string, string>>) {
  const byKey = new Map<string, CapabilitySectionInput>();
  for (const section of inputSections || []) {
    if (!section?.key) continue;
    byKey.set(section.key, section);
  }

  return CAPABILITY_TEMPLATE_SECTIONS.map((template) => {
    const input = byKey.get(template.key);
    const body = input?.body ?? fallback?.[template.key] ?? template.body ?? '';
    return {
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: input?.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      prompt: template.prompt
    };
  });
}

function buildCapabilitySectionMarkdown(input: { slug: string; capabilityTitle: string; section: ReturnType<typeof normaliseCapabilitySections>[number]; capabilityStatus: string; components: string[] }) {
  const body = input.section.body?.trim() || input.section.prompt;
  return matter.stringify([
    `# ${input.capabilityTitle} ${input.section.title}`,
    '',
    body,
    ''
  ].join('\n'), {
    aidd: {
      type: 'capability-section',
      id: `${input.slug}-${input.section.key}`,
      title: `${input.capabilityTitle} ${input.section.title}`,
      status: input.section.status || 'not-started',
      required: true,
      capability: input.slug,
      section: input.section.key,
      components: input.components,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

function buildCapabilityIndexMarkdown(input: { slug: string; title: string; status: string; components: string[]; sections: ReturnType<typeof normaliseCapabilitySections> }) {
  return matter.stringify([
    `# ${input.title}`,
    '',
    'This capability is managed by AIDD as a set of template-backed section files.',
    '',
    '## Sections',
    '',
    ...input.sections.map((section) => `- [${section.title}](./${section.fileName})`),
    '',
    '## Components Touched',
    '',
    input.components.length ? input.components.map((component) => `- ${component}`).join('\n') : 'No components linked yet.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'capability',
      id: input.slug,
      title: input.title,
      status: input.status || 'draft',
      required: true,
      components: input.components,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

function sectionBodyFromMarkdown(raw: string) {
  const parsed = matter(raw || '');
  return parsed.content.replace(/^# .*\n+/, '').replace(/^\s*\n/, '').trim();
}

function buildCapabilityOutcomeMarkdown(input: CreateCapabilityInput & { slug: string; title: string; components: string[] }) {
  const sections = [
    `# ${input.title}`,
    input.description?.trim() ? `## Description

${input.description.trim()}` : `## Description

Describe what this capability is and why it matters.`,
    input.outcome?.trim() ? `## Outcome

${input.outcome.trim()}` : `## Outcome

Describe what this capability should make possible.`,
    input.components.length ? `## Components Touched

${input.components.map((component) => `- ${component}`).join('\n')}` : `## Components Touched

No components linked yet.`,
    input.notes?.trim() ? `## Notes

${input.notes.trim()}` : `## Notes

Add useful constraints, open questions, or follow-up notes.`
  ];

  return `---
aidd:
  type: capability
  id: ${input.slug}
  title: ${input.title}
  status: ${input.status || 'draft'}
  required: true
  components:
${input.components.map((component) => `    - ${component}`).join('\n') || '    []'}
  templateVersion: ${TEMPLATE_VERSION}
  updatedAt: ${new Date().toISOString()}
---

${sections.join('\n\n')}
`;
}

function buildCapabilityBehaviourMarkdown(input: { slug: string; title: string }) {
  return `---
aidd:
  type: capability
  id: ${input.slug}-behaviour
  title: ${input.title} Behaviour Examples
  status: not-started
  required: false
  templateVersion: ${TEMPLATE_VERSION}
  updatedAt: ${new Date().toISOString()}
---

# Behaviour Examples

Add behaviour examples later when the capability needs clearer acceptance scenarios.
`;
}

async function readComponentCapabilities(root: string, slug: string) {
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((capability: any) => ({
    ...capability,
    components: Array.isArray(capability.components) ? capability.components : Array.isArray(capability.modules) ? capability.modules : []
  }));
  return caps.filter((capability: any) => capability.components.includes(slug)).map((capability: any) => String(capability.slug || capability.id)).filter(Boolean);
}

async function createComponent(root: string, title: string, description?: string, status: string = 'draft', sourceProjects: string[] = [], sectionsInput?: ComponentSectionInput[]) {
  const slug = slugify(title);
  const dir = path.join(root, 'components', slug);
  if (await exists(dir)) return slug;

  const linkedCapabilities: string[] = [];
  const sourceProjectIds = Array.from(new Set(sourceProjects));
  const fallback: Partial<Record<string, string>> = { purpose: description || '' };
  const sections = normaliseComponentSections(sectionsInput, fallback);

  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'component.json'), {
    slug,
    title,
    kind: 'component',
    status,
    lifecycle: status,
    sourceProjects: sourceProjectIds,
    createdAt: new Date().toISOString(),
    supportsCapabilities: linkedCapabilities,
    capabilitiesSupported: linkedCapabilities,
    dependsOn: [],
    exposes: [],
    dataOwned: [],
    template: {
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(path.join(dir, 'index.md'), buildComponentIndexMarkdown({ slug, title, status, sourceProjects: sourceProjectIds, capabilities: linkedCapabilities, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildComponentSectionMarkdown({ slug, componentTitle: title, section, status, sourceProjects: sourceProjectIds, capabilities: linkedCapabilities }), 'utf8');
  }
  await refreshComponentsIndex(root);
  return slug;
}


async function readComponent(input: ReadComponentInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  const markdownPath = path.join(dir, 'index.md');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const rawIndex = await exists(markdownPath) ? await fsp.readFile(markdownPath, 'utf8') : '';
  const parsedIndex = matter(rawIndex);
  const aidd = (parsedIndex.data as any)?.aidd || {};
  const title = String(manifest.title || aidd.title || slug);
  const status = String(manifest.status || manifest.lifecycle || aidd.status || 'draft');
  const sourceProjects = Array.isArray(manifest.sourceProjects)
    ? manifest.sourceProjects
    : Array.isArray(aidd.sourceProjects)
      ? aidd.sourceProjects
      : [];
  const capabilities: string[] = Array.from(new Set<string>([
    ...(Array.isArray(manifest.supportsCapabilities) ? manifest.supportsCapabilities.map(String) : []),
    ...(Array.isArray(manifest.capabilitiesSupported) ? manifest.capabilitiesSupported.map(String) : []),
    ...(Array.isArray(aidd.capabilitiesSupported) ? aidd.capabilitiesSupported.map(String) : []),
    ...(await readComponentCapabilities(input.projectPath, slug))
  ].filter(Boolean)));

  const fallbackFromLegacyIndex: Partial<Record<string, string>> = {
    purpose: sectionBodyFromMarkdown(rawIndex)
  };

  const sections = [];
  for (const template of COMPONENT_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    let body = fallbackFromLegacyIndex[template.key] || '';
    let sectionStatus: SetupStepStatus = body.trim() ? 'draft' : 'not-started';
    if (await exists(filePath)) {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const sectionAidd = (parsed.data as any)?.aidd || {};
      body = sectionBodyFromMarkdown(raw);
      sectionStatus = sectionAidd.status || (body.trim() ? 'draft' : 'not-started');
    } else {
      const legacySection = await readSectionFromFirstExistingFile(dir, COMPONENT_LEGACY_SECTION_FILES[template.key] || []);
      if (legacySection) {
        body = legacySection.body;
        sectionStatus = legacySection.status;
      } else if (!body.trim()) {
        body = template.body;
        sectionStatus = 'draft';
      }
    }
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: sectionStatus,
      prompt: template.prompt
    });
  }

  return {
    slug,
    title,
    status,
    sourceProjects,
    capabilities,
    sections,
    description: sections.find((section) => section.key === 'purpose')?.body || parsedIndex.content.replace(/^\s*\n/, ''),
    filePath: markdownPath
  };
}

async function updateComponent(input: UpdateComponentInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  const markdownPath = path.join(dir, 'index.md');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const rawIndex = await exists(markdownPath) ? await fsp.readFile(markdownPath, 'utf8') : '';
  const title = input.title.trim() || manifest.title || slug;
  const status = input.status || manifest.status || manifest.lifecycle || 'draft';
  const sourceProjectSource = Array.isArray(input.sourceProjects)
    ? input.sourceProjects
    : Array.isArray(manifest.sourceProjects)
      ? manifest.sourceProjects
      : [];
  const sourceProjects: string[] = Array.from(new Set<string>(sourceProjectSource.map(String)));
  const capabilities: string[] = Array.from(new Set<string>([
    ...(Array.isArray(input.capabilities) ? input.capabilities.map(String) : []),
    ...(Array.isArray(manifest.supportsCapabilities) ? manifest.supportsCapabilities.map(String) : []),
    ...(Array.isArray(manifest.capabilitiesSupported) ? manifest.capabilitiesSupported.map(String) : []),
    ...(await readComponentCapabilities(input.projectPath, slug))
  ].filter(Boolean)));
  const fallback: Partial<Record<string, string>> = {
    purpose: input.description || sectionBodyFromMarkdown(rawIndex)
  };
  const sections = normaliseComponentSections(input.sections, fallback);

  await writeJson(manifestPath, {
    ...manifest,
    slug,
    title,
    kind: manifest.kind || 'component',
    status,
    lifecycle: status,
    sourceProjects,
    supportsCapabilities: capabilities,
    capabilitiesSupported: capabilities,
    updatedAt: new Date().toISOString(),
    template: {
      ...(manifest.template || {}),
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(markdownPath, buildComponentIndexMarkdown({ slug, title, status, sourceProjects, capabilities, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildComponentSectionMarkdown({ slug, componentTitle: title, section, status, sourceProjects, capabilities }), 'utf8');
  }
  await refreshComponentsIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}

async function createCapability(root: string, input: CreateCapabilityInput) {
  const title = input.title.trim();
  const slug = slugify(title);
  const componentSlugs: string[] = Array.from(new Set<string>(input.componentSlugs || []));

  if (input.inlineComponent?.title?.trim()) {
    const created = await createComponent(root, input.inlineComponent.title.trim(), input.inlineComponent.description);
    if (!componentSlugs.includes(created)) componentSlugs.push(created);
  }

  const dir = path.join(root, 'capabilities', slug);
  if (await exists(dir)) return slug;

  const fallback: Partial<Record<string, string>> = {
    outcomes: input.outcome || input.description || '',
    scope: '',
    'user-journeys': '',
    'functional-requirements': '',
    'ux-ui': '',
    risks: input.notes || '',
    validation: ''
  };
  const sections = normaliseCapabilitySections(input.sections, fallback);
  const status = input.status || 'draft';

  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'capability.json'), {
    slug,
    title,
    status,
    components: componentSlugs,
    createdAt: new Date().toISOString(),
    template: {
      id: TEMPLATE_ID,
      version: TEMPLATE_VERSION,
      sectionFiles: sections.map((section) => section.fileName)
    }
  });

  await fsp.writeFile(path.join(dir, 'index.md'), buildCapabilityIndexMarkdown({ slug, title, status, components: componentSlugs, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildCapabilitySectionMarkdown({ slug, capabilityTitle: title, section, capabilityStatus: status, components: componentSlugs }), 'utf8');
  }

  await refreshCapabilitiesIndex(root);
  await refreshComponentsIndex(root);
  return slug;
}

function extractSection(content: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : '';
}

async function readCapability(input: ReadCapabilityInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'capabilities', slug);
  const manifestPath = path.join(dir, 'capability.json');
  const markdownPath = path.join(dir, 'index.md');
  if (!(await exists(manifestPath))) throw new Error(`Capability not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const rawIndex = await exists(markdownPath) ? await fsp.readFile(markdownPath, 'utf8') : '';
  const parsedIndex = matter(rawIndex);
  const aidd = (parsedIndex.data as any)?.aidd || {};
  const title = String(manifest.title || aidd.title || slug);
  const components = Array.isArray(manifest.components) ? manifest.components : Array.isArray(manifest.modules) ? manifest.modules : (Array.isArray(aidd.components) ? aidd.components : []);
  const status = String(manifest.status || aidd.status || 'draft');

  const fallbackFromLegacyIndex: Partial<Record<string, string>> = {
    outcomes: extractSection(parsedIndex.content, 'Outcome') || extractSection(parsedIndex.content, 'Description'),
    risks: extractSection(parsedIndex.content, 'Notes')
  };

  const sections = [];
  for (const template of CAPABILITY_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    let body = fallbackFromLegacyIndex[template.key] || '';
    let sectionStatus: SetupStepStatus = body.trim() ? 'draft' : 'not-started';
    if (await exists(filePath)) {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const sectionAidd = (parsed.data as any)?.aidd || {};
      body = sectionBodyFromMarkdown(raw);
      sectionStatus = sectionAidd.status || (body.trim() ? 'draft' : 'not-started');
    } else {
      const legacySection = await readSectionFromFirstExistingFile(dir, CAPABILITY_LEGACY_SECTION_FILES[template.key] || []);
      if (legacySection) {
        body = legacySection.body;
        sectionStatus = legacySection.status;
      } else if (!body.trim()) {
        body = template.body;
        sectionStatus = 'draft';
      }
    }
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: sectionStatus,
      prompt: template.prompt
    });
  }

  return {
    slug,
    title,
    status,
    components,
    description: sections.find((section) => section.key === 'outcomes')?.body || '',
    outcome: sections.find((section) => section.key === 'outcomes')?.body || '',
    notes: sections.find((section) => section.key === 'risks')?.body || '',
    sections,
    body: parsedIndex.content.replace(/^\s*\n/, ''),
    filePath: markdownPath
  };
}

async function updateCapability(input: UpdateCapabilityInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'capabilities', slug);
  const manifestPath = path.join(dir, 'capability.json');
  if (!(await exists(manifestPath))) throw new Error(`Capability not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const title = input.title.trim() || manifest.title || slug;
  const components: string[] = Array.from(new Set<string>(input.componentSlugs || manifest.components || manifest.modules || []));
  const status = input.status || manifest.status || 'draft';
  const fallback: Partial<Record<string, string>> = {
    outcomes: input.outcome || input.description || '',
    risks: input.notes || ''
  };
  const sections = normaliseCapabilitySections(input.sections, fallback);

  await writeJson(manifestPath, {
    ...manifest,
    title,
    status,
    components,
    modules: undefined,
    updatedAt: new Date().toISOString(),
    template: {
      id: TEMPLATE_ID,
      version: TEMPLATE_VERSION,
      sectionFiles: sections.map((section) => section.fileName)
    }
  });

  await fsp.writeFile(path.join(dir, 'index.md'), buildCapabilityIndexMarkdown({ slug, title, status, components, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildCapabilitySectionMarkdown({ slug, capabilityTitle: title, section, capabilityStatus: status, components }), 'utf8');
  }

  await refreshCapabilitiesIndex(input.projectPath);
  await refreshComponentsIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}



async function assertProjectFoundationReady(projectPath: string) {
  const foundation = await readFoundationDocuments(projectPath);
  const incompleteFoundation = foundation.filter((doc) => doc.required !== false && doc.status !== 'complete');
  const standardsPath = path.join(projectPath, 'foundation', 'standards', 'index.md');
  const standardsStatus = await fileStatus(standardsPath);
  const blockers: string[] = [];
  for (const doc of incompleteFoundation) blockers.push(`${doc.title} is ${doc.status.replace(/-/g, ' ')}`);
  if (standardsStatus !== 'complete') blockers.push(`Project Standards are ${standardsStatus.replace(/-/g, ' ')}`);
  if (blockers.length) {
    throw new Error(`Project Foundation must be complete before creating a delivery package. Missing: ${blockers.join('; ')}`);
  }
  return { foundation, standardsPath };
}

async function buildProjectFoundationSnapshot(projectPath: string, foundation: FoundationDocument[], standardsPath: string) {
  const foundationSections = foundation.map((doc) => [
    `## ${doc.title}`,
    '',
    `- Status: ${doc.status}`,
    `- Source: foundation/${doc.fileName}`,
    '',
    doc.body.trim() || '_No content captured._'
  ].join('\n'));

  let standardsBody = '_No standards content captured._';
  if (await exists(standardsPath)) {
    standardsBody = parseFrontmatter(await fsp.readFile(standardsPath, 'utf8')).body.trim() || standardsBody;
  }

  return [
    '## Project Foundation Snapshot',
    '',
    'This section is captured because every delivery package must inherit the approved project foundation and standards.',
    '',
    ...foundationSections,
    '',
    '## Project Standards Snapshot',
    '',
    standardsBody
  ].join('\n');
}

async function createDeliveryPackageFromCapability(input: CreateDeliveryPackageFromCapabilityInput) {
  const { foundation, standardsPath } = await assertProjectFoundationReady(input.projectPath);
  const foundationSnapshot = await buildProjectFoundationSnapshot(input.projectPath, foundation, standardsPath);
  const capability = await readCapability({ projectPath: input.projectPath, slug: input.capabilitySlug });
  const existing = await readEntities(input.projectPath, 'delivery/packages', 'package.json');
  const nextNumber = existing.length + 1;
  const id = `DP-${String(nextNumber).padStart(3, '0')}-${slugify(capability.title)}`;
  const dir = path.join(input.projectPath, 'delivery', 'packages', id);
  if (await exists(dir)) throw new Error(`Delivery package already exists: ${id}`);
  await fsp.mkdir(dir, { recursive: true });

  const componentSnapshots: string[] = [];
  for (const componentSlug of capability.components || []) {
    const componentDir = path.join(input.projectPath, 'components', componentSlug);
    const manifestPath = path.join(componentDir, 'component.json');
    const indexPath = path.join(componentDir, 'index.md');
    if (await exists(manifestPath)) {
      const manifest = await readJson<any>(manifestPath);
      const content = await exists(indexPath) ? await fsp.readFile(indexPath, 'utf8') : '';
      componentSnapshots.push([
        `## Component: ${manifest.title || componentSlug}`,
        '',
        `- Slug: ${componentSlug}`,
        `- Status: ${manifest.status || manifest.lifecycle || 'draft'}`,
        '',
        content.trim()
      ].join('\n'));
    }
  }

  const snapshot = matter.stringify([
    `# Delivery Package Snapshot: ${capability.title}`,
    '',
    'This snapshot freezes the approved project foundation, capability, and component context at the point the delivery package was created.',
    '',
    foundationSnapshot,
    '',
    '## Capability Snapshot',
    '',
    Array.isArray((capability as any).sections) && (capability as any).sections.length
      ? (capability as any).sections.map((section: any) => [
          `### ${section.title}`,
          '',
          `- Source: capabilities/${capability.slug}/${section.fileName}`,
          `- Status: ${section.status || 'not-started'}`,
          '',
          section.body?.trim() || '_No content captured._'
        ].join('\n')).join('\n\n')
      : capability.body.trim(),
    '',
    '## Component Snapshots',
    '',
    componentSnapshots.length ? componentSnapshots.join('\n\n---\n\n') : 'No components were linked when this delivery package was created.',
    ''
  ].join('\n'), {
    aidd: { type: 'delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
    id,
    title: capability.title,
    sourceCapability: capability.slug,
    components: capability.components || [],
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  const strategy = matter.stringify([
    '# Implementation Strategy',
    '',
    'This file should be refined before AI implementation starts.',
    '',
    '## Objective',
    '',
    `Implement or refine the capability: ${capability.title}.`,
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the implementation approach after refinement.',
    '',
    '## Source Code Reference',
    '',
    'TODO: Link the relevant source directory, files, or components.',
    '',
    '## Risks / Unknowns',
    '',
    'TODO: Capture risks, assumptions, and open questions.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define how the implementation will be verified.',
    ''
  ].join('\n'), {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${id}-strategy`,
    deliveryPackage: id,
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  await writeJson(path.join(dir, 'package.json'), {
    id,
    title: capability.title,
    status: 'draft',
    sourceCapability: capability.slug,
    components: capability.components || [],
    createdAt: new Date().toISOString()
  });
  await fsp.writeFile(path.join(dir, 'snapshot.md'), snapshot, 'utf8');
  await fsp.writeFile(path.join(dir, 'implementation-strategy.md'), strategy, 'utf8');
  return { id, path: dir };
}

function deliveryStatusFromManifest(manifest: any, packaged: boolean, phaseCount: number): string {
  const raw = String(manifest.status || '').trim().toLowerCase();
  if (raw) return raw;
  if (manifest.acceptedAt || manifest.completedAt) return 'done';
  if (manifest.startedAt || manifest.inProgressAt) return 'in-progress';
  if (manifest.approvedAt) return 'approved';
  if (manifest.reviewRequestedAt || manifest.submittedAt) return 'review';
  if (packaged || phaseCount > 0) return 'review';
  return 'draft';
}

async function countPackagePhases(dir: string) {
  if (!(await exists(dir))) return 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /^phase-[\w-]+\.md$/i.test(entry.name)).length;
}

async function readDeliveryPackageSummariesFrom(root: string, relativeDir: string, manifestName: string): Promise<DeliveryPackageSummary[]> {
  const dir = path.join(root, relativeDir);
  if (!(await exists(dir))) return [];
  const items: DeliveryPackageSummary[] = [];

  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const packageDir = path.join(dir, entry.name);
    const manifestPath = path.join(packageDir, manifestName);
    if (!(await exists(manifestPath))) continue;

    const manifest = await readJson<any>(manifestPath);
    const snapshotExists = await exists(path.join(packageDir, 'snapshot.md'));
    const strategyExists = await exists(path.join(packageDir, 'implementation-strategy.md'));
    const assembledExists = await exists(path.join(packageDir, 'delivery-package.md')) || await exists(path.join(packageDir, 'package.md'));
    const phaseCount = await countPackagePhases(packageDir);
    const packaged = Boolean(assembledExists || (snapshotExists && strategyExists));

    items.push({
      id: String(manifest.id || entry.name),
      title: String(manifest.title || manifest.name || entry.name),
      status: deliveryStatusFromManifest(manifest, packaged, phaseCount),
      sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
      components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
      createdAt: manifest.createdAt || manifest.updatedAt,
      packaged,
      phaseCount,
      priority: typeof manifest.priority === 'number' ? manifest.priority : undefined
    });
  }

  return items;
}

async function readDeliveryPackages(projectPath: string): Promise<DeliveryPackageSummary[]> {
  const packages = await readDeliveryPackageSummariesFrom(projectPath, 'delivery/packages', 'package.json');
  const bundles = await readDeliveryPackageSummariesFrom(projectPath, 'delivery/bundles', 'bundle.json');
  const seen = new Set<string>();
  return [...packages, ...bundles]
    .filter((item) => {
      const key = item.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const priority = (a.priority ?? 999) - (b.priority ?? 999);
      if (priority !== 0) return priority;
      return a.id.localeCompare(b.id);
    });
}


async function findDeliveryPackageTarget(projectPath: string, id: string) {
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new Error('Delivery package id is required.');

  const candidates = [
    { dir: path.join(projectPath, 'delivery', 'packages', cleanId), manifestName: 'package.json' },
    { dir: path.join(projectPath, 'delivery', 'bundles', cleanId), manifestName: 'bundle.json' }
  ];

  const projectRoot = path.resolve(projectPath);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.dir);
    if (!resolved.startsWith(projectRoot + path.sep)) continue;
    if (await exists(path.join(candidate.dir, candidate.manifestName))) return candidate;
  }

  throw new Error(`Delivery package not found: ${cleanId}`);
}

async function readMarkdownBody(filePath: string) {
  if (!(await exists(filePath))) return '';
  const parsed = matter(await fsp.readFile(filePath, 'utf8'));
  return parsed.content.trim();
}

async function writeMarkdownBody(filePath: string, body: string, fallbackData: Record<string, unknown> = {}) {
  let data = fallbackData;
  if (await exists(filePath)) {
    data = { ...fallbackData, ...matter(await fsp.readFile(filePath, 'utf8')).data };
  }
  await fsp.writeFile(filePath, matter.stringify((body || '').trim() + '\n', data), 'utf8');
}

function phaseIdFromFileName(fileName: string) {
  return fileName.replace(/\.md$/i, '');
}


async function listDeliveryPackageFiles(packageDir: string): Promise<DeliveryPackageFileDetail[]> {
  const files: DeliveryPackageFileDetail[] = [];

  async function walk(currentDir: string, relativeDir = '') {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name).replace(/\\/g, '/') : entry.name;
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        files.push({
          name: entry.name,
          relativePath,
          kind: 'directory',
          editable: false
        });
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = await fsp.stat(absolutePath);
      const extension = path.extname(entry.name).toLowerCase();
      files.push({
        name: entry.name,
        relativePath,
        kind: 'file',
        sizeBytes: stat.size,
        extension,
        editable: extension === '.md'
      });
    }
  }

  await walk(packageDir);
  return files;
}

async function readDeliveryPackage(input: { projectPath: string; id: string }): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.id);
  const manifestPath = path.join(target.dir, target.manifestName);
  const manifest = await readJson<any>(manifestPath);
  const summary = (await readDeliveryPackages(input.projectPath)).find((item) => item.id === String(manifest.id || input.id)) || {
    id: String(manifest.id || input.id),
    title: String(manifest.title || manifest.name || input.id),
    status: String(manifest.status || 'draft'),
    sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
    components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
    createdAt: manifest.createdAt || manifest.updatedAt,
    packaged: false,
    phaseCount: 0
  };

  const entries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phases: DeliveryPackagePhaseDetail[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^phase-[\w-]+\.md$/i.test(entry.name)) continue;
    const filePath = path.join(target.dir, entry.name);
    const parsed = matter(await fsp.readFile(filePath, 'utf8'));
    phases.push({
      id: String(parsed.data.id || phaseIdFromFileName(entry.name)),
      title: String(parsed.data.title || phaseIdFromFileName(entry.name).replace(/^phase-/, '').replace(/-/g, ' ')),
      status: String(parsed.data.status || 'draft'),
      fileName: entry.name,
      body: parsed.content.trim()
    });
  }
  phases.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

  return {
    ...summary,
    packagePath: target.dir,
    snapshotBody: await readMarkdownBody(path.join(target.dir, 'snapshot.md')),
    strategyBody: await readMarkdownBody(path.join(target.dir, 'implementation-strategy.md')),
    packagedBody: await readMarkdownBody(path.join(target.dir, 'delivery-package.md')) || await readMarkdownBody(path.join(target.dir, 'package.md')),
    phases,
    files: await listDeliveryPackageFiles(target.dir)
  };
}

async function saveDeliveryPackage(input: SaveDeliveryPackageInput): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.id);
  const manifestPath = path.join(target.dir, target.manifestName);
  const manifest = await readJson<any>(manifestPath);

  if (typeof input.status === 'string') manifest.status = input.status;
  if (typeof input.title === 'string') manifest.title = input.title;
  manifest.updatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  if (typeof input.snapshotBody === 'string') {
    await writeMarkdownBody(path.join(target.dir, 'snapshot.md'), input.snapshotBody, {
      aidd: { type: 'delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
      id: input.id,
      title: manifest.title,
      status: manifest.status
    });
  }

  if (typeof input.strategyBody === 'string') {
    await writeMarkdownBody(path.join(target.dir, 'implementation-strategy.md'), input.strategyBody, {
      aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
      id: `${input.id}-strategy`,
      deliveryPackage: input.id,
      status: manifest.status || 'draft'
    });
  }

  if (Array.isArray(input.phases)) {
    const existingEntries = await fsp.readdir(target.dir, { withFileTypes: true });
    for (const entry of existingEntries) {
      if (entry.isFile() && /^phase-[\w-]+\.md$/i.test(entry.name)) {
        await fsp.rm(path.join(target.dir, entry.name), { force: true });
      }
    }

    for (const [index, phase] of input.phases.entries()) {
      const title = phase.title?.trim() || `Phase ${index + 1}`;
      const safeFileName = `phase-${String(index + 1).padStart(2, '0')}-${slugify(title)}.md`;
      await writeMarkdownBody(path.join(target.dir, safeFileName), phase.body || '', {
        aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
        id: phaseIdFromFileName(safeFileName),
        title,
        status: phase.status || 'packaging',
        deliveryPackage: input.id,
        order: index + 1
      });
    }
  }

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.id });
}

async function createDeliveryPackagePhase(input: CreateDeliveryPackagePhaseInput): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.packageId);
  const title = input.title.trim() || 'Implementation Phase';
  const entries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phaseNumber = entries.filter((entry) => entry.isFile() && /^phase-[\w-]+\.md$/i.test(entry.name)).length + 1;
  const fileName = `phase-${String(phaseNumber).padStart(2, '0')}-${slugify(title)}.md`;
  const body = input.body?.trim() || [
    `# ${title}`,
    '',
    '## Goal',
    '',
    'Describe the outcome this phase should deliver.',
    '',
    '## Implementation Steps',
    '',
    '- TODO: Add implementation steps.',
    '',
    '## Files / Components',
    '',
    '- TODO: List files, components, or areas touched.',
    '',
    '## Verification',
    '',
    '- TODO: Define how this phase will be checked.',
    ''
  ].join('\n');

  await writeMarkdownBody(path.join(target.dir, fileName), body, {
    aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
    id: phaseIdFromFileName(fileName),
    title,
    status: 'packaging',
    deliveryPackage: input.packageId,
    createdAt: new Date().toISOString()
  });

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
}

async function assembleDeliveryPackage(input: { projectPath: string; packageId: string }): Promise<DeliveryPackageDetail> {
  const detail = await readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
  const body = [
    `# ${detail.id} ${detail.title}`,
    '',
    `Status: ${detail.status}`,
    '',
    '> This package is the implementation instruction set for the AI agent. Project snapshot/context is used to refine the strategy, but is intentionally excluded from this assembled handoff to reduce token load.',
    '',
    '## Implementation Strategy',
    '',
    detail.strategyBody || '_No implementation strategy content._',
    '',
    '## Implementation Phases',
    '',
    detail.phases.length
      ? detail.phases.map((phase, index) => [`### Phase ${index + 1}: ${phase.title}`, '', phase.body || '_No phase content._'].join('\n')).join('\n\n')
      : '_No implementation phases have been created._',
    ''
  ].join('\n');

  const target = await findDeliveryPackageTarget(input.projectPath, input.packageId);
  await writeMarkdownBody(path.join(target.dir, 'delivery-package.md'), body, {
    aidd: { type: 'assembled-delivery-package', templateVersion: TEMPLATE_VERSION },
    id: `${input.packageId}-assembled`,
    deliveryPackage: input.packageId,
    status: detail.status,
    includes: ['implementation-strategy', 'implementation-phases'],
    excludes: ['project-snapshot'],
    updatedAt: new Date().toISOString()
  });

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
}

async function deleteDeliveryPackage(input: DeleteDeliveryPackageInput) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('Delivery package id is required.');

  const candidates = [
    path.join(input.projectPath, 'delivery', 'packages', id),
    path.join(input.projectPath, 'delivery', 'bundles', id)
  ];

  const projectRoot = path.resolve(input.projectPath);
  const target = candidates.find((candidate) => {
    const resolved = path.resolve(candidate);
    return resolved.startsWith(projectRoot + path.sep) && fs.existsSync(resolved);
  });

  if (!target) throw new Error(`Delivery package not found: ${id}`);
  await fsp.rm(target, { recursive: true, force: true });
  return readDeliveryPackages(input.projectPath);
}

function detectSourceType(entries: string[]) {
  const names = new Set(entries.map((item) => item.toLowerCase()));
  const indicators: string[] = [];
  let detectedType = 'Unknown / mixed source project';
  if (names.has('package.json')) { indicators.push('package.json'); detectedType = 'JavaScript / TypeScript'; }
  if (names.has('vite.config.ts') || names.has('vite.config.js')) indicators.push('Vite');
  if (names.has('pom.xml')) { indicators.push('pom.xml'); detectedType = 'Java / Maven'; }
  if (names.has('build.gradle') || names.has('build.gradle.kts')) { indicators.push('Gradle'); detectedType = 'Java / JVM'; }
  if (entries.some((item) => item.toLowerCase().endsWith('.sln') || item.toLowerCase().endsWith('.csproj'))) { indicators.push('.sln/.csproj'); detectedType = 'C# / .NET'; }
  if (entries.some((item) => item.toLowerCase().endsWith('.uproject'))) { indicators.push('.uproject'); detectedType = 'Unreal Engine'; }
  if (names.has('pyproject.toml') || names.has('setup.py')) { indicators.push('pyproject/setup.py'); detectedType = 'Python'; }
  if (names.has('cargo.toml')) { indicators.push('Cargo.toml'); detectedType = 'Rust'; }
  return { detectedType, indicators };
}

async function readSourceProjects(projectPath: string): Promise<SourceCodeProject[]> {
  const projectsDir = path.join(projectPath, 'source-code', 'projects');
  if (!(await exists(projectsDir))) {
    const legacy = await readSourceReference(projectPath);
    return legacy ? [{
      id: slugify(path.basename(legacy.path) || 'source-project'),
      name: path.basename(legacy.path) || 'Source Project',
      path: legacy.path,
      detectedType: legacy.detectedType,
      indicators: legacy.indicators || [],
      createdAt: legacy.updatedAt || new Date().toISOString(),
      updatedAt: legacy.updatedAt || new Date().toISOString()
    }] : [];
  }
  const projects: SourceCodeProject[] = [];
  for (const entry of await fsp.readdir(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(projectsDir, entry.name, 'source-project.json');
    if (await exists(manifestPath)) projects.push(await readJson<SourceCodeProject>(manifestPath));
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function readSourceReference(projectPath: string) {
  const referencePath = path.join(projectPath, 'source-code', 'reference.json');
  if (!(await exists(referencePath))) return null;
  return readJson<any>(referencePath);
}

async function writeSourceProject(projectPath: string, sourcePath: string) {
  const entries = await fsp.readdir(sourcePath);
  const detected = detectSourceType(entries);
  const now = new Date().toISOString();
  const name = path.basename(sourcePath) || 'Source Project';
  const id = slugify(name);
  const sourceProject: SourceCodeProject = { id, name, path: sourcePath, ...detected, createdAt: now, updatedAt: now };
  const dir = path.join(projectPath, 'source-code', 'projects', id);
  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'source-project.json'), sourceProject);
  await fsp.writeFile(path.join(dir, 'index.md'), matter.stringify([
    `# ${name}`,
    '',
    `Directory: ${sourcePath}`,
    '',
    `Detected type: ${sourceProject.detectedType}`,
    '',
    '## Indicators',
    '',
    sourceProject.indicators.length ? sourceProject.indicators.map((item: string) => `- ${item}`).join('\n') : 'No strong indicators found.',
    '',
    '## Component Mapping',
    '',
    'Components can link to this source project from the Components screen.',
    ''
  ].join('\n'), {
    aidd: { type: 'source-code-project', templateVersion: TEMPLATE_VERSION },
    id,
    title: name,
    status: 'active',
    updatedAt: sourceProject.updatedAt
  }), 'utf8');
  await refreshSourceCodeIndex(projectPath);
  return sourceProject;
}

async function refreshSourceCodeIndex(projectPath: string) {
  const projects = await readSourceProjects(projectPath);
  const dir = path.join(projectPath, 'source-code');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'index.md'), matter.stringify([
    '# Source Code Projects',
    '',
    'These are implementation code locations referenced by this AIDD project. Code is not copied into AIDD; only the reference is tracked.',
    '',
    '## Projects',
    '',
    projects.length ? projects.map((project) => `- **${project.name}** — ${project.detectedType} — ${project.path}`).join('\n') : 'No source code projects have been added yet.',
    ''
  ].join('\n'), {
    aidd: { type: 'source-code-index', templateVersion: TEMPLATE_VERSION },
    status: projects.length ? 'active' : 'draft',
    updatedAt: new Date().toISOString()
  }), 'utf8');
}

async function writeSourceReference(projectPath: string, sourcePath: string) {
  return writeSourceProject(projectPath, sourcePath);
}


interface DecisionInput {
  projectPath: string;
  title: string;
  context?: string;
  decision?: string;
  consequences?: string;
  status?: string;
}

async function readDecisions(root: string) {
  const dir = path.join(root, 'decisions');
  if (!(await exists(dir))) return [] as Array<{ id: string; title: string; status: string; relativePath: string; body: string; createdAt?: string }>;
  const out: Array<{ id: string; title: string; status: string; relativePath: string; body: string; createdAt?: string }> = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md') continue;
    const full = path.join(dir, entry.name);
    const raw = await fsp.readFile(full, 'utf8');
    const parsed = matter(raw);
    out.push({
      id: String((parsed.data as any).id || entry.name.replace(/\.md$/, '')),
      title: String((parsed.data as any).title || entry.name.replace(/\.md$/, '')),
      status: String((parsed.data as any).status || 'proposed'),
      relativePath: path.relative(root, full).split('\\').join('/'),
      body: parsed.content.trim(),
      createdAt: (parsed.data as any).createdAt
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function refreshDecisionIndex(root: string) {
  const decisions = await readDecisions(root);
  await fsp.mkdir(path.join(root, 'decisions'), { recursive: true });
  const lines = [
    '# Decisions',
    '',
    'Decisions are managed as individual records. Do not put all decisions in one shared file.',
    '',
    '## Active decision records',
    '',
    decisions.length ? decisions.map((item) => `- [${item.id} · ${item.title}](./${path.basename(item.relativePath)}) — ${item.status}`).join('\n') : 'No decision records yet.',
    ''
  ];
  await fsp.writeFile(path.join(root, 'decisions', 'index.md'), lines.join('\n'), 'utf8');
}

async function createDecisionRecord(input: DecisionInput) {
  if (!input.title.trim()) throw new Error('Decision title is required.');
  const slug = slugify(input.title);
  const id = `DEC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug}`;
  const dir = path.join(input.projectPath, 'decisions');
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  if (await exists(filePath)) throw new Error(`Decision already exists: ${id}`);
  const content = matter.stringify([
    '# Context',
    '',
    input.context?.trim() || 'TODO: Explain the situation or problem.',
    '',
    '# Decision',
    '',
    input.decision?.trim() || 'TODO: State the decision.',
    '',
    '# Consequences',
    '',
    input.consequences?.trim() || 'TODO: Describe trade-offs and follow-up work.',
    ''
  ].join('\n'), {
    aidd: { type: 'decision', templateVersion: TEMPLATE_VERSION },
    id,
    title: input.title.trim(),
    status: input.status || 'proposed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await fsp.writeFile(filePath, content, 'utf8');
  await refreshDecisionIndex(input.projectPath);
  return readDecisions(input.projectPath);
}


async function ensureProjectGitIgnore(projectPath: string) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const requiredEntries = ['.aidd-app/', '.aidd/drag-files/', 'node_modules/', 'dist/'];

  let existing = '';
  if (await exists(gitignorePath)) {
    existing = await fsp.readFile(gitignorePath, 'utf8');
  }

  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : '';
  await fsp.writeFile(gitignorePath, `${prefix}${missing.join('\n')}\n`, 'utf8');
}

async function initialiseGit(projectPath: string, projectName: string, identity: { authorName: string; authorEmail: string }) {
  await ensureProjectGitIgnore(projectPath);
  await git.init({ fs, dir: projectPath, defaultBranch: AIDD_DEFAULT_BRANCH });
  await git.setConfig({ fs, dir: projectPath, path: 'user.name', value: identity.authorName });
  await git.setConfig({ fs, dir: projectPath, path: 'user.email', value: identity.authorEmail });

  const files = await collectFiles(projectPath);
  for (const filepath of files) await git.add({ fs, dir: projectPath, filepath });

  await git.commit({
    fs,
    dir: projectPath,
    message: 'Initial AIDD project',
    author: { name: identity.authorName, email: identity.authorEmail }
  });

  await writeJson(path.join(projectPath, '.aidd-app', 'git.json'), {
    initialized: true,
    defaultBranch: AIDD_DEFAULT_BRANCH,
    projectName,
    createdAt: new Date().toISOString()
  });
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const ignored = new Set(['.git', 'node_modules', '.aidd-app']);
  const out: string[] = [];
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(root, full));
    else out.push(path.relative(root, full).split('\\').join('/'));
  }
  return out;
}

ipcMain.handle('project:selectFolder', async () => {
  const result = await dialog.showOpenDialog({ title: 'Select project location', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('project:list', async () => readProjects());

ipcMain.handle('project:forget', async (_event, projectId: string) => {
  const projects = await readProjects();
  const remaining = projects.filter((project) => project.id !== projectId && project.path !== projectId);
  await writeProjects(remaining);
  return remaining;
});

ipcMain.handle('project:status', async (_event, projectPath: string) => readProjectStatus(projectPath));
ipcMain.handle('project:homeWork', async (_event, projectPath: string) => readHomeWork(projectPath));

ipcMain.handle('project:validate', async (_event, projectPath: string) => validateProject(projectPath));

ipcMain.handle('project:repair', async (_event, projectPath: string) => repairProject(projectPath));

ipcMain.handle('project:upgradeTemplates', async (_event, projectPath: string) => upgradeProjectTemplates(projectPath));

ipcMain.handle('project:openExisting', async () => {
  const result = await dialog.showOpenDialog({ title: 'Open AIDD project', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const projectPath = result.filePaths[0];
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  const tracked: TrackedProject = {
    id: `${Date.now()}`,
    name: manifest.project?.name || path.basename(projectPath),
    description: manifest.project?.description || '',
    path: projectPath,
    templateId: manifest.templateId || 'unknown',
    templateVersion: manifest.templateVersion || 'unknown',
    createdAt: manifest.createdAt || new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  };
  const projects = (await readProjects()).filter((p) => p.path !== projectPath);
  projects.unshift(tracked);
  await writeProjects(projects);
  return tracked;
});

ipcMain.handle('project:create', async (_event, input: CreateProjectInput) => {
  const name = input.name.trim();
  if (!name) throw new Error('Project name is required.');
  if (!input.parentLocation) throw new Error('Project location is required.');
  const projectPath = path.join(input.parentLocation, slugify(name));
  if (await exists(projectPath)) throw new Error(`Project folder already exists: ${projectPath}`);

  const identity = await requireGitIdentity(app.getPath('userData'), {
    authorName: input.authorName,
    authorEmail: input.authorEmail
  });

  await copyDir(templatePath(), projectPath);
  await replaceInTree(projectPath, {
    __PACKAGE_NAME__: packageName(name),
    StormUI: name
  });

  await fsp.rm(path.join(projectPath, 'foundation', '01-project-overview.md'), { force: true }).catch(() => undefined);
  await fsp.writeFile(path.join(projectPath, 'foundation', '02-product-definition.md'), buildFoundationMarkdown({
    id: 'product-definition',
    title: 'Product Definition',
    status: input.description.trim() ? 'draft' : 'not-started',
    body: `# Product Definition\n\n${input.description.trim() || 'Describe what this system is and what product context every delivery package should inherit.'}`
  }), 'utf8');
  await fsp.writeFile(path.join(projectPath, 'foundation', '04-goals-and-success-metrics.md'), buildFoundationMarkdown({
    id: 'goals-and-success-metrics',
    title: 'Goals & Success Metrics',
    status: 'not-started',
    body: '# Goals & Success Metrics\n\nDescribe the measurable goals, outcomes, or success signals this project should optimise for.'
  }), 'utf8');
  await writeJson(path.join(projectPath, 'aidd.template.json'), {
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    createdWith: 'AIDD App',
    createdAt: new Date().toISOString(),
    project: { name, description: input.description.trim() }
  });


  await initialiseGit(projectPath, name, identity);

  const tracked: TrackedProject = {
    id: `${Date.now()}`,
    name,
    description: input.description.trim(),
    path: projectPath,
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  };
  const projects = (await readProjects()).filter((p) => p.path !== projectPath);
  projects.unshift(tracked);
  await writeProjects(projects);
  return tracked;
});



const dragIconPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABOklEQVR4nO2aUQ6CMBBEV+PZ4MxwOf1qVBJid7rbqXTeP/XNQAsWzIQQQgghxJzcIgZZluUZMQ7Cvu9NGZoOZgY/ghZxR39wpPBmuA9UwGjhC4iXu4BRwxe8fq4CRg9f8HjCa8BVqC7gX85+odb3kS1S2LbNfcy6rgkm32gKsAXYqAC2ABsVwBZgowLYAmxUAFuAjQpgC7BRAWwBNiqALcBGBbAF2ExfQPieILL35x0rcq8w/ArI3siMHj9lCmSVkDFu2hoQLZtVauoiGCWdOa3S7wKt8tlrSpfbIBriUm+GvGF6hDfr/CBUG6pXeDPCk+CvcD3DmzkKaP0a65OzkJHha31p/wWOYXuf+YKrgMirwOwdOjq8xxMKNPLXIt6TBE2B6CshCsQLXgNGKwH1mf5bYSGEEEKIaXkB8t1QIHKJzAcAAAAASUVORK5CYII=';

function dragIconPath() {
  const iconPath = path.join(app.getPath('userData'), 'native-file-drag-icon.png');
  const iconBuffer = Buffer.from(dragIconPngBase64, 'base64');

  // Always rewrite the icon. Earlier builds could leave a corrupt cached PNG in
  // AppData, and Electron will crash the main process if startDrag receives an
  // invalid image path.
  fs.writeFileSync(iconPath, iconBuffer);

  return iconPath;
}

function safeDragFileName(fileName: string) {
  const parsed = path.parse(fileName || 'foundation.md');
  const baseName = slugify(parsed.name || 'foundation');
  const ext = parsed.ext && parsed.ext.toLowerCase() === '.md' ? '.md' : '.md';
  return `${baseName}${ext}`;
}

function safeDragDirectory(directory?: string) {
  return (directory || 'markdown')
    .split(/[\\/]+/)
    .map((part) => slugify(part))
    .filter(Boolean);
}

async function prepareMarkdownDragFile(input: PrepareMarkdownDragFileInput) {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Markdown file name is required.');

  const projectPath = path.resolve(input.projectPath);
  const dragDir = path.join(projectPath, '.aidd', 'drag-files', ...safeDragDirectory(input.directory));
  await fsp.mkdir(dragDir, { recursive: true });

  const safeName = safeDragFileName(input.fileName);
  const outputPath = path.join(dragDir, safeName);
  const title = input.title?.trim() || path.parse(safeName).name;
  const status = input.status || 'draft';
  const body = input.body?.trim() || '';

  await fsp.writeFile(outputPath, matter.stringify(body ? `${body}\n` : '', {
    aidd: {
      type: 'drag-export',
      title,
      status,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString(),
      ...(input.metadata || {})
    }
  }), 'utf8');

  return outputPath;
}

async function prepareFoundationDragFile(input: PrepareFoundationDragFileInput) {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Foundation file name is required.');

  const projectPath = path.resolve(input.projectPath);
  const dragDir = path.join(projectPath, '.aidd', 'drag-files', 'foundation');
  await fsp.mkdir(dragDir, { recursive: true });

  const safeName = safeDragFileName(input.fileName);
  const outputPath = path.join(dragDir, safeName);
  const title = input.title?.trim() || path.parse(safeName).name;
  const status = input.status || 'draft';
  const body = input.body?.trim() || '';

  await fsp.writeFile(outputPath, buildFoundationMarkdown({
    id: path.parse(safeName).name,
    title,
    status,
    required: true,
    body
  }), 'utf8');

  return outputPath;
}

async function prepareNativeDragTestFile() {
  const dragDir = path.join(app.getPath('userData'), 'native-file-drag-test');
  await fsp.mkdir(dragDir, { recursive: true });
  const filePath = path.join(dragDir, 'drag-and-drop.md');
  await fsp.writeFile(filePath, `# Native file drag test\n\nCreated by AIDD at ${new Date().toISOString()}\n`, 'utf8');
  return { filePath, fileName: path.basename(filePath) };
}

ipcMain.handle('drag:prepareFoundationFile', async (_event, input: PrepareFoundationDragFileInput) => prepareFoundationDragFile(input));
ipcMain.handle('drag:prepareMarkdownFile', async (_event, input: PrepareMarkdownDragFileInput) => prepareMarkdownDragFile(input));
ipcMain.handle('drag:prepareNativeTestFile', async () => prepareNativeDragTestFile());

// Use ipcMain.on + ipcRenderer.send for native drag-out. This keeps the call as close as possible
// to Electron's documented ondragstart -> IPC -> event.sender.startDrag(...) flow.
ipcMain.on('drag:startNativeFile', (event, filePath: string) => {
  const resolvedPath = path.resolve(filePath || '');
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    console.warn('[native-file-drag] File does not exist:', filePath);
    return;
  }

  const icon = dragIconPath();
  if (!fs.existsSync(icon)) {
    console.warn('[native-file-drag] Drag icon does not exist:', icon);
    return;
  }

  event.sender.startDrag({
    file: resolvedPath,
    icon
  });
});


ipcMain.handle('app:notify', async (_event, input: NotifyInput) => showNativeNotification(input));

ipcMain.handle('app:showItemInFolder', async (_event, filePath: string) => {
  const resolvedPath = path.resolve(filePath || '');
  if (!resolvedPath || !fs.existsSync(resolvedPath)) throw new Error(`File does not exist: ${filePath}`);
  shell.showItemInFolder(resolvedPath);
  return true;
});

ipcMain.handle('project:setup', async (_event, projectPath: string) => readProjectSetup(projectPath));

ipcMain.handle('project:workflowDocuments', async (_event, projectPath: string) => readWorkflowDocuments(projectPath));

ipcMain.handle('project:saveWorkflowDocument', async (_event, input: SaveWorkflowDocumentInput) => {
  return withProjectSaveSync(input.projectPath, () => saveWorkflowDocument(input));
});

ipcMain.handle('project:saveFoundationDocument', async (_event, input: SaveFoundationInput) => {
  const docs = await readFoundationDocuments(input.projectPath);
  const existing = docs.find((doc) => doc.fileName === input.fileName);
  if (!existing) throw new Error(`Unknown foundation document: ${input.fileName}`);
  await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
    id: existing.id,
    title: existing.title,
    status: input.status,
    required: existing.required,
    body: input.body
  }), 'utf8');
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);
});

ipcMain.handle('project:defineStandards', async (_event, input: DefineStandardsInput) => {
  const standardsDir = path.join(input.projectPath, 'foundation', 'standards');
  await fsp.mkdir(standardsDir, { recursive: true });
  await fsp.writeFile(path.join(standardsDir, 'index.md'), buildStandardsMarkdown(input.status, input.body), 'utf8');
  await writeJson(path.join(standardsDir, 'standards.json'), { profiles: input.status === 'complete' ? ['project-defined'] : [], updatedAt: new Date().toISOString() });
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);
});

ipcMain.handle('project:createComponent', async (_event, input: CreateComponentInput) => {
  if (!input.title.trim()) throw new Error('Component title is required.');
  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || [], input.sections || []);
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);
});

ipcMain.handle('project:readComponent', async (_event, input: ReadComponentInput) => {
  if (!input.projectPath || !input.slug) throw new Error('Project path and component slug are required.');
  return readComponent(input);
});

ipcMain.handle('project:updateComponent', async (_event, input: UpdateComponentInput) => {
  if (!input.projectPath || !input.slug || !input.title?.trim()) throw new Error('Project path, component slug, and title are required.');
  return withProjectSaveSync(input.projectPath, () => updateComponent(input));
});

ipcMain.handle('project:createCapability', async (_event, input: CreateCapabilityInput) => {
  if (!input.title.trim()) throw new Error('Capability title is required.');
  await createCapability(input.projectPath, input);
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);
});

ipcMain.handle('project:readCapability', async (_event, input: ReadCapabilityInput) => {
  if (!input.projectPath || !input.slug) throw new Error('Project path and capability slug are required.');
  return readCapability(input);
});

ipcMain.handle('project:updateCapability', async (_event, input: UpdateCapabilityInput) => {
  if (!input.projectPath || !input.slug || !input.title?.trim()) throw new Error('Project path, capability slug, and title are required.');
  return withProjectSaveSync(input.projectPath, () => updateCapability(input));
});

ipcMain.handle('project:createDeliveryPackageFromCapability', async (_event, input: CreateDeliveryPackageFromCapabilityInput) => {
  if (!input.projectPath || !input.capabilitySlug) throw new Error('Project path and capability slug are required.');
  return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromCapability(input));
});

ipcMain.handle('project:readDeliveryPackages', async (_event, projectPath: string) => readDeliveryPackages(projectPath));
ipcMain.handle('project:readDeliveryPackage', async (_event, input: { projectPath: string; id: string }) => readDeliveryPackage(input));
ipcMain.handle('project:saveDeliveryPackage', async (_event, input: SaveDeliveryPackageInput) => {
  return withProjectSaveSync(input.projectPath, () => saveDeliveryPackage(input));
});
ipcMain.handle('project:createDeliveryPackagePhase', async (_event, input: CreateDeliveryPackagePhaseInput) => {
  return withProjectSaveSync(input.projectPath, () => createDeliveryPackagePhase(input));
});
ipcMain.handle('project:assembleDeliveryPackage', async (_event, input: { projectPath: string; packageId: string }) => assembleDeliveryPackage(input));

ipcMain.handle('project:deleteDeliveryPackage', async (_event, input: DeleteDeliveryPackageInput) => {
  return withProjectSaveSync(input.projectPath, () => deleteDeliveryPackage(input));
});

ipcMain.handle('project:readDecisions', async (_event, projectPath: string) => readDecisions(projectPath));

ipcMain.handle('project:createDecision', async (_event, input: DecisionInput) => {
  return withProjectSaveSync(input.projectPath, () => createDecisionRecord(input));
});

ipcMain.handle('project:readSourceReference', async (_event, projectPath: string) => readSourceReference(projectPath));

ipcMain.handle('project:readSourceProjects', async (_event, projectPath: string) => readSourceProjects(projectPath));

ipcMain.handle('project:addSourceProject', async (_event, projectPath: string) => {
  const result = await dialog.showOpenDialog({ title: 'Select source code project directory', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return withProjectSaveSync(projectPath, () => writeSourceProject(projectPath, result.filePaths[0]));
});

ipcMain.handle('project:selectSourceDirectory', async (_event, projectPath: string) => {
  const result = await dialog.showOpenDialog({ title: 'Select source code directory', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return withProjectSaveSync(projectPath, () => writeSourceReference(projectPath, result.filePaths[0]));
});


const gitCredentialStore = createKeytarCredentialStore();

function isLocalOnlySyncFailureAfterSave(code: string) {
  return code === 'NOT_CONNECTED' || code === 'MISSING_TOKEN';
}

function shouldSkipSaveCheckpointPath(filePath: string) {
  const normalised = path.resolve(filePath || '').replace(/\\/g, '/');

  return (
    normalised.includes('/.git/') ||
    normalised.includes('/.aidd-app/') ||
    normalised.includes('/.aidd/drag-files/') ||
    normalised.endsWith('/.env') ||
    normalised.includes('/node_modules/') ||
    normalised.includes('/dist/') ||
    normalised.includes('/build/')
  );
}

async function findAiddProjectRootForSavedFile(filePath: string) {
  const resolved = path.resolve(filePath || '');

  if (!resolved || shouldSkipSaveCheckpointPath(resolved)) {
    return null;
  }

  let current = path.dirname(resolved);

  while (true) {
    if (await exists(path.join(current, 'aidd.config.json'))) {
      return current;
    }

    if (await exists(path.join(current, '.git'))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) {
      break;
    }

    current = next;
  }

  return null;
}

async function checkpointAndShareProjectAfterSave(projectPath: string) {
  if (!projectPath) {
    return;
  }

  const options = {
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore,
  };

  try {
    const syncResult = await syncProject(options);

    if (syncResult.ok) {
      console.log(`[AIDD save-sync] Saved, checkpointed and shared: ${syncResult.message}`);
      return;
    }

    const checkpoint = await createCheckpointIfNeeded(options);

    if (checkpoint.created) {
      console.log(`[AIDD save-sync] Saved and checkpointed locally: ${checkpoint.label}`);
    }

    if (isLocalOnlySyncFailureAfterSave(syncResult.code)) {
      console.log(`[AIDD save-sync] Remote share skipped: ${syncResult.message}`);
      return;
    }

    console.warn(`[AIDD save-sync] Remote share needs attention: ${syncResult.message}`);
  } catch (error) {
    try {
      const checkpoint = await createCheckpointIfNeeded(options);

      if (checkpoint.created) {
        console.warn(`[AIDD save-sync] Saved and checkpointed locally after share failed: ${checkpoint.label}`);
        return;
      }
    } catch (checkpointError) {
      console.warn(`[AIDD save-sync] Checkpoint failed after save: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
    }

    console.warn(`[AIDD save-sync] Saved, but checkpoint/share did not complete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function withProjectSaveSync<T>(projectPath: string, work: () => Promise<T>): Promise<T> {
  const result = await work();
  await checkpointAndShareProjectAfterSave(projectPath);
  return result;
}



ipcMain.handle('gitIdentity:read', async () => {
  return readGitIdentity(app.getPath('userData'));
});

ipcMain.handle('gitIdentity:save', async (_event, input: AiddSaveGitIdentityInput) => {
  return saveGitIdentity(app.getPath('userData'), input);
});

ipcMain.handle('gitSync:readSettings', async (_event, projectPath: string) => {
  if (!projectPath) return null;
  const settings = await readGitSyncSettings(app.getPath('userData'), projectPath);
  if (!settings) return null;
  return {
    ...settings,
    hasToken: await gitCredentialStore.hasToken(projectPath, settings.provider)
  };
});

ipcMain.handle('gitSync:saveSettings', async (_event, input: AiddSaveGitSyncSettingsInput) => {
  if (!input?.projectPath) throw new Error('Project path is required.');

  const saved = await saveGitSyncSettings(app.getPath('userData'), input.projectPath, {
    provider: input.provider,
    repoUrl: input.repoUrl || '',
    branch: AIDD_DEFAULT_BRANCH
  });

  if (input.token?.trim()) {
    await gitCredentialStore.saveToken(input.projectPath, saved.provider, input.token);
  }

  const settings = await readGitSyncSettings(app.getPath('userData'), input.projectPath, await gitCredentialStore.hasToken(input.projectPath, saved.provider));
  if (!settings) throw new Error('Repository sync settings could not be saved.');
  return settings;
});

ipcMain.handle('gitSync:testConnection', async (_event, input: AiddGitSyncTestInput) => {
  return testGitRemoteConnection({ ...input, branch: AIDD_DEFAULT_BRANCH }, gitCredentialStore);
});

ipcMain.handle('gitSync:clearToken', async (_event, projectPath: string) => {
  if (!projectPath) return null;
  const settings = await readGitSyncSettings(app.getPath('userData'), projectPath);
  if (!settings) return null;
  await gitCredentialStore.clearToken(projectPath, settings.provider);
  return {
    ...settings,
    hasToken: false
  };
});

ipcMain.handle('gitSync:getProjectConnectionStatus', async (_event, projectPath: string) => {
  return getProjectConnectionStatus({
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore
  });
});


ipcMain.handle('gitSync:connectProject', async (_event, projectPath: string) => {
  return connectProjectToRepository({
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore
  });
});

ipcMain.handle('gitSync:getSyncStatus', async (_event, projectPath: string) => {
  return getSyncStatus({
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore
  });
});

ipcMain.handle('gitSync:checkForUpdates', async (_event, projectPath: string) => {
  return checkForUpdates({
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore
  });
});

ipcMain.handle('gitSync:syncProject', async (_event, projectPath: string) => {
  return syncProject({
    userDataPath: app.getPath('userData'),
    projectPath,
    credentialStore: gitCredentialStore
  });
});

ipcMain.handle('gitSync:getReviewState', async (_event, projectPath: string) => {
  return readActiveGitReviewState(projectPath);
});

ipcMain.handle('gitSync:listReviewFiles', async (_event, projectPath: string) => {
  return listGitReviewFiles(projectPath);
});

ipcMain.handle('gitSync:readReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; kind: 'local' | 'remote' | 'base' }) => {
  return readGitReviewFileContent(input);
});

ipcMain.handle('gitSync:resolveReviewFile', async (_event, input: { projectPath: string; reviewId: string; filePath: string; resolution: 'keep_local' | 'use_shared' | 'use_combined_draft'; combinedContent?: string }) => {
  return resolveGitReviewFile(input);
});

ipcMain.handle('gitSync:completeReview', async (_event, projectPath: string, reviewId: string) => {
  return completeGitReview(projectPath, reviewId);
});

ipcMain.handle('gitSync:cancelReview', async (_event, projectPath: string, reviewId: string) => {
  return cancelGitReview(projectPath, reviewId);
});

ipcMain.handle('fs:readText', async (_event, filePath: string) => fsp.readFile(filePath, 'utf8'));

ipcMain.handle('fs:writeText', async (_event, filePath: string, content: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');

  const projectPath = await findAiddProjectRootForSavedFile(filePath);

  if (projectPath) {
    await checkpointAndShareProjectAfterSave(projectPath);
  }

  return true;
});
