import { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification, protocol } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import git from 'isomorphic-git';
import matter from './frontmatter';
import { createKeytarCredentialStore } from './services/gitCredentialStore';
import { readGitSyncSettings, saveGitSyncSettings } from './services/gitSyncSettingsStore';
import { testGitRemoteConnection } from './services/gitRemoteTester';
import { connectProjectToRepository, getProjectConnectionStatus } from './services/gitProjectConnector';
import { readGitIdentity, requireGitIdentity, saveGitIdentity } from './services/gitIdentityStore';
import { checkForUpdates, createCheckpointIfNeeded, getSyncStatus, syncProject } from './services/gitSyncWorkflow';
import type { AiddSaveGitIdentityInput, AiddSaveGitSyncSettingsInput, AiddGitSyncTestInput } from './services/gitSyncTypes';
import { cancelGitReview, completeGitReview, listGitReviewFiles, readGitReviewFileContent, resolveGitReviewFile } from './services/gitReviewResolver';
import { readActiveGitReviewState } from './services/gitReviewPackageStore';

const isDev = !app.isPackaged;
const TEMPLATE_ID = 'aidd-default';
const TEMPLATE_VERSION = '0.8.0';
const AIDD_DEFAULT_BRANCH = 'main';

function shouldEnableDevTools() {
  return isDev || process.env.AIDD_DEVTOOLS === '1' || process.argv.includes('--devtools');
}

function shouldOpenDevToolsOnStart() {
  return process.env.AIDD_DEVTOOLS === '1' || process.argv.includes('--devtools');
}

function toggleDevTools(win: BrowserWindow) {
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function installDevToolsShortcuts(win: BrowserWindow) {
  if (!shouldEnableDevTools()) return;

  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isToggleDevTools = input.key === 'F12'
      || (input.control && input.shift && key === 'i')
      || (input.meta && input.alt && key === 'i');

    if (!isToggleDevTools) return;

    event.preventDefault();
    toggleDevTools(win);
  });
}

const RENDERER_PROTOCOL = 'aidd';

interface RendererProtocolState {
  rootPath: string;
  indexPath: string;
  candidates: string[];
}

let rendererProtocolState: RendererProtocolState | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function uniqueExistingPathCandidates(paths: string[]) {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const normal = path.normalize(candidate);
    if (seen.has(normal)) return false;
    seen.add(normal);
    return true;
  });
}

function rendererIndexCandidates() {
  return uniqueExistingPathCandidates([
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../../dist/renderer/index.html'),
    path.join(app.getAppPath(), 'dist/renderer/index.html'),
    path.join(process.resourcesPath, 'app/dist/renderer/index.html'),
    path.join(process.resourcesPath, 'app.asar/dist/renderer/index.html')
  ]);
}

function resolveRendererIndexPath() {
  const candidates = rendererIndexCandidates();
  const indexPath = candidates.find((candidate) => fs.existsSync(candidate));
  return { indexPath, candidates };
}

function normaliseRendererRequestPath(requestUrl: string) {
  const url = new URL(requestUrl);
  const pathname = decodeURIComponent(url.pathname || '/index.html');
  return pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
}

function isPathInside(parentPath: string, candidatePath: string) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function registerRendererProtocol() {
  if (isDev) return;

  const { indexPath, candidates } = resolveRendererIndexPath();
  if (!indexPath) {
    rendererProtocolState = {
      rootPath: '',
      indexPath: '',
      candidates
    };
    console.error('AIDD renderer index.html was not found. Checked:', candidates);
    return;
  }

  rendererProtocolState = {
    rootPath: path.dirname(indexPath),
    indexPath,
    candidates
  };

  protocol.registerFileProtocol(RENDERER_PROTOCOL, (request, callback) => {
    try {
      const relativePath = normaliseRendererRequestPath(request.url);
      const filePath = path.resolve(rendererProtocolState!.rootPath, relativePath);

      if (!isPathInside(rendererProtocolState!.rootPath, filePath)) {
        callback({ error: -10 });
        return;
      }

      callback({ path: filePath });
    } catch (error) {
      console.error('Failed to resolve renderer asset.', error);
      callback({ error: -2 });
    }
  });
}

function htmlDocument(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0f172a;color:#e2e8f0}main{max-width:900px;margin:64px auto;padding:32px}code,pre{background:#111827;border:1px solid #334155;border-radius:8px}code{padding:2px 5px}pre{padding:16px;overflow:auto;white-space:pre-wrap}.card{background:#111827;border:1px solid #334155;border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin-top:0}</style></head><body><main><div class="card">${body}</div></main></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function dataUrlForHtml(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function missingRendererPage() {
  const candidates = rendererProtocolState?.candidates ?? rendererIndexCandidates();
  return htmlDocument(
    'AIDD renderer missing',
    `<h1>AIDD could not load the renderer build.</h1><p>The packaged app could not find <code>dist/renderer/index.html</code>.</p><p>Run the renderer build before packaging, and make sure electron-builder includes <code>dist/**/*</code>.</p><h2>Checked paths</h2><pre>${escapeHtml(candidates.join('\n'))}</pre>`
  );
}

function rendererCrashPage(reason: string) {
  return htmlDocument(
    'AIDD renderer failed',
    `<h1>AIDD could not display the app window.</h1><p>${escapeHtml(reason)}</p><p>This usually means the packaged renderer JavaScript did not load, the preload script failed, or React crashed during startup.</p><p>Open DevTools with <code>F12</code> or run with <code>AIDD_DEVTOOLS=1</code> for the renderer console.</p>`
  );
}

function blankRendererPage(detail: string) {
  return htmlDocument(
    'AIDD renderer blank',
    `<h1>AIDD loaded the HTML, but React did not start.</h1><p>${escapeHtml(detail)}</p><p>The most common cause is Vite building absolute asset paths. Make sure <code>vite.config.ts</code> contains <code>base: './'</code> and rebuild with a clean <code>dist</code> directory.</p><h2>Renderer path</h2><pre>${escapeHtml(rendererProtocolState?.indexPath || 'unknown')}</pre>`
  );
}

function installRendererBlankPageGuard(win: BrowserWindow) {
  if (isDev) return;

  let guardCompleted = false;

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (win.isDestroyed() || win.webContents.isDestroyed() || guardCompleted) return;

      win.webContents.executeJavaScript(`
        (() => {
          const root = document.getElementById('root');
          const bootState = window.__AIDD_RENDERER_BOOT_STATE__ || null;
          return {
            href: window.location.href,
            hasRoot: Boolean(root),
            childCount: root ? root.childElementCount : 0,
            textLength: root && root.textContent ? root.textContent.trim().length : 0,
            bootState
          };
        })();
      `)
        .then((state) => {
          guardCompleted = true;
          const hasVisibleRoot = Boolean(state?.hasRoot) && ((state?.childCount ?? 0) > 0 || (state?.textLength ?? 0) > 0);
          const bootState = state?.bootState;
          const appMounted = bootState?.mounted === true;

          if (hasVisibleRoot && appMounted) return;

          const detail = [
            `URL: ${state?.href || 'unknown'}`,
            `Root element found: ${state?.hasRoot ? 'yes' : 'no'}`,
            `Root child count: ${state?.childCount ?? 0}`,
            `Root text length: ${state?.textLength ?? 0}`,
            `Renderer boot state: ${JSON.stringify(bootState ?? null)}`
          ].join('\n');

          void win.loadURL(dataUrlForHtml(blankRendererPage(detail)));
        })
        .catch((error) => {
          guardCompleted = true;
          console.error('AIDD renderer blank-page guard failed.', error);
        });
    }, 2500);
  });
}

async function loadAppWindow(win: BrowserWindow) {
  if (isDev) {
    await win.loadURL('http://127.0.0.1:5173');
    return;
  }

  if (!rendererProtocolState?.indexPath) {
    await win.loadURL(dataUrlForHtml(missingRendererPage()));
    return;
  }

  await win.loadURL(`${RENDERER_PROTOCOL}://renderer/index.html`);
}

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

interface SetWorkspaceDirectoryInput {
  projectIdOrPath: string;
  workspacePath: string;
}

interface TrackedProject {
  id: string;
  name: string;
  description: string;
  path: string;
  workspacePath?: string;
  workspaceUpdatedAt?: string;
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

interface WorkspacePublishOutput {
  path: string;
  kind: 'agents' | 'doc';
  sourceHash: string;
  outputHash: string;
  status: 'missing' | 'stale' | 'modified' | 'up-to-date';
  message: string;
}

interface WorkspacePublishWritableFile {
  path: string;
  outputHash: string;
}

interface WorkspacePublishStatus {
  checkedAt: string;
  state: 'not-configured' | 'blocked' | 'missing' | 'modified' | 'stale' | 'up-to-date';
  label: string;
  message: string;
  canPublish: boolean;
  projectPath: string;
  workspacePath?: string;
  docsPath?: string;
  agentsPath?: string;
  manifestPath?: string;
  publishedAt?: string;
  blockers: string[];
  warnings: string[];
  outputs: WorkspacePublishOutput[];
  writableFiles: WorkspacePublishWritableFile[];
  summary: { total: number; missing: number; stale: number; modified: number; upToDate: number };
}

interface WorkspacePublishResult extends WorkspacePublishStatus {
  published: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  createdWritableFiles: string[];
}

interface WorkspacePublishManifestOutput {
  path: string;
  kind: WorkspacePublishOutput['kind'];
  sourceHash: string;
  outputHash: string;
}

interface WorkspacePublishManifest {
  schemaVersion: number;
  templateVersion: string;
  projectName: string;
  projectPath: string;
  workspacePath: string;
  docsPath: string;
  agentsPath: string;
  publishedAt: string;
  outputs: WorkspacePublishManifestOutput[];
  writableFiles: string[];
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

interface StandardSection {
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
type ComponentSourcePathMode = 'workspace-relative' | 'absolute';

interface ComponentSourceDetection {
  suggestedType: string;
  confidence: ComponentSourceDetectionConfidence;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  detectedMarkers: string[];
  packageManager?: string;
  reasons: string[];
}

interface ComponentSourceConfig {
  directory: string;
  type: string;
  pathMode: ComponentSourcePathMode;
  isInsideWorkspace: boolean;
  absolutePath?: string;
  warning?: string;
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
  pathMode: ComponentSourcePathMode;
  isInsideWorkspace: boolean;
  warning?: string;
  detection: ComponentSourceDetection;
}

interface ProjectSetupState {
  foundation: FoundationDocument[];
  standards: { status: SetupStepStatus; filePath: string; body: string; profiles: string[]; sections: StandardSection[] };
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
  importedComponents: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

type ComponentTechnicalReviewType = 'code' | 'security' | 'architecture' | 'tests' | 'performance' | 'accessibility' | 'dependencies';
type ComponentTechnicalReviewSourceScope = 'component-source' | 'changed-files' | 'full-source';
type ComponentTechnicalChangeStatus = 'draft' | 'proposed' | 'needs-review' | 'approved' | 'rejected' | 'superseded' | 'packaged' | 'delivered';
type ComponentTechnicalChangeSource = 'manual' | 'technical-review';
type ComponentTechnicalChangeRisk = 'low' | 'medium' | 'high' | 'unknown';

interface ComponentTechnicalReviewPackageInput {
  projectPath: string;
  slug: string;
  reviewTypes?: ComponentTechnicalReviewType[];
  sourceScope?: ComponentTechnicalReviewSourceScope;
}

interface ComponentTechnicalReviewPackageResult {
  filePath: string;
  fileName: string;
  componentSlug: string;
  componentTitle: string;
  componentFileCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  entryCount: number;
  warnings: string[];
}

interface ImportComponentTechnicalReviewPackageInput {
  projectPath: string;
  slug: string;
  zipPath: string;
}

interface CreateComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  title?: string;
  status?: ComponentTechnicalChangeStatus;
  risk?: ComponentTechnicalChangeRisk;
}

interface UpdateComponentTechnicalChangeStatusInput {
  projectPath: string;
  slug: string;
  id: string;
  status: ComponentTechnicalChangeStatus;
}

interface ComponentTechnicalChangeSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  editable: boolean;
}

interface ReadComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
}

interface SaveComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
  title?: string;
  status?: ComponentTechnicalChangeStatus;
  risk?: ComponentTechnicalChangeRisk;
  sections?: ComponentTechnicalChangeSection[];
}

interface ComponentTechnicalChangeDetail extends ComponentTechnicalChangeRecord {
  sections: ComponentTechnicalChangeSection[];
}

interface ComponentTechnicalChangeReviewPackageInput {
  projectPath: string;
  slug: string;
  id: string;
}

interface ComponentTechnicalChangeReviewPackageResult {
  filePath: string;
  fileName: string;
  componentSlug: string;
  technicalChangeId: string;
  sectionFileCount: number;
  patchCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  entryCount: number;
  warnings: string[];
}

interface ImportComponentTechnicalChangeReviewPackageInput {
  projectPath: string;
  slug: string;
  id: string;
  zipPath: string;
}

interface ComponentTechnicalChangeReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  componentSlug: string;
  technicalChangeId: string;
  importedFiles: string[];
  skippedFiles: string[];
  patchCount: number;
}

interface ComponentTechnicalReviewChangeSummary {
  id: string;
  overviewPath?: string;
  status: string;
  patches: string[];
}

interface ComponentTechnicalReviewRecord {
  type: 'component-technical-review-import';
  schemaVersion: 1;
  componentSlug: string;
  importedAt: string;
  status: string;
  reviewDirectory: string;
  summaryPath?: string;
  importedFiles: string[];
  skippedFiles: string[];
  findingCount: number;
  changeCount: number;
  patchCount: number;
  changes: ComponentTechnicalReviewChangeSummary[];
}

interface ComponentTechnicalReviewImportResult {
  accepted: boolean;
  zipPath: string;
  componentSlug: string;
  reviewDirectory: string;
  importedFiles: string[];
  skippedFiles: string[];
  findingCount: number;
  changeCount: number;
  patchCount: number;
  technicalChangeCount: number;
}

interface ComponentTechnicalChangeRecord {
  id: string;
  title: string;
  componentSlug: string;
  status: ComponentTechnicalChangeStatus;
  source: ComponentTechnicalChangeSource;
  createdAt: string;
  updatedAt: string;
  risk: ComponentTechnicalChangeRisk;
  patchCount: number;
  linkedFindings: string[];
  linkedReviewPath: string | null;
  deliveryPackageIds: string[];
  relativePath: string;
}

