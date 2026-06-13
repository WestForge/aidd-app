import { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
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

const OBSOLETE_TEMPLATE_FILES = new Set([
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

const OBSOLETE_COMPONENT_SECTION_FILES = [
  '04-dependencies.md',
  '05-architecture.md',
  '06-standards.md',
  '07-decisions.md',
  '05-dependencies-and-integrations.md',
  '06-internal-design.md',
  '07-quality-requirements.md',
  'technical-shape.md'
];

const OBSOLETE_CAPABILITY_SECTION_FILES = [
  '05-non-functional-requirements.md',
  '06-data-model.md',
  '07-integrations.md',
  '08-architecture.md',
  '09-ux-ui.md',
  '10-risks.md',
  '11-validation.md'
];

function isObsoleteTemplateFile(relativePath: string) {
  return OBSOLETE_TEMPLATE_FILES.has(normaliseRelativePath(relativePath));
}


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
  source?: ComponentSourceConfig;
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

interface ProjectRepairLogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
  path?: string;
  detail?: string;
}

interface ProjectTemplateUpgradeReport {
  generatedAt: string;
  changed: boolean;
  preUpgradeCommit?: string;
  upgradeCommit?: string;
  changes: string[];
  warnings: string[];
  logs: ProjectRepairLogEntry[];
  logPath?: string;
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

interface ComponentContractInfo {
  path: string;
  version: number;
  sourceHash?: string;
  status: 'blocked' | 'missing' | 'stale' | 'current';
  blockers: string[];
}

type ComponentSourceDetectionConfidence = 'high' | 'medium' | 'low';

interface ComponentSourceDetection {
  suggestedType: string;
  confidence: ComponentSourceDetectionConfidence;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  packageManager?: string;
  reasons: string[];
}

interface ComponentSourceConfig {
  directory: string;
  type: string;
  detection?: ComponentSourceDetection | null;
}

interface ComponentSourceDirectoryInput {
  projectPath: string;
  directory?: string;
  currentDirectory?: string;
}

interface ComponentSourceDirectorySelection {
  directory: string;
  absolutePath: string;
  detection: ComponentSourceDetection;
}

interface ProjectSetupState {
  foundation: FoundationDocument[];
  standards: { status: SetupStepStatus; filePath: string; body: string; profiles: string[] };
  components: Array<{ slug: string; title: string; status?: string; sourceProjects?: string[]; source?: ComponentSourceConfig; contract?: ComponentContractInfo }>;
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

interface PrepareComponentContractDragFileInput {
  projectPath: string;
  slug: string;
}

interface ComponentReviewBundleResult {
  filePath: string;
  fileName: string;
  componentCount: number;
  componentFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

interface PackageComponentReviewInput {
  projectPath: string;
  slug: string;
}

interface ImportComponentReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface ComponentReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  componentCount: number;
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface ComponentSectionInput {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: SetupStepStatus | string;
  skipReason?: string;
}

interface CreateComponentInput {
  projectPath: string;
  title: string;
  description?: string;
  status?: SetupStepStatus | 'active' | 'deprecated';
  sourceProjects?: string[];
  source?: Partial<ComponentSourceConfig>;
  capabilities?: string[];
  sections?: ComponentSectionInput[];
}

interface ReadComponentInput {
  projectPath: string;
  slug: string;
}

interface GenerateComponentContractInput {
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
  source?: Partial<ComponentSourceConfig>;
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

function templatePathCandidates() {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = [
    path.join(process.cwd(), 'resources', 'templates', 'aidd-default'),
    path.join(app.getAppPath(), 'resources', 'templates', 'aidd-default'),
    resourcesPath ? path.join(resourcesPath, 'resources', 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'templates', 'aidd-default') : '',
    resourcesPath ? path.join(resourcesPath, 'app', 'resources', 'templates', 'aidd-default') : ''
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

function resolveTemplatePath() {
  const candidates = templatePathCandidates();
  const selected = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  return { selected, candidates };
}

function templatePath() {
  return resolveTemplatePath().selected;
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
  const foundationDir = 'foundation';
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
  const valid: SetupStepStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];
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
      const source = normaliseComponentSource(component.source);
      const hasSourceMapping = sourceProjects.length > 0 || componentSourceIsConfigured(source);
      const capabilities = capabilityByComponent.get(slug) || [];
      const reasons: string[] = [];
      if (!isTerminalHomeStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
      if (!hasSourceMapping) reasons.push('No source mapping');
      if (!capabilities.length) reasons.push('No capability mapping');
      return {
        slug,
        title: String(component.title || slug || 'Untitled component'),
        status,
        sourceProjects,
        source,
        capabilities,
        reason: reasons.join(' · ') || 'Needs review'
      };
    })
    .filter((component) => !isTerminalHomeStatus(component.status) || !(component.sourceProjects.length > 0 || componentSourceIsConfigured(component.source)) || !component.capabilities.length)
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
  const foundationDir = 'foundation';
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
    { id: 'foundation', label: 'Project Context started', complete: foundationStatuses.some((status) => status !== 'not-started'), detail: 'Shared context exists for the project.' },
    { id: 'foundation-complete', label: 'Project Context complete', complete: foundation.every((item) => item.complete), detail: 'All required foundation sections have useful content.' },
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
    nextAction = 'Complete the Project Context.';
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

  const bundledFiles = await collectRelativeFiles(expectedRoot);
  const expectedFiles = bundledFiles.filter((relativePath) => !isObsoleteTemplateFile(relativePath));
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
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      issueCount++;
      pushValidation(section, {
        id: `template-frontmatter-corrupt-${relativePath}`,
        title: 'Template front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: `.aidd/templates/${relativePath}`,
        action: 'Fix the YAML front matter or restore the template file from the bundled app template.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
    const version = aidd?.templateVersion;
    if (!aidd || version === TEMPLATE_VERSION) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-version-${relativePath}`,
      title: 'Template front matter is out of sync',
      message: `${relativePath} uses templateVersion ${version || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run Repair issues to update front matter versions.'
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


async function readJsonSafe<T = any>(filePath: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: JSON.parse(await fsp.readFile(filePath, 'utf8')) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseMarkdownSafe(content: string): { ok: true; parsed: any } | { ok: false; error: string } {
  try {
    return { ok: true, parsed: matter(content) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function validateJsonIntegrity(projectPath: string, relativePath: string, section: ProjectValidationSection, required = true) {
  const filePath = path.join(projectPath, relativePath);
  if (!(await exists(filePath))) {
    if (required) {
      pushValidation(section, {
        id: `json-missing-${relativePath}`,
        title: 'Required JSON file missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues to restore missing AIDD data files.'
      });
      return false;
    }
    return true;
  }

  const result = await readJsonSafe(filePath);
  if (!result.ok) {
    pushValidation(section, {
      id: `json-corrupt-${relativePath}`,
      title: 'JSON file is corrupt',
      message: `${relativePath} could not be parsed: ${result.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Open the file and fix the JSON syntax, or restore it from version control.'
    });
    return false;
  }

  return true;
}

async function validateMarkdownIntegrity(projectPath: string, relativePath: string, section: ProjectValidationSection, required = true) {
  const filePath = path.join(projectPath, relativePath);
  if (!(await exists(filePath))) {
    if (required) {
      pushValidation(section, {
        id: `markdown-missing-${relativePath}`,
        title: 'Required Markdown file missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues to restore missing AIDD data files.'
      });
      return false;
    }
    return true;
  }

  const parsed = parseMarkdownSafe(await fsp.readFile(filePath, 'utf8'));
  if (!parsed.ok) {
    pushValidation(section, {
      id: `markdown-corrupt-${relativePath}`,
      title: 'Markdown front matter is corrupt',
      message: `${relativePath} could not be parsed: ${parsed.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Fix the YAML front matter or restore the file from version control.'
    });
    return false;
  }

  return true;
}

async function validateTemplateManifest(projectPath: string, section: ProjectValidationSection) {
  const relativePath = 'aidd.template.json';
  const manifestPath = path.join(projectPath, relativePath);
  if (!(await exists(manifestPath))) {
    pushValidation(section, {
      id: 'template-manifest-missing',
      title: 'Template manifest missing',
      message: 'The project does not contain aidd.template.json.',
      severity: 'error',
      path: relativePath,
      action: 'Run Repair issues to recreate the AIDD template manifest.'
    });
    return;
  }

  const result = await readJsonSafe<any>(manifestPath);
  if (!result.ok) {
    pushValidation(section, {
      id: 'template-manifest-corrupt',
      title: 'Template manifest is corrupt',
      message: `aidd.template.json could not be parsed: ${result.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Fix the JSON syntax or restore the manifest from version control.'
    });
    return;
  }

  const manifest = result.data;
  if (manifest.templateId && manifest.templateId !== TEMPLATE_ID) {
    pushValidation(section, {
      id: 'template-id-drift',
      title: 'Template id differs from the app template',
      message: `Project uses ${manifest.templateId}; app expects ${TEMPLATE_ID}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Check whether this project is meant to use the bundled AIDD template.'
    });
  }

  if (manifest.templateVersion !== TEMPLATE_VERSION) {
    pushValidation(section, {
      id: 'template-version-drift',
      title: 'Template manifest version is out of sync',
      message: `Project uses ${manifest.templateVersion || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Run Repair issues to upgrade the template manifest version.'
    });
    return;
  }

  pushValidation(section, {
    id: 'template-manifest-current',
    title: 'Template manifest is current',
    message: `${manifest.templateId || TEMPLATE_ID}@${manifest.templateVersion}`,
    severity: 'success',
    path: relativePath
  });
}

async function validateProjectDataIntegrity(projectPath: string, section: ProjectValidationSection) {
  const before = section.items.length;
  const requiredDirs = [
    '.aidd',
    '.aidd/templates',
    'foundation',
    'foundation/standards',
    'foundation/delivery-planning',
    'capabilities',
    'components',
    'delivery',
    'delivery/packages',
    'source-code',
    'source-code/projects'
  ];

  for (const relativePath of requiredDirs) {
    if (await exists(path.join(projectPath, relativePath))) continue;
    pushValidation(section, {
      id: `dir-missing-${relativePath}`,
      title: 'Required folder missing',
      message: `${relativePath} does not exist.`,
      severity: 'error',
      path: relativePath,
      action: 'Run Repair issues to restore the expected AIDD folder structure.'
    });
  }

  const legacyFolders = [
    { from: 'common', to: 'foundation' },
    { from: 'modules', to: 'components' },
    { from: 'bundles', to: 'delivery/packages' },
    { from: 'delivery/bundles', to: 'delivery/packages' }
  ];

  for (const legacy of legacyFolders) {
    if (!(await exists(path.join(projectPath, legacy.from)))) continue;
    pushValidation(section, {
      id: `legacy-folder-${legacy.from}`,
      title: 'Legacy AIDD folder found',
      message: `${legacy.from} is from an older project layout. Current projects use ${legacy.to}.`,
      severity: 'warning',
      path: legacy.from,
      action: 'Run Repair issues to migrate legacy folders where it is safe.'
    });
  }

  await validateJsonIntegrity(projectPath, 'aidd.config.json', section, false);
  await validateJsonIntegrity(projectPath, 'aidd.template.json', section, true);
  await validateJsonIntegrity(projectPath, 'foundation/standards/standards.json', section, false);
  await validateJsonIntegrity(projectPath, 'delivery/roadmap.json', section, false);

  const requiredMarkdown = [
    'foundation/02-product-definition.md',
    'foundation/03-audience-and-users.md',
    'foundation/04-goals-and-success-metrics.md',
    'foundation/standards/index.md',
    'foundation/delivery-planning/index.md',
    'capabilities/index.md',
    'components/index.md',
    'delivery/packages/index.md'
  ];

  for (const relativePath of requiredMarkdown) {
    await validateMarkdownIntegrity(projectPath, relativePath, section, true);
  }

  if (section.items.length === before) {
    pushValidation(section, {
      id: 'project-data-present',
      title: 'Required AIDD data files are present',
      message: 'Required folders, JSON files, and Markdown files are present and parseable.',
      severity: 'success'
    });
  }
}

interface HealthEntity {
  kind: 'component' | 'capability' | 'source-project' | 'delivery-package';
  rootDir: string;
  folder: string;
  manifestName: string;
  relativePath: string;
  data: any;
  slug: string;
  title: string;
}

async function listEntityFolders(projectPath: string, rootDir: string) {
  const dir = path.join(projectPath, rootDir);
  if (!(await exists(dir))) return [] as string[];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

async function collectHealthEntities(projectPath: string, section: ProjectValidationSection, rootDir: string, manifestName: string, kind: HealthEntity['kind']) {
  const entities: HealthEntity[] = [];
  const folders = await listEntityFolders(projectPath, rootDir);

  for (const folder of folders) {
    const relativePath = `${rootDir}/${folder}/${manifestName}`;
    const filePath = path.join(projectPath, relativePath);
    if (!(await exists(filePath))) {
      pushValidation(section, {
        id: `${kind}-manifest-missing-${folder}`,
        title: 'Entity manifest missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues if this is a legacy item, or recreate the missing manifest from version control.'
      });
      continue;
    }

    const result = await readJsonSafe<any>(filePath);
    if (!result.ok) {
      pushValidation(section, {
        id: `${kind}-manifest-corrupt-${folder}`,
        title: 'Entity manifest is corrupt',
        message: `${relativePath} could not be parsed: ${result.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the JSON syntax or restore the manifest from version control.'
      });
      continue;
    }

    const data = result.data;
    const slug = String(data.slug || data.id || folder).trim();
    const title = String(data.title || data.name || slug || folder).trim();
    if (!slug || !title) {
      pushValidation(section, {
        id: `${kind}-manifest-incomplete-${folder}`,
        title: 'Entity manifest is incomplete',
        message: `${relativePath} should include at least a slug/id and title/name.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open the item and save it again so AIDD can normalise the manifest.'
      });
    }

    if (slug && slug !== folder && kind !== 'source-project') {
      pushValidation(section, {
        id: `${kind}-folder-slug-mismatch-${folder}`,
        title: 'Entity folder and slug differ',
        message: `${relativePath} uses slug ${slug}, but the folder is ${folder}.`,
        severity: 'warning',
        path: relativePath,
        action: 'Rename the folder or update the manifest slug so links remain stable.'
      });
    }

    entities.push({ kind, rootDir, folder, manifestName, relativePath, data, slug, title });
  }

  return entities;
}

async function validateEntitySectionFiles(projectPath: string, section: ProjectValidationSection, entity: HealthEntity, templates: Array<{ fileName: string; key: string; title: string }>, expectedType: string) {
  const entityDir = path.join(projectPath, entity.rootDir, entity.folder);
  const configuredFiles = Array.isArray(entity.data.template?.sectionFiles)
    ? entity.data.template.sectionFiles.map((value: unknown) => String(value))
    : templates.map((template) => template.fileName);
  const allowed = new Set(['index.md', ...configuredFiles]);

  for (const fileName of configuredFiles) {
    const relativePath = `${entity.rootDir}/${entity.folder}/${fileName}`;
    const filePath = path.join(projectPath, relativePath);
    if (!(await exists(filePath))) {
      pushValidation(section, {
        id: `${entity.kind}-section-missing-${entity.folder}-${fileName}`,
        title: 'Entity section file missing',
        message: `${entity.title} is missing ${fileName}.`,
        severity: 'error',
        path: relativePath,
        action: 'Open and save the item again, or restore the missing section from version control.'
      });
      continue;
    }

    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      pushValidation(section, {
        id: `${entity.kind}-section-corrupt-${entity.folder}-${fileName}`,
        title: 'Entity section front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the YAML front matter or restore the file from version control.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
    if (!aidd) {
      pushValidation(section, {
        id: `${entity.kind}-section-frontmatter-missing-${entity.folder}-${fileName}`,
        title: 'Entity section front matter missing',
        message: `${relativePath} is missing AIDD front matter.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open and save the item again so AIDD can rebuild the section front matter.'
      });
    } else if (aidd.type && aidd.type !== expectedType) {
      pushValidation(section, {
        id: `${entity.kind}-section-type-mismatch-${entity.folder}-${fileName}`,
        title: 'Entity section type differs from expected type',
        message: `${relativePath} uses aidd.type ${aidd.type}; expected ${expectedType}.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open and save the item again so AIDD can normalise the section metadata.'
      });
    }
  }

  if (!(await exists(entityDir))) return;
  for (const entry of await fsp.readdir(entityDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (allowed.has(entry.name)) continue;
    const relativePath = `${entity.rootDir}/${entity.folder}/${entry.name}`;
    pushValidation(section, {
      id: `${entity.kind}-unexpected-section-${entity.folder}-${entry.name}`,
      title: 'Unexpected entity section file',
      message: `${relativePath} is not part of the current ${entity.kind} template file list.`,
      severity: 'warning',
      path: relativePath,
      action: 'Review the file. If it is obsolete, move it to an archive or merge useful content into the current sections.'
    });
  }
}

async function validateEntityDataIntegrity(projectPath: string, section: ProjectValidationSection) {
  const before = section.items.length;
  const components = await collectHealthEntities(projectPath, section, 'components', 'component.json', 'component');
  const capabilities = await collectHealthEntities(projectPath, section, 'capabilities', 'capability.json', 'capability');
  const sourceProjects = await collectHealthEntities(projectPath, section, 'source-code/projects', 'source-project.json', 'source-project');
  const deliveryPackages = await collectHealthEntities(projectPath, section, 'delivery/packages', 'package.json', 'delivery-package');

  const componentSlugs = new Set(components.map((component) => component.slug));
  const sourceIds = new Set(sourceProjects.map((sourceProject) => String(sourceProject.data.id || sourceProject.slug)));
  const capabilitySlugs = new Set(capabilities.map((capability) => capability.slug));

  for (const capability of capabilities) {
    if (Array.isArray(capability.data.modules) && !Array.isArray(capability.data.components)) {
      pushValidation(section, {
        id: `capability-legacy-modules-${capability.folder}`,
        title: 'Capability uses legacy module links',
        message: `${capability.relativePath} uses modules instead of components.`,
        severity: 'warning',
        path: capability.relativePath,
        action: 'Open and save the capability to normalise links to components.'
      });
    }

    const linkedComponents = Array.isArray(capability.data.components) ? capability.data.components : Array.isArray(capability.data.modules) ? capability.data.modules : [];
    const missing = linkedComponents.map((value: unknown) => String(value)).filter((slug: string) => slug && !componentSlugs.has(slug));
    if (missing.length) {
      pushValidation(section, {
        id: `capability-missing-component-links-${capability.folder}`,
        title: 'Capability links to missing components',
        message: `${capability.title} references missing components: ${missing.join(', ')}.`,
        severity: 'error',
        path: capability.relativePath,
        action: 'Create the missing components or remove the broken links.'
      });
    }

    await validateEntitySectionFiles(projectPath, section, capability, CAPABILITY_TEMPLATE_SECTIONS, 'capability-section');
  }

  for (const component of components) {
    const mappedSources = Array.isArray(component.data.sourceProjects) ? component.data.sourceProjects : [];
    const missingSources = mappedSources.map((value: unknown) => String(value)).filter((id: string) => id && !sourceIds.has(id));
    if (missingSources.length) {
      pushValidation(section, {
        id: `component-missing-source-links-${component.folder}`,
        title: 'Component links to missing source projects',
        message: `${component.title} references missing source projects: ${missingSources.join(', ')}.`,
        severity: 'error',
        path: component.relativePath,
        action: 'Add the missing source project references or remove the broken links.'
      });
    }

    await validateEntitySectionFiles(projectPath, section, component, COMPONENT_TEMPLATE_SECTIONS, 'component-section');
  }

  for (const deliveryPackage of deliveryPackages) {
    const sourceCapability = String(deliveryPackage.data.sourceCapability || deliveryPackage.data.capability || '').trim();
    if (sourceCapability && !capabilitySlugs.has(sourceCapability)) {
      pushValidation(section, {
        id: `delivery-missing-capability-${deliveryPackage.folder}`,
        title: 'Delivery package references a missing capability',
        message: `${deliveryPackage.title} references ${sourceCapability}, but no matching capability exists.`,
        severity: 'error',
        path: deliveryPackage.relativePath,
        action: 'Reconnect the delivery package to an existing capability or restore the missing capability.'
      });
    }

    await validateMarkdownIntegrity(projectPath, `${deliveryPackage.rootDir}/${deliveryPackage.folder}/snapshot.md`, section, false);
    await validateMarkdownIntegrity(projectPath, `${deliveryPackage.rootDir}/${deliveryPackage.folder}/implementation-strategy.md`, section, false);
  }

  const legacyModules = await listEntityFolders(projectPath, 'modules');
  if (legacyModules.length) {
    pushValidation(section, {
      id: 'legacy-modules-folder',
      title: 'Legacy module entities found',
      message: `${legacyModules.length} module folder${legacyModules.length === 1 ? '' : 's'} still exist under modules/.`,
      severity: 'warning',
      path: 'modules',
      action: 'Run Repair issues to migrate modules to components where it is safe.'
    });
  }

  if (section.items.length === before) {
    pushValidation(section, {
      id: 'entity-data-parseable',
      title: 'Entity data is parseable',
      message: 'Component, capability, source project, and delivery package manifests and section files are readable.',
      severity: 'success'
    });
  }
}



async function validateProjectFrontmatterVersions(projectPath: string, section: ProjectValidationSection) {
  const markdownFiles = await collectProjectMarkdownFiles(projectPath);
  let issueCount = 0;

  for (const relativePath of markdownFiles) {
    const raw = await fsp.readFile(path.join(projectPath, relativePath), 'utf8');
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      issueCount++;
      pushValidation(section, {
        id: `frontmatter-corrupt-${relativePath}`,
        title: 'AIDD front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the YAML front matter or restore the file from version control.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
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
      action: 'Run Repair issues to update front matter versions.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'frontmatter-current',
      title: 'AIDD front matter is current',
      message: `All AIDD Markdown files with front matter use templateVersion ${TEMPLATE_VERSION}.`,
      severity: 'success'
    });
  }
}

function buildValidationReport(sections: ProjectValidationSection[]): ProjectValidationReport {
  const items = sections.flatMap((section) => section.items);
  const summary = {
    total: items.length,
    errors: items.filter((item) => item.severity === 'error').length,
    warnings: items.filter((item) => item.severity === 'warning').length,
    info: items.filter((item) => item.severity === 'info').length,
    success: items.filter((item) => item.severity === 'success').length
  };
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
    canCreateDeliveryPackage: summary.errors === 0,
    summary,
    sections,
    nextActions
  };
}
async function validateProject(projectPath: string): Promise<ProjectValidationReport> {
  const manifestSection = validationSection('template-manifest', 'Template manifest');
  const templateSection = validationSection('templates', 'Template files');
  const frontmatterSection = validationSection('frontmatter', 'Front matter versions');
  const dataSection = validationSection('data', 'Required data files');
  const entitySection = validationSection('entities', 'Entity data integrity');

  if (!projectPath || !(await exists(projectPath))) {
    pushValidation(dataSection, {
      id: 'project-path-missing',
      title: 'Project folder not found',
      message: `The selected project folder does not exist: ${projectPath || 'not set'}`,
      severity: 'error',
      action: 'Open a valid AIDD project from the Projects screen.'
    });
    return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection]);
  }

  await validateTemplateManifest(projectPath, manifestSection);
  await validateTemplateFiles(projectPath, templateSection);
  await validateProjectFrontmatterVersions(projectPath, frontmatterSection);
  await validateProjectDataIntegrity(projectPath, dataSection);
  await validateEntityDataIntegrity(projectPath, entitySection);

  return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection]);
}

function pushRepairLog(
  logs: ProjectRepairLogEntry[],
  level: ProjectRepairLogEntry['level'],
  stage: string,
  message: string,
  options: { path?: string; detail?: string } = {}
) {
  logs.push({
    timestamp: new Date().toISOString(),
    level,
    stage,
    message,
    ...(options.path ? { path: normaliseRelativePath(options.path) } : {}),
    ...(options.detail ? { detail: options.detail } : {})
  });
}

function formatRepairLogEntry(entry: ProjectRepairLogEntry) {
  const parts = [`[${entry.timestamp}]`, entry.level.toUpperCase(), entry.stage, '-', entry.message];
  if (entry.path) parts.push(`(${entry.path})`);
  if (entry.detail) parts.push(`— ${entry.detail}`);
  return parts.join(' ');
}

async function writeRepairLogFile(
  projectPath: string,
  stamp: string,
  title: string,
  logs: ProjectRepairLogEntry[],
  changes: string[],
  warnings: string[]
) {
  const relativePath = `.aidd/repair-logs/${stamp}.md`;
  const logPath = path.join(projectPath, relativePath);
  const lines = [
    `# ${title}`,
    '',
    `Project: ${projectPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Process log',
    '',
    ...(logs.length ? logs.map((entry) => `- ${formatRepairLogEntry(entry)}`) : ['- No process log entries were recorded.']),
    '',
    '## Changes',
    '',
    ...(changes.length ? changes.map((item) => `- ${item}`) : ['- No changes recorded.']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ['- No warnings.']),
    ''
  ];

  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  await fsp.writeFile(logPath, lines.join('\n'), 'utf8');
  return relativePath;
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

async function syncBundledTemplateFiles(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], stamp: string) {
  const resolution = resolveTemplatePath();
  const expectedRoot = path.join(resolution.selected, '.aidd', 'templates');
  const actualRoot = path.join(projectPath, '.aidd', 'templates');

  pushRepairLog(logs, 'info', 'template-path', 'Resolved bundled template path.', {
    path: resolution.selected,
    detail: `Candidates: ${resolution.candidates.join(' | ')}`
  });
  pushRepairLog(logs, 'info', 'template-sync', 'Starting template file sync.', {
    path: '.aidd/templates',
    detail: `Expected root: ${expectedRoot}; project root: ${actualRoot}`
  });

  if (!(await exists(expectedRoot))) {
    const message = `Bundled app template folder was not found: ${expectedRoot}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-sync', 'Cannot restore missing template files because the bundled template root was not found.', {
      path: expectedRoot,
      detail: `Checked candidates: ${resolution.candidates.join(' | ')}`
    });
    return;
  }

  try {
    await fsp.mkdir(actualRoot, { recursive: true });
    pushRepairLog(logs, 'success', 'template-sync', 'Ensured project template folder exists.', { path: '.aidd/templates' });
  } catch (error) {
    const message = `Could not create project template folder ${actualRoot}: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-sync', 'Failed to create project template folder.', { path: actualRoot, detail: message });
    return;
  }

  const bundledFiles = await collectRelativeFiles(expectedRoot);
  const ignoredObsoleteFiles = bundledFiles.filter((relativePath) => isObsoleteTemplateFile(relativePath));
  const expectedFiles = bundledFiles.filter((relativePath) => !isObsoleteTemplateFile(relativePath));
  const actualFiles = await collectRelativeFiles(actualRoot);
  const expected = new Set(expectedFiles);

  pushRepairLog(logs, 'info', 'template-sync', 'Loaded template file inventories.', {
    path: '.aidd/templates',
    detail: `Bundled files: ${bundledFiles.length}; expected current files: ${expectedFiles.length}; ignored obsolete bundled files: ${ignoredObsoleteFiles.length}; project files: ${actualFiles.length}`
  });
  if (ignoredObsoleteFiles.length) {
    pushRepairLog(logs, 'warning', 'template-sync', 'Ignored obsolete files found in the bundled app template.', {
      path: '.aidd/templates',
      detail: ignoredObsoleteFiles.join(', ')
    });
  }

  if (expectedFiles.length === 0) {
    const message = `Bundled template root exists but contains no files: ${expectedRoot}`;
    warnings.push(message);
    pushRepairLog(logs, 'warning', 'template-sync', 'No bundled template files were found to restore.', { path: expectedRoot });
  }

  for (const relativePath of expectedFiles) {
    const target = path.join(actualRoot, relativePath);
    if (await exists(target)) {
      pushRepairLog(logs, 'info', 'template-sync', 'Template file already exists; leaving it in place.', { path: `.aidd/templates/${relativePath}` });
      continue;
    }

    const source = path.join(expectedRoot, relativePath);
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
      const sourceStat = await fsp.stat(source);
      const targetStat = await fsp.stat(target);
      changes.push(`Restored missing template file .aidd/templates/${relativePath}`);
      pushRepairLog(logs, 'success', 'template-sync', 'Restored missing template file.', {
        path: `.aidd/templates/${relativePath}`,
        detail: `Source bytes: ${sourceStat.size}; target bytes: ${targetStat.size}`
      });
    } catch (error) {
      const message = `Could not restore .aidd/templates/${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'template-sync', 'Failed to restore missing template file.', {
        path: `.aidd/templates/${relativePath}`,
        detail: `Source: ${source}; target: ${target}; error: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  for (const relativePath of actualFiles) {
    if (expected.has(relativePath)) continue;
    const source = path.join(actualRoot, relativePath);
    if (!(await exists(source))) {
      pushRepairLog(logs, 'warning', 'template-sync', 'Unexpected template file disappeared before it could be archived.', { path: `.aidd/templates/${relativePath}` });
      continue;
    }

    const archivePath = path.join(projectPath, '.aidd', 'template-archive', stamp, relativePath);
    try {
      await fsp.mkdir(path.dirname(archivePath), { recursive: true });
      await fsp.rename(source, archivePath);
      changes.push(`Archived unexpected template file .aidd/templates/${relativePath}`);
      pushRepairLog(logs, 'success', 'template-sync', 'Archived unexpected template file.', {
        path: `.aidd/templates/${relativePath}`,
        detail: `Archive: ${normaliseRelativePath(path.relative(projectPath, archivePath))}`
      });
    } catch (error) {
      const message = `Could not archive unexpected template file .aidd/templates/${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'template-sync', 'Failed to archive unexpected template file.', {
        path: `.aidd/templates/${relativePath}`,
        detail: message
      });
    }
  }

  const remainingMissing: string[] = [];
  for (const relativePath of expectedFiles) {
    if (!(await exists(path.join(actualRoot, relativePath)))) remainingMissing.push(relativePath);
  }

  if (remainingMissing.length) {
    const message = `${remainingMissing.length} expected template file${remainingMissing.length === 1 ? '' : 's'} still missing after sync.`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-sync', message, {
      path: '.aidd/templates',
      detail: remainingMissing.slice(0, 25).join(', ') + (remainingMissing.length > 25 ? `, and ${remainingMissing.length - 25} more` : '')
    });
  } else {
    pushRepairLog(logs, 'success', 'template-sync', 'All expected template files exist after sync.', { path: '.aidd/templates' });
  }
}

async function upgradeMarkdownFrontmatterVersions(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], now: string) {
  const markdownFiles = await collectProjectMarkdownFiles(projectPath);
  pushRepairLog(logs, 'info', 'frontmatter', 'Scanning Markdown files for AIDD front matter versions.', {
    detail: `Markdown files found: ${markdownFiles.length}`
  });

  let updated = 0;
  let skippedWithoutAidd = 0;
  let alreadyCurrent = 0;

  for (const relativePath of markdownFiles) {
    const filePath = path.join(projectPath, relativePath);
    let parsed: any;
    try {
      parsed = matter(await fsp.readFile(filePath, 'utf8'));
    } catch (error) {
      const message = `Could not update front matter in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'frontmatter', 'Failed to parse Markdown front matter.', { path: relativePath, detail: message });
      continue;
    }

    const data = (parsed.data || {}) as any;
    if (!data.aidd) {
      skippedWithoutAidd++;
      continue;
    }
    if (data.aidd.templateVersion === TEMPLATE_VERSION) {
      alreadyCurrent++;
      continue;
    }

    try {
      const previousVersion = data.aidd.templateVersion || 'missing';
      data.aidd = {
        ...data.aidd,
        templateVersion: TEMPLATE_VERSION,
        updatedAt: now
      };
      await fsp.writeFile(filePath, matter.stringify(parsed.content.replace(/^\s*\n/, ''), data), 'utf8');
      changes.push(`Updated front matter version in ${relativePath}`);
      updated++;
      pushRepairLog(logs, 'success', 'frontmatter', 'Updated AIDD front matter template version.', {
        path: relativePath,
        detail: `${previousVersion} -> ${TEMPLATE_VERSION}`
      });
    } catch (error) {
      const message = `Could not write updated front matter in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'frontmatter', 'Failed to write updated Markdown front matter.', { path: relativePath, detail: message });
    }
  }

  pushRepairLog(logs, 'info', 'frontmatter', 'Completed Markdown front matter version scan.', {
    detail: `Updated: ${updated}; already current: ${alreadyCurrent}; skipped without AIDD front matter: ${skippedWithoutAidd}`
  });
}

async function upgradeTemplateManifest(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], now: string) {
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  let manifest: any = {};

  try {
    manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  } catch (error) {
    const message = `Could not parse aidd.template.json before upgrade: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-manifest', 'Failed to parse template manifest; leaving it unchanged.', { path: 'aidd.template.json', detail: message });
    return;
  }

  const next = {
    ...manifest,
    templateId: manifest.templateId || TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    upgradedAt: now
  };

  if (JSON.stringify(manifest) === JSON.stringify(next)) {
    pushRepairLog(logs, 'info', 'template-manifest', 'Template manifest already uses the current version.', { path: 'aidd.template.json' });
    return;
  }

  try {
    await writeJson(manifestPath, next);
    changes.push('Updated aidd.template.json to the current template version');
    pushRepairLog(logs, 'success', 'template-manifest', 'Updated template manifest version.', {
      path: 'aidd.template.json',
      detail: `${manifest.templateVersion || 'missing'} -> ${TEMPLATE_VERSION}`
    });
  } catch (error) {
    const message = `Could not write aidd.template.json: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-manifest', 'Failed to write template manifest.', { path: 'aidd.template.json', detail: message });
  }
}

async function upgradeProjectTemplates(projectPath: string): Promise<ProjectTemplateUpgradeReport> {
  if (!projectPath || !(await exists(projectPath))) throw new Error(`Project path does not exist: ${projectPath}`);

  const changes: string[] = [];
  const warnings: string[] = [];
  const logs: ProjectRepairLogEntry[] = [];
  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');
  const gitAvailable = await exists(path.join(projectPath, '.git'));
  let author: { name: string; email: string } | null = null;
  let preUpgradeCommit: string | undefined;
  let upgradeCommit: string | undefined;
  let logPath: string | undefined;

  pushRepairLog(logs, 'info', 'repair-start', 'Starting AIDD template/front matter repair.', { path: projectPath });

  if (gitAvailable) {
    pushRepairLog(logs, 'info', 'git-checkpoint', 'Git repository detected; attempting a pre-repair checkpoint if there are outstanding changes.', { path: '.git' });
    try {
      author = await getProjectGitAuthor(projectPath);
      const preCommit = await commitProjectChanges(projectPath, 'chore(project): checkpoint before AIDD template upgrade', author);
      if (preCommit.created) {
        preUpgradeCommit = preCommit.oid;
        changes.push(`Committed ${preCommit.changedFiles.length} outstanding file${preCommit.changedFiles.length === 1 ? '' : 's'} before template upgrade.`);
        pushRepairLog(logs, 'success', 'git-checkpoint', 'Created pre-repair Git checkpoint.', {
          path: '.git',
          detail: `${preCommit.oid}; files: ${preCommit.changedFiles.join(', ')}`
        });
      } else {
        pushRepairLog(logs, 'info', 'git-checkpoint', 'No outstanding Git changes needed a pre-repair checkpoint.', { path: '.git' });
      }
    } catch (error) {
      const message = `Could not create a pre-upgrade Git checkpoint: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'warning', 'git-checkpoint', 'Pre-repair Git checkpoint failed; repair will continue without automatic commits.', { path: '.git', detail: message });
      author = null;
    }
  } else {
    warnings.push('No local Git repository was found, so the template repair ran without before/after commits.');
    pushRepairLog(logs, 'info', 'git-checkpoint', 'No local Git repository found; repair will run without automatic commits.', { path: '.git' });
  }

  try {
    await syncBundledTemplateFiles(projectPath, changes, warnings, logs, stamp);
  } catch (error) {
    const message = `Template file sync failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-sync', 'Template sync failed unexpectedly.', { detail: message });
  }

  try {
    await upgradeMarkdownFrontmatterVersions(projectPath, changes, warnings, logs, now);
  } catch (error) {
    const message = `Front matter upgrade failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'frontmatter', 'Front matter upgrade failed unexpectedly.', { detail: message });
  }

  try {
    await upgradeTemplateManifest(projectPath, changes, warnings, logs, now);
  } catch (error) {
    const message = `Template manifest upgrade failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(message);
    pushRepairLog(logs, 'error', 'template-manifest', 'Template manifest upgrade failed unexpectedly.', { detail: message });
  }

  pushRepairLog(logs, 'info', 'validation', 'Running validation after repair.');
  const validation = await validateProject(projectPath);
  pushRepairLog(logs, validation.summary.errors ? 'error' : validation.summary.warnings ? 'warning' : 'success', 'validation', 'Completed validation after repair.', {
    detail: `Errors: ${validation.summary.errors}; warnings: ${validation.summary.warnings}`
  });
  logValidationIssues(logs, validation, 'validation-issues');

  try {
    logPath = await writeRepairLogFile(projectPath, `template-repair-${stamp}`, 'AIDD Template Repair Log', logs, changes, warnings);
    changes.push(`Wrote ${logPath}`);
  } catch (error) {
    warnings.push(`Could not write repair log: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (gitAvailable && author) {
    try {
      const postCommit = await commitProjectChanges(projectPath, 'chore(project): upgrade AIDD templates and front matter', author);
      if (postCommit.created) {
        upgradeCommit = postCommit.oid;
        changes.push(`Committed ${postCommit.changedFiles.length} template repair file${postCommit.changedFiles.length === 1 ? '' : 's'}.`);
        pushRepairLog(logs, 'success', 'git-checkpoint', 'Created template repair Git commit.', {
          path: '.git',
          detail: `${postCommit.oid}; files: ${postCommit.changedFiles.join(', ')}`
        });
      } else {
        changes.push('No template repair file changes were needed after the pre-upgrade checkpoint.');
        pushRepairLog(logs, 'info', 'git-checkpoint', 'No template repair changes needed a post-repair commit.', { path: '.git' });
      }
    } catch (error) {
      const message = `Could not create the template repair Git commit: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'warning', 'git-checkpoint', 'Template repair Git commit failed.', { path: '.git', detail: message });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    changed: changes.length > 0,
    preUpgradeCommit,
    upgradeCommit,
    changes,
    warnings,
    logs,
    logPath,
    validation
  };
}




interface ProjectRepairReport {
  generatedAt: string;
  changed: boolean;
  changes: string[];
  warnings: string[];
  logs: ProjectRepairLogEntry[];
  logPath?: string;
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

function logValidationIssues(logs: ProjectRepairLogEntry[], validation: ProjectValidationReport, stage: string) {
  const issues = validation.sections
    .flatMap((section) => section.items)
    .filter((item) => item.severity === 'error' || item.severity === 'warning');

  if (!issues.length) {
    pushRepairLog(logs, 'success', stage, 'Validation found no remaining errors or warnings.');
    return;
  }

  for (const item of issues.slice(0, 100)) {
    pushRepairLog(logs, item.severity, stage, `${item.title}: ${item.message}`, {
      path: item.path,
      detail: `Category: ${item.category}${item.action ? `; action: ${item.action}` : ''}`
    });
  }

  if (issues.length > 100) {
    pushRepairLog(logs, 'warning', stage, `Validation produced ${issues.length - 100} more issue${issues.length - 100 === 1 ? '' : 's'} not shown in this log.`, {
      detail: 'Open the Health Check screen for the full issue list.'
    });
  }
}

async function archiveObsoleteEntitySectionFiles(
  projectPath: string,
  rootDir: string,
  folder: string,
  obsoleteFiles: string[],
  stamp: string,
  changes: string[],
  logs: ProjectRepairLogEntry[]
) {
  for (const fileName of obsoleteFiles) {
    const source = path.join(projectPath, rootDir, folder, fileName);
    if (!(await exists(source))) continue;
    const archivePath = path.join(projectPath, '_archive', 'aidd-repair', stamp, rootDir, folder, fileName);
    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    await fsp.rename(source, archivePath);
    changes.push(`Archived obsolete ${rootDir}/${folder}/${fileName}`);
    pushRepairLog(logs, 'success', 'entity-repair', 'Archived obsolete entity section file.', {
      path: `${rootDir}/${folder}/${fileName}`,
      detail: `Archive: ${normaliseRelativePath(path.relative(projectPath, archivePath))}`
    });
  }
}


function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || slug;
}

function firstMarkdownHeading(content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

async function readEntityIndexMetadata(projectPath: string, rootDir: string, folder: string) {
  const indexPath = path.join(projectPath, rootDir, folder, 'index.md');
  if (!(await exists(indexPath))) return { title: titleFromSlug(folder), status: 'draft' as SetupStepStatus, sourceProjects: [] as string[] };
  const raw = await fsp.readFile(indexPath, 'utf8');
  const parsed = parseMarkdownSafe(raw);
  const aidd = parsed.ok ? ((parsed.parsed.data as any)?.aidd || {}) : {};
  const title = String(aidd.title || firstMarkdownHeading(raw) || titleFromSlug(folder)).trim();
  const status = String(aidd.status || (contentLooksComplete(raw) ? 'complete' : 'draft')) as SetupStepStatus;
  const sourceProjects = Array.isArray(aidd.sourceProjects) ? aidd.sourceProjects.map(String).filter(Boolean) : [];
  return { title, status, sourceProjects };
}

async function capabilitySlugsReferencingComponent(projectPath: string, componentSlug: string) {
  const capabilities = await readEntities(projectPath, 'capabilities', 'capability.json');
  const out: string[] = [];
  for (const capability of capabilities) {
    const linkedComponents = Array.isArray(capability.components)
      ? capability.components
      : Array.isArray(capability.modules)
        ? capability.modules
        : [];
    if (!linkedComponents.map(String).includes(componentSlug)) continue;
    const slug = String(capability.slug || capability.id || slugify(String(capability.title || ''))).trim();
    if (slug) out.push(slug);
  }
  return Array.from(new Set(out));
}

async function ensureComponentManifestForFolder(projectPath: string, folder: string, changes: string[], logs: ProjectRepairLogEntry[]) {
  const manifestPath = path.join(projectPath, 'components', folder, 'component.json');
  if (await exists(manifestPath)) return false;

  const { title, status, sourceProjects } = await readEntityIndexMetadata(projectPath, 'components', folder);
  const linkedCapabilities = await capabilitySlugsReferencingComponent(projectPath, folder);
  await writeJson(manifestPath, {
    slug: folder,
    title,
    kind: 'component',
    status,
    lifecycle: status,
    sourceProjects,
    createdAt: new Date().toISOString(),
    repairedAt: new Date().toISOString(),
    supportsCapabilities: linkedCapabilities,
    capabilitiesSupported: linkedCapabilities,
    dependsOn: [],
    exposes: [],
    dataOwned: [],
    template: {
      type: 'component',
      sectionFiles: COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  changes.push(`Rebuilt missing component manifest for components/${folder}`);
  pushRepairLog(logs, 'success', 'entity-repair', 'Rebuilt missing component manifest.', {
    path: `components/${folder}/component.json`,
    detail: `Title: ${title}; linked capabilities: ${linkedCapabilities.length ? linkedCapabilities.join(', ') : 'none'}`
  });
  return true;
}

async function archivePathForRepair(projectPath: string, stamp: string, relativePath: string) {
  return path.join(projectPath, '_archive', 'aidd-repair', stamp, relativePath);
}


function markdownBodyWithoutFrontmatter(content: string) {
  const parsed = parseMarkdownSafe(content);
  if (parsed.ok) return String(parsed.parsed.content || '').replace(/^\s*\n/, '').trim();
  return content.replace(/^---[\s\S]*?---\s*/m, '').trim();
}

function markdownContentScore(body: string) {
  return body
    .replace(/^#\s+.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .replace(/Describe what this system is and what product context every delivery package should inherit\.?/gi, '')
    .replace(/Describe what the system is, what it should make possible, and the product context every delivery package should inherit\.?/gi, '')
    .replace(/Describe who uses the system, who maintains it, and what outcomes matter to them\.?/gi, '')
    .replace(/Describe the measurable goals, outcomes, or success signals this project should optimise for\.?/gi, '')
    .replace(/No active .+ yet\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function hasUsefulMarkdownBody(body: string) {
  return markdownContentScore(body) > 24;
}

function markdownStatus(content: string): SetupStepStatus {
  const parsed = parseMarkdownSafe(content);
  const data = parsed.ok ? ((parsed.parsed.data || {}) as Record<string, any>) : {};
  return normalizeSetupStatus(data?.aidd?.status || data?.status || (contentLooksComplete(content) ? 'draft' : 'not-started'));
}

function strongestStatus(a: SetupStepStatus, b: SetupStepStatus): SetupStepStatus {
  const rank: Record<SetupStepStatus, number> = {
    'not-started': 0,
    draft: 1,
    skipped: 1,
    'in-review': 2,
    active: 3,
    complete: 4,
    deprecated: 5
  };
  return rank[b] > rank[a] ? b : a;
}

function mergeMarkdownIntoExistingFrontmatter(existingRaw: string, body: string, status: SetupStepStatus) {
  const parsed = parseMarkdownSafe(existingRaw);
  const data: Record<string, any> = parsed.ok ? { ...(parsed.parsed.data || {}) } : {};
  data.aidd = {
    ...(data.aidd || {}),
    status,
    templateVersion: data.aidd?.templateVersion || TEMPLATE_VERSION,
    updatedAt: new Date().toISOString()
  };
  return matter.stringify(body.trim() + '\n', data);
}

async function mergeLegacyMarkdownConflict(
  projectPath: string,
  stamp: string,
  oldRelative: string,
  newRelative: string,
  changes: string[],
  logs: ProjectRepairLogEntry[]
) {
  if (!oldRelative.toLowerCase().endsWith('.md') || !newRelative.toLowerCase().endsWith('.md')) return false;

  const oldPath = path.join(projectPath, oldRelative);
  const newPath = path.join(projectPath, newRelative);
  if (!(await exists(oldPath)) || !(await exists(newPath))) return false;

  const legacyRaw = await fsp.readFile(oldPath, 'utf8');
  const currentRaw = await fsp.readFile(newPath, 'utf8');
  const legacyBody = markdownBodyWithoutFrontmatter(legacyRaw);
  if (!hasUsefulMarkdownBody(legacyBody)) return false;

  const currentBody = markdownBodyWithoutFrontmatter(currentRaw);
  const currentHasUsefulContent = hasUsefulMarkdownBody(currentBody);
  const legacyStatus = markdownStatus(legacyRaw);
  const currentStatus = markdownStatus(currentRaw);
  let nextBody = currentBody;

  if (!currentHasUsefulContent) {
    nextBody = legacyBody;
  } else if (!currentBody.includes(legacyBody.trim())) {
    nextBody = `${currentBody.trim()}\n\n## Migrated legacy content\n\n${legacyBody.trim()}`;
  }

  const nextStatus = strongestStatus(currentHasUsefulContent ? currentStatus : 'not-started', legacyStatus);
  await fsp.writeFile(newPath, mergeMarkdownIntoExistingFrontmatter(currentRaw, nextBody, nextStatus), 'utf8');

  const archivePath = await archivePathForRepair(projectPath, stamp, oldRelative);
  await fsp.mkdir(path.dirname(archivePath), { recursive: true });
  await fsp.rename(oldPath, archivePath);

  changes.push(`Merged legacy ${oldRelative} into ${newRelative}`);
  pushRepairLog(logs, 'success', 'data-repair', 'Merged legacy Markdown content before archiving legacy file.', {
    path: newRelative,
    detail: `${oldRelative} -> ${newRelative}; archive: ${normaliseRelativePath(path.relative(projectPath, archivePath))}`
  });
  return true;
}

function summaryFromMarkdownBody(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-*]\s*TODO:?/i.test(line) && !/^TODO:?/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

function descriptionIsMissingOrPlaceholder(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^no description provided\.?$/i.test(text) || /^describe what/i.test(text) || /^todo:?$/i.test(text);
}

async function refreshProjectSummaryMetadata(projectPath: string, changes: string[], logs: ProjectRepairLogEntry[]) {
  const productDefinitionPath = path.join(projectPath, 'foundation', '02-product-definition.md');
  if (!(await exists(productDefinitionPath))) return;

  const productBody = markdownBodyWithoutFrontmatter(await fsp.readFile(productDefinitionPath, 'utf8'));
  const summary = summaryFromMarkdownBody(productBody);
  if (!summary || descriptionIsMissingOrPlaceholder(summary)) return;

  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await readJsonSafe<any>(manifestPath);
  if (manifest.ok && descriptionIsMissingOrPlaceholder(manifest.data?.project?.description)) {
    manifest.data.project = { ...(manifest.data.project || {}), description: summary };
    await writeJson(manifestPath, manifest.data);
    changes.push('Updated project summary metadata from Product Definition');
    pushRepairLog(logs, 'success', 'data-repair', 'Updated project manifest summary from Product Definition.', { path: 'aidd.template.json' });
  }

  const projects = await readProjects();
  let changedTrackedProject = false;
  const nextProjects = projects.map((project) => {
    if (project.path !== projectPath || !descriptionIsMissingOrPlaceholder(project.description)) return project;
    changedTrackedProject = true;
    return { ...project, description: summary };
  });
  if (changedTrackedProject) {
    await writeProjects(nextProjects);
    changes.push('Updated tracked project summary from Product Definition');
    pushRepairLog(logs, 'success', 'data-repair', 'Updated tracked project summary from Product Definition.', { path: projectsStorePath() });
  }
}

async function moveOrArchiveLegacyEntry(
  projectPath: string,
  stamp: string,
  oldRelative: string,
  newRelative: string,
  changes: string[],
  logs: ProjectRepairLogEntry[]
) {
  const oldPath = path.join(projectPath, oldRelative);
  const newPath = path.join(projectPath, newRelative);
  if (!(await exists(oldPath))) return;

  if (!(await exists(newPath))) {
    await fsp.mkdir(path.dirname(newPath), { recursive: true });
    await fsp.rename(oldPath, newPath);
    changes.push(`Migrated ${oldRelative} to ${newRelative}`);
    pushRepairLog(logs, 'success', 'data-repair', 'Migrated legacy path.', {
      path: newRelative,
      detail: `${oldRelative} -> ${newRelative}`
    });
    return;
  }

  if (await mergeLegacyMarkdownConflict(projectPath, stamp, oldRelative, newRelative, changes, logs)) return;

  const archivePath = await archivePathForRepair(projectPath, stamp, oldRelative);
  await fsp.mkdir(path.dirname(archivePath), { recursive: true });
  await fsp.rename(oldPath, archivePath);
  changes.push(`Archived legacy ${oldRelative}`);
  pushRepairLog(logs, 'success', 'data-repair', 'Archived legacy path that conflicted with current layout.', {
    path: oldRelative,
    detail: `Archive: ${normaliseRelativePath(path.relative(projectPath, archivePath))}`
  });
}

async function migrateLegacyFolderContents(
  projectPath: string,
  stamp: string,
  oldRelative: string,
  newRelative: string,
  changes: string[],
  logs: ProjectRepairLogEntry[]
) {
  const oldPath = path.join(projectPath, oldRelative);
  if (!(await exists(oldPath))) return;

  const newPath = path.join(projectPath, newRelative);
  await fsp.mkdir(newPath, { recursive: true });

  for (const entry of await fsp.readdir(oldPath, { withFileTypes: true })) {
    await moveOrArchiveLegacyEntry(
      projectPath,
      stamp,
      `${oldRelative}/${entry.name}`,
      `${newRelative}/${entry.name}`,
      changes,
      logs
    );
  }

  try {
    await fsp.rm(oldPath, { recursive: true, force: true });
    changes.push(`Removed legacy folder ${oldRelative}`);
    pushRepairLog(logs, 'success', 'data-repair', 'Removed legacy folder after migration/archive.', { path: oldRelative });
  } catch (error) {
    pushRepairLog(logs, 'warning', 'data-repair', 'Could not remove legacy folder after migration/archive.', {
      path: oldRelative,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function repairEntitySectionDocuments(projectPath: string, stamp: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[]) {
  pushRepairLog(logs, 'info', 'entity-repair', 'Checking capability and component section files.');

  let repaired = 0;

  for (const folder of await listEntityFolders(projectPath, 'components')) {
    try {
      await ensureComponentManifestForFolder(projectPath, folder, changes, logs);
      const component = await readComponent({ projectPath, slug: folder });
      const missing = component.sections
        .map((section: any) => section.fileName)
        .filter((fileName: string) => !fs.existsSync(path.join(projectPath, 'components', folder, fileName)));
      const obsoletePresent = OBSOLETE_COMPONENT_SECTION_FILES.filter((fileName) => fs.existsSync(path.join(projectPath, 'components', folder, fileName)));
      const manifestPath = path.join(projectPath, 'components', folder, 'component.json');
      const manifest = await readJsonSafe<any>(manifestPath);
      const configuredFiles = manifest.ok && Array.isArray(manifest.data.template?.sectionFiles)
        ? manifest.data.template.sectionFiles.map((value: unknown) => String(value))
        : [];
      const expectedFiles = COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName);
      const manifestOutOfSync = expectedFiles.some((fileName) => !configuredFiles.includes(fileName)) || configuredFiles.some((fileName: string) => !expectedFiles.includes(fileName));

      if (!missing.length && !obsoletePresent.length && !manifestOutOfSync) continue;

      await updateComponent({
        projectPath,
        slug: folder,
        title: component.title,
        status: component.status as SetupStepStatus,
        sourceProjects: component.sourceProjects,
        capabilities: component.capabilities,
        sections: component.sections
      });
      await archiveObsoleteEntitySectionFiles(projectPath, 'components', folder, obsoletePresent, stamp, changes, logs);
      changes.push(`Normalised component section files for components/${folder}`);
      repaired++;
      pushRepairLog(logs, 'success', 'entity-repair', 'Normalised component section files.', {
        path: `components/${folder}`,
        detail: `Missing restored: ${missing.length ? missing.join(', ') : 'none'}; obsolete archived: ${obsoletePresent.length ? obsoletePresent.join(', ') : 'none'}; manifest updated: ${manifestOutOfSync ? 'yes' : 'no'}`
      });
    } catch (error) {
      const message = `Could not repair component section files for ${folder}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'entity-repair', 'Failed to normalise component section files.', { path: `components/${folder}`, detail: message });
    }
  }

  for (const folder of await listEntityFolders(projectPath, 'capabilities')) {
    try {
      const capability = await readCapability({ projectPath, slug: folder });
      const missing = capability.sections
        .map((section: any) => section.fileName)
        .filter((fileName: string) => !fs.existsSync(path.join(projectPath, 'capabilities', folder, fileName)));
      const obsoletePresent = OBSOLETE_CAPABILITY_SECTION_FILES.filter((fileName) => fs.existsSync(path.join(projectPath, 'capabilities', folder, fileName)));
      const manifestPath = path.join(projectPath, 'capabilities', folder, 'capability.json');
      const manifest = await readJsonSafe<any>(manifestPath);
      const configuredFiles = manifest.ok && Array.isArray(manifest.data.template?.sectionFiles)
        ? manifest.data.template.sectionFiles.map((value: unknown) => String(value))
        : [];
      const expectedFiles = CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName);
      const manifestOutOfSync = expectedFiles.some((fileName) => !configuredFiles.includes(fileName)) || configuredFiles.some((fileName: string) => !expectedFiles.includes(fileName));

      if (!missing.length && !obsoletePresent.length && !manifestOutOfSync && !Array.isArray((manifest.ok ? manifest.data.modules : undefined))) continue;

      await updateCapability({
        projectPath,
        slug: folder,
        title: capability.title,
        description: capability.description,
        outcome: capability.outcome,
        notes: capability.notes,
        status: capability.status as SetupStepStatus,
        componentSlugs: capability.components,
        sections: capability.sections
      });
      await archiveObsoleteEntitySectionFiles(projectPath, 'capabilities', folder, obsoletePresent, stamp, changes, logs);
      changes.push(`Normalised capability section files for capabilities/${folder}`);
      repaired++;
      pushRepairLog(logs, 'success', 'entity-repair', 'Normalised capability section files.', {
        path: `capabilities/${folder}`,
        detail: `Missing restored: ${missing.length ? missing.join(', ') : 'none'}; obsolete archived: ${obsoletePresent.length ? obsoletePresent.join(', ') : 'none'}; manifest updated: ${manifestOutOfSync ? 'yes' : 'no'}`
      });
    } catch (error) {
      const message = `Could not repair capability section files for ${folder}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'entity-repair', 'Failed to normalise capability section files.', { path: `capabilities/${folder}`, detail: message });
    }
  }

  if (repaired === 0) {
    pushRepairLog(logs, 'info', 'entity-repair', 'No capability or component section files needed repair.');
  }
}

async function repairProject(projectPath: string): Promise<ProjectRepairReport> {
  if (!projectPath || !(await exists(projectPath))) throw new Error(`Project path does not exist: ${projectPath}`);
  const changes: string[] = [];
  const warnings: string[] = [];
  const logs: ProjectRepairLogEntry[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let logPath: string | undefined;
  const rel = (target: string) => path.relative(projectPath, target).split('\\').join('/');

  pushRepairLog(logs, 'info', 'repair-start', 'Starting safe AIDD data repair.', { path: projectPath });

  async function ensureDir(relativePath: string) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) {
      await fsp.mkdir(target, { recursive: true });
      changes.push(`Created directory ${relativePath}`);
      pushRepairLog(logs, 'success', 'data-repair', 'Created missing directory.', { path: relativePath });
    }
  }

  async function writeRepairFile(relativePath: string, content: string) {
    const target = path.join(projectPath, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, 'utf8');
    changes.push(`Wrote ${relativePath}`);
    pushRepairLog(logs, 'success', 'data-repair', 'Wrote repair file.', { path: relativePath });
  }

  async function migrateFolder(oldRelative: string, newRelative: string) {
    const oldPath = path.join(projectPath, oldRelative);
    const newPath = path.join(projectPath, newRelative);
    if ((await exists(oldPath)) && !(await exists(newPath))) {
      await fsp.mkdir(path.dirname(newPath), { recursive: true });
      await fsp.rename(oldPath, newPath);
      changes.push(`Renamed ${oldRelative} to ${newRelative}`);
      pushRepairLog(logs, 'success', 'data-repair', 'Migrated legacy folder.', { path: newRelative, detail: `${oldRelative} -> ${newRelative}` });
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
    } catch (error) {
      const message = `${relativePath} exists but is not valid JSON. It was left unchanged.`;
      warnings.push(message);
      pushRepairLog(logs, 'warning', 'data-repair', message, { path: relativePath, detail: error instanceof Error ? error.message : String(error) });
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
      pushRepairLog(logs, 'success', 'data-repair', 'Added missing AIDD front matter to Markdown file.', { path: relativePath });
    }
  }

  async function archiveObsoleteFoundation(relativePath: string) {
    const target = path.join(projectPath, relativePath);
    if (!(await exists(target))) return;
    const content = await fsp.readFile(target, 'utf8');
    const body = markdownBodyWithoutFrontmatter(content);
    if (!hasUsefulMarkdownBody(body)) {
      const archivePath = await archivePathForRepair(projectPath, stamp, relativePath);
      await fsp.mkdir(path.dirname(archivePath), { recursive: true });
      await fsp.rename(target, archivePath);
      changes.push(`Archived obsolete empty file ${relativePath}`);
      pushRepairLog(logs, 'success', 'data-repair', 'Archived obsolete empty file.', { path: relativePath, detail: `Archive: ${rel(archivePath)}` });
    } else {
      const message = `${relativePath} is obsolete but contains content. It was left in place so summary/context is not lost.`;
      warnings.push(message);
      pushRepairLog(logs, 'warning', 'data-repair', message, { path: relativePath });
    }
  }


  async function findArchivedRepairFiles(relativePath: string) {
    const candidates: string[] = [];
    const repairArchiveRoot = path.join(projectPath, '_archive', 'aidd-repair');
    if (await exists(repairArchiveRoot)) {
      const entries = await fsp.readdir(repairArchiveRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(repairArchiveRoot, entry.name, relativePath);
        if (await exists(candidate)) candidates.push(candidate);
      }
    }

    const directArchive = path.join(projectPath, '_archive', relativePath);
    if (await exists(directArchive)) candidates.push(directArchive);

    return candidates.sort((a, b) => b.localeCompare(a));
  }

  async function restoreArchivedSummaryContent(archiveRelative: string, targetRelative: string) {
    const targetPath = path.join(projectPath, targetRelative);
    if (!(await exists(targetPath))) return;

    for (const archivePath of await findArchivedRepairFiles(archiveRelative)) {
      const archivedRaw = await fsp.readFile(archivePath, 'utf8');
      const archivedBody = markdownBodyWithoutFrontmatter(archivedRaw);
      if (!hasUsefulMarkdownBody(archivedBody)) continue;

      const currentRaw = await fsp.readFile(targetPath, 'utf8');
      const currentBody = markdownBodyWithoutFrontmatter(currentRaw);
      if (currentBody.includes(archivedBody.trim())) return;

      const currentHasUsefulContent = hasUsefulMarkdownBody(currentBody);
      const nextBody = currentHasUsefulContent
        ? `${currentBody.trim()}\n\n## Restored archived summary content\n\n${archivedBody.trim()}`
        : archivedBody;
      const nextStatus = strongestStatus(currentHasUsefulContent ? markdownStatus(currentRaw) : 'not-started', markdownStatus(archivedRaw));
      await fsp.writeFile(targetPath, mergeMarkdownIntoExistingFrontmatter(currentRaw, nextBody, nextStatus), 'utf8');
      changes.push(`Restored archived ${archiveRelative} into ${targetRelative}`);
      pushRepairLog(logs, 'success', 'data-repair', 'Restored archived summary/context content.', {
        path: targetRelative,
        detail: `${normaliseRelativePath(path.relative(projectPath, archivePath))} -> ${targetRelative}`
      });
      return;
    }
  }

  await migrateFolder('common', 'foundation');
  await migrateFolder('modules', 'components');
  await migrateFolder('bundles', 'delivery/packages');
  await migrateLegacyFolderContents(projectPath, stamp, 'common', 'foundation', changes, logs);
  await migrateLegacyFolderContents(projectPath, stamp, 'modules', 'components', changes, logs);
  await migrateLegacyFolderContents(projectPath, stamp, 'bundles', 'delivery/packages', changes, logs);
  await migrateLegacyFolderContents(projectPath, stamp, 'delivery/bundles', 'delivery/packages', changes, logs);

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


  await ensureMarkdown(
    'capabilities/index.md',
    'capabilities-index',
    'capabilities-index',
    'Capabilities',
    '# Capabilities\n\nCapabilities describe things the system can do. They are user-value focused and may touch one or many components.\n\n## Active capabilities\n\nNo active capabilities yet.'
  );

  await ensureMarkdown(
    'components/index.md',
    'components-index',
    'components-index',
    'Components',
    '# Components\n\nComponents are reusable implementation units, services, plugins, workflows, tools, data stores, or subsystems that help deliver capabilities.\n\n## Active components\n\nNo active components yet.'
  );

  await ensureMarkdown(
    'delivery/packages/index.md',
    'delivery-packages-index',
    'delivery-packages-index',
    'Delivery Packages',
    '# Delivery Packages\n\nDelivery packages are focused implementation slices that connect capability intent, component context, source code, acceptance checks, and handoff evidence.\n\n## Active delivery packages\n\nNo active delivery packages yet.'
  );

  await restoreArchivedSummaryContent('common/01-project-overview.md', 'foundation/02-product-definition.md');
  await restoreArchivedSummaryContent('common/02-product-definition.md', 'foundation/02-product-definition.md');
  await restoreArchivedSummaryContent('common/03-audience-and-users.md', 'foundation/03-audience-and-users.md');
  await restoreArchivedSummaryContent('foundation/01-project-overview.md', 'foundation/02-product-definition.md');
  await mergeLegacyMarkdownConflict(projectPath, stamp, 'foundation/01-project-overview.md', 'foundation/02-product-definition.md', changes, logs);
  await archiveObsoleteFoundation('foundation/01-project-overview.md');
  await archiveObsoleteFoundation('foundation/04-decisions.md');
  await archiveObsoleteFoundation('foundation/05-decision-ledger.md');
  await archiveObsoleteFoundation('foundation/06-delivery-rules.md');
  await refreshProjectSummaryMetadata(projectPath, changes, logs);

  await repairEntitySectionDocuments(projectPath, stamp, changes, warnings, logs);

  pushRepairLog(logs, 'info', 'validation', 'Running validation after safe data repair.');
  const validation = await validateProject(projectPath);
  pushRepairLog(logs, validation.summary.errors ? 'error' : validation.summary.warnings ? 'warning' : 'success', 'validation', 'Completed validation after safe data repair.', {
    detail: `Errors: ${validation.summary.errors}; warnings: ${validation.summary.warnings}`
  });
  logValidationIssues(logs, validation, 'validation-issues');

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

  try {
    logPath = await writeRepairLogFile(projectPath, `data-repair-${stamp}`, 'AIDD Data Repair Log', logs, changes, warnings);
    changes.push(`Wrote ${logPath}`);
  } catch (error) {
    warnings.push(`Could not write data repair log: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    changed: changes.length > 0,
    changes,
    warnings,
    logs,
    logPath,
    validation
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
      skipReason: input?.skipReason?.trim() || '',
      prompt: template.prompt
    };
  });
}

function buildComponentSectionMarkdown(input: { slug: string; componentTitle: string; section: ReturnType<typeof normaliseComponentSections>[number]; status: string; sourceProjects: string[]; capabilities: string[] }) {
  const body = input.section.body?.trim() || input.section.prompt;
  const sectionAidd: Record<string, unknown> = {
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
  };
  if (input.section.status === 'skipped' && input.section.skipReason?.trim()) {
    sectionAidd.skipReason = input.section.skipReason.trim();
  }

  return matter.stringify([
    `# ${input.componentTitle} ${input.section.title}`,
    '',
    body,
    ''
  ].join('\n'), {
    aidd: sectionAidd
  });
}

function buildComponentIndexMarkdown(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: ReturnType<typeof normaliseComponentSections> }) {
  return matter.stringify([
    `# ${input.title}`,
    '',
    'This component is managed by AIDD as a set of template-backed section files.',
    '',
    '## Sections',
    '',
    ...input.sections.map((section) => `- [${section.title}](./${section.fileName})`),
    '',
    '## Source',
    '',
    componentSourceDisplay(input.source),
    '',
    '## Source Projects',
    '',
    input.sourceProjects.length ? input.sourceProjects.map((project) => `- ${project}`).join('\n') : 'No legacy source projects linked.',
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
      source: input.source,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

type NormalisedComponentSection = ReturnType<typeof normaliseComponentSections>[number];

const COMPONENT_SOURCE_TYPES = new Set([
  'webapp',
  'desktop-app',
  'plugin',
  'library',
  'service',
  'api',
  'cli',
  'game-module',
  'shared-module',
  'test-suite',
  'other'
]);

const SOURCE_SCAN_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'bin',
  'obj',
  'Intermediate',
  'Saved',
  'Binaries'
]);

const SOURCE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.csproj': 'C# Project',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.mdx': 'MDX',
  '.md': 'Markdown'
};

function normaliseComponentSourceDetection(input?: Partial<ComponentSourceDetection> | null): ComponentSourceDetection | null {
  if (!input) return null;
  const reasons = Array.isArray(input.reasons) ? input.reasons.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const detectedLanguages = Array.isArray(input.detectedLanguages) ? input.detectedLanguages.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const detectedFrameworks = Array.isArray(input.detectedFrameworks) ? input.detectedFrameworks.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const suggestedType = normaliseComponentSourceType(input.suggestedType);
  const confidence = input.confidence === 'high' || input.confidence === 'medium' || input.confidence === 'low' ? input.confidence : 'low';
  if (!reasons.length && !detectedLanguages.length && !detectedFrameworks.length && suggestedType === 'other') return null;
  return {
    suggestedType,
    confidence,
    detectedLanguages: Array.from(new Set(detectedLanguages)),
    detectedFrameworks: Array.from(new Set(detectedFrameworks)),
    ...(input.packageManager ? { packageManager: String(input.packageManager) } : {}),
    reasons
  };
}

function normaliseComponentSourceType(value?: string | null) {
  const normalised = String(value || '').trim() || 'other';
  return COMPONENT_SOURCE_TYPES.has(normalised) ? normalised : 'other';
}

function normaliseComponentSource(input?: Partial<ComponentSourceConfig> | null): ComponentSourceConfig {
  return {
    directory: String(input?.directory || '').trim().replace(/\\/g, '/'),
    type: normaliseComponentSourceType(input?.type),
    detection: normaliseComponentSourceDetection((input as any)?.detection)
  };
}

function componentSourceIsConfigured(source?: Partial<ComponentSourceConfig> | null) {
  return Boolean(String(source?.directory || '').trim());
}

function componentSourceDisplay(source: ComponentSourceConfig) {
  if (!componentSourceIsConfigured(source)) return 'Source location has not been configured for this component.';
  const detection = normaliseComponentSourceDetection(source.detection);
  const lines = [
    `- Type: \`${source.type || 'other'}\``,
    `- Directory: \`${source.directory}\``
  ];
  if (detection) {
    lines.push(`- Detection confidence: \`${detection.confidence}\``);
    lines.push(`- Suggested type: \`${detection.suggestedType}\``);
    if (detection.packageManager) lines.push(`- Package manager: \`${detection.packageManager}\``);
    if (detection.detectedFrameworks.length) lines.push(`- Detected frameworks: ${detection.detectedFrameworks.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.detectedLanguages.length) lines.push(`- Detected languages: ${detection.detectedLanguages.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.reasons.length) {
      lines.push('- Detection evidence:');
      for (const reason of detection.reasons) lines.push(`  - ${reason}`);
    }
  }
  return lines.join('\n');
}

function componentSourceDirectoryToStoredPath(projectPath: string, absolutePath: string) {
  const relative = path.relative(projectPath, absolutePath);
  if (relative === '') return '.';
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return normaliseRelativePath(relative);
  }
  return path.resolve(absolutePath).replace(/\\/g, '/');
}

function resolveComponentSourceDirectory(projectPath: string, sourceDirectory?: string | null) {
  const value = String(sourceDirectory || '').trim();
  if (!value) return projectPath;
  return path.isAbsolute(value) ? value : path.resolve(projectPath, value);
}

async function collectSourceFileEvidence(root: string, maxDepth = 5, maxFiles = 2500) {
  const files: string[] = [];
  const extensionCounts = new Map<string, number>();

  async function visit(dir: string, depth: number) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (SOURCE_SCAN_IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = path.join(dir, entry.name);
      const relative = normaliseRelativePath(path.relative(root, absolute));
      files.push(relative);
      const lowerName = entry.name.toLowerCase();
      const extension = lowerName.endsWith('.build.cs') ? '.build.cs' : path.extname(lowerName);
      if (extension) extensionCounts.set(extension, (extensionCounts.get(extension) || 0) + 1);
    }
  }

  await visit(root, 0);
  return { files, extensionCounts };
}

async function readJsonIfPresent(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function dependencyNames(packageJson: any) {
  const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return new Set(groups.flatMap((group) => Object.keys(packageJson?.[group] || {})));
}

function detectPackageManager(files: Set<string>) {
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('package-lock.json')) return 'npm';
  return undefined;
}

function topLanguages(extensionCounts: Map<string, number>) {
  return Array.from(extensionCounts.entries())
    .map(([extension, count]) => ({ language: SOURCE_LANGUAGE_BY_EXTENSION[extension], count }))
    .filter((item): item is { language: string; count: number } => Boolean(item.language))
    .sort((a, b) => b.count - a.count)
    .map((item) => item.language)
    .filter((language, index, all) => all.indexOf(language) === index)
    .slice(0, 6);
}

async function detectComponentSourceDirectory(directoryPath: string): Promise<ComponentSourceDetection> {
  const root = path.resolve(directoryPath);
  const { files, extensionCounts } = await collectSourceFileEvidence(root);
  const fileSet = new Set(files.map((file) => file.toLowerCase()));
  const basenames = new Set(files.map((file) => path.basename(file).toLowerCase()));
  const packageJson = await readJsonIfPresent(path.join(root, 'package.json'));
  const deps = dependencyNames(packageJson);
  const reasons: string[] = [];
  const frameworks = new Set<string>();
  const languages = topLanguages(extensionCounts);
  const packageManager = detectPackageManager(fileSet);

  const hasFile = (fileName: string) => fileSet.has(fileName.toLowerCase()) || basenames.has(fileName.toLowerCase());
  const hasAnyFile = (...fileNames: string[]) => fileNames.some(hasFile);
  const hasDep = (...names: string[]) => names.some((name) => deps.has(name));
  const hasRelativeMatch = (predicate: (file: string) => boolean) => files.some((file) => predicate(file.toLowerCase()));

  let suggestedType = 'other';
  let confidence: ComponentSourceDetectionConfidence = 'low';
  let confidenceRank = 1;
  const confidenceRanks: Record<ComponentSourceDetectionConfidence, number> = { low: 1, medium: 2, high: 3 };

  const useSuggestion = (type: string, nextConfidence: ComponentSourceDetectionConfidence, reason: string) => {
    const nextRank = confidenceRanks[nextConfidence];
    if (nextRank >= confidenceRank) {
      suggestedType = type;
      confidence = nextConfidence;
      confidenceRank = nextRank;
    }
    reasons.push(reason);
  };

  if (packageJson) reasons.push('package.json found.');
  if (packageManager) reasons.push(`${packageManager} lockfile found.`);

  if (hasAnyFile('tauri.conf.json') || hasRelativeMatch((file) => file.endsWith('/tauri.conf.json'))) {
    frameworks.add('Tauri');
    useSuggestion('desktop-app', 'high', 'Tauri configuration found.');
  }
  if (hasDep('electron') || hasAnyFile('electron-builder.json', 'electron.vite.config.ts', 'electron.vite.config.js')) {
    frameworks.add('Electron');
    useSuggestion('desktop-app', 'high', 'Electron dependency or configuration found.');
  }

  if (hasRelativeMatch((file) => file.endsWith('.uproject'))) {
    frameworks.add('Unreal Engine');
    useSuggestion('game-module', 'high', 'Unreal .uproject file found.');
  }
  if (hasRelativeMatch((file) => file.endsWith('.uplugin'))) {
    frameworks.add('Unreal Plugin');
    useSuggestion('plugin', 'high', 'Unreal .uplugin file found.');
  }
  if (hasRelativeMatch((file) => file.endsWith('.build.cs'))) {
    frameworks.add('Unreal Build');
    useSuggestion(suggestedType === 'plugin' ? 'plugin' : 'game-module', 'medium', 'Unreal Build.cs file found.');
  }

  const manifest = await readJsonIfPresent(path.join(root, 'manifest.json'));
  if (manifest?.manifest_version && (manifest.background || manifest.content_scripts || manifest.action || manifest.browser_action)) {
    frameworks.add('Browser extension');
    useSuggestion('plugin', 'high', 'Browser extension manifest found.');
  }

  if (hasDep('next') || hasAnyFile('next.config.js', 'next.config.mjs', 'next.config.ts')) {
    frameworks.add('Next.js');
    useSuggestion('webapp', 'high', 'Next.js dependency or configuration found.');
  }
  if (hasDep('astro') || hasAnyFile('astro.config.js', 'astro.config.mjs', 'astro.config.ts')) {
    frameworks.add('Astro');
    useSuggestion('webapp', 'high', 'Astro dependency or configuration found.');
  }
  if (hasDep('@angular/core') || hasAnyFile('angular.json')) {
    frameworks.add('Angular');
    useSuggestion('webapp', 'high', 'Angular dependency or workspace file found.');
  }
  if (hasDep('vite') || hasAnyFile('vite.config.js', 'vite.config.mjs', 'vite.config.ts')) {
    frameworks.add('Vite');
    if (hasDep('react')) frameworks.add('React');
    if (hasDep('vue')) frameworks.add('Vue');
    if (hasDep('svelte')) frameworks.add('Svelte');
    useSuggestion('webapp', confidenceRank >= confidenceRanks.high ? 'medium' : 'high', 'Vite configuration or dependency found.');
  }
  if (hasDep('react') || hasDep('vue') || hasDep('svelte') || hasDep('solid-js')) {
    if (hasDep('react')) frameworks.add('React');
    if (hasDep('vue')) frameworks.add('Vue');
    if (hasDep('svelte')) frameworks.add('Svelte');
    if (hasDep('solid-js')) frameworks.add('Solid');
    useSuggestion('webapp', confidenceRank >= confidenceRanks.high ? 'medium' : 'medium', 'Front-end framework dependency found.');
  }

  if (packageJson?.bin && Object.keys(packageJson.bin).length) {
    useSuggestion('cli', 'high', 'package.json exposes a bin entry.');
  }

  if (hasDep('express', 'fastify', '@nestjs/core', 'hono', 'koa', 'elysia', '@apollo/server') || hasAnyFile('openapi.yaml', 'openapi.yml', 'swagger.yaml', 'swagger.yml')) {
    if (hasDep('@nestjs/core')) frameworks.add('NestJS');
    if (hasDep('express')) frameworks.add('Express');
    if (hasDep('fastify')) frameworks.add('Fastify');
    if (hasDep('hono')) frameworks.add('Hono');
    if (hasDep('koa')) frameworks.add('Koa');
    useSuggestion(suggestedType === 'webapp' || suggestedType === 'desktop-app' ? suggestedType : 'api', suggestedType === 'webapp' || suggestedType === 'desktop-app' ? 'medium' : 'high', 'API/server framework or OpenAPI file found.');
  }

  if (hasAnyFile('playwright.config.ts', 'playwright.config.js', 'cypress.config.ts', 'cypress.config.js', 'vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js')) {
    frameworks.add('Test tooling');
    if (suggestedType === 'other') useSuggestion('test-suite', 'medium', 'Dedicated test tool configuration found.');
    else reasons.push('Test tool configuration found.');
  }

  const hasLibraryShape = Boolean(packageJson?.exports || packageJson?.types || packageJson?.typings || packageJson?.main || hasAnyFile('index.ts', 'index.js', 'src/index.ts', 'src/index.js'));
  if (hasLibraryShape && suggestedType === 'other') {
    useSuggestion('library', packageJson ? 'medium' : 'low', 'Library-style entry point or package metadata found.');
  }

  if (!reasons.length) {
    reasons.push(files.length ? 'Source files found, but no strong framework indicators were detected.' : 'No source files or known project indicators were detected.');
  }

  return {
    suggestedType: normaliseComponentSourceType(suggestedType),
    confidence,
    detectedLanguages: languages,
    detectedFrameworks: Array.from(frameworks).sort(),
    ...(packageManager ? { packageManager } : {}),
    reasons: Array.from(new Set(reasons)).slice(0, 12)
  };
}

async function selectComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection | null> {
  const currentDirectory = input.currentDirectory || input.directory || '';
  const defaultPath = currentDirectory ? resolveComponentSourceDirectory(input.projectPath, currentDirectory) : input.projectPath;
  const result = await dialog.showOpenDialog({
    title: 'Select component source directory',
    defaultPath: await exists(defaultPath) ? defaultPath : input.projectPath,
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const absolutePath = path.resolve(result.filePaths[0]);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    directory: componentSourceDirectoryToStoredPath(input.projectPath, absolutePath),
    absolutePath: absolutePath.replace(/\\/g, '/'),
    detection
  };
}

async function detectStoredComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection> {
  if (!input.directory?.trim()) throw new Error('Source directory is required.');
  const absolutePath = resolveComponentSourceDirectory(input.projectPath, input.directory);
  if (!(await exists(absolutePath))) throw new Error(`Source directory does not exist: ${input.directory}`);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    directory: componentSourceDirectoryToStoredPath(input.projectPath, absolutePath),
    absolutePath: absolutePath.replace(/\\/g, '/'),
    detection
  };
}

type ComponentContractStatus = ComponentContractInfo['status'];

function componentSectionIsContractReady(section: NormalisedComponentSection) {
  if (section.status === 'skipped') return Boolean(section.skipReason?.trim());
  return section.status === 'complete' || section.status === 'active';
}

function componentContractBlockers(_sections: NormalisedComponentSection[]) {
  return [] as string[];
}

function componentContractSource(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }) {
  return {
    slug: input.slug,
    title: input.title,
    status: input.status,
    sourceProjects: [...input.sourceProjects].sort(),
    source: normaliseComponentSource(input.source),
    capabilities: [...input.capabilities].sort(),
    sections: input.sections.map((section) => ({
      key: section.key,
      fileName: section.fileName,
      title: section.title,
      status: section.status || 'not-started',
      skipReason: section.skipReason?.trim() || '',
      body: section.body?.trim() || ''
    }))
  };
}

function computeComponentContractHash(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }) {
  return createHash('sha256')
    .update(JSON.stringify(componentContractSource(input)))
    .digest('hex');
}

async function getComponentContractInfo(input: { dir: string; manifest: any; slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }): Promise<ComponentContractInfo> {
  const blockers = componentContractBlockers(input.sections);
  const sourceHash = computeComponentContractHash(input);
  const stored = input.manifest.contract || {};
  const version = Number(stored.version || 0);
  const contractExists = await exists(path.join(input.dir, 'component.md'));
  let status: ComponentContractStatus = 'missing';
  if (blockers.length) status = 'blocked';
  else if (!contractExists || !stored.sourceHash) status = 'missing';
  else if (stored.sourceHash === sourceHash) status = 'current';
  else status = 'stale';

  return {
    path: 'component.md',
    version,
    sourceHash,
    status,
    blockers
  };
}

function buildComponentContractMarkdown(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[]; version: number; sourceHash: string }) {
  const sectionBlocks = input.sections.map((section) => {
    const body = section.status === 'skipped'
      ? `Skipped: ${section.skipReason?.trim() || 'No reason provided.'}`
      : (section.body?.trim() || section.prompt || 'No content provided.');
    return [`## ${section.title}`, '', body, ''].join('\n');
  }).join('\n');

  const sourceProjects = input.sourceProjects.length
    ? input.sourceProjects.map((project) => `- ${project}`).join('\n')
    : 'No legacy source projects linked.';
  const source = componentSourceDisplay(input.source);
  const capabilities = input.capabilities.length
    ? input.capabilities.map((capability) => `- ${capability}`).join('\n')
    : 'No capabilities linked yet.';

  return matter.stringify([
    `# Component: ${input.title}`,
    '',
    'Generated by AIDD from component definition sections.',
    'Do not edit this file directly. Update the component sections and regenerate this contract.',
    '',
    '## Contract status',
    '',
    `- Component ID: \`${input.slug}\``,
    `- Contract version: \`${input.version}\``,
    '- Source sections: ready/skipped',
    '',
    '## Source',
    '',
    source,
    '',
    '## Source projects',
    '',
    sourceProjects,
    '',
    '## Capabilities supported',
    '',
    capabilities,
    '',
    sectionBlocks,
    '## AI coding instructions',
    '',
    '- Preserve the responsibilities, boundaries, interfaces, data ownership, dependencies, and architecture defined above.',
    '- Do not move ownership to another component without updating AIDD component documentation.',
    '- Follow project coding standards before modifying source code.',
    '- Update the component sections and regenerate this contract when implementation changes the architecture.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'component-contract',
      id: `${input.slug}-component-contract`,
      title: `${input.title} Component Contract`,
      component: input.slug,
      contractVersion: input.version,
      sourceHash: input.sourceHash,
      source: input.source,
      sourceSections: input.sections.map((section) => ({
        key: section.key,
        fileName: section.fileName,
        status: section.status || 'not-started',
        ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
      })),
      sourceProjects: input.sourceProjects,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION
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
  dependencies: ['04-dependencies.md', '05-dependencies-and-integrations.md'],
  architecture: ['05-architecture.md', '06-internal-design.md', 'technical-shape.md'],
  standards: ['06-standards.md', '07-quality-requirements.md']
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
      status: sectionAidd.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      skipReason: sectionAidd.skipReason ? String(sectionAidd.skipReason) : ''
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

async function createComponent(root: string, title: string, description?: string, status: string = 'draft', sourceProjects: string[] = [], sourceInput?: Partial<ComponentSourceConfig>, sectionsInput?: ComponentSectionInput[]) {
  const slug = slugify(title);
  const dir = path.join(root, 'components', slug);
  if (await exists(dir)) return slug;

  const linkedCapabilities: string[] = [];
  const sourceProjectIds = Array.from(new Set(sourceProjects));
  const source = normaliseComponentSource(sourceInput);
  const fallback: Partial<Record<string, string>> = { purpose: description || '' };
  const sections = normaliseComponentSections(sectionsInput, fallback);
  const initialContractBlockers = componentContractBlockers(sections);

  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'component.json'), {
    slug,
    title,
    kind: 'component',
    status,
    lifecycle: status,
    sourceProjects: sourceProjectIds,
    source,
    createdAt: new Date().toISOString(),
    supportsCapabilities: linkedCapabilities,
    capabilitiesSupported: linkedCapabilities,
    dependsOn: [],
    exposes: [],
    dataOwned: [],
    sections: sections.map((section) => ({
      key: section.key,
      title: section.title,
      fileName: section.fileName,
      status: section.status || 'not-started',
      required: true,
      ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
    })),
    contract: {
      path: 'component.md',
      version: 0,
      sourceHash: '',
      status: initialContractBlockers.length ? 'blocked' : 'missing',
      blockers: initialContractBlockers
    },
    template: {
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(path.join(dir, 'index.md'), buildComponentIndexMarkdown({ slug, title, status, sourceProjects: sourceProjectIds, source, capabilities: linkedCapabilities, sections }), 'utf8');
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
  const source = normaliseComponentSource(manifest.source || aidd.source);
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
      const skipReason = sectionAidd.skipReason ? String(sectionAidd.skipReason) : '';
      sections.push({
        key: template.key,
        fileName: template.fileName,
        title: template.title,
        body,
        status: sectionStatus,
        skipReason,
        prompt: template.prompt
      });
      continue;
    } else {
      const legacySection = await readSectionFromFirstExistingFile(dir, COMPONENT_LEGACY_SECTION_FILES[template.key] || []);
      if (legacySection) {
        body = legacySection.body;
        sectionStatus = legacySection.status;
        sections.push({
          key: template.key,
          fileName: template.fileName,
          title: template.title,
          body,
          status: sectionStatus,
          skipReason: legacySection.skipReason || '',
          prompt: template.prompt
        });
        continue;
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
      skipReason: '',
      prompt: template.prompt
    });
  }

  const contract = await getComponentContractInfo({
    dir,
    manifest,
    slug,
    title,
    status,
    sourceProjects,
    source,
    capabilities,
    sections
  });

  return {
    slug,
    title,
    status,
    sourceProjects,
    source,
    capabilities,
    sections,
    contract,
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
  const source = normaliseComponentSource(input.source || manifest.source);
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
  const contractSourceHash = computeComponentContractHash({ slug, title, status, sourceProjects, source, capabilities, sections });
  const contractBlockers = componentContractBlockers(sections);
  const previousContract = manifest.contract || {};
  const contractExists = await exists(path.join(dir, 'component.md'));
  const contractStatus: ComponentContractStatus = contractBlockers.length
    ? 'blocked'
    : (!contractExists || !previousContract.sourceHash)
      ? 'missing'
      : previousContract.sourceHash === contractSourceHash
        ? 'current'
        : 'stale';

  await writeJson(manifestPath, {
    ...manifest,
    slug,
    title,
    kind: manifest.kind || 'component',
    status,
    lifecycle: status,
    sourceProjects,
    source,
    supportsCapabilities: capabilities,
    capabilitiesSupported: capabilities,
    updatedAt: new Date().toISOString(),
    sections: sections.map((section) => ({
      key: section.key,
      title: section.title,
      fileName: section.fileName,
      status: section.status || 'not-started',
      required: true,
      ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
    })),
    contract: {
      ...previousContract,
      path: 'component.md',
      version: Number(previousContract.version || 0),
      sourceHash: previousContract.sourceHash || '',
      status: contractStatus,
      blockers: contractBlockers
    },
    template: {
      ...(manifest.template || {}),
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(markdownPath, buildComponentIndexMarkdown({ slug, title, status, sourceProjects, source, capabilities, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildComponentSectionMarkdown({ slug, componentTitle: title, section, status, sourceProjects, capabilities }), 'utf8');
  }
  await refreshComponentsIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}

async function generateComponentContract(input: GenerateComponentContractInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);

  const manifest = await readJson<any>(manifestPath);
  const component = await readComponent({ projectPath: input.projectPath, slug });
  const sections = normaliseComponentSections(component.sections, {});
  const sourceHash = computeComponentContractHash({
    slug,
    title: component.title,
    status: String(component.status || 'draft'),
    sourceProjects: component.sourceProjects || [],
    source: normaliseComponentSource(component.source),
    capabilities: component.capabilities || [],
    sections
  });
  const previousContract = manifest.contract || {};
  const previousVersion = Number(previousContract.version || 0);
  const version = previousContract.sourceHash === sourceHash && previousVersion > 0
    ? previousVersion
    : previousVersion + 1;

  await fsp.writeFile(path.join(dir, 'component.md'), buildComponentContractMarkdown({
    slug,
    title: component.title,
    status: String(component.status || 'draft'),
    sourceProjects: component.sourceProjects || [],
    source: normaliseComponentSource(component.source),
    capabilities: component.capabilities || [],
    sections,
    version,
    sourceHash
  }), 'utf8');

  await writeJson(manifestPath, {
    ...manifest,
    slug,
    title: component.title,
    source: normaliseComponentSource(component.source),
    contract: {
      path: 'component.md',
      version,
      sourceHash,
      status: 'current',
      blockers: [],
      sections: sections.map((section) => ({
        key: section.key,
        title: section.title,
        fileName: section.fileName,
        status: section.status || 'not-started',
        ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
      }))
    }
  });

  await refreshComponentsIndex(input.projectPath);
  return readComponent({ projectPath: input.projectPath, slug });
}



interface ZipEntryInput {
  name: string;
  data: Buffer;
  modifiedAt?: Date;
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function safeZipEntryName(value: string) {
  const normalised = normaliseRelativePath(value).replace(/^\/+/, '');
  const parts = normalised.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..') || path.isAbsolute(value)) {
    throw new Error(`Unsafe zip entry path: ${value}`);
  }
  return parts.join('/');
}

async function writeZipFile(filePath: string, entries: ZipEntryInput[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sortedEntries) {
    const entryName = safeZipEntryName(entry.name);
    const nameBuffer = Buffer.from(entryName, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = zipDosDateTime(entry.modifiedAt || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sortedEntries.length, 8);
  end.writeUInt16LE(sortedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, Buffer.concat([...localParts, centralDirectory, end]));
}

interface ZipReadEntry {
  name: string;
  data: Buffer;
  directory: boolean;
}

function findZipEndOfCentralDirectory(buffer: Buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid zip file: end of central directory was not found.');
}

function safeZipReadEntryName(value: string) {
  const normalised = normaliseRelativePath(value).replace(/^\/+/, '');
  const parts = normalised.split('/');
  if (!normalised || path.isAbsolute(value) || parts.some((part) => part === '..')) return null;
  return normalised;
}

async function readZipFile(filePath: string): Promise<ZipReadEntry[]> {
  const zipPath = path.resolve(filePath || '');
  const buffer = await fsp.readFile(zipPath);
  const endOffset = findZipEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipReadEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('Invalid zip file: central directory is corrupt.');
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const rawName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');
    const name = safeZipReadEntryName(rawName);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
    if (!name) continue;

    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip file: local header is corrupt for ${name}.`);
    }
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const directory = name.endsWith('/');
    let data = Buffer.alloc(0);

    if (!directory) {
      if (compressionMethod === 0) data = Buffer.from(compressed);
      else if (compressionMethod === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported zip compression method ${compressionMethod} for ${name}.`);
    }

    entries.push({ name, data, directory });
  }

  return entries;
}

function isSafeComponentReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('components/')) return false;
  const parts = normalised.split('/');
  if (parts.length < 3) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  const base = path.basename(normalised).toLowerCase();
  if (base === 'component.md' || base === 'index.md') return false;
  return true;
}

async function importComponentReviewPackage(input: ImportComponentReviewPackageInput): Promise<ComponentReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasComponentsDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'components/' || name.startsWith('components/');
  });
  if (!hasComponentsDirectory) {
    throw new Error('Review response rejected: the zip must contain a components/ directory.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let reviewMarkdown: string | undefined;

  for (const entry of entries) {
    const relativePath = safeZipReadEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeComponentReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data, 'utf8');
    importedFiles.push(relativePath);
  }

  const componentSlugs = new Set(importedFiles.map((file) => file.split('/')[1]).filter(Boolean));
  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    componentCount: componentSlugs.size,
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

function shouldIncludeInReviewBundle(raw: string) {
  try {
    const parsed = matter(raw || '');
    const data = (parsed.data || {}) as any;
    const aidd = data.aidd || {};
    if (data.includeInReviewBundle === false || aidd.includeInReviewBundle === false) return false;
    if (data.excludeFromReviewBundle === true || aidd.excludeFromReviewBundle === true) return false;
  } catch {
    return true;
  }
  return true;
}

function frontmatterValueAsString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

async function buildProjectFoundationReviewMarkdown(projectPath: string) {
  const foundationRoot = path.join(projectPath, 'foundation');
  const files = await collectMarkdownFiles(foundationRoot);
  const includedFiles: string[] = [];
  const sections: string[] = [];

  for (const relativeFile of files) {
    const full = path.join(foundationRoot, relativeFile);
    const raw = await fsp.readFile(full, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;

    const parsed = matter(raw);
    const data = (parsed.data || {}) as any;
    const aidd = data.aidd || {};
    const title = frontmatterValueAsString(aidd.title) || frontmatterValueAsString(data.title) || path.basename(relativeFile, '.md');
    const status = frontmatterValueAsString(aidd.status) || frontmatterValueAsString(data.status) || 'unknown';
    const body = parsed.content.trim() || '_No content captured._';
    includedFiles.push(`foundation/${normaliseRelativePath(relativeFile)}`);
    sections.push([
      `## ${title}`,
      '',
      `- Source: \`foundation/${normaliseRelativePath(relativeFile)}\``,
      `- Status: \`${status}\``,
      '',
      body,
      ''
    ].join('\n'));
  }

  const markdown = [
    '# Project Context',
    '',
    'This file was generated by AIDD for review context only.',
    'Do not return this file in the review zip.',
    '',
    sections.length ? sections.join('\n') : '_No foundation files were included in this review bundle._',
    ''
  ].join('\n');

  return { markdown, includedFiles };
}

async function collectComponentReviewEntries(projectPath: string, componentSlug?: string) {
  const componentsRoot = path.join(projectPath, 'components');
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const requestedSlug = componentSlug ? slugify(componentSlug) : null;
  let componentCount = 0;

  if (!(await exists(componentsRoot))) {
    return { entries, includedFiles, componentCount };
  }

  for (const componentDirEntry of await fsp.readdir(componentsRoot, { withFileTypes: true })) {
    if (!componentDirEntry.isDirectory() || componentDirEntry.name.startsWith('_')) continue;

    const slug = componentDirEntry.name;
    if (requestedSlug && slug !== requestedSlug) continue;
    const componentDir = path.join(componentsRoot, slug);
    const manifestPath = path.join(componentDir, 'component.json');
    if (!(await exists(manifestPath))) continue;
    componentCount += 1;

    let sectionFiles = COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName);
    try {
      const manifest = await readJson<any>(manifestPath);
      const manifestSectionFiles = Array.isArray(manifest?.template?.sectionFiles)
        ? manifest.template.sectionFiles.map(String)
        : Array.isArray(manifest?.sections)
          ? manifest.sections.map((section: any) => String(section.fileName || '')).filter(Boolean)
          : [];
      if (manifestSectionFiles.length) sectionFiles = manifestSectionFiles;
    } catch {}

    const existingMarkdown = (await collectMarkdownFiles(componentDir)).filter((relativeFile) => {
      const base = path.basename(relativeFile).toLowerCase();
      return base !== 'index.md' && base !== 'component.md';
    });

    const candidateFiles = Array.from(new Set([...sectionFiles, ...existingMarkdown])).filter((fileName) => {
      const normalised = normaliseRelativePath(fileName);
      const base = path.basename(normalised).toLowerCase();
      const unsafe = path.isAbsolute(fileName) || normalised.split('/').some((part) => part === '..' || part === '.');
      return !unsafe && normalised.toLowerCase().endsWith('.md') && base !== 'index.md' && base !== 'component.md';
    });

    for (const relativeFile of candidateFiles) {
      const full = path.join(componentDir, relativeFile);
      if (!(await exists(full))) continue;
      const raw = await fsp.readFile(full, 'utf8');
      if (!shouldIncludeInReviewBundle(raw)) continue;
      const zipPath = `components/${slug}/${normaliseRelativePath(relativeFile)}`;
      entries.push({ name: zipPath, data: Buffer.from(raw, 'utf8') });
      includedFiles.push(zipPath);
    }
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)), componentCount };
}

function buildComponentReviewBundleReadme(input: { projectName: string; componentCount: number; componentFileCount: number; foundationFileCount: number; targetComponent?: string | null }) {
  const targetComponent = input.targetComponent || '<included-component-id>';
  return `# AIDD Component Review Package

This zip was generated by AIDD for component review.

## Review scope

You are reviewing **only the component included in this package**.

Target component: \`${targetComponent}\`

Do not review or modify any other components, capabilities, delivery packages, source code, or project structure unless explicitly required to understand this component.

\`PROJECT.md\` is **context only**.

Focus your review on:

- clarity of purpose
- responsibilities and boundaries
- internal architecture
- risks and edge cases
- missing or unclear design decisions
- pros and cons
- suitability for implementation in a delivery package

## Your task

Review the included component section files under \`components/${targetComponent}/\` and improve them so they are clearer, more complete, and more useful for coding delivery packages.

Use \`PROJECT.md\` only as background context.

## Allowed changes

You may update files only under:

- \`components/${targetComponent}/\`

You must return a zip containing only:

- updated Markdown files under \`components/${targetComponent}/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated component files.

## Do not return

Do not return:

- \`PROJECT.md\`
- \`README.md\`
- \`MANIFEST.json\`
- generated \`component.md\` files
- component \`index.md\` files
- source code
- files outside \`components/${targetComponent}/\`
- any unrelated components

## Required return shape

\`\`\`txt
components/
  ${targetComponent}/
    <updated-section-files>.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`components/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Components reviewed
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review bundles

To exclude a Markdown file from future review bundles, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Target component: ${targetComponent}
- Foundation files included: ${input.foundationFileCount}
- Components found: ${input.componentCount}
- Component files included: ${input.componentFileCount}
`;
}

function buildComponentReviewTemplate(input: { projectName: string; targetComponent?: string | null }) {
  return `# Component Review

Project: ${input.projectName}
Target component: ${input.targetComponent || '<included-component-id>'}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Components reviewed

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

async function createComponentReviewBundle(projectPath: string, componentSlug?: string): Promise<ComponentReviewBundleResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const templateManifestPath = path.join(root, 'aidd.template.json');
  const templateManifest = await exists(templateManifestPath) ? await readJson<any>(templateManifestPath).catch(() => null) : null;
  const projectName = String(templateManifest?.project?.name || path.basename(root) || 'AIDD project');
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const requestedSlug = componentSlug ? slugify(componentSlug) : null;
  const fileName = requestedSlug
    ? `${slugify(projectName)}-${requestedSlug}-component-review-${stamp}.zip`
    : `${slugify(projectName)}-component-review-${stamp}.zip`;
  const outputDir = requestedSlug
    ? path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), requestedSlug)
    : path.join(app.getPath('userData'), 'review-bundles', slugify(projectName));
  const filePath = path.join(outputDir, fileName);

  const foundation = await buildProjectFoundationReviewMarkdown(root);
  const components = await collectComponentReviewEntries(root, requestedSlug || undefined);
  if (requestedSlug && components.componentCount === 0) {
    throw new Error(`Component not found or has no reviewable files: ${requestedSlug}`);
  }
  const manifest = {
    bundleType: 'component-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      'components/**/*.md',
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'PROJECT.md',
      'README.md',
      'MANIFEST.json',
      'components/**/component.md',
      'components/**/index.md',
      '**/*.json',
      'code/**',
      'foundation/**',
      'capabilities/**',
      'delivery/**'
    ],
    foundationSources: foundation.includedFiles,
    targetComponent: requestedSlug || null,
    componentFiles: components.includedFiles,
    returnInstructions: {
      zipMustContain: ['components/<component-id>/<updated-section-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnChangedComponentSectionFiles: true,
      doNotReturnGeneratedComponentContracts: true
    }
  };

  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildComponentReviewBundleReadme({ projectName, componentCount: components.componentCount, componentFileCount: components.includedFiles.length, foundationFileCount: foundation.includedFiles.length, targetComponent: requestedSlug || null }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildComponentReviewTemplate({ projectName, targetComponent: requestedSlug || null }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    { name: 'PROJECT.md', data: Buffer.from(foundation.markdown, 'utf8') },
    ...components.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    componentCount: components.componentCount,
    componentFileCount: components.includedFiles.length,
    foundationFileCount: foundation.includedFiles.length,
    entryCount: zipEntries.length
  };
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
    throw new Error(`Project Context must be complete before creating a delivery package. Missing: ${blockers.join('; ')}`);
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
    '## Project Context Snapshot',
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


async function prepareComponentContractDragFile(input: PrepareComponentContractDragFileInput) {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  const slug = slugify(input.slug);
  const filePath = path.join(input.projectPath, 'components', slug, 'component.md');
  if (!(await exists(filePath))) throw new Error('Generate component.md before dragging it.');
  return filePath;
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
ipcMain.handle('drag:prepareComponentContractFile', async (_event, input: PrepareComponentContractDragFileInput) => prepareComponentContractDragFile(input));
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
  await createComponent(input.projectPath, input.title.trim(), input.description, input.status || 'draft', input.sourceProjects || [], input.source, input.sections || []);
  await checkpointAndShareProjectAfterSave(input.projectPath);
  return readProjectSetup(input.projectPath);
});

ipcMain.handle('project:readComponent', async (_event, input: ReadComponentInput) => {
  if (!input.projectPath || !input.slug) throw new Error('Project path and component slug are required.');
  return readComponent(input);
});

ipcMain.handle('project:createComponentReviewBundle', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createComponentReviewBundle(projectPath);
});

ipcMain.handle('project:packageComponentsForReview', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createComponentReviewBundle(projectPath);
});

ipcMain.handle('project:packageComponentForReview', async (_event, input: PackageComponentReviewInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and component slug are required.');
  return createComponentReviewBundle(input.projectPath, input.slug);
});

ipcMain.handle('project:importComponentReviewPackage', async (_event, input: ImportComponentReviewPackageInput) => {
  if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importComponentReviewPackage(input));
});

ipcMain.handle('project:updateComponent', async (_event, input: UpdateComponentInput) => {
  if (!input.projectPath || !input.slug || !input.title?.trim()) throw new Error('Project path, component slug, and title are required.');
  return withProjectSaveSync(input.projectPath, () => updateComponent(input));
});

ipcMain.handle('project:generateComponentContract', async (_event, input: GenerateComponentContractInput) => {
  if (!input.projectPath || !input.slug) throw new Error('Project path and component slug are required.');
  return withProjectSaveSync(input.projectPath, () => generateComponentContract(input));
});

ipcMain.handle('project:selectComponentSourceDirectory', async (_event, input: ComponentSourceDirectoryInput) => {
  if (!input.projectPath) throw new Error('Project path is required.');
  return selectComponentSourceDirectory(input);
});

ipcMain.handle('project:detectComponentSourceDirectory', async (_event, input: ComponentSourceDirectoryInput) => {
  if (!input.projectPath || !input.directory?.trim()) throw new Error('Project path and source directory are required.');
  return detectStoredComponentSourceDirectory(input);
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
