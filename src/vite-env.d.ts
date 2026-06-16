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
  workspacePath?: string;
  workspaceUpdatedAt?: string;
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

interface AiddWorkspacePublishOutput {
  path: string;
  kind: 'agents' | 'doc';
  sourceHash: string;
  outputHash: string;
  status: 'missing' | 'stale' | 'modified' | 'up-to-date';
  message: string;
}

interface AiddWorkspacePublishWritableFile {
  path: string;
  outputHash: string;
}

interface AiddWorkspacePublishStatus {
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
  outputs: AiddWorkspacePublishOutput[];
  writableFiles: AiddWorkspacePublishWritableFile[];
  summary: { total: number; missing: number; stale: number; modified: number; upToDate: number };
}

interface AiddWorkspacePublishResult extends AiddWorkspacePublishStatus {
  published: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  createdWritableFiles: string[];
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

interface AiddStandardSection {
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
type AiddComponentSourcePathMode = 'workspace-relative' | 'absolute';

interface AiddComponentSourceDetection {
  suggestedType: string;
  confidence: AiddComponentSourceDetectionConfidence;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  detectedMarkers: string[];
  packageManager?: string;
  reasons: string[];
}

interface AiddComponentSourceConfig {
  directory: string;
  type: string;
  pathMode: AiddComponentSourcePathMode;
  isInsideWorkspace: boolean;
  absolutePath?: string;
  warning?: string;
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
  pathMode: AiddComponentSourcePathMode;
  isInsideWorkspace: boolean;
  warning?: string;
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
  standards: { status: AiddSetupStatus; filePath: string; body: string; profiles: string[]; sections: AiddStandardSection[] };
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


interface AiddSaveStandardSectionInput {
  projectPath: string;
  fileName: string;
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
  technicalReviews: AiddComponentTechnicalReviewRecord[];
  technicalChanges: AiddComponentTechnicalChangeRecord[];
  description: string;
  filePath: string;
}

type AiddComponentTechnicalReviewType = 'code' | 'security' | 'architecture' | 'tests' | 'performance' | 'accessibility' | 'dependencies';
type AiddComponentTechnicalReviewSourceScope = 'component-source' | 'changed-files' | 'full-source';
type AiddComponentTechnicalChangeStatus = 'draft' | 'proposed' | 'needs-review' | 'approved' | 'rejected' | 'superseded' | 'packaged' | 'delivered';
type AiddComponentTechnicalChangeSource = 'manual' | 'technical-review';
type AiddComponentTechnicalChangeRisk = 'low' | 'medium' | 'high' | 'unknown';

interface AiddComponentTechnicalChangeRecord {
  id: string;
  title: string;
  componentSlug: string;
  status: AiddComponentTechnicalChangeStatus;
  source: AiddComponentTechnicalChangeSource;
  createdAt: string;
  updatedAt: string;
  risk: AiddComponentTechnicalChangeRisk;
  patchCount: number;
  linkedFindings: string[];
  linkedReviewPath: string | null;
  deliveryPackageIds: string[];
  relativePath: string;
}

interface AiddComponentTechnicalChangeSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  editable: boolean;
}

interface AiddComponentTechnicalChangeDetail extends AiddComponentTechnicalChangeRecord {
  sections: AiddComponentTechnicalChangeSection[];
}

interface AiddCreateComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  title?: string;
  status?: AiddComponentTechnicalChangeStatus;
  risk?: AiddComponentTechnicalChangeRisk;
}

interface AiddUpdateComponentTechnicalChangeStatusInput {
  projectPath: string;
  slug: string;
  id: string;
  status: AiddComponentTechnicalChangeStatus;
}

interface AiddReadComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
}

interface AiddSaveComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
  title?: string;
  status?: AiddComponentTechnicalChangeStatus;
  risk?: AiddComponentTechnicalChangeRisk;
  sections?: AiddComponentTechnicalChangeSection[];
}

interface AiddComponentTechnicalReviewChangeSummary {
  id: string;
  overviewPath?: string;
  status: string;
  patches: string[];
}