interface CapabilityReviewPackageResult {
  filePath: string;
  fileName: string;
  capabilityCount: number;
  capabilityFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

interface PackageCapabilityReviewInput {
  projectPath: string;
  slug: string;
}

interface ImportCapabilityReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface CapabilityReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  capabilityCount: number;
  importedCapabilities: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface FoundationReviewPackageResult {
  filePath: string;
  fileName: string;
  foundationFileCount: number;
  entryCount: number;
}

interface ImportFoundationReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface ImportFoundationDocumentUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

interface FoundationReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
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

interface DeleteComponentInput {
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

interface DeleteCapabilityInput {
  projectPath: string;
  slug: string;
}

interface CreateDeliveryPackageFromCapabilityInput {
  projectPath: string;
  capabilitySlug: string;
}

interface CreateDeliveryPackageFromTechnicalChangeInput {
  projectPath: string;
  componentSlug: string;
  technicalChangeId: string;
}

type DeliveryPackageType = 'capability' | 'technical';

interface DeliveryPackageSummary {
  id: string;
  title: string;
  packageType?: DeliveryPackageType;
  status: string;
  sourceCapability?: string;
  sourceTechnicalChange?: {
    componentSlug: string;
    technicalChangeId: string;
    title: string;
  };
  components: string[];
  technicalChanges?: DeliveryPackageTechnicalChangeSummary[];
  excludedTechnicalChanges?: DeliveryPackageTechnicalChangeSummary[];
  createdAt?: string;
  packaged: boolean;
  phaseCount: number;
  priority?: number;
  workspacePackagePath?: string;
  workspacePublished?: boolean;
  workspacePublishedAt?: string;
  workspacePublishStatus?: 'not-configured' | 'missing' | 'published' | 'stale';
  workspaceStatus?: string;
  workspacePhaseCount?: number;
  workspaceDeliveryFiles?: string[];
}

interface DeliveryWorkspacePublishInput {
  projectPath: string;
  packageId: string;
}

interface DeliveryWorkspacePublishResult {
  packageId: string;
  workspacePath: string;
  targetPath: string;
  published: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  createdWritableFiles: string[];
  removedFiles?: string[];
  message: string;
}

interface DeliveryReviewPackageInput {
  projectPath: string;
  packageId: string;
}

interface DeliveryReviewPackageResult {
  filePath: string;
  fileName: string;
  packageId: string;
  strategyFileCount: number;
  phaseFileCount: number;
  standardsFileCount: number;
  capabilityFileCount: number;
  componentFileCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  entryCount: number;
  warnings: string[];
}

interface ImportDeliveryReviewPackageInput {
  projectPath: string;
  packageId: string;
  zipPath: string;
}

interface DeliveryReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  packageId: string;
  importedFiles: string[];
  skippedFiles: string[];
  backedUpFiles: string[];
  backupDirectory?: string;
  strategyImported: boolean;
  phaseFileCount: number;
  assembledPackageUpdated: boolean;
  reviewIncluded: boolean;
  reviewMarkdown?: string;
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

interface DeliveryPackageTechnicalChangeSummary {
  id: string;
  title: string;
  componentSlug: string;
  status: string;
  risk: string;
  patchCount: number;
  relativePath?: string;
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


interface SaveStandardSectionInput {
  projectPath: string;
  fileName: string;
  status: SetupStepStatus;
  body: string;
}

interface PrepareStandardSectionDragFileInput {
  projectPath: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus;
  body: string;
}

interface StandardsReviewPackageResult {
  filePath: string;
  fileName: string;
  standardsFileCount: number;
  entryCount: number;
}

interface ImportStandardsReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface ImportStandardSectionUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

interface StandardsReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
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
  installDevToolsShortcuts(win);
  installRendererBlankPageGuard(win);

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = sourceId ? `${sourceId}:${line}` : `line ${line}`;
    console.log(`[AIDD renderer:${level}] ${message} (${source})`);
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('AIDD preload failed.', { preloadPath, error });
    if (!isDev) {
      void win.loadURL(dataUrlForHtml(rendererCrashPage(`Preload failed: ${error instanceof Error ? error.message : String(error)}`)));
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('AIDD renderer process gone.', details);
    if (!isDev && !win.isDestroyed()) {
      void win.loadURL(dataUrlForHtml(rendererCrashPage(`Renderer process exited: ${details.reason}.`)));
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('AIDD renderer failed to load.', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (!isMainFrame || isDev) return;
    void win.loadURL(dataUrlForHtml(rendererCrashPage(`Renderer load failed: ${errorDescription} (${errorCode}).`)));
  });

  loadAppWindow(win)
    .then(() => {
      if (shouldOpenDevToolsOnStart()) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    })
    .catch((error) => {
      console.error('Failed to load AIDD window.', error);
      if (!isDev) {
        void win.loadURL(dataUrlForHtml(rendererCrashPage(error instanceof Error ? error.message : String(error))));
      }
    });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerRendererProtocol();
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

async function updateTrackedProject(projectIdOrPath: string, updater: (project: TrackedProject) => TrackedProject) {
  const projects = await readProjects();
  const index = projects.findIndex((project) => project.id === projectIdOrPath || project.path === projectIdOrPath);
  if (index === -1) throw new Error('Tracked project was not found.');
  const updated = updater({ ...projects[index] });
  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

async function readTrackedProjectByPath(projectPath: string) {
  const resolvedProjectPath = normaliseDiskPath(projectPath);
  return (await readProjects()).find((project) => normaliseDiskPath(project.path) === resolvedProjectPath) || null;
}

async function readWorkspacePathForProject(projectPath: string) {
  const trackedProject = await readTrackedProjectByPath(projectPath);
  return trackedProject?.workspacePath?.trim() || '';
}

function templatePathCandidates() {
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


const STANDARD_SECTION_DEFINITIONS = [
  {
    id: 'project-standards',
    title: 'Standards Overview',
    fileName: 'index.md',
    required: true,
    body: '# Project Standards\n\nUse these standards to guide capabilities, components, delivery packages, implementation, and AI review.\n\n## Sections\n\n- Coding Style\n- Security\n- Testing\n- Architecture\n- Hosting & Platform'
  },
  {
    id: 'coding-style',
    title: 'Coding Style',
    fileName: '01-coding-style.md',
    required: false,
    body: '# Coding Style\n\nDefine the coding conventions people and AI agents should follow.\n\n## Rules\n\n- TODO: Define naming, formatting, linting, and code organisation expectations.\n\n## Avoid\n\n- TODO: Define patterns, shortcuts, or implementation habits to avoid.'
  },
  {
    id: 'security',
    title: 'Security',
    fileName: '02-security.md',
    required: false,
    body: '# Security\n\nDefine the baseline security expectations for this project.\n\n## Rules\n\n- TODO: Define authentication, authorisation, secret handling, dependency, and data protection expectations.\n\n## Review Checks\n\n- TODO: Define what must be checked before security-sensitive work is accepted.'
  },
  {
    id: 'testing',
    title: 'Testing',
    fileName: '03-testing.md',
    required: false,
    body: '# Testing\n\nDefine how changes should be verified before they are accepted.\n\n## Required Tests\n\n- TODO: Define unit, integration, end-to-end, accessibility, or manual verification expectations.\n\n## Evidence\n\n- TODO: Define what test results or review notes must be captured in delivery packages.'
  },
  {
    id: 'architecture',
    title: 'Architecture',
    fileName: '04-architecture.md',
    required: false,
    body: '# Architecture\n\nDefine the architectural principles that should shape implementation decisions.\n\n## Principles\n\n- TODO: Define layering, boundaries, dependency direction, data ownership, and integration expectations.\n\n## Decision Rules\n\n- TODO: Define when an architecture decision record is required.'
  },
  {
    id: 'hosting-platform',
    title: 'Hosting & Platform',
    fileName: '05-hosting-platform.md',
    required: false,
    body: '# Hosting & Platform\n\nDefine the runtime, hosting, deployment, and operational expectations for this project.\n\n## Platform Choices\n\n- TODO: Define hosting platform, environments, deployment approach, observability, and operational constraints.\n\n## Constraints\n\n- TODO: Define platform limits AI agents and delivery packages must respect.'
  }
] as const;

function buildStandardSectionMarkdown(section: { id: string; title: string; status: SetupStepStatus; required?: boolean; body: string }) {
  return `---\naidd:\n  type: standards\n  id: ${section.id}\n  title: ${section.title}\n  status: ${section.status}\n  required: ${section.required !== false}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${section.body.trim()}\n`;
}

function standardSectionDone(section: StandardSection) {
  return section.status === 'complete' || (section.required === false && section.status === 'skipped');
}

function deriveStandardsStatus(sections: StandardSection[]): SetupStepStatus {
  if (!sections.length || sections.every((section) => section.status === 'not-started')) return 'not-started';
  if (sections.every(standardSectionDone)) return 'complete';
  if (sections.some((section) => section.status === 'in-review')) return 'in-review';
  if (sections.some((section) => section.status === 'active')) return 'active';
  if (sections.some((section) => section.status === 'deprecated')) return 'deprecated';
  return 'draft';
}

function combineStandardsBody(sections: StandardSection[]) {
  return sections
    .map((section) => {
      const body = section.body.trim() || `# ${section.title}\n\nTODO`;
      return [`<!-- Source: foundation/standards/${section.fileName} -->`, body].join('\n\n');
    })
    .join('\n\n---\n\n');
}

async function readStandardSections(projectPath: string): Promise<StandardSection[]> {
  const standardsDir = path.join(projectPath, 'foundation', 'standards');
  const sections: StandardSection[] = [];

  for (const definition of STANDARD_SECTION_DEFINITIONS) {
    const filePath = path.join(standardsDir, definition.fileName);
    const fileExists = await exists(filePath);
    const raw = fileExists
      ? await fsp.readFile(filePath, 'utf8')
      : buildStandardSectionMarkdown({
          id: definition.id,
          title: definition.title,
          status: 'not-started',
          required: definition.required,
          body: definition.body
        });
    const parsed = parseFrontmatter(raw);
    sections.push({
      id: parsed.id || definition.id,
      title: parsed.title || definition.title,
      fileName: definition.fileName,
      filePath,
      status: parsed.status,
      required: fileExists ? parsed.required : definition.required,
      body: parsed.body.trim() || definition.body
    });
  }

  return sections;
}

async function writeStandardsManifest(projectPath: string, sections?: StandardSection[]) {
  const standardsDir = path.join(projectPath, 'foundation', 'standards');
  const standardSections = sections ?? await readStandardSections(projectPath);
  const overallStatus = deriveStandardsStatus(standardSections);
  await fsp.mkdir(standardsDir, { recursive: true });
  await writeJson(path.join(standardsDir, 'standards.json'), {
    profiles: overallStatus === 'complete' ? ['project-defined'] : [],
    sections: standardSections.map((section) => ({
      id: section.id,
      fileName: section.fileName,
      title: section.title,
      status: section.status,
      required: section.required
    })),
    updatedAt: new Date().toISOString()
  });
}

async function fileStatus(filePath: string): Promise<SetupStepStatus> {
  if (!(await exists(filePath))) return 'not-started';
  const parsed = parseFrontmatter(await fsp.readFile(filePath, 'utf8'));
  return parsed.status;
}

async function readFoundationDocuments(projectPath: string): Promise<FoundationDocument[]> {
  const foundationDir = 'foundation';
  const definitions = [
    ['project-overview', 'Project Overview', '01-project-overview.md'],
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
  const standardsSections = await readStandardSections(projectPath);
  const standardsStatus = deriveStandardsStatus(standardsSections);
  let profiles: string[] = [];
  try {
    const standardsJson = await readJson<any>(path.join(projectPath, 'foundation', 'standards', 'standards.json'));
    profiles = Array.isArray(standardsJson.profiles) ? standardsJson.profiles : [];
  } catch {}
  return {
    foundation: await readFoundationDocuments(projectPath),
    standards: { status: standardsStatus, filePath: standardsPath, body: combineStandardsBody(standardsSections), profiles, sections: standardsSections },
    components: (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json')).map((component: any) => ({ ...component, source: normaliseComponentSource(component.source) })),
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
    ['overview', 'Project overview', '01-project-overview.md', 'Summarises what the project is, why it exists, and what success looks like.'],
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
  const standardSections = await readStandardSections(projectPath);
  const standardsStatus = deriveStandardsStatus(standardSections);
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

function normaliseDiskPath(value: string) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameDiskPath(a: string, b: string) {
  return normaliseDiskPath(a) === normaliseDiskPath(b);
}

function isSameOrInsideDiskPath(candidatePath: string, rootPath: string) {
  const candidate = normaliseDiskPath(candidatePath);
  const root = normaliseDiskPath(rootPath);
  if (!candidate || !root) return false;
  if (candidate === root) return true;
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(rootWithSeparator);
}

function agentsTargetPathForWorkspace(workspacePath: string) {
  return path.join(workspacePath, 'AGENTS.md');
}

const SOURCE_WORKSPACE_MARKER_FILES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'astro.config.mjs',
  'next.config.js',
  'Cargo.toml'.toLowerCase(),
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'gradlew',
  'CMakeLists.txt'.toLowerCase(),
  'Makefile'.toLowerCase(),
  'composer.json',
  'Gemfile'.toLowerCase()
]);

const SOURCE_WORKSPACE_MARKER_DIRECTORIES = new Set([
  'src',
  'source',
  'app',
  'apps',
  'packages',
  'lib',
  'public',
  'private',
  'tests',
  'test'
]);

const SOURCE_WORKSPACE_MARKER_EXTENSIONS = [
  '.sln',
  '.csproj',
  '.fsproj',
  '.vbproj',
  '.xcodeproj',
  '.xcworkspace',
  '.uproject',
  '.uplugin'
];

async function detectSourceWorkspaceMarkers(workspacePath: string) {
  const markers: string[] = [];
  const entries = await fsp.readdir(workspacePath, { withFileTypes: true });

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory() && SOURCE_WORKSPACE_MARKER_DIRECTORIES.has(lowerName)) {
      markers.push(`${entry.name}/`);
      continue;
    }
    if (SOURCE_WORKSPACE_MARKER_FILES.has(lowerName)) {
      markers.push(entry.name);
      continue;
    }
    if (SOURCE_WORKSPACE_MARKER_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      markers.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    }
  }

  return markers.slice(0, 8);
}

const WORKSPACE_PUBLISH_SCHEMA_VERSION = 1;
const WORKSPACE_PUBLISH_TEMPLATE_VERSION = '2';
const AGENTS_START_MARKER = '<!-- AIDD:START -->';
const AGENTS_END_MARKER = '<!-- AIDD:END -->';

const DELIVERY_WRITABLE_FILE_TEMPLATES = [
  {
    fileName: 'progress.md',
    title: 'Progress',
    body: 'Use this file to record what has been done, what is in progress, and what remains.'
  },
  {
    fileName: 'changes.md',
    title: 'Changes',
    body: 'Record the implementation files changed and the reason for each meaningful change.'
  },
  {
    fileName: 'evidence.md',
    title: 'Evidence',
    body: 'Record tests run, checks completed, screenshots, logs, or manual verification notes.'
  },
  {
    fileName: 'questions.md',
    title: 'Questions',
    body: 'Record blockers, product questions, technical unknowns, and anything requiring human review.'
  },
  {
    fileName: 'handoff.md',
    title: 'Handoff',
    body: 'Summarise what changed, how it was verified, and what the next reviewer should look at.'
  },
  {
    fileName: 'proposed-aidd-updates.md',
    title: 'Proposed AIDD Updates',
    body: 'Record proposed changes to Foundation, Standards, Components, or Delivery rules. Do not edit generated AIDD docs directly.'
  }
] as const;

function sha256Text(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function workspacePublishDocsPath(workspacePath: string) {
  return path.join(workspacePath, 'docs');
}

function workspacePublishManifestPath(workspacePath: string) {
  return path.join(workspacePath, 'docs', '.aidd-publish-manifest.json');
}

function workspaceDeliveryRootPath(workspacePath: string) {
  return path.join(workspacePath, 'delivery');
}

function workspaceDeliveryPackagePath(workspacePath: string, packageId: string) {
  return path.join(workspaceDeliveryRootPath(workspacePath), packageId);
}

function toWorkspacePublishPath(relativePath: string) {
  return normaliseRelativePath(relativePath).replace(/^\/+/, '');
}

function publishOutputHashFor(kind: WorkspacePublishOutput['kind'], content: string) {
  return kind === 'agents' ? sha256Text(extractAgentsManagedBlock(content) || content) : sha256Text(content);
}

function buildPublishOutput(kind: WorkspacePublishOutput['kind'], relativePath: string, content: string): WorkspacePublishOutput & { content: string } {
  const normalPath = toWorkspacePublishPath(relativePath);
  const outputHash = publishOutputHashFor(kind, content);
  const sourceHash = sha256Text(JSON.stringify({ templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION, kind, path: normalPath, content }));
  return {
    path: normalPath,
    kind,
    sourceHash,
    outputHash,
    status: 'missing',
    message: 'Not checked yet.',
    content
  };
}

function generatedDocHeader(sourceLabel: string) {
  return [
    '<!-- Generated by AIDD. Do not edit directly. Regenerate from AIDD Home > Publish workspace docs. -->',
    `<!-- Source: ${sourceLabel} -->`,
    ''
  ].join('\n');
}

function markdownSection(title: string, body: string) {
  const cleanBody = body.trim() || '_No content captured._';
  return [`## ${title}`, '', cleanBody].join('\n');
}

function setupStatusLabel(status?: string) {
  return String(status || 'not-started').replace(/-/g, ' ');
}

function buildPublishedFoundationMarkdown(projectName: string, docs: FoundationDocument[]) {
  const lines = [
    generatedDocHeader('AIDD foundation sections'),
    '# AIDD Foundation',
    '',
    `Project: ${projectName}`,
    '',
    'This file is generated from approved AIDD Foundation sections and is safe for AI agents to read as project context.',
    '',
    '## Section status',
    '',
    ...docs.map((doc) => `- ${doc.title}: ${setupStatusLabel(doc.status)}`),
    ''
  ];

  for (const doc of docs) {
    lines.push('---', '', `## ${doc.title}`, '', `Source: \`foundation/${doc.fileName}\``, `Status: \`${doc.status}\``, '', doc.body.trim() || '_No content captured._', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildPublishedStandardsMarkdown(projectName: string, sections: StandardSection[]) {
  const lines = [
    generatedDocHeader('AIDD standards sections'),
    '# AIDD Standards',
    '',
    `Project: ${projectName}`,
    '',
    'These are the approved project standards that AI agents should follow during implementation.',
    '',
    '## Section status',
    '',
    ...sections.map((section) => `- ${section.title}: ${setupStatusLabel(section.status)}`),
    ''
  ];

  for (const section of sections) {
    lines.push('---', '', `## ${section.title}`, '', `Source: \`foundation/standards/${section.fileName}\``, `Status: \`${section.status}\``, '', section.status === 'skipped' ? '_This section was skipped in AIDD._' : section.body.trim() || '_No content captured._', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

function componentSourceReferenceLines(component: any) {
  const source = normaliseComponentSource(component.source);
  const lines: string[] = [];
  if (componentSourceIsConfigured(source)) {
    lines.push(`- Source path: \`${source.directory}\``);
    lines.push(`- Path mode: \`${source.pathMode}\``);
    lines.push(`- Portable: \`${source.isInsideWorkspace ? 'yes' : 'no'}\``);
    lines.push(`- Source type: \`${source.type || 'other'}\``);
    if (source.warning) lines.push(`- Source warning: ${source.warning}`);
    const detection = normaliseComponentSourceDetection(source.detection);
    if (detection?.detectedMarkers.length) lines.push(`- Detected markers: ${detection.detectedMarkers.map((item) => `\`${item}\``).join(', ')}`);
    if (detection?.detectedFrameworks.length) lines.push(`- Detected frameworks: ${detection.detectedFrameworks.map((item) => `\`${item}\``).join(', ')}`);
    if (detection?.detectedLanguages.length) lines.push(`- Detected languages: ${detection.detectedLanguages.map((item) => `\`${item}\``).join(', ')}`);
  }
  const sourceProjects: string[] = Array.isArray(component.sourceProjects) ? component.sourceProjects.map(String).filter(Boolean) : [];
  if (sourceProjects.length) lines.push(`- Source projects: ${sourceProjects.map((item) => `\`${item}\``).join(', ')}`);
  const capabilities = Array.from(new Set<string>([
    ...(Array.isArray(component.supportsCapabilities) ? component.supportsCapabilities.map(String) : []),
    ...(Array.isArray(component.capabilitiesSupported) ? component.capabilitiesSupported.map(String) : [])
  ].filter(Boolean)));
  if (capabilities.length) lines.push(`- Capabilities: ${capabilities.map((item) => `\`${item}\``).join(', ')}`);
  if (!lines.length) lines.push('- Source location has not been configured.');
  return lines;
}

function buildPublishedComponentsMarkdown(projectName: string, components: any[], sourceProjects: SourceCodeProject[]) {
  const lines = [
    generatedDocHeader('AIDD components'),
    '# AIDD Components',
    '',
    `Project: ${projectName}`,
    '',
    'This generated component map helps agents find the relevant source code without scanning the whole workspace first.',
    '',
    '## Component inventory',
    '',
    components.length
      ? components.map((component) => `- ${component.title || component.slug || component.id} (${setupStatusLabel(component.status || component.lifecycle || 'draft')})`).join('\n')
      : 'No components have been defined yet.',
    ''
  ];

  if (sourceProjects.length) {
    lines.push('## Source projects', '');
    for (const sourceProject of sourceProjects) {
      lines.push(`- ${sourceProject.name}: \`${sourceProject.path}\` (${sourceProject.detectedType})`);
    }
    lines.push('');
  }

  for (const component of components) {
    const title = String(component.title || component.slug || component.id || 'Untitled component');
    lines.push('---', '', `## ${title}`, '', `Status: \`${component.status || component.lifecycle || 'draft'}\``, '');
    lines.push(...componentSourceReferenceLines(component), '');
    if (Array.isArray(component.sections) && component.sections.length) {
      lines.push('### AIDD section status', '');
      for (const section of component.sections) {
        lines.push(`- ${section.title || section.key}: ${setupStatusLabel(section.status)}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}


function buildPublishedCapabilityMarkdown(projectName: string, capability: Awaited<ReturnType<typeof readCapability>>) {
  const lines = [
    generatedDocHeader(`AIDD capability ${capability.slug}`),
    `# AIDD Capability: ${capability.title}`,
    '',
    `Project: ${projectName}`,
    `Slug: \`${capability.slug}\``,
    `Status: \`${setupStatusLabel(capability.status)}\``,
    capability.components.length ? `Components: ${capability.components.map((component: string) => `\`${component}\``).join(', ')}` : 'Components: _none captured_',
    '',
    'This file is a generated snapshot of the linked capability at the time the delivery review package was created.',
    'Treat it as read-only review context. If the delivery work reveals needed AIDD updates, record them in the delivery files rather than editing this snapshot.',
    ''
  ];

  if (capability.body.trim()) {
    lines.push('## Capability index', '', capability.body.trim(), '');
  }

  for (const section of capability.sections || []) {
    lines.push(
      '---',
      '',
      `## ${section.title}`,
      '',
      `Source: \`capabilities/${capability.slug}/${section.fileName}\``,
      `Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

function deliveryReviewCapabilitySnapshotFileName(capabilitySlug: string | null | undefined) {
  const slug = slugify(capabilitySlug || 'capability');
  return `capability-${slug || 'context'}.md`;
}

function buildDeliveryBriefMarkdown(detail: DeliveryPackageDetail) {
  const lines = [
    generatedDocHeader(`AIDD delivery package ${detail.id}`),
    `# ${detail.id} · ${detail.title}`,
    '',
    `Status: \`${detail.status}\``,
    detail.sourceCapability ? `Source capability: \`${detail.sourceCapability}\`` : '',
    detail.components.length ? `Components: ${detail.components.map((item) => `\`${item}\``).join(', ')}` : 'Components: _none captured_',
    '',
    'This generated brief is read-only. Agents should update the writable files beside it: progress.md, changes.md, evidence.md, questions.md, handoff.md, and proposed-aidd-updates.md.',
    ''
  ].filter(Boolean);

  if (detail.snapshotBody.trim()) lines.push(markdownSection('Snapshot', detail.snapshotBody), '');
  if (detail.strategyBody.trim()) lines.push(markdownSection('Implementation strategy', detail.strategyBody), '');
  if (detail.packagedBody.trim()) lines.push(markdownSection('Packaged instructions', detail.packagedBody), '');
  if (detail.phases.length) {
    lines.push('## Phases', '');
    for (const phase of detail.phases) {
      lines.push(`### ${phase.title}`, '', `Status: \`${phase.status}\``, '', phase.body.trim() || '_No phase detail captured._', '');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildDeliveryWritableMarkdown(packageId: string, title: string, body: string) {
  return [
    `# ${packageId} ${title}`,
    '',
    body,
    '',
    '<!-- This file is intentionally writable by the agent during implementation. -->',
    ''
  ].join('\n');
}

function buildPublishedDeliveryIndexMarkdown(projectName: string, deliveries: DeliveryPackageDetail[]) {
  const lines = [
    generatedDocHeader('AIDD delivery packages'),
    '# AIDD Delivery',
    '',
    `Project: ${projectName}`,
    '',
    'This file lists active delivery packages published for agentic implementation.',
    '',
    '## Active delivery packages',
    '',
    deliveries.length
      ? deliveries.map((item) => `- [${item.id} · ${item.title}](../delivery/${item.id}/implementation-strategy.md) — ${setupStatusLabel(item.status)}`).join('\n')
      : 'No active delivery packages are currently published.',
    ''
  ];

  if (deliveries.length) {
    lines.push('## Workspace delivery files', '', 'Agents may update the implementation strategy and phase/stage Markdown files inside each workspace delivery package folder:', '', '- `implementation-strategy.md`', '- `phase-*.md`', '- `stage-*.md`', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildAgentsManagedBlock(input: {
  projectName: string;
  projectPath: string;
  workspacePath: string;
  components: any[];
  sourceProjects: SourceCodeProject[];
}) {
  const lines = [
    AGENTS_START_MARKER,
    '# AIDD Agent Operating Brief',
    '',
    'This block is generated by AIDD. Edit AIDD source files and republish rather than editing this block directly.',
    '',
    `Project: ${input.projectName}`,
    `AIDD project: \`${input.projectPath}\``,
    `Implementation workspace: \`${input.workspacePath}\``,
    '',
    '## Read first',
    '',
    '- `docs/foundation.md`',
    '- `docs/standards.md`',
    '- `docs/components.md`',
    '',
    '## Source and component map',
    ''
  ];

  if (input.components.length) {
    for (const component of input.components) {
      const title = String(component.title || component.slug || component.id || 'Untitled component');
      lines.push(`### ${title}`, '');
      lines.push(...componentSourceReferenceLines(component), '');
    }
  } else {
    lines.push('No AIDD components have been published yet.', '');
  }

  if (input.sourceProjects.length) {
    lines.push('## Source projects', '');
    for (const sourceProject of input.sourceProjects) lines.push(`- ${sourceProject.name}: \`${sourceProject.path}\``);
    lines.push('');
  }

  lines.push(
    '## Operating rules',
    '',
    '- Use `AGENTS.md` as the entry point and the files above as the approved AIDD context.',
    '- Do not scan or modify the AIDD source project unless the user explicitly asks.',
    '- Treat `docs/foundation.md`, `docs/standards.md`, and `docs/components.md` as read-only generated context.',
    '- Use the component source map to find implementation files before searching the wider workspace.',
    '- Approved delivery packages are published under `delivery/<package-id>/`; use that folder as the writable execution record.',
    '- Work in the implementation source workspace and avoid unrelated files unless the user or delivery instructions require it.',
    '',
    AGENTS_END_MARKER,
    ''
  );

  return lines.join('\n');
}

function extractAgentsManagedBlock(content: string) {
  const start = content.indexOf(AGENTS_START_MARKER);
  const end = content.indexOf(AGENTS_END_MARKER);
  if (start === -1 || end === -1 || end < start) return '';
  return content.slice(start, end + AGENTS_END_MARKER.length);
}

function replaceAgentsManagedBlock(existingContent: string, generatedBlock: string) {
  const start = existingContent.indexOf(AGENTS_START_MARKER);
  const end = existingContent.indexOf(AGENTS_END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existingContent.slice(0, start).replace(/\s+$/g, '');
    const after = existingContent.slice(end + AGENTS_END_MARKER.length).replace(/^\s+/g, '');
    return [before, generatedBlock.trim(), after].filter(Boolean).join('\n\n') + '\n';
  }
  const cleanExisting = existingContent.trim();
  return cleanExisting ? `${cleanExisting}\n\n${generatedBlock.trim()}\n` : `${generatedBlock.trim()}\n`;
}

async function readWorkspacePublishManifest(workspacePath: string): Promise<WorkspacePublishManifest | null> {
  const manifestPath = workspacePublishManifestPath(workspacePath);
  if (!(await exists(manifestPath))) return null;
  try {
    return await readJson<WorkspacePublishManifest>(manifestPath);
  } catch {
    return null;
  }
}

async function readActiveDeliveryPackageDetails(projectPath: string) {
  const summaries = (await readDeliveryPackages(projectPath)).filter((item) => !isTerminalDeliveryStatus(item.status));
  const details: DeliveryPackageDetail[] = [];
  for (const summary of summaries) {
    try {
      details.push(await readDeliveryPackage({ projectPath, id: summary.id }));
    } catch {
      // Ignore packages that disappear between the summary and detail read.
    }
  }
  return details;
}

async function buildWorkspacePublishPlan(projectPath: string) {
  const trackedProject = (await readProjects()).find((project) => sameDiskPath(project.path, projectPath));
  const projectName = trackedProject?.name || await readProjectName(projectPath);
  const workspacePath = trackedProject?.workspacePath?.trim();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const outputs: Array<WorkspacePublishOutput & { content: string }> = [];
  const writableFiles: Array<WorkspacePublishWritableFile & { content: string }> = [];

  if (!trackedProject) blockers.push('Open this project from the Projects screen so AIDD can read its source workspace setting.');
  if (!workspacePath) blockers.push('Choose the implementation/source-code workspace on Home.');

  if (workspacePath) {
    if (!(await exists(workspacePath))) blockers.push(`The configured source workspace does not exist: ${workspacePath}`);
    else {
      const stat = await fsp.stat(workspacePath);
      if (!stat.isDirectory()) blockers.push(`The configured source workspace is not a directory: ${workspacePath}`);
      if (sameDiskPath(workspacePath, projectPath)) blockers.push('The source workspace cannot be the active AIDD project.');
      else {
        if (isSameOrInsideDiskPath(projectPath, workspacePath)) warnings.push('The source workspace contains the active AIDD project. Publishing is allowed, but agents may scan AIDD source files from this workspace.');
        if (isSameOrInsideDiskPath(workspacePath, projectPath)) warnings.push('The source workspace is inside the active AIDD project. Publishing is allowed, but this layout may confuse agents and generated docs.');
      }
      const markers = stat.isDirectory() ? await detectSourceWorkspaceMarkers(workspacePath) : [];
      if (!markers.length) warnings.push('The configured workspace does not look like a source-code directory. Publishing is allowed, but check the workspace path.');
      const legacyAiddDocsPath = path.join(workspacePath, 'docs', 'aidd');
      if (await exists(legacyAiddDocsPath)) warnings.push('A legacy docs/aidd directory exists from an older publishing layout. New AIDD publishing writes directly to docs/. Remove docs/aidd if it was generated by AIDD and is no longer needed.');
    }
  }

  const foundation = await readFoundationDocuments(projectPath);
  const incompleteFoundation = foundation.filter((doc) => doc.required !== false && doc.status !== 'complete');
  if (incompleteFoundation.length) blockers.push(`Complete Foundation before publishing: ${incompleteFoundation.map((doc) => doc.title).join(', ')}.`);

  const standards = await readStandardSections(projectPath);
  const incompleteStandards = standards.filter((section) => !standardSectionDone(section));
  if (incompleteStandards.length) blockers.push(`Complete or skip Standards sections before publishing: ${incompleteStandards.map((section) => section.title).join(', ')}.`);

  const components = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));
  const sourceProjects = await readSourceProjects(projectPath);

  if (workspacePath) {
    outputs.push(buildPublishOutput('doc', 'docs/foundation.md', buildPublishedFoundationMarkdown(projectName, foundation)));
    outputs.push(buildPublishOutput('doc', 'docs/standards.md', buildPublishedStandardsMarkdown(projectName, standards)));
    outputs.push(buildPublishOutput('doc', 'docs/components.md', buildPublishedComponentsMarkdown(projectName, components, sourceProjects)));
    const agentsBlock = buildAgentsManagedBlock({ projectName, projectPath, workspacePath, components, sourceProjects });
    outputs.unshift(buildPublishOutput('agents', 'AGENTS.md', agentsBlock));
  }

  return { trackedProject, projectName, projectPath, workspacePath, blockers, warnings, outputs, writableFiles };
}

async function evaluateWorkspacePublishStatus(projectPath: string): Promise<WorkspacePublishStatus> {
  const plan = await buildWorkspacePublishPlan(projectPath);
  const workspacePath = plan.workspacePath;
  const checkedAt = new Date().toISOString();
  const manifest = workspacePath ? await readWorkspacePublishManifest(workspacePath) : null;
  const hasPublishedManifest = Boolean(manifest?.publishedAt);
  const manifestOutputByPath = new Map((manifest?.outputs || []).map((output) => [output.path, output]));

  const outputs: WorkspacePublishOutput[] = [];
  for (const output of plan.outputs) {
    const absolutePath = path.join(workspacePath || '', output.path);
    const previous = manifestOutputByPath.get(output.path);
    const fileExists = Boolean(workspacePath) && await exists(absolutePath);
    let currentHash = '';
    let hasManagedAgentsBlock = true;
    if (fileExists) {
      const current = await fsp.readFile(absolutePath, 'utf8');
      if (output.kind === 'agents') {
        const managed = extractAgentsManagedBlock(current);
        hasManagedAgentsBlock = Boolean(managed);
        currentHash = managed ? sha256Text(managed) : '';
      } else {
        currentHash = sha256Text(current);
      }
    }

    let status: WorkspacePublishOutput['status'] = 'up-to-date';
    let message = 'Published output is up to date.';
    if (!fileExists || (output.kind === 'agents' && !hasManagedAgentsBlock)) {
      status = 'missing';
      if (!hasPublishedManifest) {
        message = output.kind === 'agents'
          ? 'AGENTS.md will receive the generated AIDD managed block on first publish.'
          : 'This generated file will be created on first publish.';
      } else {
        message = output.kind === 'agents' ? 'AGENTS.md is missing the AIDD managed block.' : 'Published file is missing.';
      }
    } else if (!previous) {
      status = 'stale';
      message = 'Published file is not tracked in the AIDD publish manifest.';
    } else if (previous.sourceHash !== output.sourceHash) {
      status = 'stale';
      message = 'AIDD source content has changed since the last publish.';
    } else if (currentHash !== previous.outputHash) {
      status = 'modified';
      message = output.kind === 'agents' ? 'The AIDD managed block in AGENTS.md was edited outside AIDD.' : 'Published file was edited outside AIDD.';
    }

    outputs.push({ path: output.path, kind: output.kind, sourceHash: output.sourceHash, outputHash: output.outputHash, status, message });
  }

  const summary = {
    total: outputs.length,
    missing: outputs.filter((output) => output.status === 'missing').length,
    stale: outputs.filter((output) => output.status === 'stale').length,
    modified: outputs.filter((output) => output.status === 'modified').length,
    upToDate: outputs.filter((output) => output.status === 'up-to-date').length
  };

  let state: WorkspacePublishStatus['state'] = 'up-to-date';
  let label = 'Published docs up to date';
  let message = 'AGENTS.md and docs are current.';
  if (!workspacePath) {
    state = 'not-configured';
    label = 'Workspace not configured';
    message = 'Choose a source workspace before publishing AIDD docs.';
  } else if (plan.blockers.length) {
    state = 'blocked';
    label = 'Publishing blocked';
    message = plan.blockers[0];
  } else if (summary.missing) {
    state = 'missing';
    if (!hasPublishedManifest) {
      label = 'Not published yet';
      message = 'Publish will create AGENTS.md plus docs/foundation.md, docs/standards.md, and docs/components.md.';
    } else {
      label = 'Published docs missing';
      message = `${summary.missing} publish output${summary.missing === 1 ? '' : 's'} need to be recreated.`;
    }
  } else if (summary.modified) {
    state = 'modified';
    label = 'Published docs modified';
    message = `${summary.modified} published output${summary.modified === 1 ? '' : 's'} changed outside AIDD.`;
  } else if (summary.stale) {
    state = 'stale';
    label = 'Published docs stale';
    message = `${summary.stale} published output${summary.stale === 1 ? '' : 's'} need to be regenerated.`;
  }

  return {
    checkedAt,
    state,
    label,
    message,
    canPublish: Boolean(workspacePath) && plan.blockers.length === 0,
    projectPath,
    ...(workspacePath ? {
      workspacePath,
      docsPath: workspacePublishDocsPath(workspacePath),
      agentsPath: agentsTargetPathForWorkspace(workspacePath),
      manifestPath: workspacePublishManifestPath(workspacePath)
    } : {}),
    ...(manifest?.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
    blockers: plan.blockers,
    warnings: plan.warnings,
    outputs,
    writableFiles: plan.writableFiles.map((file) => ({ path: file.path, outputHash: file.outputHash })),
    summary
  };
}

async function publishWorkspaceDocs(projectPath: string): Promise<WorkspacePublishResult> {
  const plan = await buildWorkspacePublishPlan(projectPath);
  const workspacePath = plan.workspacePath;
  if (!workspacePath || plan.blockers.length) {
    const status = await evaluateWorkspacePublishStatus(projectPath);
    return { ...status, published: false, writtenFiles: [], skippedFiles: [], createdWritableFiles: [] };
  }

  const previousStatus = await evaluateWorkspacePublishStatus(projectPath);
  const outputStatusByPath = new Map(previousStatus.outputs.map((output) => [output.path, output.status]));
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const createdWritableFiles: string[] = [];

  for (const output of plan.outputs) {
    const status = outputStatusByPath.get(output.path);
    if (status === 'up-to-date') {
      skippedFiles.push(output.path);
      continue;
    }

    const absolutePath = path.join(workspacePath, output.path);
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    if (output.kind === 'agents') {
      const existing = await exists(absolutePath) ? await fsp.readFile(absolutePath, 'utf8') : '';
      await fsp.writeFile(absolutePath, replaceAgentsManagedBlock(existing, output.content), 'utf8');
    } else {
      await fsp.writeFile(absolutePath, output.content, 'utf8');
    }
    writtenFiles.push(output.path);
  }

  for (const writable of plan.writableFiles) {
    const absolutePath = path.join(workspacePath, writable.path);
    if (await exists(absolutePath)) continue;
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, writable.content, 'utf8');
    createdWritableFiles.push(writable.path);
  }

  const publishedAt = new Date().toISOString();
  const manifest: WorkspacePublishManifest = {
    schemaVersion: WORKSPACE_PUBLISH_SCHEMA_VERSION,
    templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION,
    projectName: plan.projectName,
    projectPath,
    workspacePath,
    docsPath: workspacePublishDocsPath(workspacePath),
    agentsPath: agentsTargetPathForWorkspace(workspacePath),
    publishedAt,
    outputs: plan.outputs.map((output) => ({ path: output.path, kind: output.kind, sourceHash: output.sourceHash, outputHash: output.outputHash })),
    writableFiles: plan.writableFiles.map((file) => file.path)
  };
  await writeJson(workspacePublishManifestPath(workspacePath), manifest);

  const status = await evaluateWorkspacePublishStatus(projectPath);
  return { ...status, published: true, writtenFiles, skippedFiles, createdWritableFiles };
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
    'foundation/01-project-overview.md',
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

async function validateWorkspaceConfiguration(projectPath: string, section: ProjectValidationSection) {
  const trackedProject = (await readProjects()).find((project) => sameDiskPath(project.path, projectPath));
  const workspacePath = trackedProject?.workspacePath?.trim();

  if (!trackedProject) {
    pushValidation(section, {
      id: 'workspace-project-not-tracked',
      title: 'Source workspace cannot be checked',
      message: 'This AIDD project is not currently in the tracked project list, so the source workspace setting could not be read.',
      severity: 'warning',
      action: 'Open the project from the Projects screen, then set the source workspace from Home.'
    });
    return;
  }

  if (!workspacePath) {
    pushValidation(section, {
      id: 'workspace-directory-missing',
      title: 'Source workspace is not configured',
      message: 'Set the workspace to the implementation/source-code directory where AGENTS.md and published AIDD docs should be generated.',
      severity: 'warning',
      action: 'Open Home and choose the source-code workspace before generating AGENTS.md.'
    });
    return;
  }

  if (!(await exists(workspacePath))) {
    pushValidation(section, {
      id: 'workspace-directory-not-found',
      title: 'Source workspace was not found',
      message: `The configured source workspace does not exist: ${workspacePath}`,
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the directory that contains the source code.'
    });
    return;
  }

  const workspaceStat = await fsp.stat(workspacePath);
  if (!workspaceStat.isDirectory()) {
    pushValidation(section, {
      id: 'workspace-directory-not-directory',
      title: 'Source workspace is not a directory',
      message: `The configured source workspace is not a directory: ${workspacePath}`,
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the directory that contains the source code.'
    });
    return;
  }

  let issueCount = 0;

  if (sameDiskPath(workspacePath, projectPath)) {
    issueCount++;
    pushValidation(section, {
      id: 'workspace-directory-is-aidd-project',
      title: 'Source workspace cannot be the AIDD project',
      message: 'The configured workspace is the active AIDD project. Choose the separate implementation directory that contains the source code.',
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the source-code workspace, not the AIDD project directory.'
    });
  } else {
    if (isSameOrInsideDiskPath(projectPath, workspacePath)) {
      issueCount++;
      pushValidation(section, {
        id: 'workspace-directory-contains-aidd-project',
        title: 'Source workspace contains the active AIDD project',
        message: `The active AIDD project is inside the configured source workspace. Workspace: ${workspacePath}. AIDD project: ${projectPath}. Agents may scan the AIDD source files if this is not corrected.`,
        severity: 'warning',
        path: workspacePath,
        action: 'Choose the implementation/source-code directory only, keeping the AIDD project outside that workspace.'
      });
    }

    if (isSameOrInsideDiskPath(workspacePath, projectPath)) {
      issueCount++;
      pushValidation(section, {
        id: 'workspace-directory-inside-aidd-project',
        title: 'Source workspace is inside the active AIDD project',
        message: `The configured source workspace is nested inside the AIDD project. Workspace: ${workspacePath}. AIDD project: ${projectPath}.`,
        severity: 'warning',
        path: workspacePath,
        action: 'Choose the real implementation/source-code directory outside the AIDD project.'
      });
    }
  }

  const sourceMarkers = await detectSourceWorkspaceMarkers(workspacePath);
  if (sourceMarkers.length === 0) {
    issueCount++;
    pushValidation(section, {
      id: 'workspace-directory-no-source-markers',
      title: 'Source workspace does not look like a code workspace',
      message: 'No common source-code markers were found at the workspace root, such as src/, Source/, package.json, .sln, .uproject, go.mod, pyproject.toml, or Cargo.toml.',
      severity: 'warning',
      path: workspacePath,
      action: 'Choose the directory that contains the project source code.'
    });
  } else {
    pushValidation(section, {
      id: 'workspace-directory-source-markers-found',
      title: 'Source workspace markers found',
      message: `Found source-code marker${sourceMarkers.length === 1 ? '' : 's'}: ${sourceMarkers.join(', ')}.`,
      severity: 'success',
      path: workspacePath
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'workspace-directory-ready',
      title: 'Source workspace is configured',
      message: `AGENTS.md will be generated at ${agentsTargetPathForWorkspace(workspacePath)}.`,
      severity: 'success',
      path: workspacePath
    });
  }
}

async function validateWorkspacePublishing(projectPath: string, section: ProjectValidationSection) {
  const status = await evaluateWorkspacePublishStatus(projectPath);

  if (status.state === 'up-to-date') {
    pushValidation(section, {
      id: 'workspace-publishing-up-to-date',
      title: 'Published AIDD docs are up to date',
      message: `AGENTS.md and docs are current in the source workspace.${status.publishedAt ? ` Last published: ${status.publishedAt}.` : ''}`,
      severity: 'success',
      path: status.docsPath
    });
    return;
  }

  if (status.state === 'not-configured') {
    pushValidation(section, {
      id: 'workspace-publishing-not-configured',
      title: 'Workspace publishing is not configured',
      message: 'Set the source workspace on Home before publishing AGENTS.md and docs.',
      severity: 'warning',
      action: 'Open Home and choose the source workspace.'
    });
    return;
  }

  if (status.blockers.length) {
    pushValidation(section, {
      id: 'workspace-publishing-blocked',
      title: 'Workspace publishing is blocked',
      message: status.blockers.join(' '),
      severity: 'warning',
      path: status.docsPath || status.workspacePath,
      action: 'Resolve the publishing blockers, then use Home > Publish workspace docs.'
    });
    return;
  }

  if (status.state === 'missing' && !status.publishedAt) {
    pushValidation(section, {
      id: 'workspace-publishing-not-yet-published',
      title: 'Workspace docs have not been published yet',
      message: 'Use Home > Publish workspace docs to create AGENTS.md, docs/foundation.md, docs/standards.md, and docs/components.md.',
      severity: 'warning',
      path: status.docsPath,
      action: 'Open Home and click Publish workspace docs.'
    });
    return;
  }

  const issueParts = [
    status.summary.missing ? `${status.summary.missing} missing` : '',
    status.summary.stale ? `${status.summary.stale} stale` : '',
    status.summary.modified ? `${status.summary.modified} modified outside AIDD` : ''
  ].filter(Boolean);

  pushValidation(section, {
    id: 'workspace-publishing-needs-publish',
    title: status.label,
    message: issueParts.length ? `Published workspace docs need attention: ${issueParts.join(', ')}.` : status.message,
    severity: 'warning',
    path: status.docsPath,
    action: 'Open Home and click Publish workspace docs.'
  });
}


async function validateComponentSourceLocations(projectPath: string, section: ProjectValidationSection) {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  const components = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));

  if (!components.length) {
    pushValidation(section, {
      id: 'component-source-no-components',
      title: 'No components to validate',
      message: 'Component source locations can be added after components are created.',
      severity: 'info'
    });
    return;
  }

  let configuredCount = 0;
  let issueCount = 0;

  for (const component of components) {
    const slug = String(component.slug || component.id || '').trim() || 'component';
    const title = String(component.title || slug);
    const source = normaliseComponentSource(component.source);
    if (!componentSourceIsConfigured(source)) continue;
    configuredCount += 1;

    const absolutePath = resolveComponentSourceDirectory(projectPath, source.directory, workspacePath);
    const insideWorkspace = Boolean(workspacePath && isSameOrInsideDiskPath(absolutePath, workspacePath));

    if (!workspacePath) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-workspace-missing`,
        title: `${title} source cannot be checked against workspace`,
        message: 'Set the source workspace on Home so AIDD can store component source paths relative to the workspace.',
        severity: 'warning',
        path: source.directory,
        action: 'Open Home and choose the implementation/source-code workspace.'
      });
    }

    if (!(await exists(absolutePath))) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-missing`,
        title: `${title} source location was not found`,
        message: `The configured component source path does not exist: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Open Components and choose the current source directory for this component.'
      });
      continue;
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isDirectory()) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-not-directory`,
        title: `${title} source location is not a directory`,
        message: `The configured component source path is not a directory: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Open Components and choose a directory for this component source location.'
      });
      continue;
    }

    if (workspacePath && !insideWorkspace) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-outside-workspace`,
        title: `${title} source location is outside the workspace`,
        message: `The source path is stored as an absolute path and may break for other users: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Prefer a directory inside the configured source workspace when this component belongs to the project.'
      });
    }

    if (source.pathMode === 'absolute') {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-absolute`,
        title: `${title} source location is not portable`,
        message: 'This component source location is stored as an absolute path. It can be kept, but it may not work for other users or agents on another machine.',
        severity: 'warning',
        path: source.directory,
        action: 'Choose a source location inside the workspace to save a workspace-relative path.'
      });
    }

    const detection = normaliseComponentSourceDetection(source.detection);
    if (!detection) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-undetected`,
        title: `${title} source type has not been detected`,
        message: 'Run Detect in the component source card so AIDD can publish useful source type, language, and framework hints for agents.',
        severity: 'warning',
        path: source.directory,
        action: 'Open Components, configure source, then click Detect.'
      });
    } else if (detection.confidence === 'low') {
      pushValidation(section, {
        id: `component-source-${slug}-low-confidence`,
        title: `${title} source type detection is low confidence`,
        message: `Detected ${detection.suggestedType}, but with low confidence. Evidence: ${detection.reasons.slice(0, 2).join(' ')}`,
        severity: 'info',
        path: source.directory,
        action: 'Review the component source type if this looks wrong.'
      });
    }
  }

  if (configuredCount === 0) {
    pushValidation(section, {
      id: 'component-source-none-configured',
      title: 'No component source locations configured',
      message: 'Source locations are optional, but adding them helps AGENTS.md point agents at the right source directories without broad scanning.',
      severity: 'info',
      action: 'Open Components and add source locations for the components agents are likely to modify.'
    });
    return;
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'component-source-ready',
      title: 'Component source locations are usable',
      message: `${configuredCount} component source location${configuredCount === 1 ? '' : 's'} configured and portable inside the source workspace.`,
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

async function validateWorkspaceDeliveryPackages(projectPath: string, section: ProjectValidationSection) {
  const packages = await readDeliveryPackages(projectPath);
  const approvedPackages = packages.filter((item) => normaliseStatusForDelivery(item.status) === 'approved');

  if (!approvedPackages.length) {
    pushValidation(section, {
      id: 'workspace-delivery-no-approved-packages',
      title: 'No approved delivery packages to publish',
      message: 'Delivery packages will be published to workspace/delivery when they are approved.',
      severity: 'info'
    });
    return;
  }

  let issueCount = 0;
  for (const item of approvedPackages) {
    if (item.workspacePublishStatus === 'published') continue;
    issueCount++;
    pushValidation(section, {
      id: `workspace-delivery-${item.id}-${item.workspacePublishStatus || 'missing'}`,
      title: `${item.id} is approved but not current in workspace/delivery`,
      message: item.workspacePublishStatus === 'not-configured'
        ? 'Set the source workspace on Home so the approved delivery package can be published.'
        : item.workspacePublishStatus === 'stale'
          ? 'The AIDD delivery package changed after it was published. Republish it to workspace/delivery.'
          : 'Publish the approved package to workspace/delivery so the implementation agent can work from it.',
      severity: 'warning',
      path: item.workspacePackagePath,
      action: 'Open Delivery, select the package, then use Approve & publish or Publish to workspace.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'workspace-delivery-published',
      title: 'Approved delivery packages are published',
      message: `${approvedPackages.length} approved delivery package${approvedPackages.length === 1 ? '' : 's'} available in workspace/delivery.`,
      severity: 'success'
    });
  }
}

async function validateProject(projectPath: string): Promise<ProjectValidationReport> {
  const manifestSection = validationSection('template-manifest', 'Template manifest');
  const templateSection = validationSection('templates', 'Template files');
  const frontmatterSection = validationSection('frontmatter', 'Front matter versions');
  const dataSection = validationSection('data', 'Required data files');
  const entitySection = validationSection('entities', 'Entity data integrity');
  const workspaceSection = validationSection('workspace', 'Source workspace configuration');
  const componentSourceSection = validationSection('component-source-locations', 'Component source locations');
  const publishSection = validationSection('workspace-publishing', 'Workspace publishing');
  const deliveryPublishSection = validationSection('workspace-delivery', 'Workspace delivery packages');

  if (!projectPath || !(await exists(projectPath))) {
    pushValidation(dataSection, {
      id: 'project-path-missing',
      title: 'Project folder not found',
      message: `The selected project folder does not exist: ${projectPath || 'not set'}`,
      severity: 'error',
      action: 'Open a valid AIDD project from the Projects screen.'
    });
    return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection, workspaceSection, componentSourceSection, publishSection, deliveryPublishSection]);
  }

  await validateTemplateManifest(projectPath, manifestSection);
  await validateTemplateFiles(projectPath, templateSection);
  await validateProjectFrontmatterVersions(projectPath, frontmatterSection);
  await validateProjectDataIntegrity(projectPath, dataSection);
  await validateEntityDataIntegrity(projectPath, entitySection);
  await validateWorkspaceConfiguration(projectPath, workspaceSection);
  await validateComponentSourceLocations(projectPath, componentSourceSection);
  await validateWorkspacePublishing(projectPath, publishSection);
  await validateWorkspaceDeliveryPackages(projectPath, deliveryPublishSection);

  return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection, workspaceSection, componentSourceSection, publishSection, deliveryPublishSection]);
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
    .replace(/Describe what this project is, why it exists, and what success looks like\.?/gi, '')
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
  const summarySources = [
    path.join(projectPath, 'foundation', '01-project-overview.md'),
    path.join(projectPath, 'foundation', '02-product-definition.md')
  ];

  let summary = '';
  for (const sourcePath of summarySources) {
    if (!(await exists(sourcePath))) continue;
    const body = markdownBodyWithoutFrontmatter(await fsp.readFile(sourcePath, 'utf8'));
    const candidate = summaryFromMarkdownBody(body);
    if (candidate && !descriptionIsMissingOrPlaceholder(candidate)) {
      summary = candidate;
      break;
    }
  }
  if (!summary) return;

  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await readJsonSafe<any>(manifestPath);
  if (manifest.ok && descriptionIsMissingOrPlaceholder(manifest.data?.project?.description)) {
    manifest.data.project = { ...(manifest.data.project || {}), description: summary };
    await writeJson(manifestPath, manifest.data);
    changes.push('Updated project summary metadata from Foundation context');
    pushRepairLog(logs, 'success', 'data-repair', 'Updated project manifest summary from Foundation context.', { path: 'aidd.template.json' });
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
    'foundation/01-project-overview.md',
    'foundation',
    'project-overview',
    'Project Overview',
    '# Project Overview\n\nDescribe what this project is, why it exists, and what success looks like.'
  );

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

  for (const section of STANDARD_SECTION_DEFINITIONS) {
    await ensureMarkdown(
      `foundation/standards/${section.fileName}`,
      'standards',
      section.id,
      section.title,
      section.body,
      section.required
    );
  }

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

  await restoreArchivedSummaryContent('common/01-project-overview.md', 'foundation/01-project-overview.md');
  await restoreArchivedSummaryContent('common/02-product-definition.md', 'foundation/02-product-definition.md');
  await restoreArchivedSummaryContent('common/03-audience-and-users.md', 'foundation/03-audience-and-users.md');
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
  const detectedMarkers = Array.isArray((input as any).detectedMarkers) ? (input as any).detectedMarkers.map(String).map((item: string) => item.trim()).filter(Boolean) : [];
  const suggestedType = normaliseComponentSourceType(input.suggestedType);
  const confidence = input.confidence === 'high' || input.confidence === 'medium' || input.confidence === 'low' ? input.confidence : 'low';
  if (!reasons.length && !detectedLanguages.length && !detectedFrameworks.length && !detectedMarkers.length && suggestedType === 'other') return null;
  return {
    suggestedType,
    confidence,
    detectedLanguages: Array.from(new Set(detectedLanguages)),
    detectedFrameworks: Array.from(new Set(detectedFrameworks)),
    detectedMarkers: Array.from(new Set(detectedMarkers)),
    ...(input.packageManager ? { packageManager: String(input.packageManager) } : {}),
    reasons
  };
}

function normaliseComponentSourceType(value?: string | null) {
  const normalised = String(value || '').trim() || 'other';
  return COMPONENT_SOURCE_TYPES.has(normalised) ? normalised : 'other';
}

function normaliseComponentSourcePathMode(value: unknown, directory: string): ComponentSourcePathMode {
  if (value === 'absolute') return 'absolute';
  if (value === 'workspace-relative') return 'workspace-relative';
  return directory && path.isAbsolute(directory) ? 'absolute' : 'workspace-relative';
}

function normaliseComponentSource(input?: Partial<ComponentSourceConfig> | null): ComponentSourceConfig {
  const directory = String(input?.directory || '').trim().replace(/\\/g, '/');
  const pathMode = normaliseComponentSourcePathMode((input as any)?.pathMode, directory);
  const absolutePath = String((input as any)?.absolutePath || '').trim().replace(/\\/g, '/');
  const isInsideWorkspace = typeof (input as any)?.isInsideWorkspace === 'boolean'
    ? Boolean((input as any).isInsideWorkspace)
    : pathMode === 'workspace-relative';
  const warning = String((input as any)?.warning || '').trim();

  return {
    directory,
    type: normaliseComponentSourceType(input?.type),
    pathMode,
    isInsideWorkspace,
    ...(pathMode === 'absolute' && (absolutePath || directory) ? { absolutePath: absolutePath || directory } : {}),
    ...(warning ? { warning } : {}),
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
    `- Path: \`${source.directory}\``,
    `- Path mode: \`${source.pathMode}\``,
    `- Portable: \`${source.isInsideWorkspace ? 'yes' : 'no'}\``,
    `- Source type: \`${source.type || 'other'}\``
  ];
  if (source.absolutePath && source.pathMode === 'absolute') lines.push(`- Absolute path: \`${source.absolutePath}\``);
  if (source.warning) lines.push(`- Warning: ${source.warning}`);
  if (detection) {
    lines.push(`- Detection confidence: \`${detection.confidence}\``);
    lines.push(`- Suggested type: \`${detection.suggestedType}\``);
    if (detection.packageManager) lines.push(`- Package manager: \`${detection.packageManager}\``);
    if (detection.detectedMarkers.length) lines.push(`- Detected markers: ${detection.detectedMarkers.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.detectedFrameworks.length) lines.push(`- Detected frameworks: ${detection.detectedFrameworks.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.detectedLanguages.length) lines.push(`- Detected languages: ${detection.detectedLanguages.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.reasons.length) {
      lines.push('- Detection evidence:');
      for (const reason of detection.reasons) lines.push(`  - ${reason}`);
    }
  }
  return lines.join('\n');
}

function componentSourcePathInfo(projectPath: string, absolutePath: string, workspacePath?: string | null) {
  const resolved = path.resolve(absolutePath);
  const workspace = String(workspacePath || '').trim();
  const isInsideWorkspace = Boolean(workspace && isSameOrInsideDiskPath(resolved, workspace));
  const directory = isInsideWorkspace
    ? (path.relative(workspace, resolved) || '.')
    : resolved;
  const pathMode: ComponentSourcePathMode = isInsideWorkspace ? 'workspace-relative' : 'absolute';
  const warning = !workspace
    ? 'No source workspace is configured, so this source location is stored as an absolute path and may break for other users.'
    : isInsideWorkspace
      ? ''
      : 'This source location is outside the configured workspace and is stored as an absolute path. It may break for other users.';

  return {
    directory: normaliseRelativePath(directory),
    absolutePath: resolved.replace(/\\/g, '/'),
    pathMode,
    isInsideWorkspace,
    ...(warning ? { warning } : {})
  };
}

function componentSourceDirectoryToStoredPath(projectPath: string, absolutePath: string, workspacePath?: string | null) {
  return componentSourcePathInfo(projectPath, absolutePath, workspacePath).directory;
}

function resolveComponentSourceDirectory(projectPath: string, sourceDirectory?: string | null, workspacePath?: string | null) {
  const value = String(sourceDirectory || '').trim();
  if (!value) return String(workspacePath || '').trim() || projectPath;
  return path.isAbsolute(value) ? value : path.resolve(String(workspacePath || '').trim() || projectPath, value);
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
  const markers = new Set<string>();
  const addMarker = (marker: string, condition: boolean) => { if (condition) markers.add(marker); };

  const hasFile = (fileName: string) => fileSet.has(fileName.toLowerCase()) || basenames.has(fileName.toLowerCase());
  const hasAnyFile = (...fileNames: string[]) => fileNames.some(hasFile);
  const hasDep = (...names: string[]) => names.some((name) => deps.has(name));
  const hasRelativeMatch = (predicate: (file: string) => boolean) => files.some((file) => predicate(file.toLowerCase()));

  addMarker('package.json', Boolean(packageJson));
  addMarker('tsconfig.json', hasAnyFile('tsconfig.json'));
  addMarker('vite.config', hasAnyFile('vite.config.js', 'vite.config.mjs', 'vite.config.ts'));
  addMarker('next.config', hasAnyFile('next.config.js', 'next.config.mjs', 'next.config.ts'));
  addMarker('astro.config', hasAnyFile('astro.config.js', 'astro.config.mjs', 'astro.config.ts'));
  addMarker('angular.json', hasAnyFile('angular.json'));
  addMarker('.sln', hasRelativeMatch((file) => file.endsWith('.sln')));
  addMarker('.csproj', hasRelativeMatch((file) => file.endsWith('.csproj')));
  addMarker('.uproject', hasRelativeMatch((file) => file.endsWith('.uproject')));
  addMarker('.uplugin', hasRelativeMatch((file) => file.endsWith('.uplugin')));
  addMarker('.Build.cs', hasRelativeMatch((file) => file.endsWith('.build.cs')));
  addMarker('pyproject.toml', hasAnyFile('pyproject.toml'));
  addMarker('requirements.txt', hasAnyFile('requirements.txt'));
  addMarker('go.mod', hasAnyFile('go.mod'));
  addMarker('Cargo.toml', hasAnyFile('cargo.toml'));
  addMarker('Dockerfile', hasAnyFile('dockerfile'));

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
  if (packageManager) {
    reasons.push(`${packageManager} lockfile found.`);
    markers.add(`${packageManager} lockfile`);
  }

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
    detectedMarkers: Array.from(markers).sort(),
    ...(packageManager ? { packageManager } : {}),
    reasons: Array.from(new Set(reasons)).slice(0, 12)
  };
}

async function selectComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection | null> {
  const workspacePath = await readWorkspacePathForProject(input.projectPath);
  const currentDirectory = input.currentDirectory || input.directory || '';
  const fallbackPath = workspacePath || input.projectPath;
  const defaultPath = currentDirectory ? resolveComponentSourceDirectory(input.projectPath, currentDirectory, workspacePath) : fallbackPath;
  const result = await dialog.showOpenDialog({
    title: 'Select component source directory',
    defaultPath: await exists(defaultPath) ? defaultPath : fallbackPath,
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const absolutePath = path.resolve(result.filePaths[0]);
  const sourcePathInfo = componentSourcePathInfo(input.projectPath, absolutePath, workspacePath);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    ...sourcePathInfo,
    detection
  };
}

async function detectStoredComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection> {
  if (!input.directory?.trim()) throw new Error('Source directory is required.');
  const workspacePath = await readWorkspacePathForProject(input.projectPath);
  const absolutePath = resolveComponentSourceDirectory(input.projectPath, input.directory, workspacePath);
  if (!(await exists(absolutePath))) throw new Error(`Source directory does not exist: ${input.directory}`);
  const sourcePathInfo = componentSourcePathInfo(input.projectPath, absolutePath, workspacePath);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    ...sourcePathInfo,
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

async function readComponentTechnicalReviews(projectPath: string, slug: string): Promise<ComponentTechnicalReviewRecord[]> {
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

const COMPONENT_TECHNICAL_CHANGE_STATUSES = new Set<ComponentTechnicalChangeStatus>([
  'draft',
  'proposed',
  'needs-review',
  'approved',
  'rejected',
  'superseded',
  'packaged',
  'delivered'
]);

const COMPONENT_TECHNICAL_CHANGE_RISKS = new Set<ComponentTechnicalChangeRisk>(['low', 'medium', 'high', 'unknown']);

const COMPONENT_TECHNICAL_CHANGE_SECTIONS: Array<Omit<ComponentTechnicalChangeSection, 'body'>> = [
  { key: 'overview', fileName: 'overview.md', title: 'Overview', editable: true },
  { key: 'affected-files', fileName: 'affected-files.md', title: 'Affected files', editable: true },
  { key: 'rationale', fileName: 'rationale.md', title: 'Rationale', editable: true },
  { key: 'verification', fileName: 'verification.md', title: 'Verification', editable: true },
  { key: 'review', fileName: 'review.md', title: 'Review', editable: true },
  { key: 'patch', fileName: 'patches/proposed.patch', title: 'Patch', editable: true },
  { key: 'patch-notes', fileName: 'patches/notes.md', title: 'Patch notes', editable: true }
];

const COMPONENT_TECHNICAL_CHANGE_SECTION_BY_FILE = new Map(
  COMPONENT_TECHNICAL_CHANGE_SECTIONS.map((section) => [normaliseRelativePath(section.fileName).toLowerCase(), section])
);

function normaliseComponentTechnicalChangeStatus(value: unknown, fallback: ComponentTechnicalChangeStatus = 'draft'): ComponentTechnicalChangeStatus {
  const status = String(value || '').trim().toLowerCase() as ComponentTechnicalChangeStatus;
  return COMPONENT_TECHNICAL_CHANGE_STATUSES.has(status) ? status : fallback;
}

function normaliseComponentTechnicalChangeRisk(value: unknown): ComponentTechnicalChangeRisk {
  const risk = String(value || '').trim().toLowerCase() as ComponentTechnicalChangeRisk;
  return COMPONENT_TECHNICAL_CHANGE_RISKS.has(risk) ? risk : 'unknown';
}

function componentTechnicalChangesRoot(projectPath: string, slug: string) {
  return path.join(projectPath, 'components', slugify(slug), 'technical-changes');
}

function titleFromTechnicalChangeId(id: string) {
  return String(id || 'Technical change')
    .replace(/^TC-\d{1,5}-?/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || String(id || 'Technical change');
}

function titleFromMarkdownHeading(raw: string, fallback: string) {
  const heading = raw.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  return heading || fallback;
}

function patchFileNameLooksSupported(fileName: string) {
  return ['.patch', '.diff'].includes(path.extname(fileName).toLowerCase());
}

function isSafeComponentTechnicalChangePatchFileName(fileName: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) return false;
  return fileName.toLowerCase() === 'notes.md' || patchFileNameLooksSupported(fileName);
}

function resolveTechnicalChangePath(changeDir: string, relativePath: string) {
  const normalised = normaliseRelativePath(relativePath).replace(/^\/+/, '');
  const target = path.resolve(changeDir, normalised);
  if (!isSameOrInsideDiskPath(target, changeDir)) throw new Error(`Unsafe technical change path: ${relativePath}`);
  return target;
}

async function countTechnicalChangePatches(changeDir: string) {
  const patchesDir = path.join(changeDir, 'patches');
  if (!(await exists(patchesDir))) return 0;
  const entries = await fsp.readdir(patchesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && patchFileNameLooksSupported(entry.name)).length;
}

function normaliseTechnicalChangeRecord(input: any, projectPath: string, componentSlug: string, changeDir: string): ComponentTechnicalChangeRecord {
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

async function readComponentTechnicalChanges(projectPath: string, slug: string): Promise<ComponentTechnicalChangeRecord[]> {
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

function technicalChangeMetadata(record: ComponentTechnicalChangeRecord) {
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

async function writeTechnicalChangeMetadata(changeDir: string, record: ComponentTechnicalChangeRecord) {
  await writeJson(path.join(changeDir, 'technical-change.json'), technicalChangeMetadata(record));
}

async function uniqueTechnicalChangeId(root: string, preferredId: string) {
  const base = preferredId || 'TC-001-technical-change';
  let candidate = base;
  let suffix = 2;
  while (await exists(path.join(root, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function nextManualTechnicalChangeId(projectPath: string, componentSlug: string, title: string) {
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

function technicalChangeMarkdownTemplates(title: string) {
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

async function ensureTechnicalChangeMarkdownFiles(changeDir: string, title: string) {
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

async function createComponentTechnicalChange(input: CreateComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeRecord> {
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

async function updateComponentTechnicalChangeStatus(input: UpdateComponentTechnicalChangeStatusInput): Promise<ComponentTechnicalChangeRecord[]> {
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

async function findComponentTechnicalChangeTarget(projectPath: string, slug: string, id: string) {
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

async function readComponentTechnicalChange(input: ReadComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeDetail> {
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

async function saveComponentTechnicalChange(input: SaveComponentTechnicalChangeInput): Promise<ComponentTechnicalChangeDetail> {
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

async function readLinkedFindingsForImportedTechnicalChange(changeDir: string) {
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

async function createTechnicalChangeFromImportedReview(input: {
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

function buildTechnicalChangeReviewReadme(input: {
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

function buildTechnicalChangeReviewInstructions(change: ComponentTechnicalChangeDetail) {
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

function buildTechnicalChangeReviewReturnFormat(change: ComponentTechnicalChangeDetail) {
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

async function createComponentTechnicalChangeReviewPackage(input: ComponentTechnicalChangeReviewPackageInput): Promise<ComponentTechnicalChangeReviewPackageResult> {
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

function componentTechnicalChangeReviewReturnPath(entryName: string, changeId: string) {
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

function isSafeTechnicalChangeReviewReturnPath(relativePath: string) {
  const lower = normaliseRelativePath(relativePath).toLowerCase();
  if (COMPONENT_TECHNICAL_CHANGE_SECTION_BY_FILE.has(lower)) return true;
  const parts = lower.split('/');
  if (parts.length === 2 && parts[0] === 'patches') {
    return isSafeComponentTechnicalChangePatchFileName(parts[1]);
  }
  return false;
}

async function importComponentTechnicalChangeReviewPackage(input: ImportComponentTechnicalChangeReviewPackageInput): Promise<ComponentTechnicalChangeReviewPackageImportResult> {
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
    technicalReviews: await readComponentTechnicalReviews(input.projectPath, slug),
    technicalChanges: await readComponentTechnicalChanges(input.projectPath, slug),
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

async function removeDeletedComponentFromCapabilities(projectPath: string, componentSlug: string) {
  const capabilities = await readEntities(projectPath, 'capabilities', 'capability.json');
  const updatedCapabilitySlugs: string[] = [];

  for (const capability of capabilities) {
    const capabilitySlug = String(capability.slug || capability.id || slugify(String(capability.title || ''))).trim();
    if (!capabilitySlug) continue;

    const linkedComponents: string[] = Array.isArray(capability.components)
      ? capability.components.map(String)
      : Array.isArray(capability.modules)
        ? capability.modules.map(String)
        : [];
    if (!linkedComponents.includes(componentSlug)) continue;

    const nextComponentSlugs = linkedComponents.filter((slug) => slug !== componentSlug);
    const detail = await readCapability({ projectPath, slug: capabilitySlug });
    await updateCapability({
      projectPath,
      slug: capabilitySlug,
      title: detail.title,
      status: detail.status as SetupStepStatus,
      componentSlugs: nextComponentSlugs,
      sections: detail.sections
    });
    updatedCapabilitySlugs.push(capabilitySlug);
  }

  return updatedCapabilitySlugs;
}

async function deleteComponent(input: DeleteComponentInput) {
  const rawSlug = String(input.slug || '').trim();
  if (!input.projectPath || !rawSlug) throw new Error('Project path and component slug are required.');

  const slug = slugify(rawSlug);
  if (!slug || slug !== rawSlug) throw new Error('Component delete rejected: invalid component slug.');

  const candidates = [
    {
      root: path.resolve(input.projectPath, 'components'),
      dir: path.resolve(input.projectPath, 'components', slug),
      manifest: 'component.json'
    },
    {
      root: path.resolve(input.projectPath, 'modules'),
      dir: path.resolve(input.projectPath, 'modules', slug),
      manifest: 'module.json'
    }
  ];

  let target: typeof candidates[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.dir === candidate.root || !candidate.dir.startsWith(`${candidate.root}${path.sep}`)) {
      throw new Error('Component delete rejected: unsafe component path.');
    }
    if (await exists(path.join(candidate.dir, candidate.manifest))) {
      target = candidate;
      break;
    }
  }

  if (!target) throw new Error(`Component not found: ${slug}`);

  await fsp.rm(target.dir, { recursive: true, force: false });
  await removeDeletedComponentFromCapabilities(input.projectPath, slug);
  await refreshComponentsIndex(input.projectPath);
  await refreshCapabilitiesIndex(input.projectPath);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPONENT_REVIEW_TITLE_SUFFIXES = Array.from(new Set([
  ...COMPONENT_TEMPLATE_SECTIONS.map((section) => section.title),
  ...COMPONENT_TEMPLATE_SECTIONS.map((section) => section.key.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')),
  'Purpose',
  'Boundaries',
  'Interfaces',
  'Data And State',
  'Data & State',
  'Dependencies',
  'Dependencies & Integrations',
  'Architecture',
  'Internal Design',
  'Standards',
  'Quality Requirements',
  'Risks'
])).sort((a, b) => b.length - a.length);

function componentTitleCandidateFromReviewTitle(rawTitle: string, slug: string) {
  let title = String(rawTitle || '').trim().replace(/\s+/g, ' ');
  if (!title) return '';

  for (const suffix of COMPONENT_REVIEW_TITLE_SUFFIXES) {
    const re = new RegExp(`(?:\\s+[-–—:]?\\s*)${escapeRegExp(suffix)}$`, 'i');
    title = title.replace(re, '').trim();
  }

  if (!title || slugify(title) === slugify(slug)) return title || titleFromSlug(slug);
  return title;
}

async function readComponentReviewSectionMetadata(projectPath: string, slug: string) {
  const dir = path.join(projectPath, 'components', slug);
  const titleCandidates: string[] = [];
  const sourceProjects = new Set<string>();
  const capabilities = new Set<string>();
  const sections: ComponentSectionInput[] = [];

  for (const template of COMPONENT_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    if (!(await exists(filePath))) continue;

    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    const aidd = parsed.ok ? ((parsed.parsed.data as any)?.aidd || {}) : {};
    const body = sectionBodyFromMarkdown(raw);
    const heading = firstMarkdownHeading(raw);
    const aiddTitle = String(aidd.title || '').trim();

    if (aiddTitle) titleCandidates.push(componentTitleCandidateFromReviewTitle(aiddTitle, slug));
    if (heading) titleCandidates.push(componentTitleCandidateFromReviewTitle(heading, slug));

    if (Array.isArray(aidd.sourceProjects)) {
      for (const item of aidd.sourceProjects) {
        const value = String(item || '').trim();
        if (value) sourceProjects.add(value);
      }
    }
    if (Array.isArray(aidd.capabilitiesSupported)) {
      for (const item of aidd.capabilitiesSupported) {
        const value = String(item || '').trim();
        if (value) capabilities.add(value);
      }
    }

    const status = String(aidd.status || (contentLooksComplete(raw) ? 'complete' : 'draft')) as SetupStepStatus;
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status,
      skipReason: aidd.skipReason ? String(aidd.skipReason) : ''
    });
  }

  const title = titleCandidates.find((candidate) => candidate.trim()) || titleFromSlug(slug);
  const status = sections.length && sections.every((section) => section.status === 'complete' || section.status === 'skipped')
    ? 'complete'
    : 'draft';

  return {
    title,
    status: status as SetupStepStatus,
    sourceProjects: Array.from(sourceProjects),
    capabilities: Array.from(capabilities),
    sections: normaliseComponentSections(sections, {})
  };
}

async function reconcileComponentAfterReviewImport(projectPath: string, slug: string) {
  const canonicalSlug = slugify(slug);
  const dir = path.join(projectPath, 'components', canonicalSlug);
  const manifestPath = path.join(dir, 'component.json');
  const indexPath = path.join(dir, 'index.md');
  const metadata = await readComponentReviewSectionMetadata(projectPath, canonicalSlug);
  const linkedCapabilities = await capabilitySlugsReferencingComponent(projectPath, canonicalSlug);
  const capabilities = Array.from(new Set([...metadata.capabilities, ...linkedCapabilities]));
  const source = normaliseComponentSource();
  const createdManifest = !(await exists(manifestPath));

  await fsp.mkdir(dir, { recursive: true });

  if (createdManifest) {
    await writeJson(manifestPath, {
      slug: canonicalSlug,
      title: metadata.title,
      kind: 'component',
      status: metadata.status,
      lifecycle: metadata.status,
      sourceProjects: metadata.sourceProjects,
      source,
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      supportsCapabilities: capabilities,
      capabilitiesSupported: capabilities,
      dependsOn: [],
      exposes: [],
      dataOwned: [],
      sections: metadata.sections.map((section) => ({
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
        status: componentContractBlockers(metadata.sections).length ? 'blocked' : 'missing',
        blockers: componentContractBlockers(metadata.sections)
      },
      template: {
        type: 'component',
        sectionFiles: COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName),
        templateVersion: TEMPLATE_VERSION
      }
    });
  }

  if (!(await exists(indexPath))) {
    await fsp.writeFile(indexPath, buildComponentIndexMarkdown({
      slug: canonicalSlug,
      title: metadata.title,
      status: metadata.status,
      sourceProjects: metadata.sourceProjects,
      source,
      capabilities,
      sections: metadata.sections
    }), 'utf8');
  }

  const component = await readComponent({ projectPath, slug: canonicalSlug });
  await updateComponent({
    projectPath,
    slug: canonicalSlug,
    title: component.title,
    status: component.status as SetupStepStatus,
    sourceProjects: component.sourceProjects,
    source: component.source,
    capabilities: component.capabilities,
    sections: component.sections
  });

  return { slug: canonicalSlug, createdManifest };
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

  const componentSlugs = Array.from(new Set(importedFiles.map((file) => file.split('/')[1]).filter(Boolean).map((slug) => slugify(slug)))).sort((a, b) => a.localeCompare(b));
  const importedComponents: string[] = [];

  for (const slug of componentSlugs) {
    const result = await reconcileComponentAfterReviewImport(root, slug);
    importedComponents.push(result.slug);
  }

  await refreshComponentsIndex(root);

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    componentCount: componentSlugs.length,
    importedComponents: Array.from(new Set(importedComponents)).sort((a, b) => a.localeCompare(b)),
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


const FOUNDATION_REVIEW_FILES = new Set([
  'foundation/01-project-overview.md',
  'foundation/02-product-definition.md',
  'foundation/03-audience-and-users.md',
  'foundation/04-goals-and-success-metrics.md'
]);

async function readProjectName(root: string) {
  const templateManifestPath = path.join(root, 'aidd.template.json');
  const templateManifest = await exists(templateManifestPath)
    ? await readJson<any>(templateManifestPath).catch(() => null)
    : null;
  return String(templateManifest?.project?.name || path.basename(root) || 'AIDD project');
}

async function readStandardsReviewMarkdown(projectPath: string) {
  const sections = await readStandardSections(projectPath);
  const included: string[] = [];

  for (const section of sections) {
    if (!(await exists(section.filePath))) continue;
    const raw = await fsp.readFile(section.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    const parsed = matter(raw);
    included.push([
      `## ${section.title}`,
      '',
      `Source: foundation/standards/${section.fileName}`,
      `Status: ${section.status}`,
      '',
      parsed.content.trim() || '_No content captured._'
    ].join('\n'));
  }

  if (!included.length) return '_No project standards files were found or included._\n';
  return included.join('\n\n');
}

function buildFoundationReviewPackageReadme(input: { projectName: string; foundationFileCount: number }) {
  return `# AIDD Foundation Review Package

This zip was generated by AIDD for Foundation review.

## Review scope

You are reviewing **only the Foundation files included in this package**.

Do not review or modify components, capabilities, delivery packages, source code, generated files, or project structure.

\`CONTEXT-STANDARDS.md\` is **context only**. Use it to understand project expectations, but do not return it.

Focus your review on:

- clarity of project overview
- clarity of product definition
- audience and user understanding
- goals and success metrics
- consistency between overview, product, audience, and goals
- missing or unclear assumptions
- pros and cons
- usefulness for future component, capability, and delivery-package work

## Your task

Review the Markdown files under \`foundation/\` and improve them so they are clearer, more complete, and easier to use as AIDD project context.

## Allowed changes

You may update only these files:

- \`foundation/01-project-overview.md\`
- \`foundation/02-product-definition.md\`
- \`foundation/03-audience-and-users.md\`
- \`foundation/04-goals-and-success-metrics.md\`

You must return a zip containing only:

- updated Markdown files under \`foundation/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated Foundation files.

## Do not return

Do not return:

- \`CONTEXT-STANDARDS.md\`
- \`README.md\`
- \`MANIFEST.json\`
- source code
- components
- capabilities
- delivery packages
- files outside \`foundation/\`
- any unknown Foundation files

## Required return shape

\`\`\`txt
foundation/
  01-project-overview.md
  02-product-definition.md
  03-audience-and-users.md
  04-goals-and-success-metrics.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`foundation/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review packages

To exclude a Markdown file from future review packages, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Foundation files included: ${input.foundationFileCount}
`;
}

function buildFoundationReviewTemplate(input: { projectName: string }) {
  return `# Foundation Review

Project: ${input.projectName}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

async function collectFoundationReviewEntries(projectPath: string) {
  const docs = await readFoundationDocuments(projectPath);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];

  for (const doc of docs) {
    const relativePath = `foundation/${doc.fileName}`;
    if (!FOUNDATION_REVIEW_FILES.has(relativePath)) continue;
    if (!(await exists(doc.filePath))) continue;
    const raw = await fsp.readFile(doc.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    entries.push({ name: relativePath, data: Buffer.from(raw, 'utf8') });
    includedFiles.push(relativePath);
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)) };
}

async function createFoundationReviewPackage(projectPath: string): Promise<FoundationReviewPackageResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-foundation-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-packages', slugify(projectName), 'foundation');
  const filePath = path.join(outputDir, fileName);

  const foundation = await collectFoundationReviewEntries(root);
  if (!foundation.includedFiles.length) {
    throw new Error('No Foundation files were available to package for review.');
  }

  const manifest = {
    bundleType: 'foundation-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      'foundation/01-project-overview.md',
      'foundation/02-product-definition.md',
      'foundation/03-audience-and-users.md',
      'foundation/04-goals-and-success-metrics.md',
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'README.md',
      'MANIFEST.json',
      'CONTEXT-STANDARDS.md',
      'components/**',
      'capabilities/**',
      'delivery/**',
      'code/**',
      'source-code/**'
    ],
    foundationFiles: foundation.includedFiles,
    returnInstructions: {
      zipMustContain: ['foundation/<updated-foundation-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnKnownFoundationFiles: true
    }
  };

  const standardsMarkdown = await readStandardsReviewMarkdown(root);
  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildFoundationReviewPackageReadme({ projectName, foundationFileCount: foundation.includedFiles.length }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildFoundationReviewTemplate({ projectName }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    { name: 'CONTEXT-STANDARDS.md', data: Buffer.from(`# Project Standards Context\n\n${standardsMarkdown.trim()}\n`, 'utf8') },
    ...foundation.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    foundationFileCount: foundation.includedFiles.length,
    entryCount: zipEntries.length
  };
}

function isSafeFoundationReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('foundation/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  return FOUNDATION_REVIEW_FILES.has(normalised);
}

async function importFoundationReviewPackage(input: ImportFoundationReviewPackageInput): Promise<FoundationReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasFoundationDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'foundation/' || name.startsWith('foundation/');
  });
  if (!hasFoundationDirectory) {
    throw new Error('Review response rejected: the zip must contain a foundation/ directory.');
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
    if (!isSafeFoundationReviewReturnPath(relativePath)) {
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

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

async function importFoundationDocumentUpdate(input: ImportFoundationDocumentUpdateInput): Promise<ProjectSetupState> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Foundation file name is required.');
  if (!input.updateFilePath) throw new Error('Dropped Markdown update path is required.');
  if (path.basename(input.fileName) !== input.fileName || path.extname(input.fileName).toLowerCase() !== '.md') {
    throw new Error(`Invalid Foundation file name: ${input.fileName}`);
  }

  const updateFilePath = path.resolve(input.updateFilePath);
  if (!(await exists(updateFilePath))) throw new Error(`Dropped Markdown file does not exist: ${input.updateFilePath}`);
  if (path.extname(updateFilePath).toLowerCase() !== '.md') throw new Error('Foundation updates must be Markdown .md files.');

  const docs = await readFoundationDocuments(input.projectPath);
  const existing = docs.find((doc) => doc.fileName === input.fileName);
  if (!existing) throw new Error(`Unknown foundation document: ${input.fileName}`);

  const raw = await fsp.readFile(updateFilePath, 'utf8');
  const parsed = matter(raw);
  const incomingStatus = normalizeSetupStatus(parsed.data?.aidd?.status || parsed.data?.status || existing.status);
  const body = parsed.content ?? raw;

  await fsp.mkdir(path.dirname(existing.filePath), { recursive: true });
  await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
    id: existing.id,
    title: existing.title,
    status: incomingStatus,
    required: existing.required,
    body,
  }), 'utf8');

