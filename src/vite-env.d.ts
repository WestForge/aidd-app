/// <reference types="vite/client" />

interface AiddProjectCreateInput {
  name: string;
  description: string;
  parentLocation: string;
  authorName?: string;
  authorEmail?: string;
  initializeGit?: boolean;
}

interface AiddNotifyInput {
  title: string;
  body?: string;
}

type AiddGitProvider = 'github' | 'gitlab';

interface AiddGitIdentity {
  authorName: string;
  authorEmail: string;
  source: 'saved' | 'git-global' | 'none';
}

interface AiddSaveGitIdentityInput {
  authorName: string;
  authorEmail: string;
}

interface AiddGitSyncSettings {
  provider: AiddGitProvider;
  repoUrl: string;
  branch: 'main';
  hasToken: boolean;
}

interface AiddSaveGitSyncSettingsInput {
  projectPath: string;
  provider: AiddGitProvider;
  repoUrl?: string;
  token?: string;
}

interface AiddGitSyncTestInput {
  projectPath: string;
  provider: AiddGitProvider;
  repoUrl: string;
  token?: string;
}

interface AiddGitSyncTestResult {
  ok: boolean;
  code:
    | 'OK'
    | 'MISSING_PROJECT'
    | 'INVALID_REPO_URL'
    | 'INVALID_PROVIDER'
    | 'MISSING_TOKEN'
    | 'AUTH_FAILED'
    | 'EMPTY_REPOSITORY'
    | 'BRANCH_NOT_FOUND'
    | 'NETWORK_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
}

type AiddGitProjectConnectionState =
  | 'missing_identity'
  | 'local_not_ready'
  | 'local_ready'
  | 'remote_not_configured'
  | 'not_connected'
  | 'connected'
  | 'remote_mismatch'
  | 'needs_attention'
  | 'error';

interface AiddGitProjectConnectionStatus {
  connected: boolean;
  state: AiddGitProjectConnectionState;
  provider?: AiddGitProvider;
  repoUrl?: string;
  branch: 'main';
  remoteUrl?: string;
  hasLocalRepository: boolean;
  hasToken?: boolean;
  authorName?: string;
  authorEmail?: string;
  lastConnectedAt?: string;
  message: string;
}

interface AiddGitProjectConnectionResult {
  ok: boolean;
  code:
    | 'OK'
    | 'LOCAL_READY'
    | 'MISSING_PROJECT'
    | 'MISSING_IDENTITY'
    | 'INVALID_REPO_URL'
    | 'REMOTE_NOT_CONFIGURED'
    | 'REMOTE_MISMATCH'
    | 'LOCAL_REPO_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
  status: AiddGitProjectConnectionStatus;
}

type AiddGitSyncStatusState =
  | 'not_connected'
  | 'ready_to_publish_first_version'
  | 'up_to_date'
  | 'local_changes'
  | 'remote_updates_available'
  | 'syncing'
  | 'synced'
  | 'review_needed'
  | 'error';

interface AiddGitSyncStatus {
  state: AiddGitSyncStatusState;
  message: string;
  lastSyncAt?: string;
  lastCheckpointLabel?: string;
}

interface AiddGitSyncResult {
  ok: boolean;
  code:
    | 'OK'
    | 'NOT_CONNECTED'
    | 'MISSING_TOKEN'
    | 'LOCAL_CHECKPOINT_FAILED'
    | 'REMOTE_CHECK_FAILED'
    | 'PULL_FAILED'
    | 'PUSH_FAILED'
    | 'CONFLICT_DETECTED'
    | 'UNSAFE_REPOSITORY_STATE'
    | 'UNKNOWN_ERROR';
  message: string;
  status: AiddGitSyncStatus;
}


type AiddGitReviewPackageStatus = 'none' | 'pending' | 'partially_resolved' | 'ready_to_complete' | 'completed';
type AiddGitReviewFileStatus = 'unresolved' | 'resolved';
type AiddGitReviewVersionKind = 'local' | 'remote' | 'base';
type AiddGitReviewResolution = 'keep_local' | 'use_shared' | 'use_combined_draft';

interface AiddGitReviewFile {
  path: string;
  status: AiddGitReviewFileStatus;
  options: Array<'keep_local' | 'use_shared' | 'manual_review' | 'combined_draft'>;
}