interface AiddComponentTechnicalReviewRecord {
  type: 'component-technical-review-import';
  schemaVersion: number;
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
  changes: AiddComponentTechnicalReviewChangeSummary[];
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
  packageType?: 'capability' | 'technical';
  status: AiddSetupStatus | string;
  sourceCapability?: string;
  sourceTechnicalChange?: {
    componentSlug: string;
    technicalChangeId: string;
    title: string;
  };
  components: string[];
  technicalChanges?: AiddDeliveryPackageTechnicalChange[];
  excludedTechnicalChanges?: AiddDeliveryPackageTechnicalChange[];
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

interface AiddDeliveryPackageTechnicalChange {
  id: string;
  title: string;
  componentSlug: string;
  status: string;
  risk: string;
  patchCount: number;
  relativePath?: string;
}

interface AiddDeliveryWorkspacePublishResult {
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

interface AiddDeliveryReviewPackageResult {
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

interface AiddDeliveryReviewPackageImportResult {
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

interface AiddPrepareStandardSectionDragFileInput {
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

interface AiddPackageComponentTechnicalReviewInput {
  projectPath: string;
  slug: string;
  reviewTypes?: AiddComponentTechnicalReviewType[];
  sourceScope?: AiddComponentTechnicalReviewSourceScope;
}

interface AiddComponentTechnicalReviewPackageResult {
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

interface AiddCapabilityReviewPackageResult {
  filePath: string;
  fileName: string;
  capabilityCount: number;
  capabilityFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

interface AiddFoundationReviewPackageResult {
  filePath: string;
  fileName: string;
  foundationFileCount: number;
  entryCount: number;
}

interface AiddStandardsReviewPackageResult {
  filePath: string;
  fileName: string;
  standardsFileCount: number;
  entryCount: number;
}

interface AiddImportFoundationReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface AiddImportFoundationDocumentUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

interface AiddImportStandardsReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface AiddImportStandardSectionUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

interface AiddFoundationReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface AiddStandardsReviewPackageImportResult {
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
  importedComponents: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

interface AiddImportComponentTechnicalReviewPackageInput {
  projectPath: string;
  slug: string;
  zipPath: string;
}

interface AiddComponentTechnicalReviewImportResult {
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

interface AiddComponentTechnicalChangeReviewPackageResult {
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

interface AiddImportComponentTechnicalChangeReviewPackageResult {
  accepted: boolean;
  zipPath: string;
  componentSlug: string;
  technicalChangeId: string;
  importedFiles: string[];
  skippedFiles: string[];
  patchCount: number;
}

interface AiddPackageCapabilityForReviewInput {
  projectPath: string;
  slug: string;
}

interface AiddImportCapabilityReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

interface AiddCapabilityReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  capabilityCount: number;
  importedCapabilities: string[];
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
    selectWorkspaceDirectory: (projectIdOrPath: string) => Promise<AiddTrackedProject | null>;
    clearWorkspaceDirectory: (projectIdOrPath: string) => Promise<AiddTrackedProject>;
    listProjects: () => Promise<AiddTrackedProject[]>;
    forgetProject: (projectId: string) => Promise<AiddTrackedProject[]>;
    readProjectStatus: (projectPath: string) => Promise<AiddProjectStatus>;
    readHomeWork: (projectPath: string) => Promise<AiddHomeWork>;
    readWorkspacePublishStatus: (projectPath: string) => Promise<AiddWorkspacePublishStatus>;
    publishWorkspaceDocs: (projectPath: string) => Promise<AiddWorkspacePublishResult>;
    validateProject: (projectPath: string) => Promise<AiddProjectValidationReport>;
    repairProject: (projectPath: string) => Promise<AiddProjectRepairReport>;
    upgradeProjectTemplates: (projectPath: string) => Promise<AiddProjectTemplateUpgradeReport>;
    readProjectSetup: (projectPath: string) => Promise<AiddProjectSetupState>;
    prepareFoundationReviewPackage: (projectPath: string) => Promise<AiddFoundationReviewPackageResult>;
    packageFoundationForReview: (projectPath: string) => Promise<AiddFoundationReviewPackageResult>;
    importFoundationReviewPackage: (input: AiddImportFoundationReviewPackageInput) => Promise<AiddFoundationReviewPackageImportResult>;
    importFoundationDocumentUpdate: (input: AiddImportFoundationDocumentUpdateInput) => Promise<AiddProjectSetupState>;
    prepareStandardsReviewPackage: (projectPath: string) => Promise<AiddStandardsReviewPackageResult>;
    packageStandardsForReview: (projectPath: string) => Promise<AiddStandardsReviewPackageResult>;
    importStandardsReviewPackage: (input: AiddImportStandardsReviewPackageInput) => Promise<AiddStandardsReviewPackageImportResult>;
    importStandardSectionUpdate: (input: AiddImportStandardSectionUpdateInput) => Promise<AiddProjectSetupState>;
    packageComponentsForReview: (projectPath: string) => Promise<AiddComponentReviewPackageResult>;
    packageComponentForReview: (input: AiddPackageComponentForReviewInput) => Promise<AiddComponentReviewPackageResult>;
    importComponentReviewPackage: (input: AiddImportComponentReviewPackageInput) => Promise<AiddComponentReviewPackageImportResult>;
    packageComponentTechnicalReview: (input: AiddPackageComponentTechnicalReviewInput) => Promise<AiddComponentTechnicalReviewPackageResult>;
    importComponentTechnicalReviewPackage: (input: AiddImportComponentTechnicalReviewPackageInput) => Promise<AiddComponentTechnicalReviewImportResult>;
    createComponentTechnicalChange: (input: AiddCreateComponentTechnicalChangeInput) => Promise<AiddComponentTechnicalChangeRecord>;
    readComponentTechnicalChange: (input: AiddReadComponentTechnicalChangeInput) => Promise<AiddComponentTechnicalChangeDetail>;
    saveComponentTechnicalChange: (input: AiddSaveComponentTechnicalChangeInput) => Promise<AiddComponentTechnicalChangeDetail>;
    updateComponentTechnicalChangeStatus: (input: AiddUpdateComponentTechnicalChangeStatusInput) => Promise<AiddComponentTechnicalChangeRecord[]>;
    packageComponentTechnicalChangeReview: (input: AiddReadComponentTechnicalChangeInput) => Promise<AiddComponentTechnicalChangeReviewPackageResult>;
    importComponentTechnicalChangeReviewPackage: (input: AiddReadComponentTechnicalChangeInput & { zipPath: string }) => Promise<AiddImportComponentTechnicalChangeReviewPackageResult>;
    packageCapabilitiesForReview: (projectPath: string) => Promise<AiddCapabilityReviewPackageResult>;
    packageCapabilityForReview: (input: AiddPackageCapabilityForReviewInput) => Promise<AiddCapabilityReviewPackageResult>;
    importCapabilityReviewPackage: (input: AiddImportCapabilityReviewPackageInput) => Promise<AiddCapabilityReviewPackageImportResult>;
    createComponentReviewBundle: (projectPath: string) => Promise<AiddComponentReviewPackageResult>;
    prepareFoundationDragFile: (input: AiddPrepareFoundationDragFileInput) => Promise<string>;
    prepareStandardSectionDragFile: (input: AiddPrepareStandardSectionDragFileInput) => Promise<string>;
    prepareMarkdownDragFile: (input: AiddPrepareMarkdownDragFileInput) => Promise<string>;
    prepareComponentContractDragFile: (input: AiddPrepareComponentContractDragFileInput) => Promise<string>;
    prepareNativeDragTestFile: () => Promise<{ filePath: string; fileName: string }>;
    startNativeFileDrag: (filePath: string) => void;
    startFileDrag: (filePath: string) => void;
    readWorkflowDocuments: (projectPath: string) => Promise<AiddWorkflowDocument[]>;
    saveWorkflowDocument: (input: AiddSaveWorkflowDocumentInput) => Promise<AiddWorkflowDocument[]>;
    saveFoundationDocument: (input: AiddSaveFoundationInput) => Promise<AiddProjectSetupState>;
    defineStandards: (input: AiddDefineStandardsInput) => Promise<AiddProjectSetupState>;
    saveStandardSection: (input: AiddSaveStandardSectionInput) => Promise<AiddProjectSetupState>;
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
    createDeliveryPackageFromTechnicalChange: (input: { projectPath: string; componentSlug: string; technicalChangeId: string }) => Promise<{ id: string; path: string }>;
    readDeliveryPackages: (projectPath: string) => Promise<AiddDeliveryPackageSummary[]>;
    deleteDeliveryPackage: (input: { projectPath: string; id: string }) => Promise<AiddDeliveryPackageSummary[]>;
    reorderDeliveryPackage: (input: { projectPath: string; id: string; direction: 'up' | 'down' }) => Promise<AiddDeliveryPackageSummary[]>;
    readDeliveryPackage: (input: { projectPath: string; id: string }) => Promise<AiddDeliveryPackageDetail>;
    saveDeliveryPackage: (input: { projectPath: string; id: string; title?: string; status?: string; snapshotBody?: string; strategyBody?: string; phases?: AiddDeliveryPackagePhase[] }) => Promise<AiddDeliveryPackageDetail>;
    createDeliveryPackagePhase: (input: { projectPath: string; packageId: string; title: string; body?: string }) => Promise<AiddDeliveryPackageDetail>;
    assembleDeliveryPackage: (input: { projectPath: string; packageId: string }) => Promise<AiddDeliveryPackageDetail>;
    publishDeliveryPackageToWorkspace: (input: { projectPath: string; packageId: string }) => Promise<AiddDeliveryWorkspacePublishResult>;
    packageDeliveryPackageForReview: (input: { projectPath: string; packageId: string }) => Promise<AiddDeliveryReviewPackageResult>;
    importDeliveryReviewPackage: (input: { projectPath: string; packageId: string; zipPath: string }) => Promise<AiddDeliveryReviewPackageImportResult>;
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

declare module '*.json' {
  const value: { version?: string; [key: string]: unknown };
  export default value;
}

declare module 'prismjs/prism.js' {
  const Prism: {
    languages: Record<string, unknown>;
    manual?: boolean;
    disableWorkerMessageHandler?: boolean;
    [key: string]: unknown;
  };
  export default Prism;
}