  return readProjectSetup(input.projectPath);
}


const STANDARDS_REVIEW_FILES = new Set(
  STANDARD_SECTION_DEFINITIONS.map((section) => `foundation/standards/${section.fileName}`)
);

function buildStandardsReviewPackageReadme(input: { projectName: string; standardsFileCount: number }) {
  return `# AIDD Standards Review Package

This zip was generated by AIDD for Standards review.

## Review scope

You are reviewing **only the Standards files included in this package**.

Do not review or modify Foundation, components, capabilities, delivery packages, source code, generated files, or project structure.

Focus your review on:

- clarity of coding style expectations
- security expectations and review checks
- testing and evidence requirements
- architectural principles and decision rules
- hosting/platform constraints
- usefulness for future components, capabilities, delivery packages, and AI agents

## Your task

Review the Markdown files under \`foundation/standards/\` and improve them so they are clearer, more complete, and easier for humans and AI agents to follow.

## Allowed changes

You may update only known Standards Markdown files under:

- \`foundation/standards/\`

You must return a zip containing only:

- updated Markdown files under \`foundation/standards/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated Standards files.

## Do not return

Do not return:

- \`README.md\`
- \`MANIFEST.json\`
- source code
- foundation files outside \`foundation/standards/\`
- components
- capabilities
- delivery packages
- files outside \`foundation/standards/\`
- any unknown Standards files

## Required return shape

\`\`\`txt
foundation/
  standards/
    index.md
    01-coding-style.md
    02-security.md
    03-testing.md
    04-architecture.md
    05-hosting-platform.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`foundation/standards/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review packages

To exclude a Markdown file from future review packages, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Standards files included: ${input.standardsFileCount}
`;
}

function buildStandardsReviewTemplate(input: { projectName: string }) {
  return `# Standards Review

Project: ${input.projectName}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

async function collectStandardsReviewEntries(projectPath: string) {
  const sections = await readStandardSections(projectPath);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];

  for (const section of sections) {
    const relativePath = `foundation/standards/${section.fileName}`;
    if (!STANDARDS_REVIEW_FILES.has(relativePath)) continue;
    if (!(await exists(section.filePath))) continue;
    const raw = await fsp.readFile(section.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    entries.push({ name: relativePath, data: Buffer.from(raw, 'utf8') });
    includedFiles.push(relativePath);
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)) };
}

async function createStandardsReviewPackage(projectPath: string): Promise<StandardsReviewPackageResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-standards-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-packages', slugify(projectName), 'standards');
  const filePath = path.join(outputDir, fileName);