interface AiddGitReviewState {
  active: boolean;
  reviewId?: string;
  createdAt?: string;
  status: AiddGitReviewPackageStatus;
  message: string;
  files: AiddGitReviewFile[];
  packagePath?: string;
}

interface AiddGitReadReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  kind: AiddGitReviewVersionKind;
}

interface AiddGitResolveReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  resolution: AiddGitReviewResolution;
  combinedContent?: string;
}

interface AiddTrackedProject {
  id: string;
  name: string;
  description: string;
  path: string;
  templateId: string;
  templateVersion: string;
  createdAt: string;
  lastOpenedAt: string;
}

interface AiddProjectStatusItem {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
}


interface AiddProjectValidationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
  path?: string;
  action?: string;
}

interface AiddProjectValidationSection {
  id: string;
  title: string;
  items: AiddProjectValidationItem[];
}

interface AiddProjectValidationReport {
  generatedAt: string;
  status: 'pass' | 'warning' | 'fail';
  score: number;
  canCreateDeliveryPackage: boolean;
  summary: { total: number; errors: number; warnings: number; info: number; success: number };
  sections: AiddProjectValidationSection[];
  nextActions: string[];
}

interface AiddProjectRepairLogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
  path?: string;
  detail?: string;
}

interface AiddProjectRepairReport {
  generatedAt: string;
  changed: boolean;
  changes: string[];
  warnings: string[];
  logs: AiddProjectRepairLogEntry[];
  logPath?: string;
  validation: AiddProjectValidationReport;
}

interface AiddProjectTemplateUpgradeReport {
  generatedAt: string;
  changed: boolean;
  preUpgradeCommit?: string;
  upgradeCommit?: string;
  changes: string[];
  warnings: string[];
  logs: AiddProjectRepairLogEntry[];
  logPath?: string;
  validation: AiddProjectValidationReport;
}


interface AiddHomeWorkDeliveryItem {
  id: string;
  title: string;
  status: string;
  sourceCapability?: string;
  components: string[];
  phaseCount: number;
  priority?: number;
  reason: string;
}

interface AiddHomeWorkCapabilityItem {
  slug: string;
  title: string;
  status: string;
  components: string[];
  incompleteSections: number;
  reason: string;
}

interface AiddHomeWorkComponentItem {
  slug: string;
  title: string;
  status: string;
  sourceProjects: string[];
  source?: AiddComponentSourceConfig;
  capabilities: string[];
  reason: string;
}

interface AiddHomeWork {
  delivery: AiddHomeWorkDeliveryItem[];
  capabilities: AiddHomeWorkCapabilityItem[];
  components: AiddHomeWorkComponentItem[];
  total: number;
}

interface AiddProjectStatus {
  status: 'draft' | 'setting-up' | 'ready-for-planning' | 'ready-for-ai-delivery' | 'active' | 'needs-attention';
  label: string;
  completed: number;
  total: number;
  templateVersion: string;
  gitInitialized: boolean;
  componentCount: number;
  capabilityCount: number;
  bundleCount: number;
  foundation: AiddProjectStatusItem[];
  setup: AiddProjectStatusItem[];
  nextAction: string;
}

type AiddSetupStatus = 'not-started' | 'draft' | 'in-review' | 'active' | 'deprecated' | 'complete' | 'skipped';

interface AiddFoundationDocument {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  status: AiddSetupStatus;
  required: boolean;
  body: string;
}

interface AiddComponentContractInfo {
  path: string;
  version: number;
  sourceHash?: string;
  status: 'blocked' | 'missing' | 'stale' | 'current';
  blockers: string[];
}

type AiddComponentSourceDetectionConfidence = 'high' | 'medium' | 'low';

interface AiddComponentSourceDetection {
  suggestedType: string;
  confidence: AiddComponentSourceDetectionConfidence;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  packageManager?: string;
  reasons: string[];
}

interface AiddComponentSourceConfig {
  directory: string;
  type: string;
  detection?: AiddComponentSourceDetection | null;
}

interface AiddComponentSourceDirectoryInput {
  projectPath: string;
  directory?: string;
  currentDirectory?: string;
}

interface AiddComponentSourceDirectorySelection {
  directory: string;
  absolutePath: string;
  detection: AiddComponentSourceDetection;
}

interface AiddComponentSummary {
  slug: string;
  title: string;
  status?: string;
  sourceProjects?: string[];
  source?: AiddComponentSourceConfig;
  contract?: AiddComponentContractInfo;
}