  const standards = await collectStandardsReviewEntries(root);
  if (!standards.includedFiles.length) {
    throw new Error('No Standards files were available to package for review.');
  }

  const manifest = {
    bundleType: 'standards-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      ...Array.from(STANDARDS_REVIEW_FILES),
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'README.md',
      'MANIFEST.json',
      'foundation/*.md',
      'components/**',
      'capabilities/**',
      'delivery/**',
      'code/**',
      'source-code/**'
    ],
    standardsFiles: standards.includedFiles,
    returnInstructions: {
      zipMustContain: ['foundation/standards/<updated-standards-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnKnownStandardsFiles: true
    }
  };

  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildStandardsReviewPackageReadme({ projectName, standardsFileCount: standards.includedFiles.length }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildStandardsReviewTemplate({ projectName }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...standards.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    standardsFileCount: standards.includedFiles.length,
    entryCount: zipEntries.length
  };
}

function isSafeStandardsReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('foundation/standards/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  return STANDARDS_REVIEW_FILES.has(normalised);
}

async function importStandardsReviewPackage(input: ImportStandardsReviewPackageInput): Promise<StandardsReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasStandardsDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'foundation/standards/' || name.startsWith('foundation/standards/');
  });
  if (!hasStandardsDirectory) {
    throw new Error('Review response rejected: the zip must contain a foundation/standards/ directory.');
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
    if (!isSafeStandardsReviewReturnPath(relativePath)) {
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

  await writeStandardsManifest(root);

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

async function importStandardSectionUpdate(input: ImportStandardSectionUpdateInput): Promise<ProjectSetupState> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Standards file name is required.');
  if (!input.updateFilePath) throw new Error('Dropped Markdown update path is required.');
  if (path.basename(input.fileName) !== input.fileName || path.extname(input.fileName).toLowerCase() !== '.md') {
    throw new Error(`Invalid Standards file name: ${input.fileName}`);
  }

  const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
  if (!definition) throw new Error(`Unknown Standards section: ${input.fileName}`);

  const updateFilePath = path.resolve(input.updateFilePath);
  if (!(await exists(updateFilePath))) throw new Error(`Dropped Markdown file does not exist: ${input.updateFilePath}`);
  if (path.extname(updateFilePath).toLowerCase() !== '.md') throw new Error('Standards updates must be Markdown .md files.');

  const sections = await readStandardSections(input.projectPath);
  const existing = sections.find((section) => section.fileName === input.fileName);
  if (!existing) throw new Error(`Unknown Standards section: ${input.fileName}`);

  const raw = await fsp.readFile(updateFilePath, 'utf8');
  const parsed = matter(raw);
  const incomingStatus = normalizeSetupStatus(parsed.data?.aidd?.status || parsed.data?.status || existing.status);
  const body = parsed.content ?? raw;

  await fsp.mkdir(path.dirname(existing.filePath), { recursive: true });
  await fsp.writeFile(existing.filePath, buildStandardSectionMarkdown({
    id: existing.id || definition.id,
    title: existing.title || definition.title,
    status: incomingStatus,
    required: existing.required,
    body
  }), 'utf8');

  await writeStandardsManifest(input.projectPath);
  return readProjectSetup(input.projectPath);
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
      const normalised = normaliseRelativePath(relativeFile).toLowerCase();
      return base !== 'index.md' && base !== 'component.md' && !normalised.startsWith('technical-reviews/');
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

  const projectName = await readProjectName(root);
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

const DEFAULT_COMPONENT_TECHNICAL_REVIEW_TYPES: ComponentTechnicalReviewType[] = ['code', 'security', 'architecture', 'tests'];
const COMPONENT_TECHNICAL_REVIEW_TYPES = new Set<ComponentTechnicalReviewType>([
  'code',
  'security',
  'architecture',
  'tests',
  'performance',
  'accessibility',
  'dependencies'
]);

function normaliseComponentTechnicalReviewTypes(input?: ComponentTechnicalReviewType[]) {
  const selected = Array.isArray(input)
    ? input.filter((item): item is ComponentTechnicalReviewType => COMPONENT_TECHNICAL_REVIEW_TYPES.has(item))
    : [];
  return selected.length ? Array.from(new Set(selected)) : DEFAULT_COMPONENT_TECHNICAL_REVIEW_TYPES;
}

function normaliseComponentTechnicalReviewSourceScope(input?: ComponentTechnicalReviewSourceScope) {
  return input === 'changed-files' || input === 'full-source' ? input : 'component-source';
}

function buildComponentTechnicalReviewComponentMarkdown(input: {
  projectName: string;
  component: Awaited<ReturnType<typeof readComponent>>;
}) {
  const { component } = input;
  const lines = [
    generatedDocHeader(`AIDD component ${component.slug}`),
    `# AIDD Component: ${component.title}`,
    '',
    `Project: ${input.projectName}`,
    `Slug: \`${component.slug}\``,
    `Status: \`${setupStatusLabel(component.status)}\``,
    component.capabilities.length ? `Capabilities: ${component.capabilities.map((item) => `\`${item}\``).join(', ')}` : 'Capabilities: _none linked_',
    '',
    'This file is generated by AIDD as read-only context for a component technical review.',
    '',
    '## Source mapping',
    '',
    ...componentSourceReferenceLines({
      ...component,
      supportsCapabilities: component.capabilities,
      capabilitiesSupported: component.capabilities
    }),
    ''
  ];

  for (const section of component.sections || []) {
    lines.push(
      '---',
      '',
      `## ${section.title}`,
      '',
      `Source: \`components/${component.slug}/${section.fileName}\``,
      `Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.status === 'skipped'
        ? `_This section was skipped in AIDD.${section.skipReason ? ` Reason: ${section.skipReason}` : ''}_`
        : section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

async function readComponentContractMarkdownForReview(projectPath: string, component: Awaited<ReturnType<typeof readComponent>>) {
  const contractPath = path.join(projectPath, 'components', component.slug, 'component.md');
  if (await exists(contractPath)) return fsp.readFile(contractPath, 'utf8');
  return [
    `# Component Contract: ${component.title}`,
    '',
    `Component: \`${component.slug}\``,
    '',
    'AIDD did not have a generated component contract file when this technical review package was created.',
    'Use `context/component.md` and the source snapshot as review context.',
    ''
  ].join('\n');
}

function buildComponentTechnicalReviewReadme(input: {
  projectName: string;
  component: Awaited<ReturnType<typeof readComponent>>;
  reviewTypes: ComponentTechnicalReviewType[];
  sourceRootCount: number;
  sourceFileCount: number;
  warnings: string[];
}) {
  const lines = [
    '# AIDD Component Technical Review',
    '',
    'This zip was generated by AIDD for a component technical review.',
    '',
    '## Review scope',
    '',
    `Project: ${input.projectName}`,
    `Component: ${input.component.title} (\`${input.component.slug}\`)`,
    `Review types: ${input.reviewTypes.map((item) => `\`${item}\``).join(', ')}`,
    '',
    'Use the component context, contract, foundation, standards, and source snapshot to identify technical findings and proposed changes.',
    '',
    '## Bundle layout',
    '',
    '- `instructions/technical-review.md` - review task and constraints',
    '- `instructions/return-format.md` - required return zip shape',
    '- `context/foundation.md` - project foundation context',
    '- `context/standards.md` - project standards context',
    '- `context/component.md` - generated component documentation snapshot',
    '- `context/component-contract.md` - generated component contract when available',
    '- `src/` - read-only source-code snapshot',
    '- `_return-template/` - example returned artefacts',
    '',
    '## Source-code snapshot rules',
    '',
    'Source code is included for review context only. Do not return edited source files.',
    'All proposed implementation changes must be represented as patches under `changes/<change-id>/patches/` in the returned zip.',
    '',
    '## Return package rule',
    '',
    'Return a zip containing only `SUMMARY.md`, optional `REVIEW.md`, optional `MANIFEST.json`, `findings/`, `changes/`, and `patches/index.md`.',
    'Do not include `src/`, `context/`, `instructions/`, component folders, capabilities, delivery packages, executables, environment files, or private keys.',
    '',
    '## Package summary',
    '',
    `- Source roots: ${input.sourceRootCount}`,
    `- Source files: ${input.sourceFileCount}`,
    ''
  ];

  if (input.warnings.length) {
    lines.push('## Warnings', '', ...input.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildComponentTechnicalReviewInstructions(input: {
  component: Awaited<ReturnType<typeof readComponent>>;
  reviewTypes: ComponentTechnicalReviewType[];
}) {
  return [
    '# Technical Review Instructions',
    '',
    `Review component: ${input.component.title} (\`${input.component.slug}\`)`,
    '',
    '## Goals',
    '',
    '- Identify concrete technical findings in the component source and AIDD context.',
    '- Propose focused technical changes that can be reviewed by a human before application.',
    '- Provide patches only as proposed artefacts; do not return edited source files.',
    '- Link each proposed change to findings where possible.',
    '',
    '## Review types',
    '',
    ...input.reviewTypes.map((item) => `- ${item}`),
    '',
    '## Constraints',
    '',
    '- Treat all files under `src/` as read-only source context.',
    '- Treat all files under `context/` as read-only AIDD context.',
    '- Do not invent source paths outside the bundled source snapshot unless the finding explicitly explains why.',
    '- Keep patch files reviewable and narrowly scoped.',
    '- If a patch is unsafe or speculative, put the reasoning in `changes/<change-id>/rationale.md` instead of forcing a diff.',
    ''
  ].join('\n');
}