interface AiddCapabilitySummary {
  slug: string;
  title: string;
  status?: string;
  components?: string[];
}

interface AiddProjectSetupState {
  foundation: AiddFoundationDocument[];
  standards: { status: AiddSetupStatus; filePath: string; body: string; profiles: string[] };
  components: AiddComponentSummary[];
  capabilities: AiddCapabilitySummary[];
  gitInitialized: boolean;
}

interface AiddSaveFoundationInput {
  projectPath: string;
  fileName: string;
  status: AiddSetupStatus;
  body: string;
}

interface AiddDefineStandardsInput {
  projectPath: string;
  body: string;
  status: AiddSetupStatus;
}

interface AiddComponentSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  skipReason?: string;
  prompt?: string;
}

interface AiddCreateComponentInput {
  projectPath: string;
  title: string;
  description?: string;
  status?: AiddSetupStatus;
  sourceProjects?: string[];
  source?: Partial<AiddComponentSourceConfig>;
  capabilities?: string[];
  sections?: AiddComponentSection[];
}

interface AiddComponentDetail {
  slug: string;
  title: string;
  status: AiddSetupStatus | string;
  sourceProjects: string[];
  source: AiddComponentSourceConfig;
  capabilities: string[];
  sections: AiddComponentSection[];
  contract: AiddComponentContractInfo;
  description: string;
  filePath: string;
}

interface AiddReadComponentInput {
  projectPath: string;
  slug: string;
}

interface AiddGenerateComponentContractInput {
  projectPath: string;
  slug: string;
}

interface AiddUpdateComponentInput {
  projectPath: string;
  slug: string;
  title: string;
  description?: string;
  status?: AiddSetupStatus;
  sourceProjects?: string[];
  source?: Partial<AiddComponentSourceConfig>;
  capabilities?: string[];
  sections?: AiddComponentSection[];
}


interface AiddCapabilitySection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  prompt?: string;
}

interface AiddCapabilityDetail {
  slug: string;
  title: string;
  status: AiddSetupStatus | string;
  components: string[];
  description: string;
  outcome: string;
  notes: string;
  sections: AiddCapabilitySection[];
  body: string;
  filePath: string;
}

interface AiddReadCapabilityInput {
  projectPath: string;
  slug: string;
}

interface AiddUpdateCapabilityInput {
  projectPath: string;
  slug: string;
  title: string;
  description?: string;
  outcome?: string;
  notes?: string;
  status?: AiddSetupStatus;
  componentSlugs?: string[];
  sections?: AiddCapabilitySection[];
}

interface AiddSourceReference {
  path: string;
  detectedType: string;
  indicators: string[];
  updatedAt: string;
}

interface AiddSourceCodeProject {
  id: string;
  name: string;
  path: string;
  detectedType: string;
  indicators: string[];
  createdAt: string;
  updatedAt: string;
}
interface AiddCreateCapabilityInput {
  projectPath: string;
  title: string;
  description?: string;
  outcome?: string;
  componentSlugs?: string[];
  notes?: string;
  status?: AiddSetupStatus;
  inlineComponent?: { title: string; description?: string };
  sections?: AiddCapabilitySection[];
}


interface AiddDeliveryPackageSummary {
  id: string;
  title: string;
  status: AiddSetupStatus | string;
  sourceCapability?: string;
  components: string[];
  createdAt?: string;
  packaged: boolean;
  phaseCount: number;
  priority?: number;
}

interface AiddDeliveryPackagePhase {
  id: string;
  title: string;
  status: AiddSetupStatus | string;
  fileName: string;
  body: string;
}

interface AiddDeliveryPackageFile {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  extension?: string;
  editable: boolean;
}

interface AiddDeliveryPackageDetail extends AiddDeliveryPackageSummary {
  packagePath: string;
  snapshotBody: string;
  strategyBody: string;
  packagedBody: string;
  phases: AiddDeliveryPackagePhase[];
  files: AiddDeliveryPackageFile[];
}


interface AiddDecisionRecord {
  id: string;
  title: string;
  status: string;
  relativePath: string;
  body: string;
  createdAt?: string;
}

interface AiddCreateDecisionInput {
  projectPath: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: string;
}

interface AiddWorkflowDocument {
  id: string;
  title: string;
  type: string;
  status: AiddSetupStatus;
  required: boolean;
  relativePath: string;
  filePath: string;
  body: string;
  updatedAt?: string;
}