function buildComponentTechnicalReviewReturnFormat() {
  return [
    '# Return Format',
    '',
    'Returned zips must not contain edited source files.',
    'All source-code changes must be proposed as patches inside `changes/<change-id>/patches/`.',
    '',
    '## Accepted files',
    '',
    '```text',
    'SUMMARY.md',
    'REVIEW.md',
    'MANIFEST.json',
    'findings/<finding-id>.md',
    'findings/<finding-id>.json',
    'changes/<change-id>/overview.md',
    'changes/<change-id>/affected-files.md',
    'changes/<change-id>/rationale.md',
    'changes/<change-id>/verification.md',
    'changes/<change-id>/linked-findings.json',
    'changes/<change-id>/patches/<patch-name>.patch',
    'changes/<change-id>/patches/<patch-name>.diff',
    'changes/<change-id>/patches/notes.md',
    'patches/index.md',
    '```',
    '',
    '## Rejected content',
    '',
    '- `src/**`',
    '- `source/**`',
    '- `components/**`',
    '- `capabilities/**`',
    '- `delivery/**`',
    '- `foundation/**`',
    '- source files such as `.ts`, `.tsx`, `.js`, `.cs`, `.py` outside patch artefacts',
    '- executables, libraries, environment files, private keys, or paths containing `../`',
    ''
  ].join('\n');
}

function buildComponentTechnicalReviewSummaryTemplate(input: Awaited<ReturnType<typeof readComponent>>) {
  return [
    '# Component Technical Review Summary',
    '',
    `Component: ${input.title} (${input.slug})`,
    '',
    '## Executive summary',
    '',
    '- TODO',
    '',
    '## Findings',
    '',
    '- TODO',
    '',
    '## Proposed changes',
    '',
    '- TODO',
    '',
    '## Verification',
    '',
    '- TODO',
    '',
    '## Residual risk',
    '',
    '- TODO',
    ''
  ].join('\n');
}

function componentTechnicalReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised) return null;
  const stripped = normalised.startsWith('component-technical-review-return/')
    ? normalised.slice('component-technical-review-return/'.length)
    : normalised;
  const clean = stripped.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return clean;
}

function isSafeComponentTechnicalReviewSegment(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

function isSafeComponentTechnicalReviewFileName(fileName: string, allowedExtensions: string[]) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) return false;
  if (fileName === '.' || fileName === '..') return false;
  return allowedExtensions.includes(path.extname(fileName).toLowerCase());
}

function isSafeComponentTechnicalReviewReturnPath(relativePath: string) {
  const normalised = componentTechnicalReviewReturnPath(relativePath);
  if (!normalised) return false;
  const lower = normalised.toLowerCase();
  if (lower === 'summary.md' || lower === 'review.md' || lower === 'manifest.json') return true;

  const parts = normalised.split('/');
  if (parts[0] === 'findings' && parts.length === 2) {
    return isSafeComponentTechnicalReviewFileName(parts[1], ['.md', '.json']);
  }

  if (parts[0] === 'patches' && parts.length === 2) {
    return parts[1].toLowerCase() === 'index.md';
  }

  if (parts[0] !== 'changes' || parts.length < 3) return false;
  const changeId = parts[1];
  if (!isSafeComponentTechnicalReviewSegment(changeId)) return false;
  const fileName = parts[2].toLowerCase();

  if (parts.length === 3) {
    return [
      'overview.md',
      'affected-files.md',
      'rationale.md',
      'verification.md',
      'linked-findings.json'
    ].includes(fileName);
  }

  if (parts.length === 4 && parts[2] === 'patches') {
    if (parts[3].toLowerCase() === 'notes.md') return true;
    return isSafeComponentTechnicalReviewFileName(parts[3], ['.patch', '.diff']);
  }

  return false;
}

function summarizeComponentTechnicalReviewImport(input: {
  componentSlug: string;
  importedAt: string;
  reviewDirectory: string;
  importedFiles: string[];
  skippedFiles: string[];
}) {
  const findingFiles = input.importedFiles.filter((file) => file.startsWith('findings/') && (file.endsWith('.md') || file.endsWith('.json')));
  const changes = new Map<string, ComponentTechnicalReviewChangeSummary & { patchSet: Set<string> }>();

  for (const file of input.importedFiles) {
    const parts = file.split('/');
    if (parts[0] !== 'changes' || parts.length < 3) continue;
    const changeId = parts[1];
    const current = changes.get(changeId) || { id: changeId, status: 'proposed', patches: [], patchSet: new Set<string>() };
    if (parts.length === 3 && parts[2] === 'overview.md') current.overviewPath = file;
    if (parts.length === 4 && parts[2] === 'patches' && (file.endsWith('.patch') || file.endsWith('.diff'))) {
      current.patchSet.add(file);
    }
    changes.set(changeId, current);
  }

  const changeSummaries = Array.from(changes.values())
    .map((change) => ({
      id: change.id,
      ...(change.overviewPath ? { overviewPath: change.overviewPath } : {}),
      status: change.status,
      patches: Array.from(change.patchSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const patchCount = changeSummaries.reduce((sum, change) => sum + change.patches.length, 0);

  return {
    type: 'component-technical-review-import' as const,
    schemaVersion: 1 as const,
    componentSlug: input.componentSlug,
    importedAt: input.importedAt,
    status: 'pending-review',
    reviewDirectory: input.reviewDirectory,
    ...(input.importedFiles.includes('SUMMARY.md') ? { summaryPath: 'SUMMARY.md' } : {}),
    importedFiles: input.importedFiles,
    skippedFiles: input.skippedFiles,
    findingCount: findingFiles.length,
    changeCount: changeSummaries.length,
    patchCount,
    changes: changeSummaries
  };
}

async function importComponentTechnicalReviewPackage(input: ImportComponentTechnicalReviewPackageInput): Promise<ComponentTechnicalReviewImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.zipPath) throw new Error('Technical review response zip path is required.');

  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Technical review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Technical review response must be a .zip file.');

  const component = await readComponent({ projectPath: root, slug: input.slug });
  const entries = await readZipFile(zipPath);
  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const importedFileSet = new Set<string>();
  const importedAt = new Date().toISOString();
  const stamp = importedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const reviewRelativeDirectory = `components/${component.slug}/technical-reviews/${stamp}`;
  const reviewDirectory = path.join(root, 'components', component.slug, 'technical-reviews', stamp);

  for (const entry of entries) {
    if (entry.directory) continue;
    const relativePath = componentTechnicalReviewReturnPath(entry.name);
    if (!relativePath) {
      skippedFiles.push(normaliseRelativePath(entry.name));
      continue;
    }
    if (!isSafeComponentTechnicalReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }
    if (importedFileSet.has(relativePath)) {
      skippedFiles.push(`${relativePath} was skipped because it appeared more than once.`);
      continue;
    }

    const target = path.resolve(reviewDirectory, relativePath);
    if (!isSameOrInsideDiskPath(target, reviewDirectory)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data);
    importedFiles.push(relativePath);
    importedFileSet.add(relativePath);
  }

  if (!importedFiles.length) {
    throw new Error('Technical review response did not contain any importable review artefacts. Expected SUMMARY.md, findings/, changes/, or patches/index.md. Source files were not imported.');
  }

  const sortedImportedFiles = importedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sortedSkippedFiles = skippedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const record = summarizeComponentTechnicalReviewImport({
    componentSlug: component.slug,
    importedAt,
    reviewDirectory: reviewRelativeDirectory,
    importedFiles: sortedImportedFiles,
    skippedFiles: sortedSkippedFiles
  });

  await writeJson(path.join(reviewDirectory, 'technical-review.json'), {
    ...record,
    sourceZipPath: zipPath
  });

  const technicalChanges: ComponentTechnicalChangeRecord[] = [];
  for (const change of record.changes) {
    const technicalChange = await createTechnicalChangeFromImportedReview({
      projectPath: root,
      componentSlug: component.slug,
      reviewRelativeDirectory,
      reviewDirectory,
      changeId: change.id,
      importedAt
    });
    if (technicalChange) technicalChanges.push(technicalChange);
  }

  return {
    accepted: true,
    zipPath,
    componentSlug: component.slug,
    reviewDirectory,
    importedFiles: sortedImportedFiles,
    skippedFiles: sortedSkippedFiles,
    findingCount: record.findingCount,
    changeCount: record.changeCount,
    patchCount: record.patchCount,
    technicalChangeCount: technicalChanges.length
  };
}

async function createComponentTechnicalReviewBundle(input: ComponentTechnicalReviewPackageInput): Promise<ComponentTechnicalReviewPackageResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  const root = path.resolve(input.projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);

  const projectName = await readProjectName(root);
  const component = await readComponent({ projectPath: root, slug: input.slug });
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-${component.slug}-component-technical-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'components', component.slug, 'technical');
  const filePath = path.join(outputDir, fileName);
  const reviewTypes = normaliseComponentTechnicalReviewTypes(input.reviewTypes);
  const sourceScope = normaliseComponentTechnicalReviewSourceScope(input.sourceScope);
  const warnings: string[] = [];

  if (sourceScope !== 'component-source') {
    warnings.push(`Source scope "${sourceScope}" is not implemented yet; packaged the configured component source directory instead.`);
  }

  const source = await collectDeliveryReviewSourceEntries(root, [component]);
  warnings.push(...source.warnings);
  if (!source.includedFiles.length) {
    warnings.push('No source files were included. Configure the component source directory before requesting a technical source review.');
  }

  const foundation = await readFoundationDocuments(root);
  const standards = await readStandardSections(root);
  const componentContextMarkdown = buildComponentTechnicalReviewComponentMarkdown({ projectName, component });
  const componentContractMarkdown = await readComponentContractMarkdownForReview(root, component);
  const contextEntries: ZipEntryInput[] = [
    { name: 'context/foundation.md', data: Buffer.from(buildPublishedFoundationMarkdown(projectName, foundation), 'utf8') },
    { name: 'context/standards.md', data: Buffer.from(buildPublishedStandardsMarkdown(projectName, standards), 'utf8') },
    { name: 'context/component.md', data: Buffer.from(componentContextMarkdown, 'utf8') },
    { name: 'context/component-contract.md', data: Buffer.from(componentContractMarkdown, 'utf8') }
  ];
  const templateEntries: ZipEntryInput[] = [
    { name: '_return-template/SUMMARY.md', data: Buffer.from(buildComponentTechnicalReviewSummaryTemplate(component), 'utf8') },
    { name: '_return-template/findings/FINDING-001.md', data: Buffer.from('# FINDING-001\n\n## Summary\n\nTODO\n\n## Evidence\n\nTODO\n\n## Impact\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/overview.md', data: Buffer.from('# TC-001 Short Name\n\n## Proposed change\n\nTODO\n\n## Linked findings\n\n- FINDING-001\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/affected-files.md', data: Buffer.from('# Affected Files\n\n- `src/...`\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/rationale.md', data: Buffer.from('# Rationale\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/verification.md', data: Buffer.from('# Verification\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/linked-findings.json', data: Buffer.from('{\n  "findings": ["FINDING-001"]\n}\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/patches/proposed.patch', data: Buffer.from('# Add a unified diff here.\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/patches/notes.md', data: Buffer.from('# Patch Notes\n\nTODO\n', 'utf8') },
    { name: '_return-template/patches/index.md', data: Buffer.from('# Patch Index\n\n- TC-001-short-name: `changes/TC-001-short-name/patches/proposed.patch`\n', 'utf8') }
  ];
  const contextFiles = contextEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const templateFiles = templateEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const instructionEntries: ZipEntryInput[] = [
    { name: 'instructions/technical-review.md', data: Buffer.from(buildComponentTechnicalReviewInstructions({ component, reviewTypes }), 'utf8') },
    { name: 'instructions/return-format.md', data: Buffer.from(buildComponentTechnicalReviewReturnFormat(), 'utf8') }
  ];

  const allEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildComponentTechnicalReviewReadme({
      projectName,
      component,
      reviewTypes,
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length,
      warnings
    }), 'utf8') },
    ...instructionEntries,
    ...contextEntries,
    ...source.entries,
    ...templateEntries
  ];

  const manifest = {
    bundleType: 'component-technical-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    snapshotIsSelfContained: true,
    componentSlug: component.slug,
    componentTitle: component.title,
    reviewTypes,
    sourceScope: 'component-source',
    sourceCodeIsContextOnly: true,
    patchesMustBeProposedOnly: true,
    returnShape: {
      required: [
        'SUMMARY.md',
        'changes/<change-id>/overview.md'
      ],
      allowed: [
        'findings/**/*.md',
        'findings/**/*.json',
        'changes/**/overview.md',
        'changes/**/affected-files.md',
        'changes/**/rationale.md',
        'changes/**/verification.md',
        'changes/**/linked-findings.json',
        'changes/**/patches/*.patch',
        'changes/**/patches/*.diff',
        'changes/**/patches/notes.md',
        'patches/index.md'
      ]
    },
    includedFiles: {
      instructions: instructionEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b)),
      context: contextFiles,
      source: source.includedFiles,
      templates: templateFiles
    },
    sourceSnapshot: {
      directory: 'src',
      allowedExtensions: Array.from(DELIVERY_REVIEW_SOURCE_EXTENSIONS).sort((a, b) => a.localeCompare(b)),
      excludedDirectories: Array.from(DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES).sort((a, b) => a.localeCompare(b)),
      roots: source.roots.map((sourceRoot) => ({
        configuredDirectory: sourceRoot.configuredDirectory,
        absolutePath: sourceRoot.absolutePath,
        packagePrefix: sourceRoot.packagePrefix ? `src/${sourceRoot.packagePrefix}` : 'src',
        isInsideWorkspace: sourceRoot.isInsideWorkspace,
        componentSlugs: sourceRoot.componentSlugs,
        componentTitles: sourceRoot.componentTitles
      })),
      skippedNestedRoots: source.skippedNestedRoots
    },
    warnings,
    returnInstructions: {
      returnedZipShouldContainOnly: ['SUMMARY.md', 'REVIEW.md', 'MANIFEST.json', 'findings/', 'changes/', 'patches/index.md'],
      doNotReturnSourceFiles: true,
      patchesAreProposalsOnly: true,
      importedReviewsAreStoredUnder: `components/${component.slug}/technical-reviews/<timestamp>/`
    }
  };

  allEntries.push({ name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });

  const uniqueEntries = new Map<string, ZipEntryInput>();
  for (const entry of allEntries) {
    const name = safeZipEntryName(entry.name);
    if (!uniqueEntries.has(name)) uniqueEntries.set(name, { ...entry, name });
  }

  await writeZipFile(filePath, Array.from(uniqueEntries.values()));
  return {
    filePath,
    fileName,
    componentSlug: component.slug,
    componentTitle: component.title,
    componentFileCount: contextEntries.length,
    sourceRootCount: source.roots.length,
    sourceFileCount: source.includedFiles.length,
    entryCount: uniqueEntries.size,
    warnings
  };
}


function isSafeCapabilityReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('capabilities/')) return false;
  const parts = normalised.split('/');
  if (parts.length < 3) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  const base = path.basename(normalised).toLowerCase();
  if (base === 'index.md') return false;
  return true;
}

async function collectCapabilityReviewEntries(projectPath: string, capabilitySlug?: string) {
  const capabilitiesRoot = path.join(projectPath, 'capabilities');
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const requestedSlug = capabilitySlug ? slugify(capabilitySlug) : null;
  let capabilityCount = 0;

  if (!(await exists(capabilitiesRoot))) {
    return { entries, includedFiles, capabilityCount };
  }

  for (const capabilityDirEntry of await fsp.readdir(capabilitiesRoot, { withFileTypes: true })) {
    if (!capabilityDirEntry.isDirectory() || capabilityDirEntry.name.startsWith('_')) continue;

    const slug = capabilityDirEntry.name;
    if (requestedSlug && slug !== requestedSlug) continue;
    const capabilityDir = path.join(capabilitiesRoot, slug);
    const manifestPath = path.join(capabilityDir, 'capability.json');
    if (!(await exists(manifestPath))) continue;
    capabilityCount += 1;

    let sectionFiles = CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName);
    try {
      const manifest = await readJson<any>(manifestPath);
      const manifestSectionFiles = Array.isArray(manifest?.template?.sectionFiles)
        ? manifest.template.sectionFiles.map(String)
        : Array.isArray(manifest?.sections)
          ? manifest.sections.map((section: any) => String(section.fileName || '')).filter(Boolean)
          : [];
      if (manifestSectionFiles.length) sectionFiles = manifestSectionFiles;
    } catch {}

    const existingMarkdown = (await collectMarkdownFiles(capabilityDir)).filter((relativeFile) => {
      const base = path.basename(relativeFile).toLowerCase();
      return base !== 'index.md';
    });

    const candidateFiles = Array.from(new Set([...sectionFiles, ...existingMarkdown])).filter((fileName) => {
      const normalised = normaliseRelativePath(fileName);
      const base = path.basename(normalised).toLowerCase();
      const unsafe = path.isAbsolute(fileName) || normalised.split('/').some((part) => part === '..' || part === '.');
      return !unsafe && normalised.toLowerCase().endsWith('.md') && base !== 'index.md';
    });

    for (const relativeFile of candidateFiles) {
      const full = path.join(capabilityDir, relativeFile);
      if (!(await exists(full))) continue;
      const raw = await fsp.readFile(full, 'utf8');
      if (!shouldIncludeInReviewBundle(raw)) continue;
      const zipPath = `capabilities/${slug}/${normaliseRelativePath(relativeFile)}`;
      entries.push({ name: zipPath, data: Buffer.from(raw, 'utf8') });
      includedFiles.push(zipPath);
    }
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)), capabilityCount };
}

function buildCapabilityReviewBundleReadme(input: { projectName: string; capabilityCount: number; capabilityFileCount: number; foundationFileCount: number; targetCapability?: string | null }) {
  const targetCapability = input.targetCapability || '<included-capability-id>';
  return `# AIDD Capability Review Package

This zip was generated by AIDD for capability review.

## Review scope

You are reviewing **only the capability included in this package**.

Target capability: \`${targetCapability}\`

Do not review or modify components, delivery packages, source code, or project structure unless explicitly required to understand this capability.

\`PROJECT.md\` is **context only**.

Focus your review on:

- clarity of outcomes
- scope boundaries
- user journeys
- functional and quality requirements
- UX expectations
- risks and edge cases
- validation and acceptance checks
- suitability for implementation planning

## Your task

Review the included capability section files under \`capabilities/${targetCapability}/\` and improve them so they are clearer, more complete, and more useful for delivery planning.

Use \`PROJECT.md\` only as background context.

## Allowed changes

You may update files only under:

- \`capabilities/${targetCapability}/\`

You must return a zip containing only:

- updated Markdown files under \`capabilities/${targetCapability}/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated capability files.

## Do not return

Do not return:

- \`PROJECT.md\`
- \`README.md\`
- \`MANIFEST.json\`
- capability \`index.md\` files
- source code
- components
- files outside \`capabilities/${targetCapability}/\`
- unrelated capabilities

## Required return shape

\`\`\`txt
capabilities/
  ${targetCapability}/
    <updated-section-files>.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`capabilities/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Capabilities reviewed
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
- Target capability: ${targetCapability}
- Foundation files included: ${input.foundationFileCount}
- Capabilities found: ${input.capabilityCount}
- Capability files included: ${input.capabilityFileCount}
`;
}

function buildCapabilityReviewTemplate(input: { projectName: string; targetCapability?: string | null }) {
  return `# Capability Review

Project: ${input.projectName}
Target capability: ${input.targetCapability || '<included-capability-id>'}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Capabilities reviewed

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

async function readCapabilityReviewSectionMetadata(projectPath: string, slug: string) {
  const dir = path.join(projectPath, 'capabilities', slug);
  const titleCandidates: string[] = [];
  const components = new Set<string>();
  const sections: CapabilitySectionInput[] = [];

  for (const template of CAPABILITY_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    if (!(await exists(filePath))) continue;

    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    const aidd = parsed.ok ? ((parsed.parsed.data as any)?.aidd || {}) : {};
    const body = sectionBodyFromMarkdown(raw);
    const heading = firstMarkdownHeading(raw);
    const aiddTitle = String(aidd.title || '').trim();

    if (aiddTitle) titleCandidates.push(aiddTitle.replace(new RegExp(`${escapeRegExp(template.title)}$`, 'i'), '').trim());
    if (heading) titleCandidates.push(heading.replace(new RegExp(`${escapeRegExp(template.title)}$`, 'i'), '').trim());

    if (Array.isArray(aidd.components)) {
      for (const item of aidd.components) {
        const value = String(item || '').trim();
        if (value) components.add(value);
      }
    }

    const status = String(aidd.status || (contentLooksComplete(raw) ? 'complete' : 'draft')) as SetupStepStatus;
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status
    });
  }

  const title = titleCandidates.find((candidate) => candidate.trim()) || titleFromSlug(slug);
  const status = sections.length && sections.every((section) => section.status === 'complete' || section.status === 'skipped')
    ? 'complete'
    : 'draft';

  return {
    title,
    status: status as SetupStepStatus,
    components: Array.from(components),
    sections: normaliseCapabilitySections(sections, {})
  };
}

async function reconcileCapabilityAfterReviewImport(projectPath: string, slug: string) {
  const canonicalSlug = slugify(slug);
  const dir = path.join(projectPath, 'capabilities', canonicalSlug);
  const manifestPath = path.join(dir, 'capability.json');
  const metadata = await readCapabilityReviewSectionMetadata(projectPath, canonicalSlug);
  const createdManifest = !(await exists(manifestPath));

  await fsp.mkdir(dir, { recursive: true });

  if (createdManifest) {
    await writeJson(manifestPath, {
      slug: canonicalSlug,
      title: metadata.title,
      status: metadata.status,
      components: metadata.components,
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      template: {
        id: TEMPLATE_ID,
        version: TEMPLATE_VERSION,
        sectionFiles: CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName)
      }
    });
  }

  const capability = await readCapability({ projectPath, slug: canonicalSlug }).catch(async () => ({
    slug: canonicalSlug,
    title: metadata.title,
    status: metadata.status,
    components: metadata.components,
    sections: metadata.sections
  }));

  await updateCapability({
    projectPath,
    slug: canonicalSlug,
    title: capability.title || metadata.title,
    status: (capability.status || metadata.status) as SetupStepStatus,
    componentSlugs: Array.isArray((capability as any).components) ? (capability as any).components : metadata.components,
    sections: metadata.sections
  });

  return { slug: canonicalSlug, createdManifest };
}