interface AiddSaveWorkflowDocumentInput {
  projectPath: string;
  relativePath: string;
  title: string;
  status: AiddSetupStatus;
  body: string;
}


interface AiddPrepareFoundationDragFileInput {
  projectPath: string;
  fileName: string;
  title?: string;
  status?: AiddSetupStatus;
  body: string;
}

interface AiddPrepareMarkdownDragFileInput {
  projectPath: string;
  directory?: string;
  fileName: string;
  title?: string;
  status?: AiddSetupStatus | string;
  body: string;
  metadata?: Record<string, unknown>;
}


interface AiddComponentReviewPackageResult {
  filePath: string;
  fileName: string;
  componentCount: number;
  componentFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

interface AiddFoundationReviewPackageResult {
  filePath: string;
  fileName: string;
  foundationFileCount: number;
  entryCount: number;
}

interface AiddImportFoundationReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface AiddFoundationReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface AiddPackageComponentForReviewInput {
  projectPath: string;
  slug: string;
}

interface AiddImportComponentReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface AiddComponentReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  componentCount: number;
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface AiddPrepareComponentContractDragFileInput {
  projectPath: string;
  slug: string;
}

interface Window {
  aidd: {
    getDroppedFilePath: (file: File) => string;
    notify: (input: AiddNotifyInput) => Promise<boolean>;
    showItemInFolder: (filePath: string) => Promise<boolean>;
    selectProjectFolder: () => Promise<string | null>;
    listProjects: () => Promise<AiddTrackedProject[]>;
    forgetProject: (projectId: string) => Promise<AiddTrackedProject[]>;
    readProjectStatus: (projectPath: string) => Promise<AiddProjectStatus>;
    readHomeWork: (projectPath: string) => Promise<AiddHomeWork>;
    validateProject: (projectPath: string) => Promise<AiddProjectValidationReport>;
    repairProject: (projectPath: string) => Promise<AiddProjectRepairReport>;
    upgradeProjectTemplates: (projectPath: string) => Promise<AiddProjectTemplateUpgradeReport>;
    readProjectSetup: (projectPath: string) => Promise<AiddProjectSetupState>;
    prepareFoundationReviewPackage: (projectPath: string) => Promise<AiddFoundationReviewPackageResult>;
    packageFoundationForReview: (projectPath: string) => Promise<AiddFoundationReviewPackageResult>;
    importFoundationReviewPackage: (input: AiddImportFoundationReviewPackageInput) => Promise<AiddFoundationReviewPackageImportResult>;
    packageComponentsForReview: (projectPath: string) => Promise<AiddComponentReviewPackageResult>;
    packageComponentForReview: (input: AiddPackageComponentForReviewInput) => Promise<AiddComponentReviewPackageResult>;
    importComponentReviewPackage: (input: AiddImportComponentReviewPackageInput) => Promise<AiddComponentReviewPackageImportResult>;
    createComponentReviewBundle: (projectPath: string) => Promise<AiddComponentReviewPackageResult>;
    prepareFoundationDragFile: (input: AiddPrepareFoundationDragFileInput) => Promise<string>;
    prepareMarkdownDragFile: (input: AiddPrepareMarkdownDragFileInput) => Promise<string>;
    prepareComponentContractDragFile: (input: AiddPrepareComponentContractDragFileInput) => Promise<string>;
    prepareNativeDragTestFile: () => Promise<{ filePath: string; fileName: string }>;
    startNativeFileDrag: (filePath: string) => void;
    startFileDrag: (filePath: string) => void;
    readWorkflowDocuments: (projectPath: string) => Promise<AiddWorkflowDocument[]>;
    saveWorkflowDocument: (input: AiddSaveWorkflowDocumentInput) => Promise<AiddWorkflowDocument[]>;
    saveFoundationDocument: (input: AiddSaveFoundationInput) => Promise<AiddProjectSetupState>;
    defineStandards: (input: AiddDefineStandardsInput) => Promise<AiddProjectSetupState>;
    createComponent: (input: AiddCreateComponentInput) => Promise<AiddProjectSetupState>;
    readComponent: (input: AiddReadComponentInput) => Promise<AiddComponentDetail>;
    updateComponent: (input: AiddUpdateComponentInput) => Promise<AiddProjectSetupState>;
    generateComponentContract: (input: AiddGenerateComponentContractInput) => Promise<AiddComponentDetail>;
    selectComponentSourceDirectory: (input: AiddComponentSourceDirectoryInput) => Promise<AiddComponentSourceDirectorySelection | null>;
    detectComponentSourceDirectory: (input: AiddComponentSourceDirectoryInput) => Promise<AiddComponentSourceDirectorySelection>;
    createCapability: (input: AiddCreateCapabilityInput) => Promise<AiddProjectSetupState>;
    readCapability: (input: AiddReadCapabilityInput) => Promise<AiddCapabilityDetail>;
    updateCapability: (input: AiddUpdateCapabilityInput) => Promise<AiddProjectSetupState>;
    createDeliveryPackageFromCapability: (input: { projectPath: string; capabilitySlug: string }) => Promise<{ id: string; path: string }>;
    readDeliveryPackages: (projectPath: string) => Promise<AiddDeliveryPackageSummary[]>;
    deleteDeliveryPackage: (input: { projectPath: string; id: string }) => Promise<AiddDeliveryPackageSummary[]>;
    reorderDeliveryPackage: (input: { projectPath: string; id: string; direction: 'up' | 'down' }) => Promise<AiddDeliveryPackageSummary[]>;
    readDeliveryPackage: (input: { projectPath: string; id: string }) => Promise<AiddDeliveryPackageDetail>;
    saveDeliveryPackage: (input: { projectPath: string; id: string; title?: string; status?: string; snapshotBody?: string; strategyBody?: string; phases?: AiddDeliveryPackagePhase[] }) => Promise<AiddDeliveryPackageDetail>;
    createDeliveryPackagePhase: (input: { projectPath: string; packageId: string; title: string; body?: string }) => Promise<AiddDeliveryPackageDetail>;
    assembleDeliveryPackage: (input: { projectPath: string; packageId: string }) => Promise<AiddDeliveryPackageDetail>;
    readDecisions: (projectPath: string) => Promise<AiddDecisionRecord[]>;
    createDecision: (input: AiddCreateDecisionInput) => Promise<AiddDecisionRecord[]>;
    readSourceReference: (projectPath: string) => Promise<AiddSourceReference | null>;
    readSourceProjects: (projectPath: string) => Promise<AiddSourceCodeProject[]>;
    addSourceProject: (projectPath: string) => Promise<AiddSourceCodeProject | null>;
    selectSourceDirectory: (projectPath: string) => Promise<AiddSourceReference | null>;
    createProject: (input: AiddProjectCreateInput) => Promise<AiddTrackedProject>;
    openExistingProject: () => Promise<AiddTrackedProject | null>;
    gitIdentity: {
      read: () => Promise<AiddGitIdentity | null>;
      save: (input: AiddSaveGitIdentityInput) => Promise<AiddGitIdentity>;
    };
    gitSync: {
      readSettings: (projectPath: string) => Promise<AiddGitSyncSettings | null>;
      saveSettings: (input: AiddSaveGitSyncSettingsInput) => Promise<AiddGitSyncSettings>;
      testConnection: (input: AiddGitSyncTestInput) => Promise<AiddGitSyncTestResult>;
      clearToken: (projectPath: string) => Promise<AiddGitSyncSettings | null>;
      getReviewState: (projectPath: string) => Promise<AiddGitReviewState>;
      listReviewFiles: (projectPath: string) => Promise<AiddGitReviewFile[]>;
      readReviewFile: (input: AiddGitReadReviewFileInput) => Promise<string>;
      resolveReviewFile: (input: AiddGitResolveReviewFileInput) => Promise<AiddGitReviewState>;
      completeReview: (projectPath: string, reviewId: string) => Promise<AiddGitReviewState>;
      cancelReview: (projectPath: string, reviewId: string) => Promise<AiddGitReviewState>;
      getProjectConnectionStatus: (projectPath: string) => Promise<AiddGitProjectConnectionStatus>;
      connectProject: (projectPath: string) => Promise<AiddGitProjectConnectionResult>;
      getSyncStatus: (projectPath: string) => Promise<AiddGitSyncStatus>;
      checkForUpdates: (projectPath: string) => Promise<AiddGitSyncResult>;
      syncProject: (projectPath: string) => Promise<AiddGitSyncResult>;
    };
    readText: (filePath: string) => Promise<string>;
    writeText: (filePath: string, content: string) => Promise<boolean>;
  };
}