async function importCapabilityReviewPackage(input: ImportCapabilityReviewPackageInput): Promise<CapabilityReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasCapabilitiesDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'capabilities/' || name.startsWith('capabilities/');
  });
  if (!hasCapabilitiesDirectory) {
    throw new Error('Review response rejected: the zip must contain a capabilities/ directory.');
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
    if (!isSafeCapabilityReviewReturnPath(relativePath)) {
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

  const capabilitySlugs = Array.from(new Set(importedFiles.map((file) => file.split('/')[1]).filter(Boolean).map((slug) => slugify(slug)))).sort((a, b) => a.localeCompare(b));
  const importedCapabilities: string[] = [];

  for (const slug of capabilitySlugs) {
    const result = await reconcileCapabilityAfterReviewImport(root, slug);
    importedCapabilities.push(result.slug);
  }

  await refreshCapabilitiesIndex(root);
  await refreshComponentsIndex(root);

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    capabilityCount: capabilitySlugs.length,
    importedCapabilities: Array.from(new Set(importedCapabilities)).sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

async function createCapabilityReviewBundle(projectPath: string, capabilitySlug?: string): Promise<CapabilityReviewPackageResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const requestedSlug = capabilitySlug ? slugify(capabilitySlug) : null;
  const fileName = requestedSlug
    ? `${slugify(projectName)}-${requestedSlug}-capability-review-${stamp}.zip`
    : `${slugify(projectName)}-capability-review-${stamp}.zip`;
  const outputDir = requestedSlug
    ? path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'capabilities', requestedSlug)
    : path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'capabilities');
  const filePath = path.join(outputDir, fileName);

  const foundation = await buildProjectFoundationReviewMarkdown(root);
  const capabilities = await collectCapabilityReviewEntries(root, requestedSlug || undefined);
  if (requestedSlug && capabilities.capabilityCount === 0) {
    throw new Error(`Capability not found or has no reviewable files: ${requestedSlug}`);
  }

  const manifest = {
    bundleType: 'capability-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      'capabilities/**/*.md',
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'PROJECT.md',
      'README.md',
      'MANIFEST.json',
      'capabilities/**/index.md',
      '**/*.json',
      'code/**',
      'foundation/**',
      'components/**',
      'delivery/**'
    ],
    foundationSources: foundation.includedFiles,
    targetCapability: requestedSlug || null,
    capabilityFiles: capabilities.includedFiles,
    returnInstructions: {
      zipMustContain: ['capabilities/<capability-id>/<updated-section-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnChangedCapabilitySectionFiles: true
    }
  };

  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildCapabilityReviewBundleReadme({ projectName, capabilityCount: capabilities.capabilityCount, capabilityFileCount: capabilities.includedFiles.length, foundationFileCount: foundation.includedFiles.length, targetCapability: requestedSlug || null }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildCapabilityReviewTemplate({ projectName, targetCapability: requestedSlug || null }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    { name: 'PROJECT.md', data: Buffer.from(foundation.markdown, 'utf8') },
    ...capabilities.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    capabilityCount: capabilities.capabilityCount,
    capabilityFileCount: capabilities.includedFiles.length,
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
  const components: string[] = (Array.isArray(manifest.components) ? manifest.components : Array.isArray(manifest.modules) ? manifest.modules : (Array.isArray(aidd.components) ? aidd.components : []))
    .map((component: unknown) => String(component))
    .filter(Boolean);
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

async function deleteCapability(input: DeleteCapabilityInput) {
  const rawSlug = String(input.slug || '').trim();
  if (!input.projectPath || !rawSlug) throw new Error('Project path and capability slug are required.');

  const slug = slugify(rawSlug);
  if (!slug || slug !== rawSlug) throw new Error('Capability delete rejected: invalid capability slug.');

  const capabilitiesRoot = path.resolve(input.projectPath, 'capabilities');
  const capabilityDir = path.resolve(capabilitiesRoot, slug);

  if (capabilityDir === capabilitiesRoot || !capabilityDir.startsWith(`${capabilitiesRoot}${path.sep}`)) {
    throw new Error('Capability delete rejected: unsafe capability path.');
  }

  const manifestPath = path.join(capabilityDir, 'capability.json');
  if (!(await exists(manifestPath))) throw new Error(`Capability not found: ${slug}`);

  await fsp.rm(capabilityDir, { recursive: true, force: false });
  await refreshCapabilitiesIndex(input.projectPath);
  await refreshComponentsIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}



async function assertProjectFoundationReady(projectPath: string) {
  const foundation = await readFoundationDocuments(projectPath);
  const standardSections = await readStandardSections(projectPath);
  const incompleteFoundation = foundation.filter((doc) => doc.required !== false && doc.status !== 'complete');
  const incompleteStandards = standardSections.filter((section) => !standardSectionDone(section));
  const blockers: string[] = [];
  for (const doc of incompleteFoundation) blockers.push(`${doc.title} is ${doc.status.replace(/-/g, ' ')}`);
  for (const section of incompleteStandards) blockers.push(`${section.title} standard is ${section.status.replace(/-/g, ' ')}`);
  if (blockers.length) {
    throw new Error(`Project Context must be complete before creating a delivery package. Missing: ${blockers.join('; ')}`);
  }
  return { foundation, standardSections };
}

function buildProjectFoundationSnapshot(foundation: FoundationDocument[], standardSections: StandardSection[]) {
  const foundationSections = foundation.map((doc) => [
    `## ${doc.title}`,
    '',
    `- Status: ${doc.status}`,
    `- Source: foundation/${doc.fileName}`,
    '',
    doc.body.trim() || '_No content captured._'
  ].join('\n'));

  const standardsSections = standardSections.map((section) => [
    `## ${section.title}`,
    '',
    `- Status: ${section.status}`,
    `- Source: foundation/standards/${section.fileName}`,
    '',
    section.body.trim() || '_No content captured._'
  ].join('\n'));

  return [
    '## Project Context Snapshot',
    '',
    'This section is captured because every delivery package must inherit the approved project foundation and standards.',
    '',
    ...foundationSections,
    '',
    '## Project Standards Snapshot',
    '',
    ...standardsSections
  ].join('\n');
}

async function assertProjectTechnicalStandardsReady(projectPath: string) {
  const standardSections = await readStandardSections(projectPath);
  const incompleteStandards = standardSections.filter((section) => !standardSectionDone(section));
  if (incompleteStandards.length) {
    throw new Error(`Project Standards must be complete before creating a technical delivery package. Missing: ${incompleteStandards.map((section) => `${section.title} is ${section.status.replace(/-/g, ' ')}`).join('; ')}`);
  }
  return { standardSections };
}

function buildProjectTechnicalStandardsSnapshot(standardSections: StandardSection[]) {
  const standardsSections = standardSections.map((section) => [
    `## ${section.title}`,
    '',
    `- Status: ${section.status}`,
    `- Source: foundation/standards/${section.fileName}`,
    '',
    section.body.trim() || '_No content captured._'
  ].join('\n'));

  return [
    '## Technical Standards Snapshot',
    '',
    'This technical delivery package includes project standards and component constraints only. Product foundation narrative is intentionally omitted.',
    '',
    ...standardsSections
  ].join('\n');
}

function buildComponentTechnicalConstraintsSnapshot(component: Awaited<ReturnType<typeof readComponent>>, componentContract: string) {
  const lines = [
    `## Component Technical Constraints: ${component.title}`,
    '',
    `- Component: \`${component.slug}\``,
    `- Status: \`${setupStatusLabel(component.status)}\``,
    component.source?.directory ? `- Source: \`${component.source.directory}\`` : '- Source: _not configured_',
    component.capabilities.length ? `- Linked capabilities: ${component.capabilities.map((item) => `\`${item}\``).join(', ')}` : '- Linked capabilities: _none_',
    '',
    '### Component Contract',
    '',
    componentContract.trim() || '_No component contract has been generated._',
    '',
    '### Component Sections',
    ''
  ];

  for (const section of component.sections || []) {
    lines.push(
      `#### ${section.title}`,
      '',
      `- Source: components/${component.slug}/${section.fileName}`,
      `- Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildTechnicalChangeSnapshot(change: ComponentTechnicalChangeDetail) {
  const lines = [
    `## Technical Change: ${change.title}`,
    '',
    `- Id: \`${change.id}\``,
    `- Component: \`${change.componentSlug}\``,
    `- Status: \`${change.status}\``,
    `- Risk: \`${change.risk}\``,
    `- Patch files: \`${change.patchCount}\``,
    '',
  ];

  for (const section of change.sections.filter((item) => !item.fileName.startsWith('patches/'))) {
    lines.push(
      `### ${section.title}`,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}


async function requireDeliveryWorkspace(projectPath: string) {
  const trackedProject = await readTrackedProjectByPath(projectPath);
  const workspacePath = trackedProject?.workspacePath?.trim();
  if (!workspacePath) throw new Error('Choose the implementation/source-code workspace on Home before publishing delivery packages.');
  if (!(await exists(workspacePath))) throw new Error(`The configured source workspace does not exist: ${workspacePath}`);
  const stat = await fsp.stat(workspacePath);
  if (!stat.isDirectory()) throw new Error(`The configured source workspace is not a directory: ${workspacePath}`);
  if (sameDiskPath(workspacePath, projectPath)) throw new Error('The source workspace cannot be the active AIDD project.');
  return workspacePath;
}

function deliveryPackageSourceHash(detail: DeliveryPackageDetail) {
  return sha256Text(JSON.stringify({
    templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION,
    id: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: detail.status,
    sourceCapability: detail.sourceCapability,
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components,
    technicalChanges: detail.technicalChanges || [],
    strategyBody: detail.strategyBody,
    snapshotBody: detail.snapshotBody,
    phases: detail.phases.map((phase) => ({ id: phase.id, title: phase.title, status: phase.status, fileName: phase.fileName, body: phase.body }))
  }));
}


function isDeliveryPhaseFileName(fileName: string) {
  return /^(phase|stage)-[\w-]+\.md$/i.test(fileName);
}

function isWorkspaceDeliveryFileName(fileName: string) {
  return fileName === 'implementation-strategy.md' || isDeliveryPhaseFileName(fileName);
}

function buildPublishedDeliveryStrategyFileMarkdown(detail: DeliveryPackageDetail) {
  return matter.stringify((detail.strategyBody || '').trim() + '\n', {
    aidd: { type: 'workspace-delivery-strategy', templateVersion: TEMPLATE_VERSION },
    deliveryPackage: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: detail.status,
    sourceCapability: detail.sourceCapability || '',
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components || [],
    publishedBy: 'AIDD'
  });
}

function buildPublishedDeliveryPhaseFileMarkdown(detail: DeliveryPackageDetail, phase: DeliveryPackagePhaseDetail, index: number) {
  const title = phase.title?.trim() || `Phase ${index + 1}`;
  return matter.stringify((phase.body || '').trim() + '\n', {
    aidd: { type: 'workspace-delivery-phase', templateVersion: TEMPLATE_VERSION },
    id: phase.id || phaseIdFromFileName(phase.fileName),
    title,
    status: phase.status || detail.status || 'approved',
    deliveryPackage: detail.id,
    order: index + 1,
    publishedBy: 'AIDD'
  });
}

function extractWorkspacePhaseStatus(markdown: string) {
  try {
    const parsed = matter(markdown);
    const frontmatterStatus = String((parsed.data as any)?.status || '').trim();
    if (frontmatterStatus) return normaliseStatusForDelivery(frontmatterStatus);
    const inlineStatus = parsed.content.match(/^\s*Status\s*:\s*([^\n]+)/im)?.[1]?.trim();
    if (inlineStatus) return normaliseStatusForDelivery(inlineStatus);
  } catch {
    const inlineStatus = markdown.match(/^\s*Status\s*:\s*([^\n]+)/im)?.[1]?.trim();
    if (inlineStatus) return normaliseStatusForDelivery(inlineStatus);
  }
  return '';
}

function markdownHasCheckedTask(markdown: string) {
  return /-\s*\[[xX]\]/.test(markdown);
}

async function readWorkspaceDeliveryExecutionState(targetPath: string, publishedManifest?: any) {
  const files: string[] = [];
  const phaseStatuses: string[] = [];
  let hasCheckedTask = false;

  if (await exists(targetPath)) {
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (!entry.isFile() || !isWorkspaceDeliveryFileName(entry.name)) continue;
      files.push(entry.name);
      if (!isDeliveryPhaseFileName(entry.name)) continue;
      const content = await fsp.readFile(path.join(targetPath, entry.name), 'utf8');
      const phaseStatus = extractWorkspacePhaseStatus(content);
      if (phaseStatus) phaseStatuses.push(phaseStatus);
      if (markdownHasCheckedTask(content)) hasCheckedTask = true;
    }
  }

  const phaseCount = files.filter(isDeliveryPhaseFileName).length;
  const manifestStatusRaw = String(publishedManifest?.status || '').trim();
  const manifestStatus = manifestStatusRaw ? normaliseStatusForDelivery(manifestStatusRaw) : '';
  const completeStatuses = new Set(['done', 'accepted', 'complete']);
  const inProgressStatuses = new Set(['in-progress', 'active']);

  let workspaceStatus = manifestStatus && manifestStatus !== 'packaging' ? manifestStatus : 'approved';
  if (phaseCount > 0 && phaseStatuses.length === phaseCount && phaseStatuses.every((status) => completeStatuses.has(status))) {
    workspaceStatus = 'done';
  } else if (phaseStatuses.some((status) => inProgressStatuses.has(status) || completeStatuses.has(status)) || hasCheckedTask) {
    workspaceStatus = 'in-progress';
  }

  return { files, phaseCount, workspaceStatus };
}

function buildPublishedDeliveryBriefMarkdown(detail: DeliveryPackageDetail) {
  const phaseSections = detail.phases.length
    ? detail.phases.map((phase, index) => [
        `## Phase ${index + 1}: ${phase.title}`,
        '',
        `Status: ${phase.status}`,
        '',
        phase.body?.trim() || '_No phase content._'
      ].join('\n')).join('\n\n')
    : '_No implementation phases have been created._';

  return [
    `# ${detail.id} ${detail.title}`,
    '',
    '<!-- Generated by AIDD. Update the delivery package in AIDD and republish rather than editing this file directly. -->',
    '',
    `Status: ${detail.status}`,
    detail.sourceCapability ? `Source capability: ${detail.sourceCapability}` : '',
    detail.components.length ? `Components: ${detail.components.join(', ')}` : '',
    '',
    '## Operating context',
    '',
    'Read these generated workspace docs before implementing this delivery package:',
    '',
    '- `../../docs/foundation.md`',
    '- `../../docs/standards.md`',
    '- `../../docs/components.md`',
    '',
    'Update the writable files in this folder as work progresses. Do not edit generated workspace docs directly.',
    '',
    '## Implementation strategy',
    '',
    detail.strategyBody?.trim() || '_No implementation strategy has been captured._',
    '',
    '## Implementation phases',
    '',
    phaseSections,
    ''
  ].join('\n');
}

function buildPublishedDeliveryContextMarkdown(detail: DeliveryPackageDetail) {
  return [
    `# ${detail.id} Context`,
    '',
    '<!-- Generated by AIDD. Update the delivery package in AIDD and republish rather than editing this file directly. -->',
    '',
    'This file contains the delivery context snapshot captured in AIDD when the package was created or updated.',
    '',
    detail.snapshotBody?.trim() || '_No context snapshot has been captured._',
    ''
  ].join('\n');
}

function buildWorkspaceDeliveryWritableMarkdown(title: string, body: string) {
  return [
    `# ${title}`,
    '',
    '<!-- Writable by the implementation agent. AIDD will preserve this file when republishing the package. -->',
    '',
    body,
    ''
  ].join('\n');
}

async function writeDeliveryGeneratedFile(targetPath: string, content: string, writtenFiles: string[], skippedFiles: string[], relativePath: string) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  if (await exists(targetPath)) {
    const current = await fsp.readFile(targetPath, 'utf8');
    if (sha256Text(current) === sha256Text(content)) {
      skippedFiles.push(relativePath);
      return;
    }
  }
  await fsp.writeFile(targetPath, content, 'utf8');
  writtenFiles.push(relativePath);
}

async function writeDeliveryGeneratedTree(sourceRoot: string, targetRoot: string, relativeRoot: string, writtenFiles: string[], skippedFiles: string[]) {
  const generatedFiles: string[] = [];
  if (!(await exists(sourceRoot))) return generatedFiles;

  async function walk(currentDir: string) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const sourcePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(sourcePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normaliseRelativePath(path.join(relativeRoot, path.relative(sourceRoot, sourcePath)));
      const content = await fsp.readFile(sourcePath, 'utf8');
      await writeDeliveryGeneratedFile(path.join(targetRoot, relativePath), content, writtenFiles, skippedFiles, relativePath);
      generatedFiles.push(relativePath);
    }
  }

  await walk(sourceRoot);
  return generatedFiles;
}

async function readDeliveryWorkspacePublicationState(projectPath: string, packageId: string, manifest?: any): Promise<Partial<DeliveryPackageSummary>> {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  if (!workspacePath) return { workspacePublishStatus: 'not-configured', workspacePublished: false };
  const targetPath = workspaceDeliveryPackagePath(workspacePath, packageId);
  const manifestPath = path.join(targetPath, 'manifest.json');
  if (!(await exists(manifestPath))) {
    return { workspacePackagePath: targetPath, workspacePublishStatus: 'missing', workspacePublished: false };
  }

  let publishedAt = manifest?.workspaceDelivery?.publishedAt || '';
  let publishedManifest: any = {};
  try {
    publishedManifest = await readJson<any>(manifestPath);
    publishedAt = String(publishedManifest.publishedAt || publishedAt || '');
  } catch {
    // Keep the package visible; the Health Check can flag corrupt workspace files later.
  }

  const execution = await readWorkspaceDeliveryExecutionState(targetPath, publishedManifest);
  const sourceStatus = normaliseStatusForDelivery(manifest?.status || '');
  const effectiveWorkspaceStatus = sourceStatus === 'done' ? 'done' : execution.workspaceStatus;
  const updatedAt = manifest?.updatedAt || manifest?.createdAt || '';
  const manifestSourceHash = String(manifest?.workspaceDelivery?.sourceHash || '');
  const publishedSourceHash = String(publishedManifest?.sourceHash || '');
  const staleByHash = Boolean(manifestSourceHash && publishedSourceHash && manifestSourceHash !== publishedSourceHash);
  const staleByDate = Boolean(publishedAt && updatedAt && Date.parse(updatedAt) > Date.parse(publishedAt));
  const isStale = staleByHash || staleByDate;

  return {
    workspacePackagePath: targetPath,
    workspacePublished: true,
    workspacePublishedAt: publishedAt || undefined,
    workspacePublishStatus: isStale ? 'stale' : 'published',
    workspaceStatus: effectiveWorkspaceStatus,
    workspacePhaseCount: execution.phaseCount,
    workspaceDeliveryFiles: execution.files,
    status: effectiveWorkspaceStatus,
    ...(execution.phaseCount ? { phaseCount: execution.phaseCount } : {})
  };
}

async function createDeliveryPackageFromCapability(input: CreateDeliveryPackageFromCapabilityInput) {
  const { foundation, standardSections } = await assertProjectFoundationReady(input.projectPath);
  const foundationSnapshot = buildProjectFoundationSnapshot(foundation, standardSections);
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
  const technicalChangeCandidates = await collectComponentTechnicalChangesForDelivery(input.projectPath, capability.components || []);
  const technicalChangeDelivery = await copyApprovedTechnicalChangesIntoDeliveryPackage({
    projectPath: input.projectPath,
    packageDir: dir,
    packageId: id,
    approved: technicalChangeCandidates.approved,
    excluded: technicalChangeCandidates.excluded
  });

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
    '',
    buildDeliveryTechnicalChangesIndexMarkdown(technicalChangeDelivery.included, technicalChangeDelivery.excluded).trim(),
    ''
  ].join('\n'), {
    aidd: { type: 'delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
    id,
    title: capability.title,
    packageType: 'capability',
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
    packageType: 'capability',
    status: 'draft',
    sourceCapability: capability.slug,
    components: capability.components || [],
    technicalChanges: technicalChangeDelivery.included,
    excludedTechnicalChanges: technicalChangeDelivery.excluded,
    createdAt: new Date().toISOString()
  });
  await fsp.writeFile(path.join(dir, 'snapshot.md'), snapshot, 'utf8');
  await fsp.writeFile(path.join(dir, 'implementation-strategy.md'), strategy, 'utf8');
  return { id, path: dir };
}

async function createDeliveryPackageFromTechnicalChange(input: CreateDeliveryPackageFromTechnicalChangeInput) {
  const { standardSections } = await assertProjectTechnicalStandardsReady(input.projectPath);
  const component = await readComponent({ projectPath: input.projectPath, slug: input.componentSlug });
  const change = await readComponentTechnicalChange({
    projectPath: input.projectPath,
    slug: component.slug,
    id: input.technicalChangeId
  });

  if (change.status !== 'approved') {
    throw new Error(`Only approved technical changes can be packaged for delivery. ${change.id} is ${change.status.replace(/-/g, ' ')}.`);
  }

  const existing = await readEntities(input.projectPath, 'delivery/packages', 'package.json');
  const nextNumber = existing.length + 1;
  const id = `DP-${String(nextNumber).padStart(3, '0')}-${slugify(change.title)}`;
  const dir = path.join(input.projectPath, 'delivery', 'packages', id);
  if (await exists(dir)) throw new Error(`Delivery package already exists: ${id}`);
  await fsp.mkdir(dir, { recursive: true });

  const technicalChangeDelivery = await copyApprovedTechnicalChangesIntoDeliveryPackage({
    projectPath: input.projectPath,
    packageDir: dir,
    packageId: id,
    approved: [change],
    excluded: []
  });
  const includedChange = technicalChangeDelivery.included[0] || deliveryTechnicalChangeSummary(change);
  const componentContract = await readComponentContractMarkdownForReview(input.projectPath, component);

  const snapshot = matter.stringify([
    `# Technical Delivery Snapshot: ${change.title}`,
    '',
    'This snapshot contains technical delivery context only. Product foundation and capability narrative are intentionally omitted so implementation stays focused on technical constraints.',
    '',
    buildProjectTechnicalStandardsSnapshot(standardSections),
    '',
    buildComponentTechnicalConstraintsSnapshot(component, componentContract).trim(),
    '',
    buildTechnicalChangeSnapshot(change).trim(),
    ''
  ].join('\n'), {
    aidd: { type: 'technical-delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
    id,
    title: change.title,
    packageType: 'technical',
    sourceTechnicalChange: {
      componentSlug: component.slug,
      technicalChangeId: change.id,
      title: change.title
    },
    components: [component.slug],
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  const strategy = matter.stringify([
    '# Implementation Strategy',
    '',
    'This package implements an approved technical change. Keep implementation inside the technical change scope and component constraints.',
    '',
    '## Objective',
    '',
    `Implement technical change ${change.id}: ${change.title}.`,
    '',
    '## Technical Constraints',
    '',
    '- Follow the included project standards.',
    '- Stay inside the component source area unless the technical change explicitly requires otherwise.',
    '- Treat the approved technical change files as the source of delivery intent.',
    '- Do not expand the work into unrelated product or capability changes.',
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the implementation approach after reviewing the technical change, component contract, and source code.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define tests, commands, manual checks, and evidence required for this technical change.',
    ''
  ].join('\n'), {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${id}-strategy`,
    deliveryPackage: id,
    packageType: 'technical',
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  await writeJson(path.join(dir, 'package.json'), {
    id,
    title: change.title,
    packageType: 'technical',
    status: 'draft',
    sourceTechnicalChange: {
      componentSlug: component.slug,
      technicalChangeId: change.id,
      title: change.title
    },
    components: [component.slug],
    technicalChanges: [{ ...includedChange, status: 'approved' }],
    excludedTechnicalChanges: [],
    createdAt: new Date().toISOString()
  });
  await fsp.writeFile(path.join(dir, 'snapshot.md'), snapshot, 'utf8');
  await fsp.writeFile(path.join(dir, 'implementation-strategy.md'), strategy, 'utf8');
  return { id, path: dir };
}

function deliveryStatusFromManifest(manifest: any, packaged: boolean, phaseCount: number): string {
  const raw = String(manifest.status || '').trim().toLowerCase();
  if (raw) return normaliseStatusForDelivery(raw);
  if (manifest.acceptedAt || manifest.completedAt) return 'done';
  if (manifest.startedAt || manifest.inProgressAt) return 'in-progress';
  if (manifest.approvedAt) return 'approved';
  if (manifest.reviewRequestedAt || manifest.submittedAt) return 'packaging';
  if (packaged || phaseCount > 0) return 'packaging';
  return 'draft';
}

function normaliseStatusForDelivery(status?: string) {
  const value = String(status || 'draft').trim().toLowerCase();
  if (value === 'approved-for-ai') return 'approved';
  if (value === 'in-ai-execution' || value === 'active') return 'in-progress';
  if (value === 'complete' || value === 'accepted') return 'done';
  if (value === 'review' || value === 'in-review' || value === 'needs-review' || value === 'needs-verification') return 'packaging';
  if (value === 'approved' || value === 'in-progress' || value === 'done') return value;
  return 'packaging';
}

function deliveryTechnicalChangeSummary(change: ComponentTechnicalChangeRecord, relativePath?: string): DeliveryPackageTechnicalChangeSummary {
  return {
    id: change.id,
    title: change.title,
    componentSlug: change.componentSlug,
    status: change.status,
    risk: change.risk,
    patchCount: change.patchCount,
    ...(relativePath ? { relativePath } : change.relativePath ? { relativePath: change.relativePath } : {})
  };
}

function normaliseDeliveryPackageTechnicalChanges(input: any): DeliveryPackageTechnicalChangeSummary[] {
  if (!Array.isArray(input)) return [];
  return input.map((item: any) => ({
    id: String(item?.id || ''),
    title: String(item?.title || item?.id || 'Technical change'),
    componentSlug: String(item?.componentSlug || ''),
    status: String(item?.status || ''),
    risk: String(item?.risk || 'unknown'),
    patchCount: Number.isFinite(Number(item?.patchCount)) ? Number(item.patchCount) : 0,
    ...(item?.relativePath ? { relativePath: normaliseRelativePath(String(item.relativePath)) } : {})
  })).filter((item) => item.id);
}

async function collectComponentTechnicalChangesForDelivery(projectPath: string, componentSlugs: string[]) {
  const approved: ComponentTechnicalChangeRecord[] = [];
  const excluded: ComponentTechnicalChangeRecord[] = [];
  const seen = new Set<string>();

  for (const componentSlug of componentSlugs.map((item) => slugify(item)).filter(Boolean)) {
    if (seen.has(componentSlug)) continue;
    seen.add(componentSlug);
    const changes = await readComponentTechnicalChanges(projectPath, componentSlug);
    for (const change of changes) {
      if (change.status === 'approved') approved.push(change);
      else excluded.push(change);
    }
  }

  return { approved, excluded };
}

async function markTechnicalChangePackaged(projectPath: string, change: ComponentTechnicalChangeRecord, packageId: string) {
  const changeDir = path.join(projectPath, change.relativePath);
  const metadataPath = path.join(changeDir, 'technical-change.json');
  if (!(await exists(metadataPath))) return;
  const raw = await readJson<any>(metadataPath);
  const current = normaliseTechnicalChangeRecord(raw, projectPath, change.componentSlug, changeDir);
  const deliveryPackageIds = Array.from(new Set([...(current.deliveryPackageIds || []), packageId]));
  await writeTechnicalChangeMetadata(changeDir, {
    ...current,
    status: 'packaged',
    patchCount: await countTechnicalChangePatches(changeDir),
    deliveryPackageIds,
    updatedAt: new Date().toISOString()
  });
}

async function copyApprovedTechnicalChangesIntoDeliveryPackage(input: {
  projectPath: string;
  packageDir: string;
  packageId: string;
  approved: ComponentTechnicalChangeRecord[];
  excluded: ComponentTechnicalChangeRecord[];
}) {
  const targetRoot = path.join(input.packageDir, 'technical-changes');
  const usedFolders = new Set<string>();
  const included: DeliveryPackageTechnicalChangeSummary[] = [];

  for (const change of input.approved) {
    const sourceDir = path.join(input.projectPath, change.relativePath);
    if (!(await exists(sourceDir))) continue;
    let folderName = isSafeComponentTechnicalReviewSegment(change.id) ? change.id : slugify(change.id) || 'technical-change';
    if (usedFolders.has(folderName.toLowerCase()) || (await exists(path.join(targetRoot, folderName)))) {
      folderName = slugify(`${change.componentSlug}-${change.id}`) || folderName;
    }
    usedFolders.add(folderName.toLowerCase());
    const targetDir = path.join(targetRoot, folderName);
    await copyDir(sourceDir, targetDir);
    const relativePath = normaliseRelativePath(path.relative(input.packageDir, targetDir));
    included.push({
      ...deliveryTechnicalChangeSummary(change, relativePath),
      status: 'approved'
    });
    await markTechnicalChangePackaged(input.projectPath, change, input.packageId);
  }

  const excluded = input.excluded.map((change) => deliveryTechnicalChangeSummary(change));
  if (included.length) {
    await fsp.mkdir(targetRoot, { recursive: true });
    await fsp.writeFile(path.join(targetRoot, 'index.md'), buildDeliveryTechnicalChangesIndexMarkdown(included, []), 'utf8');
  }

  return { included, excluded };
}

function buildDeliveryTechnicalChangesIndexMarkdown(included: DeliveryPackageTechnicalChangeSummary[], excluded: DeliveryPackageTechnicalChangeSummary[]) {
  const lines = [
    '# Technical Changes',
    '',
    'This delivery package includes approved technical changes only.',
    '',
    '## Included',
    '',
    included.length
      ? included.map((change) => `- ${change.id} ${change.title} (${change.componentSlug}, ${change.risk} risk, ${change.patchCount} patch${change.patchCount === 1 ? '' : 'es'})`).join('\n')
      : '- None',
    '',
    '## Excluded',
    '',
    excluded.length
      ? excluded.map((change) => `- ${change.id} ${change.title} (${change.componentSlug}) - ${change.status}`).join('\n')
      : '- None',
    ''
  ];
  return `${lines.join('\n').trim()}\n`;
}

async function buildDeliveryPackageTechnicalChangeSection(packageDir: string, changes: DeliveryPackageTechnicalChangeSummary[]) {
  if (!changes.length) return '';
  const lines = ['## Approved Technical Changes', ''];
  for (const change of changes) {
    lines.push(`### ${change.id} ${change.title}`, '');
    lines.push(`- Component: \`${change.componentSlug}\``);
    lines.push(`- Risk: \`${change.risk}\``);
    lines.push(`- Patches: \`${change.patchCount}\``);
    if (change.relativePath) lines.push(`- Source: \`${change.relativePath}\``);
    const overviewPath = change.relativePath ? path.join(packageDir, change.relativePath, 'overview.md') : '';
    if (overviewPath && await exists(overviewPath)) {
      const overview = matter(await fsp.readFile(overviewPath, 'utf8')).content.trim();
      if (overview) lines.push('', overview);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function buildDeliveryTechnicalChangesContextMarkdown(packageDir: string, changes: DeliveryPackageTechnicalChangeSummary[]) {
  const body = await buildDeliveryPackageTechnicalChangeSection(packageDir, changes);
  return [
    generatedDocHeader('AIDD technical changes'),
    '# AIDD Technical Changes',
    '',
    'This file contains approved technical-change context for this delivery package. Treat it as delivery intent, not broad product context.',
    '',
    body || '_No approved technical changes were included._',
    ''
  ].join('\n');
}

async function countPackagePhases(dir: string) {
  if (!(await exists(dir))) return 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)).length;
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

    const id = String(manifest.id || entry.name);
    const workspacePublication = await readDeliveryWorkspacePublicationState(root, id, manifest);
    items.push({
      id,
      title: String(manifest.title || manifest.name || entry.name),
      packageType: manifest.packageType === 'technical' ? 'technical' : 'capability',
      status: deliveryStatusFromManifest(manifest, packaged, phaseCount),
      sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
      sourceTechnicalChange: manifest.sourceTechnicalChange && typeof manifest.sourceTechnicalChange === 'object'
        ? {
            componentSlug: String(manifest.sourceTechnicalChange.componentSlug || ''),
            technicalChangeId: String(manifest.sourceTechnicalChange.technicalChangeId || ''),
            title: String(manifest.sourceTechnicalChange.title || '')
          }
        : undefined,
      components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
      technicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.technicalChanges),
      excludedTechnicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.excludedTechnicalChanges),
      createdAt: manifest.createdAt || manifest.updatedAt,
      packaged,
      phaseCount,
      priority: typeof manifest.priority === 'number' ? manifest.priority : undefined,
      ...workspacePublication
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
  const fallbackId = String(manifest.id || input.id);
  const summary = (await readDeliveryPackages(input.projectPath)).find((item) => item.id === fallbackId) || {
    id: fallbackId,
    title: String(manifest.title || manifest.name || input.id),
    packageType: manifest.packageType === 'technical' ? 'technical' : 'capability',
    status: String(manifest.status || 'draft'),
    sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
    sourceTechnicalChange: manifest.sourceTechnicalChange && typeof manifest.sourceTechnicalChange === 'object'
      ? {
          componentSlug: String(manifest.sourceTechnicalChange.componentSlug || ''),
          technicalChangeId: String(manifest.sourceTechnicalChange.technicalChangeId || ''),
          title: String(manifest.sourceTechnicalChange.title || '')
        }
      : undefined,
    components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
    technicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.technicalChanges),
    excludedTechnicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.excludedTechnicalChanges),
    createdAt: manifest.createdAt || manifest.updatedAt,
    packaged: false,
    phaseCount: 0,
    ...(await readDeliveryWorkspacePublicationState(input.projectPath, fallbackId, manifest))
  };

  const entries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phases: DeliveryPackagePhaseDetail[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^(phase|stage)-[\w-]+\.md$/i.test(entry.name)) continue;
    const filePath = path.join(target.dir, entry.name);
    const parsed = matter(await fsp.readFile(filePath, 'utf8'));
    phases.push({
      id: String(parsed.data.id || phaseIdFromFileName(entry.name)),
      title: String(parsed.data.title || phaseIdFromFileName(entry.name).replace(/^(phase|stage)-/, '').replace(/-/g, ' ')),
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
      if (entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)) {
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
  const phaseNumber = entries.filter((entry) => entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)).length + 1;
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
  const target = await findDeliveryPackageTarget(input.projectPath, input.packageId);
  const technicalChangesBody = await buildDeliveryPackageTechnicalChangeSection(target.dir, detail.technicalChanges || []);
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
    '',
    technicalChangesBody || '## Approved Technical Changes\n\n_No approved technical changes were included._',
    ''
  ].join('\n');

  await writeMarkdownBody(path.join(target.dir, 'delivery-package.md'), body, {
    aidd: { type: 'assembled-delivery-package', templateVersion: TEMPLATE_VERSION },
    id: `${input.packageId}-assembled`,
    deliveryPackage: input.packageId,
    status: detail.status,
    includes: ['implementation-strategy', 'implementation-phases', 'approved-technical-changes'],
    excludes: ['project-snapshot'],
    updatedAt: new Date().toISOString()
  });

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
}


const DELIVERY_REVIEW_SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp',
  '.m', '.mm', '.cs', '.java', '.kt', '.kts', '.swift',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.pyw', '.go', '.rs', '.php', '.rb', '.lua', '.gd',
  '.vue', '.svelte', '.astro', '.qml',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.glsl', '.hlsl', '.wgsl', '.metal', '.shader', '.usf', '.ush'
]);

const DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.vs',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'output', 'bin', 'obj', 'target', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  'intermediate', 'saved', 'binaries', 'deriveddatacache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv',
  'docs', 'delivery', '.aidd', '.aidd-app'
]);

interface DeliveryReviewSourceRoot {
  absolutePath: string;
  configuredDirectory: string;
  isInsideWorkspace: boolean;
  componentSlugs: string[];
  componentTitles: string[];
  packagePrefix: string;
}

interface DeliveryReviewCollectedSource {
  entries: ZipEntryInput[];
  roots: DeliveryReviewSourceRoot[];
  skippedNestedRoots: Array<{ configuredDirectory: string; absolutePath: string; coveredBy: string; componentSlugs: string[] }>;
  includedFiles: string[];
  warnings: string[];
}

function deliveryReviewSourceFileAllowed(fileName: string) {
  return DELIVERY_REVIEW_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function deliveryReviewSourceDirectoryExcluded(directoryName: string) {
  const lower = directoryName.toLowerCase();
  if (DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES.has(lower)) return true;
  return lower.startsWith('.') && lower !== '.github';
}

function shortHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

function packagePrefixForDeliveryReviewSourceRoot(rootPath: string, workspacePath: string) {
  if (workspacePath && isSameOrInsideDiskPath(rootPath, workspacePath)) {
    const relative = normaliseRelativePath(path.relative(workspacePath, rootPath)).replace(/^\.\/?$/, '');
    return relative;
  }
  const baseName = slugify(path.basename(rootPath) || 'external-source');
  return `_external/${baseName}-${shortHash(rootPath)}`;
}

function deliveryReviewSourceEntryPath(root: DeliveryReviewSourceRoot, relativeFile: string) {
  return ['src', root.packagePrefix, normaliseRelativePath(relativeFile)].filter(Boolean).join('/');
}

function buildDeliveryReviewStrategyMarkdown(detail: DeliveryPackageDetail) {
  const body = (detail.strategyBody || '').trim() || [
    '# Implementation Strategy',
    '',
    '## Objective',
    '',
    'TODO: Describe the implementation objective for this delivery package.',
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the planned implementation approach.',
    '',
    '## Source Code Reference',
    '',
    'TODO: List the source files, components, or directories that should be reviewed.',
    '',
    '## Risks / Unknowns',
    '',
    'TODO: Capture risks, assumptions, and open questions.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define how the implementation will be verified.',
    ''
  ].join('\n');

  return matter.stringify(`${body}\n`, {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${detail.id}-strategy`,
    deliveryPackage: detail.id,
    status: detail.status || 'packaging',
    generatedForReview: true
  });
}

function buildDeliveryReviewSamplePhaseMarkdown(detail: DeliveryPackageDetail) {
  const title = 'Sample Implementation Phase';
  const body = [
    `# Phase 01 — ${title}`,
    '',
    '> AIDD generated this sample phase because the delivery package did not contain any phase or stage files when the review bundle was created.',
    '',
    '## Objective',
    '',
    'Describe the goal of this phase.',
    '',
    '## Scope',
    '',
    'This phase includes:',
    '',
    '- [ ] Understand the delivery objective and linked context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '',
    'This phase does not include:',
    '',
    '- Out-of-scope item 1',
    '- Out-of-scope item 2',
    '',
    '## Source areas',
    '',
    'Expected source locations:',
    '',
    '- `src/...`',
    '',
    '## Implementation notes',
    '',
    '- Keep changes within the listed source areas unless the package explicitly requires otherwise.',
    '- Follow `package/standards.md`.',
    '- Use `package/components.md` and the delivery package files for component/capability context.',
    '- Record required AIDD updates in this delivery package rather than changing the snapshot context files.',
    '',
    '## Progress',
    '',
    'Status: Not started',
    '',
    'Allowed values:',
    '',
    '- Not started',
    '- In progress',
    '- Blocked',
    '- Complete',
    '- Needs review',
    '',
    '## Tasks',
    '',
    '- [ ] Understand the phase objective and relevant context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '- [ ] Add or update tests where appropriate.',
    '- [ ] Run the relevant verification steps.',
    '- [ ] Record changed files.',
    '- [ ] Record evidence.',
    '- [ ] Record any questions or blockers.',
    '- [ ] Mark the phase complete only when acceptance criteria are satisfied.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Criterion 1',
    '- [ ] Criterion 2',
    '- [ ] Criterion 3',
    '',
    '## Changed files',
    '',
    'Record files changed during this phase:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Verification evidence',
    '',
    'Record commands run, test results, screenshots, logs, or manual checks:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Questions / blockers',
    '',
    '- None',
    '',
    '## Proposed AIDD updates',
    '',
    '- None',
    '',
    '## Completion note',
    '',
    'Summarise what was completed in this phase.',
    ''
  ].join('\n');

  return matter.stringify(`${body}\n`, {
    aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
    id: `${detail.id}-sample-phase`,
    title,
    status: 'packaging',
    deliveryPackage: detail.id,
    order: 1,
    generatedForReview: true
  });
}

function buildDeliveryPhaseTemplateMarkdown(input: { packageId: string }) {
  return [
    '# Delivery Phase Template',
    '',
    `Delivery package: ${input.packageId}`,
    '',
    'Use this template when creating or updating phase files in the returned delivery package.',
    '',
    '## File naming rules',
    '',
    'Place phase files directly under `delivery/`.',
    '',
    'Use this naming format:',
    '',
    '```text',
    'delivery/phase-01-short-kebab-name.md',
    'delivery/phase-02-short-kebab-name.md',
    'delivery/phase-03-short-kebab-name.md',
    '```',
    '',
    'Rules:',
    '',
    '- Use `phase-` as the prefix for new phase files.',
    '- Use a two-digit sequence number: `01`, `02`, `03`.',
    '- Use lowercase kebab-case after the sequence number.',
    '- Keep one phase per file.',
    '- Existing `stage-*.md` files may be edited if the package already contains them, but new files should use the `phase-##-name.md` pattern.',
    '',
    'AIDD import accepts returned updates from:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md`',
    '',
    'Do not return snapshot context files, `_templates/`, or `src/`.',
    '',
    '---',
    '',
    '# Phase {{phase_number}} — {{phase_title}}',
    '',
    '## Objective',
    '',
    'Describe the goal of this phase.',
    '',
    '## Scope',
    '',
    'This phase includes:',
    '',
    '- [ ] Task 1',
    '- [ ] Task 2',
    '- [ ] Task 3',
    '',
    'This phase does not include:',
    '',
    '- Out-of-scope item 1',
    '- Out-of-scope item 2',
    '',
    '## Source areas',
    '',
    'Expected source locations:',
    '',
    '- `src/...`',
    '',
    '## Implementation notes',
    '',
    'Guidance for the agentic AI:',
    '',
    '- Keep changes within the listed source areas unless the package explicitly requires otherwise.',
    '- Follow `package/standards.md`.',
    '- Use `package/components.md` and the delivery package files for component/capability context.',
    '- Record any required AIDD updates in the delivery notes rather than changing the snapshot context files.',
    '',
    '## Progress',
    '',
    'Status: Not started',
    '',
    'Allowed values:',
    '',
    '- Not started',
    '- In progress',
    '- Blocked',
    '- Complete',
    '- Needs review',
    '',
    '## Tasks',
    '',
    '- [ ] Understand the phase objective and relevant context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '- [ ] Add or update tests where appropriate.',
    '- [ ] Run the relevant verification steps.',
    '- [ ] Record changed files.',
    '- [ ] Record evidence.',
    '- [ ] Record any questions or blockers.',
    '- [ ] Mark the phase complete only when acceptance criteria are satisfied.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Criterion 1',
    '- [ ] Criterion 2',
    '- [ ] Criterion 3',
    '',
    '## Changed files',
    '',
    'Record files changed during this phase:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Verification evidence',
    '',
    'Record commands run, test results, screenshots, logs, or manual checks:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Questions / blockers',
    '',
    '- None',
    '',
    '## Proposed AIDD updates',
    '',
    '- None',
    '',
    '## Completion note',
    '',
    'Summarise what was completed in this phase.',
    ''
  ].join('\n');
}

function isDeliveryPhaseOrStageMarkdownFile(relativePath: string) {
  return /^(phase|stage)-[\w-]+\.md$/i.test(path.basename(relativePath));
}

async function collectDeliveryPackageEntries(projectPath: string, detail: DeliveryPackageDetail, warnings: string[]) {
  const target = await findDeliveryPackageTarget(projectPath, detail.id);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const entryNames = new Set<string>();
  const base = 'delivery';
  let strategyFileCount = 0;
  let phaseFileCount = 0;

  async function addBuffer(relativePath: string, data: Buffer | string) {
    const zipPath = `${base}/${normaliseRelativePath(relativePath)}`;
    if (entryNames.has(zipPath)) return false;
    entries.push({ name: zipPath, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') });
    includedFiles.push(zipPath);
    entryNames.add(zipPath);
    return true;
  }

  async function addFile(relativePath: string, absolutePath: string) {
    if (!(await exists(absolutePath))) return false;
    const data = await fsp.readFile(absolutePath);
    return addBuffer(relativePath, data);
  }

  async function addReviewMarkdownFile(relativePath: string, absolutePath: string) {
    if (!(await exists(absolutePath))) return false;
    const raw = await fsp.readFile(absolutePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) return false;
    return addBuffer(relativePath, raw);
  }

  async function addTechnicalChangeTree(relativeRoot: string, absoluteRoot: string) {
    if (!(await exists(absoluteRoot))) return;
    const entries = await fsp.readdir(absoluteRoot, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const relativePath = normaliseRelativePath(path.join(relativeRoot, entry.name));
      const absolutePath = path.join(absoluteRoot, entry.name);
      if (entry.isDirectory()) {
        await addTechnicalChangeTree(relativePath, absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!['.md', '.json', '.patch', '.diff'].includes(extension)) continue;
      await addFile(relativePath, absolutePath);
    }
  }

  await addFile(target.manifestName, path.join(target.dir, target.manifestName));

  const strategyPath = path.join(target.dir, 'implementation-strategy.md');
  const addedStrategy = await addReviewMarkdownFile('implementation-strategy.md', strategyPath);
  if (addedStrategy) {
    strategyFileCount = 1;
  } else {
    await addBuffer('implementation-strategy.md', buildDeliveryReviewStrategyMarkdown(detail));
    strategyFileCount = 1;
    if (await exists(strategyPath)) {
      warnings.push('implementation-strategy.md was excluded from normal review packaging, so AIDD generated a strategy copy from the saved package state.');
    } else {
      warnings.push('implementation-strategy.md was missing, so AIDD generated a strategy file for this review bundle.');
    }
  }

  const directEntries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phaseOrStageFiles = directEntries
    .filter((entry) => entry.isFile() && isDeliveryPhaseOrStageMarkdownFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const fileName of phaseOrStageFiles) {
    const added = await addReviewMarkdownFile(fileName, path.join(target.dir, fileName));
    if (added) phaseFileCount += 1;
  }

  if (phaseFileCount === 0) {
    await addBuffer('phase-01-sample-implementation-phase.md', buildDeliveryReviewSamplePhaseMarkdown(detail));
    phaseFileCount = 1;
    if (phaseOrStageFiles.length) {
      warnings.push('Phase/stage files existed but none were included in the review bundle, so AIDD added a sample phase file.');
    } else {
      warnings.push('No phase/stage files were found, so AIDD added a sample phase file to the review bundle.');
    }
  }

  const markdownFiles = await collectMarkdownFiles(target.dir);
  for (const relativeFile of markdownFiles) {
    if (relativeFile === 'implementation-strategy.md') continue;
    if (isDeliveryPhaseOrStageMarkdownFile(relativeFile)) continue;
    if (normaliseRelativePath(relativeFile).startsWith('technical-changes/')) continue;
    const absolutePath = path.join(target.dir, relativeFile);
    const raw = await fsp.readFile(absolutePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    await addBuffer(relativeFile, raw);
  }

  await addTechnicalChangeTree('technical-changes', path.join(target.dir, 'technical-changes'));

  return {
    entries,
    includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)),
    strategyFileCount,
    phaseFileCount
  };
}

async function collectDeliveryReviewComponents(projectPath: string, detail: DeliveryPackageDetail, warnings: string[]) {
  const componentSlugs = new Set<string>((detail.components || []).map((component) => slugify(component)).filter(Boolean));
  let capabilitySlug = detail.sourceCapability ? slugify(detail.sourceCapability) : '';
  let capability: Awaited<ReturnType<typeof readCapability>> | null = null;

  if (capabilitySlug) {
    try {
      capability = await readCapability({ projectPath, slug: capabilitySlug });
      capabilitySlug = capability.slug;
      for (const component of capability.components || []) {
        const slug = slugify(String(component));
        if (slug) componentSlugs.add(slug);
      }
    } catch (error) {
      warnings.push(`The source capability could not be included: ${capabilitySlug} (${error instanceof Error ? error.message : String(error)})`);
      capability = null;
    }
  } else if (detail.packageType !== 'technical') {
    warnings.push('This delivery package does not reference a source capability.');
  }

  const components: Awaited<ReturnType<typeof readComponent>>[] = [];

  for (const componentSlug of Array.from(componentSlugs).sort((a, b) => a.localeCompare(b))) {
    try {
      const component = await readComponent({ projectPath, slug: componentSlug });
      components.push(component);
    } catch (error) {
      warnings.push(`Component could not be included: ${componentSlug} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return {
    capabilitySlug: capability?.slug || capabilitySlug || null,
    capability,
    capabilitySnapshotFileName: capability ? deliveryReviewCapabilitySnapshotFileName(capability.slug) : null,
    components
  };
}

async function collectDeliveryReviewSourceRoots(projectPath: string, components: Awaited<ReturnType<typeof readComponent>>[], warnings: string[]) {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  if (!workspacePath) warnings.push('No source workspace is configured, so component source paths may not resolve as intended.');

  const byPath = new Map<string, DeliveryReviewSourceRoot>();

  for (const component of components) {
    const source = normaliseComponentSource(component.source);
    if (!componentSourceIsConfigured(source)) {
      warnings.push(`Component ${component.slug} has no source code location configured.`);
      continue;
    }

    const absolutePath = path.resolve(resolveComponentSourceDirectory(projectPath, source.directory, workspacePath));
    if (!(await exists(absolutePath))) {
      warnings.push(`Component ${component.slug} source location was not found: ${source.directory}`);
      continue;
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isDirectory()) {
      warnings.push(`Component ${component.slug} source location is not a directory: ${source.directory}`);
      continue;
    }

    const key = normaliseDiskPath(absolutePath);
    const existing = byPath.get(key);
    if (existing) {
      existing.componentSlugs.push(component.slug);
      existing.componentTitles.push(component.title);
      continue;
    }

    byPath.set(key, {
      absolutePath,
      configuredDirectory: source.directory,
      isInsideWorkspace: Boolean(workspacePath && isSameOrInsideDiskPath(absolutePath, workspacePath)),
      componentSlugs: [component.slug],
      componentTitles: [component.title],
      packagePrefix: ''
    });
  }

  const orderedRoots = Array.from(byPath.values()).sort((a, b) => {
    const lengthDiff = normaliseDiskPath(a.absolutePath).length - normaliseDiskPath(b.absolutePath).length;
    return lengthDiff || a.absolutePath.localeCompare(b.absolutePath);
  });
  const roots: DeliveryReviewSourceRoot[] = [];
  const skippedNestedRoots: DeliveryReviewCollectedSource['skippedNestedRoots'] = [];

  for (const candidate of orderedRoots) {
    const parent = roots.find((kept) => isSameOrInsideDiskPath(candidate.absolutePath, kept.absolutePath));
    if (parent) {
      skippedNestedRoots.push({
        configuredDirectory: candidate.configuredDirectory,
        absolutePath: candidate.absolutePath,
        coveredBy: parent.absolutePath,
        componentSlugs: candidate.componentSlugs
      });
      warnings.push(`Skipped nested source root ${candidate.configuredDirectory}; it is already covered by ${parent.configuredDirectory}.`);
      continue;
    }
    candidate.packagePrefix = packagePrefixForDeliveryReviewSourceRoot(candidate.absolutePath, workspacePath);
    roots.push(candidate);
  }

  return { workspacePath, roots, skippedNestedRoots };
}

async function collectDeliveryReviewSourceEntries(projectPath: string, components: Awaited<ReturnType<typeof readComponent>>[]): Promise<DeliveryReviewCollectedSource> {
  const warnings: string[] = [];
  const { roots, skippedNestedRoots } = await collectDeliveryReviewSourceRoots(projectPath, components, warnings);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const entryNames = new Set<string>();

  async function walk(root: DeliveryReviewSourceRoot, currentDir: string, relativeDir = '') {
    let directoryEntries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      directoryEntries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Could not read source directory ${currentDir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    directoryEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of directoryEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (deliveryReviewSourceDirectoryExcluded(entry.name)) continue;
        await walk(root, absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!deliveryReviewSourceFileAllowed(entry.name)) continue;

      const zipPath = deliveryReviewSourceEntryPath(root, relativePath);
      if (entryNames.has(zipPath)) continue;
      try {
        const data = await fsp.readFile(absolutePath);
        entries.push({ name: zipPath, data });
        includedFiles.push(zipPath);
        entryNames.add(zipPath);
      } catch (error) {
        warnings.push(`Could not include source file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const root of roots) {
    await walk(root, root.absolutePath);
  }

  return {
    entries,
    roots,
    skippedNestedRoots,
    includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)),
    warnings
  };
}

function buildDeliveryReviewPackageReadme(input: {
  projectName: string;
  packageId: string;
  title: string;
  packageType?: DeliveryPackageType;
  strategyFileCount: number;
  phaseFileCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  warnings: string[];
}) {
  const isTechnical = input.packageType === 'technical';
  const lines = [
    '# AIDD Delivery Package Review',
    '',
    'This zip was generated by AIDD for delivery package review.',
    '',
    isTechnical
      ? 'The bundle is a self-contained technical snapshot. Review it and create an implementation plan for the approved technical change against the included source code. Use the Standards, Components, and Technical Changes snapshots to steer the implementation plan.'
      : 'The bundle is a self-contained snapshot. Review it and create an implementation plan for the delivery capability against the included source code. Use the Foundation and Standards snapshots to steer the implementation plan, and use the Components snapshot to understand where the relevant source code lives.',
    '',
    '## Bundle layout',
    '',
    'Root files:',
    '',
    '- `README.md` — these instructions',
    '- `MANIFEST.json` — machine-readable package metadata for AIDD and tooling',
    '',
    'Package context snapshots:',
    '',
    ...(isTechnical
      ? [
          '- `package/standards.md`',
          '- `package/components.md`',
          '- `package/technical-changes.md`'
        ]
      : [
          '- `package/foundation.md`',
          '- `package/standards.md`',
          '- `package/components.md`'
        ]),
    '',
    'Editable delivery package files:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md` when existing stages are present',
    '',
    'Approved technical changes, when present:',
    '',
    '- `delivery/technical-changes/`',
    '',
    'The phase template is included at:',
    '',
    '- `_templates/delivery/phase-template.md`',
    '',
    'Source code is included for review context under:',
    '',
    '- `src/`',
    '',
    '## Your task',
    '',
    isTechnical
      ? 'Review the delivery package and create a practical implementation plan for the approved technical change using the included source code.'
      : 'Review the delivery package and create a practical implementation plan for the capability using the included source code.',
    '',
    'Use:',
    '',
    ...(isTechnical
      ? [
          '- `package/standards.md` to steer implementation, testing, security, and delivery expectations',
          '- `package/components.md` to understand the component constraints and source-code locations',
          '- `package/technical-changes.md` to understand the approved technical change being delivered'
        ]
      : [
          '- `package/foundation.md` to understand product intent and project context',
          '- `package/standards.md` to steer implementation, testing, security, and delivery expectations',
          '- `package/components.md` to understand the component map and source-code locations'
        ]),
    '- `delivery/implementation-strategy.md` as the main plan',
    '- `delivery/phase-*.md` or `delivery/stage-*.md` as the implementation phases',
    '- `delivery/technical-changes/` as approved change context',
    '- `src/` as read-only source-code context',
    '',
    'Do not modify the source-code snapshot in this review bundle. Use it to make the implementation plan specific and grounded.',
    '',
    '## Phase file naming',
    '',
    'New phase files must be placed directly under `delivery/` and use this structure:',
    '',
    '```text',
    'delivery/phase-01-short-kebab-name.md',
    'delivery/phase-02-short-kebab-name.md',
    'delivery/phase-03-short-kebab-name.md',
    '```',
    '',
    'Rules:',
    '',
    '- Use `phase-` for new phase files.',
    '- Use a two-digit phase number.',
    '- Use lowercase kebab-case after the number.',
    '- Keep one phase per file.',
    '- Existing `stage-*.md` files may be edited if they were included in the package, but new files should use `phase-##-name.md`.',
    '',
    '## Source-code snapshot rules',
    '',
    'AIDD has included a source-code snapshot under `src/` so the delivery package can be reviewed against the actual implementation surface.',
    '',
    'AIDD includes only source-code files under `src/`. It excludes build output, dependencies, generated folders, docs, delivery folders, and other non-source directories.',
    '',
    'When components point to nested source locations, AIDD keeps the highest source root and skips child roots so the same files are not included twice.',
    '',
    '## Progress tracking',
    '',
    'Markdown checkboxes are useful, but they are not enough on their own. When marking work as complete, also record changed files, verification evidence, blockers, and proposed AIDD updates in the delivery phase files.',
    '',
    '## Return package rule',
    '',
    'When returning a revised package, provide a download zip that contains only the updated `delivery/` folder and its matching files.',
    '',
    'AIDD accepts `delivery/` at the zip root, or inside one wrapping folder if the zip tool adds a parent directory.',
    '',
    'AIDD will import returned files from:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md`',
    '',
    'Do not include `src/`, `package/`, `_templates/`, `MANIFEST.json`, or duplicated review context in the returned zip. The included source code and package context are snapshots for review only.',
    '',
    '## Package summary',
    '',
    `- Project: ${input.projectName}`,
    `- Delivery package: ${input.packageId} — ${input.title}`,
    `- Strategy files: ${input.strategyFileCount}`,
    `- Phase/stage files: ${input.phaseFileCount}`,
    `- Source roots: ${input.sourceRootCount}`,
    `- Source files: ${input.sourceFileCount}`,
    ''
  ];

  if (input.warnings.length) {
    lines.push('## Warnings', '', ...input.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n')}\n`;
}

function normaliseDeliveryReviewReturnEntryName(entryName: string) {
  const normalised = safeZipReadEntryName(entryName);
  if (!normalised) return null;
  if (normalised === 'REVIEW.md') return normalised;
  if (normalised.startsWith('delivery/')) return normalised;

  const parts = normalised.split('/');
  const isSingleWrapperDeliveryPath = parts.length >= 3 && Boolean(parts[0]) && parts[1] === 'delivery';
  if (isSingleWrapperDeliveryPath) return parts.slice(1).join('/');

  const isSingleWrapperReviewFile = parts.length === 2 && Boolean(parts[0]) && parts[1] === 'REVIEW.md';
  if (isSingleWrapperReviewFile) return 'REVIEW.md';

  return null;
}

function isSafeDeliveryReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('delivery/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  const parts = normalised.split('/');
  if (parts.length !== 2) return false;
  const fileName = parts[1].toLowerCase();
  if (fileName === 'implementation-strategy.md') return true;
  return /^(phase|stage)-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(fileName);
}

function deliveryReviewImportBodyFromMarkdown(raw: Buffer | string) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  try {
    return matter(text).content.trim();
  } catch {
    return text.trim();
  }
}

function deliveryReviewImportHasSubstantialContent(body: string) {
  const cleaned = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[>#*_`\-\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;
  if (/^(todo|tbd|n\/?a|none|no content|not provided|placeholder)$/i.test(cleaned)) return false;
  return cleaned.split(/\s+/).filter(Boolean).length >= 8;
}

async function backupDeliveryReviewImportTarget(input: {
  projectRoot: string;
  packageId: string;
  stamp: string;
  deliveryRelativePath: string;
  targetPath: string;
}) {
  if (!(await exists(input.targetPath))) return null;
  const backupRoot = path.join(input.projectRoot, '.aidd', 'backups', 'delivery-review-imports', slugify(input.packageId), input.stamp);
  const backupPath = path.join(backupRoot, input.deliveryRelativePath);
  await fsp.mkdir(path.dirname(backupPath), { recursive: true });
  await fsp.copyFile(input.targetPath, backupPath);
  return { backupRoot, backupPath };
}

async function importDeliveryReviewPackage(input: ImportDeliveryReviewPackageInput): Promise<DeliveryReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.packageId) throw new Error('Delivery package id is required.');
  if (!input.zipPath) throw new Error('Delivery review response zip path is required.');

  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Delivery review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Delivery review response must be a .zip file.');

  const target = await findDeliveryPackageTarget(root, input.packageId);
  const entries = await readZipFile(zipPath);
  const normalisedEntries = entries
    .map((entry) => normaliseDeliveryReviewReturnEntryName(entry.name))
    .filter((entryName): entryName is string => Boolean(entryName));
  const hasDeliveryDirectory = normalisedEntries.some((name) => name === 'delivery/' || name.startsWith('delivery/'));
  if (!hasDeliveryDirectory) {
    throw new Error('Delivery review response rejected: the zip must contain delivery files at delivery/ or inside one wrapping folder, for example delivery/implementation-strategy.md or returned-package/delivery/implementation-strategy.md.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const backedUpFiles: string[] = [];
  const importStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  let backupDirectory: string | undefined;
  let reviewMarkdown: string | undefined;
  let strategyImported = false;
  let phaseFileCount = 0;

  for (const entry of entries) {
    const relativePath = normaliseDeliveryReviewReturnEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeDeliveryReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const deliveryRelativePath = normaliseRelativePath(relativePath.slice('delivery/'.length));
    if (!deliveryRelativePath || deliveryRelativePath.startsWith('../') || path.isAbsolute(deliveryRelativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const targetPath = path.resolve(target.dir, deliveryRelativePath);
    if (!isSameOrInsideDiskPath(targetPath, target.dir)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const importedBody = deliveryReviewImportBodyFromMarkdown(entry.data);
    const importedHasContent = deliveryReviewImportHasSubstantialContent(importedBody);
    if (!importedHasContent) {
      const existingBody = await readMarkdownBody(targetPath);
      const existingHasContent = deliveryReviewImportHasSubstantialContent(existingBody);
      skippedFiles.push(`${relativePath} was skipped because it did not contain enough content${existingHasContent ? ' to safely replace the existing file' : ''}.`);
      continue;
    }

    const backup = await backupDeliveryReviewImportTarget({
      projectRoot: root,
      packageId: input.packageId,
      stamp: importStamp,
      deliveryRelativePath,
      targetPath
    });
    if (backup) {
      backupDirectory = backup.backupRoot;
      backedUpFiles.push(deliveryRelativePath);
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, entry.data);
    importedFiles.push(relativePath);
    if (deliveryRelativePath === 'implementation-strategy.md') strategyImported = true;
    if (/^(phase|stage)-/i.test(path.basename(deliveryRelativePath))) phaseFileCount += 1;
  }

  if (!importedFiles.length) {
    throw new Error('Delivery review response did not contain any importable delivery files. Expected delivery/implementation-strategy.md or delivery/phase-*.md files. Existing delivery files were not changed.');
  }

  let assembledPackageUpdated = false;
  try {
    const assembled = await assembleDeliveryPackage({ projectPath: root, packageId: input.packageId });
    assembledPackageUpdated = Boolean(assembled.packagedBody);
  } catch (error) {
    skippedFiles.push(`delivery-package.md could not be regenerated: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    accepted: true,
    zipPath,
    packageId: input.packageId,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    backedUpFiles: backedUpFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ...(backupDirectory ? { backupDirectory } : {}),
    strategyImported,
    phaseFileCount,
    assembledPackageUpdated,
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

async function createDeliveryPackageReviewBundle(input: DeliveryReviewPackageInput): Promise<DeliveryReviewPackageResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.packageId) throw new Error('Delivery package id is required.');
  const root = path.resolve(input.projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);

  const detail = await readDeliveryPackage({ projectPath: root, id: input.packageId });
  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-${slugify(detail.id)}-delivery-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'delivery', slugify(detail.id));
  const filePath = path.join(outputDir, fileName);
  const warnings: string[] = [];

  const delivery = await collectDeliveryPackageEntries(root, detail, warnings);
  if (detail.excludedTechnicalChanges?.length) {
    warnings.push(`${detail.excludedTechnicalChanges.length} technical change(s) are not approved and were excluded from delivery packaging.`);
  }
  const related = await collectDeliveryReviewComponents(root, detail, warnings);
  const source = await collectDeliveryReviewSourceEntries(root, related.components);
  warnings.push(...source.warnings);

  const standards = await readStandardSections(root);
  const sourceProjects = await readSourceProjects(root);
  const packageType = detail.packageType === 'technical' ? 'technical' : 'capability';
  const componentContext = related.components.length
    ? related.components
    : (await readEntities(root, 'components', 'component.json')).concat(await readEntities(root, 'modules', 'module.json'));
  const contextEntries: ZipEntryInput[] = [];
  if (packageType === 'capability') {
    const foundation = await readFoundationDocuments(root);
    contextEntries.push({ name: 'package/foundation.md', data: Buffer.from(buildPublishedFoundationMarkdown(projectName, foundation), 'utf8') });
  }
  contextEntries.push(
    { name: 'package/standards.md', data: Buffer.from(buildPublishedStandardsMarkdown(projectName, standards), 'utf8') },
    { name: 'package/components.md', data: Buffer.from(buildPublishedComponentsMarkdown(projectName, componentContext, sourceProjects), 'utf8') }
  );
  if (packageType === 'technical') {
    const target = await findDeliveryPackageTarget(root, detail.id);
    contextEntries.push({
      name: 'package/technical-changes.md',
      data: Buffer.from(await buildDeliveryTechnicalChangesContextMarkdown(target.dir, detail.technicalChanges || []), 'utf8')
    });
  }

  const templateEntries: ZipEntryInput[] = [
    {
      name: '_templates/delivery/phase-template.md',
      data: Buffer.from(buildDeliveryPhaseTemplateMarkdown({ packageId: detail.id }), 'utf8')
    }
  ];

  const contextFiles = contextEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const templateFiles = templateEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));

  const allEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildDeliveryReviewPackageReadme({
      projectName,
      packageId: detail.id,
      title: detail.title,
      strategyFileCount: delivery.strategyFileCount,
      phaseFileCount: delivery.phaseFileCount,
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length,
      packageType,
      warnings
    }), 'utf8') },
    ...contextEntries,
    ...delivery.entries,
    ...templateEntries,
    ...source.entries
  ];

  const manifest = {
    bundleType: 'delivery-package-review',
    schemaVersion: 2,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    snapshotIsSelfContained: true,
    packageId: detail.id,
    packageTitle: detail.title,
    packageType,
    sourceCapability: related.capabilitySlug,
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: related.components.map((component) => ({
      slug: component.slug,
      title: component.title,
      source: normaliseComponentSource(component.source)
    })),
    deliveryPackage: {
      directory: 'delivery',
      strategyFileCount: delivery.strategyFileCount,
      phaseFileCount: delivery.phaseFileCount,
      strategyPath: 'delivery/implementation-strategy.md',
      phasePatterns: ['delivery/phase-##-short-kebab-name.md'],
      technicalChanges: detail.technicalChanges || [],
      excludedTechnicalChanges: detail.excludedTechnicalChanges || [],
      acceptedReturnPaths: ['delivery/implementation-strategy.md', 'delivery/phase-*.md', 'delivery/stage-*.md']
    },
    includedFiles: {
      context: contextFiles,
      delivery: delivery.includedFiles,
      templates: templateFiles,
      source: source.includedFiles
    },
    sourceSnapshot: {
      directory: 'src',
      allowedExtensions: Array.from(DELIVERY_REVIEW_SOURCE_EXTENSIONS).sort((a, b) => a.localeCompare(b)),
      excludedDirectories: Array.from(DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES).sort((a, b) => a.localeCompare(b)),
      roots: source.roots.map((sourceRoot) => ({
        configuredDirectory: sourceRoot.configuredDirectory,
        absolutePath: sourceRoot.absolutePath,
        packagePrefix: sourceRoot.packagePrefix ? `src/${sourceRoot.packagePrefix}` : 'src',
        isInsideWorkspace: sourceRoot.isInsideWorkspace,
        componentSlugs: sourceRoot.componentSlugs,
        componentTitles: sourceRoot.componentTitles
      })),
      skippedNestedRoots: source.skippedNestedRoots
    },
    warnings,
    returnInstructions: {
      returnedZipShouldContainOnly: ['delivery/'],
      deliveryDirectory: 'delivery',
      strategyPath: 'delivery/implementation-strategy.md',
      phasePatterns: ['delivery/phase-*.md', 'delivery/stage-*.md'],
      newPhaseNaming: 'delivery/phase-##-short-kebab-name.md',
      sourceCodeIsIncludedForReview: true,
      sourceCodeIsContextOnly: true,
      doNotReturnBundledSourceCodeAsEditedFiles: true,
      doNotReturnSnapshotContext: contextFiles
    }
  };

  allEntries.push({ name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });

  const uniqueEntries = new Map<string, ZipEntryInput>();
  for (const entry of allEntries) {
    const name = safeZipEntryName(entry.name);
    if (!uniqueEntries.has(name)) uniqueEntries.set(name, { ...entry, name });
  }

  await writeZipFile(filePath, Array.from(uniqueEntries.values()));
  return {
    filePath,
    fileName,
    packageId: detail.id,
    strategyFileCount: delivery.strategyFileCount,
    phaseFileCount: delivery.phaseFileCount,
    standardsFileCount: 1,
    capabilityFileCount: 0,
    componentFileCount: 1,
    sourceRootCount: source.roots.length,
    sourceFileCount: source.includedFiles.length,
    entryCount: uniqueEntries.size,
    warnings
  };
}


async function publishDeliveryPackageToWorkspace(input: DeliveryWorkspacePublishInput): Promise<DeliveryWorkspacePublishResult> {
  const packageId = String(input.packageId || '').trim();
  if (!input.projectPath || !packageId) throw new Error('Project path and delivery package id are required.');

  const detail = await readDeliveryPackage({ projectPath: input.projectPath, id: packageId });
  if (normaliseStatusForDelivery(detail.status) !== 'approved') {
    throw new Error('Only approved delivery packages can be published to the workspace. Mark the package as approved first.');
  }

  const workspacePath = await requireDeliveryWorkspace(input.projectPath);
  const targetPath = workspaceDeliveryPackagePath(workspacePath, detail.id);
  const sourceHash = deliveryPackageSourceHash(detail);
  const publishedAt = new Date().toISOString();
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const createdWritableFiles: string[] = [];
  const removedFiles: string[] = [];
  const sourceTarget = await findDeliveryPackageTarget(input.projectPath, detail.id);

  const deliveryFiles = [
    { relativePath: 'implementation-strategy.md', content: buildPublishedDeliveryStrategyFileMarkdown(detail) },
    ...detail.phases.map((phase, index) => ({
      relativePath: phase.fileName,
      content: buildPublishedDeliveryPhaseFileMarkdown(detail, phase, index)
    }))
  ];

  for (const file of deliveryFiles) {
    await writeDeliveryGeneratedFile(path.join(targetPath, file.relativePath), file.content, writtenFiles, skippedFiles, file.relativePath);
  }
  const technicalChangeFiles = await writeDeliveryGeneratedTree(
    path.join(sourceTarget.dir, 'technical-changes'),
    targetPath,
    'technical-changes',
    writtenFiles,
    skippedFiles
  );

  // Older AIDD builds wrote brief/context/progress-style files into workspace delivery packages.
  // Do not remove agent-authored notes, but remove generated read-only files that no longer form part of the package contract.
  for (const obsoleteFile of ['brief.md', 'context.md']) {
    const obsoletePath = path.join(targetPath, obsoleteFile);
    if (await exists(obsoletePath)) {
      await fsp.rm(obsoletePath, { force: true });
      removedFiles.push(obsoleteFile);
    }
  }

  const workspaceManifest = {
    schemaVersion: 2,
    type: 'aidd-workspace-delivery-package',
    packageId: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: 'approved',
    sourceCapability: detail.sourceCapability || '',
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components,
    technicalChanges: detail.technicalChanges || [],
    aiddProjectPath: input.projectPath,
    workspacePath,
    publishedAt,
    sourceHash,
    deliveryDirectory: 'delivery',
    generatedFiles: deliveryFiles.map((file) => file.relativePath).concat(technicalChangeFiles, ['manifest.json']),
    editableFiles: deliveryFiles.map((file) => file.relativePath),
    strategyPath: 'implementation-strategy.md',
    phasePatterns: ['phase-*.md', 'stage-*.md'],
    instructions: 'This folder is the agent-facing delivery package. Implement against the source workspace, update implementation-strategy.md and phase/stage Markdown files as progress is made, and return/import the delivery folder when review is complete.'
  };

  const manifestContent = JSON.stringify(workspaceManifest, null, 2) + '\n';
  await writeDeliveryGeneratedFile(path.join(targetPath, 'manifest.json'), manifestContent, writtenFiles, skippedFiles, 'manifest.json');

  const sourceManifestPath = path.join(sourceTarget.dir, sourceTarget.manifestName);
  const sourceManifest = await readJson<any>(sourceManifestPath);
  await writeJson(sourceManifestPath, {
    ...sourceManifest,
    status: 'approved',
    approvedAt: sourceManifest.approvedAt || publishedAt,
    updatedAt: publishedAt,
    workspaceDelivery: {
      path: targetPath,
      publishedAt,
      sourceHash,
      manifestPath: path.join(targetPath, 'manifest.json'),
      deliveryFiles: deliveryFiles.map((file) => file.relativePath)
    }
  });

  return {
    packageId: detail.id,
    workspacePath,
    targetPath,
    published: true,
    writtenFiles,
    skippedFiles,
    createdWritableFiles,
    removedFiles,
    message: `Published ${detail.id} delivery files to ${targetPath}`
  };
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

ipcMain.handle('project:selectWorkspaceDirectory', async (_event, projectIdOrPath: string) => {
  const projects = await readProjects();
  const project = projects.find((item) => item.id === projectIdOrPath || item.path === projectIdOrPath);
  if (!project) throw new Error('Tracked project was not found.');

  const dialogOptions = {
    title: 'Select source workspace for AGENTS.md',
    properties: ['openDirectory'] as Array<'openDirectory'>,
    ...(project.workspacePath ? { defaultPath: project.workspacePath } : {})
  };
  const result = await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) return null;

  const workspacePath = result.filePaths[0];
  return updateTrackedProject(projectIdOrPath, (current) => ({
    ...current,
    workspacePath,
    workspaceUpdatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  }));
});

ipcMain.handle('project:setWorkspaceDirectory', async (_event, input: SetWorkspaceDirectoryInput) => {
  const projectIdOrPath = input?.projectIdOrPath;
  const workspacePath = input?.workspacePath?.trim();
  if (!projectIdOrPath) throw new Error('Tracked project id or path is required.');
  if (!workspacePath) throw new Error('Workspace path is required.');

  return updateTrackedProject(projectIdOrPath, (current) => ({
    ...current,
    workspacePath,
    workspaceUpdatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  }));
});

ipcMain.handle('project:clearWorkspaceDirectory', async (_event, projectIdOrPath: string) => {
  return updateTrackedProject(projectIdOrPath, (current) => {
    const next: TrackedProject = { ...current, lastOpenedAt: new Date().toISOString() };
    delete next.workspacePath;
    delete next.workspaceUpdatedAt;
    return next;
  });
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
ipcMain.handle('project:workspacePublishStatus', async (_event, projectPath: string) => evaluateWorkspacePublishStatus(projectPath));
ipcMain.handle('project:publishWorkspaceDocs', async (_event, projectPath: string) => publishWorkspaceDocs(projectPath));

ipcMain.handle('project:validate', async (_event, projectPath: string) => validateProject(projectPath));

ipcMain.handle('project:repair', async (_event, projectPath: string) => repairProject(projectPath));

ipcMain.handle('project:upgradeTemplates', async (_event, projectPath: string) => upgradeProjectTemplates(projectPath));

ipcMain.handle('project:openExisting', async () => {
  const result = await dialog.showOpenDialog({ title: 'Open AIDD project', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const projectPath = result.filePaths[0];
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  const existingProjects = await readProjects();
  const previous = existingProjects.find((project) => sameDiskPath(project.path, projectPath));
  const tracked: TrackedProject = {
    id: previous?.id || `${Date.now()}`,
    name: manifest.project?.name || previous?.name || path.basename(projectPath),
    description: manifest.project?.description || previous?.description || '',
    path: projectPath,
    ...(previous?.workspacePath ? { workspacePath: previous.workspacePath } : {}),
    ...(previous?.workspaceUpdatedAt ? { workspaceUpdatedAt: previous.workspaceUpdatedAt } : {}),
    templateId: manifest.templateId || previous?.templateId || 'unknown',
    templateVersion: manifest.templateVersion || previous?.templateVersion || 'unknown',
    createdAt: manifest.createdAt || previous?.createdAt || new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  };
  const projects = existingProjects.filter((project) => !sameDiskPath(project.path, projectPath));
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

  await fsp.writeFile(path.join(projectPath, 'foundation', '01-project-overview.md'), buildFoundationMarkdown({
    id: 'project-overview',
    title: 'Project Overview',
    status: input.description.trim() ? 'draft' : 'not-started',
    body: `# Project Overview\n\n${input.description.trim() || 'Describe what this project is, why it exists, and what success looks like.'}`
  }), 'utf8');
  await fsp.writeFile(path.join(projectPath, 'foundation', '02-product-definition.md'), buildFoundationMarkdown({
    id: 'product-definition',
    title: 'Product Definition',
    status: 'not-started',
    body: '# Product Definition\n\nDescribe what this system is and what product context every delivery package should inherit.'
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



async function prepareStandardSectionDragFile(input: PrepareStandardSectionDragFileInput) {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Standards file name is required.');

  const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
  if (!definition) throw new Error(`Unknown Standards section: ${input.fileName}`);

  const projectPath = path.resolve(input.projectPath);
  const dragDir = path.join(projectPath, '.aidd', 'drag-files', 'standards');
  await fsp.mkdir(dragDir, { recursive: true });

  const safeName = safeDragFileName(input.fileName);
  const outputPath = path.join(dragDir, safeName);
  const title = input.title?.trim() || definition.title;
  const status = input.status || 'draft';
  const body = input.body?.trim() || '';

  await fsp.writeFile(outputPath, buildStandardSectionMarkdown({
    id: definition.id,
    title,
    status,
    required: definition.required,
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
ipcMain.handle('drag:prepareStandardSectionFile', async (_event, input: PrepareStandardSectionDragFileInput) => prepareStandardSectionDragFile(input));
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

ipcMain.handle('project:packageFoundationForReview', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createFoundationReviewPackage(projectPath);
});

ipcMain.handle('project:prepareFoundationReviewPackage', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createFoundationReviewPackage(projectPath);
});

ipcMain.handle('project:importFoundationReviewPackage', async (_event, input: ImportFoundationReviewPackageInput) => {
  if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and foundation review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importFoundationReviewPackage(input));
});

ipcMain.handle('project:importFoundationDocumentUpdate', async (_event, input: ImportFoundationDocumentUpdateInput) => {
  if (!input?.projectPath || !input?.fileName || !input?.updateFilePath) throw new Error('Project path, foundation file name and Markdown update path are required.');
  return withProjectSaveSync(input.projectPath, () => importFoundationDocumentUpdate(input));
});


ipcMain.handle('project:packageStandardsForReview', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createStandardsReviewPackage(projectPath);
});

ipcMain.handle('project:prepareStandardsReviewPackage', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createStandardsReviewPackage(projectPath);
});

ipcMain.handle('project:importStandardsReviewPackage', async (_event, input: ImportStandardsReviewPackageInput) => {
  if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and standards review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importStandardsReviewPackage(input));
});

ipcMain.handle('project:importStandardSectionUpdate', async (_event, input: ImportStandardSectionUpdateInput) => {
  if (!input?.projectPath || !input?.fileName || !input?.updateFilePath) throw new Error('Project path, standards file name and Markdown update path are required.');
  return withProjectSaveSync(input.projectPath, () => importStandardSectionUpdate(input));
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


ipcMain.handle('project:saveStandardSection', async (_event, input: SaveStandardSectionInput) => {
  const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
  if (!definition) throw new Error(`Unknown standards section: ${input.fileName}`);

  const standardsDir = path.join(input.projectPath, 'foundation', 'standards');
  await fsp.mkdir(standardsDir, { recursive: true });
  await fsp.writeFile(path.join(standardsDir, definition.fileName), buildStandardSectionMarkdown({
    id: definition.id,
    title: definition.title,
    status: input.status,
    required: definition.required,
    body: input.body
  }), 'utf8');

  const sections = await readStandardSections(input.projectPath);
  await writeStandardsManifest(input.projectPath, sections);
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

ipcMain.handle('project:packageComponentTechnicalReview', async (_event, input: ComponentTechnicalReviewPackageInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and component slug are required.');
  return createComponentTechnicalReviewBundle(input);
});

ipcMain.handle('project:importComponentTechnicalReviewPackage', async (_event, input: ImportComponentTechnicalReviewPackageInput) => {
  if (!input?.projectPath || !input?.slug || !input?.zipPath) throw new Error('Project path, component slug and technical review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importComponentTechnicalReviewPackage(input));
});

ipcMain.handle('project:createComponentTechnicalChange', async (_event, input: CreateComponentTechnicalChangeInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and component slug are required.');
  return withProjectSaveSync(input.projectPath, () => createComponentTechnicalChange(input));
});

ipcMain.handle('project:readComponentTechnicalChange', async (_event, input: ReadComponentTechnicalChangeInput) => {
  if (!input?.projectPath || !input?.slug || !input?.id) throw new Error('Project path, component slug and technical change id are required.');
  return readComponentTechnicalChange(input);
});

ipcMain.handle('project:saveComponentTechnicalChange', async (_event, input: SaveComponentTechnicalChangeInput) => {
  if (!input?.projectPath || !input?.slug || !input?.id) throw new Error('Project path, component slug and technical change id are required.');
  return withProjectSaveSync(input.projectPath, () => saveComponentTechnicalChange(input));
});

ipcMain.handle('project:updateComponentTechnicalChangeStatus', async (_event, input: UpdateComponentTechnicalChangeStatusInput) => {
  if (!input?.projectPath || !input?.slug || !input?.id || !input?.status) throw new Error('Project path, component slug, technical change id and status are required.');
  return withProjectSaveSync(input.projectPath, () => updateComponentTechnicalChangeStatus(input));
});

ipcMain.handle('project:packageComponentTechnicalChangeReview', async (_event, input: ComponentTechnicalChangeReviewPackageInput) => {
  if (!input?.projectPath || !input?.slug || !input?.id) throw new Error('Project path, component slug and technical change id are required.');
  return createComponentTechnicalChangeReviewPackage(input);
});

ipcMain.handle('project:importComponentTechnicalChangeReviewPackage', async (_event, input: ImportComponentTechnicalChangeReviewPackageInput) => {
  if (!input?.projectPath || !input?.slug || !input?.id || !input?.zipPath) throw new Error('Project path, component slug, technical change id and review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importComponentTechnicalChangeReviewPackage(input));
});

ipcMain.handle('project:updateComponent', async (_event, input: UpdateComponentInput) => {
  if (!input.projectPath || !input.slug || !input.title?.trim()) throw new Error('Project path, component slug, and title are required.');
  return withProjectSaveSync(input.projectPath, () => updateComponent(input));
});

ipcMain.handle('project:deleteComponent', async (_event, input: DeleteComponentInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and component slug are required.');
  return withProjectSaveSync(input.projectPath, () => deleteComponent(input));
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


ipcMain.handle('project:packageCapabilitiesForReview', async (_event, projectPath: string) => {
  if (!projectPath) throw new Error('Project path is required.');
  return createCapabilityReviewBundle(projectPath);
});

ipcMain.handle('project:packageCapabilityForReview', async (_event, input: PackageCapabilityReviewInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and capability slug are required.');
  return createCapabilityReviewBundle(input.projectPath, input.slug);
});

ipcMain.handle('project:importCapabilityReviewPackage', async (_event, input: ImportCapabilityReviewPackageInput) => {
  if (!input?.projectPath || !input?.zipPath) throw new Error('Project path and capability review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importCapabilityReviewPackage(input));
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

ipcMain.handle('project:deleteCapability', async (_event, input: DeleteCapabilityInput) => {
  if (!input?.projectPath || !input?.slug) throw new Error('Project path and capability slug are required.');
  return withProjectSaveSync(input.projectPath, () => deleteCapability(input));
});

ipcMain.handle('project:createDeliveryPackageFromCapability', async (_event, input: CreateDeliveryPackageFromCapabilityInput) => {
  if (!input.projectPath || !input.capabilitySlug) throw new Error('Project path and capability slug are required.');
  return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromCapability(input));
});

ipcMain.handle('project:createDeliveryPackageFromTechnicalChange', async (_event, input: CreateDeliveryPackageFromTechnicalChangeInput) => {
  if (!input.projectPath || !input.componentSlug || !input.technicalChangeId) throw new Error('Project path, component slug and technical change id are required.');
  return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromTechnicalChange(input));
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
ipcMain.handle('project:publishDeliveryPackageToWorkspace', async (_event, input: DeliveryWorkspacePublishInput) => {
  return withProjectSaveSync(input.projectPath, () => publishDeliveryPackageToWorkspace(input));
});

ipcMain.handle('project:packageDeliveryPackageForReview', async (_event, input: DeliveryReviewPackageInput) => {
  if (!input?.projectPath || !input?.packageId) throw new Error('Project path and delivery package id are required.');
  return createDeliveryPackageReviewBundle(input);
});

ipcMain.handle('project:importDeliveryReviewPackage', async (_event, input: ImportDeliveryReviewPackageInput) => {
  if (!input?.projectPath || !input?.packageId || !input?.zipPath) throw new Error('Project path, delivery package id and review response zip path are required.');
  return withProjectSaveSync(input.projectPath, () => importDeliveryReviewPackage(input));
});

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
