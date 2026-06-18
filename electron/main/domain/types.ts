import type { ZipEntryInput } from '../shared/zip';

export interface NotifyInput {
  title: string;
  body?: string;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  parentLocation: string;
  authorName?: string;
  authorEmail?: string;
  initializeGit?: boolean;
}

export interface SetWorkspaceDirectoryInput {
  projectIdOrPath: string;
  workspacePath: string;
}

export interface TrackedProject {
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

export interface ProjectStatusItem {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
}

export interface ProjectStatus {
  status: 'draft' | 'setting-up' | 'ready-for-planning' | 'ready-for-ai-delivery' | 'active' | 'needs-attention';
  label: string;
  completed: number;
  total: number;
  templateVersion: string;
  gitInitialized: boolean;
  componentCount: number;
  capabilityCount: number;
  bundleCount: number;
  changeCount: number;
  readyChangeCount: number;
  changesInDeliveryCount: number;
  changesInReviewCount: number;
  acceptedChangeCount: number;
  foundation: ProjectStatusItem[];
  setup: ProjectStatusItem[];
  nextAction: string;
}

export interface HomeWorkDeliveryItem {
  id: string;
  title: string;
  status: string;
  sourceCapability?: string;
  components: string[];
  phaseCount: number;
  priority?: number;
  reason: string;
}

export interface HomeWorkCapabilityItem {
  slug: string;
  title: string;
  status: string;
  components: string[];
  incompleteSections: number;
  reason: string;
}

export interface HomeWorkComponentItem {
  slug: string;
  title: string;
  status: string;
  sourceProjects: string[];
  source?: ComponentSourceConfig;
  capabilities: string[];
  reason: string;
}

export interface HomeWork {
  delivery: HomeWorkDeliveryItem[];
  capabilities: HomeWorkCapabilityItem[];
  components: HomeWorkComponentItem[];
  total: number;
}

export type ProjectValidationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface ProjectValidationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  severity: ProjectValidationSeverity;
  path?: string;
  action?: string;
}

export interface ProjectValidationSection {
  id: string;
  title: string;
  items: ProjectValidationItem[];
}

export interface ProjectValidationReport {
  generatedAt: string;
  status: 'pass' | 'warning' | 'fail';
  score: number;
  canCreateDeliveryPackage: boolean;
  summary: { total: number; errors: number; warnings: number; info: number; success: number };
  sections: ProjectValidationSection[];
  nextActions: string[];
}

export interface WorkspacePublishOutput {
  path: string;
  kind: 'agents' | 'doc';
  sourceHash: string;
  outputHash: string;
  status: 'missing' | 'stale' | 'modified' | 'up-to-date';
  message: string;
}

export interface WorkspacePublishWritableFile {
  path: string;
  outputHash: string;
}

export interface WorkspacePublishStatus {
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

export interface WorkspacePublishResult extends WorkspacePublishStatus {
  published: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  createdWritableFiles: string[];
}

export interface WorkspacePublishManifestOutput {
  path: string;
  kind: WorkspacePublishOutput['kind'];
  sourceHash: string;
  outputHash: string;
}

export interface WorkspacePublishManifest {
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

export interface ProjectRepairLogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  stage: string;
  message: string;
  path?: string;
  detail?: string;
}

export interface ProjectTemplateUpgradeReport {
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

export type SetupStepStatus = 'not-started' | 'draft' | 'in-review' | 'active' | 'deprecated' | 'complete' | 'skipped';

export interface WorkflowDocument {
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

export interface SaveWorkflowDocumentInput {
  projectPath: string;
  relativePath: string;
  title: string;
  status: SetupStepStatus;
  body: string;
}

export interface FoundationDocument {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  status: SetupStepStatus;
  required: boolean;
  body: string;
}

export interface StandardSection {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  status: SetupStepStatus;
  required: boolean;
  body: string;
}

export interface ComponentContractInfo {
  path: string;
  version: number;
  sourceHash?: string;
  status: 'blocked' | 'missing' | 'stale' | 'current';
  blockers: string[];
}

export type ComponentSourceDetectionConfidence = 'high' | 'medium' | 'low';

export type ComponentSourcePathMode = 'workspace-relative' | 'absolute';

export interface ComponentSourceDetection {
  suggestedType: string;
  confidence: ComponentSourceDetectionConfidence;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  detectedMarkers: string[];
  packageManager?: string;
  reasons: string[];
}

export interface ComponentSourceConfig {
  directory: string;
  type: string;
  pathMode: ComponentSourcePathMode;
  isInsideWorkspace: boolean;
  absolutePath?: string;
  warning?: string;
  detection?: ComponentSourceDetection | null;
}

export interface ComponentSourceDirectoryInput {
  projectPath: string;
  directory?: string;
  currentDirectory?: string;
}

export interface ComponentSourceDirectorySelection {
  directory: string;
  absolutePath: string;
  pathMode: ComponentSourcePathMode;
  isInsideWorkspace: boolean;
  warning?: string;
  detection: ComponentSourceDetection;
}

export interface ProjectSetupState {
  foundation: FoundationDocument[];
  standards: { status: SetupStepStatus; filePath: string; body: string; profiles: string[]; sections: StandardSection[] };
  components: Array<{ slug: string; title: string; status?: string; sourceProjects?: string[]; source?: ComponentSourceConfig; contract?: ComponentContractInfo }>;
  capabilities: Array<{ slug: string; title: string; status?: string; components?: string[] }>;
  gitInitialized: boolean;
}

export interface SourceCodeProject {
  id: string;
  name: string;
  path: string;
  detectedType: string;
  indicators: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveFoundationInput {
  projectPath: string;
  fileName: string;
  status: SetupStepStatus;
  body: string;
}

export interface PrepareFoundationDragFileInput {
  projectPath: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus;
  body: string;
}

export interface PrepareMarkdownDragFileInput {
  projectPath: string;
  directory?: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus | string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface PrepareComponentContractDragFileInput {
  projectPath: string;
  slug: string;
}

export interface ComponentReviewBundleResult {
  filePath: string;
  fileName: string;
  componentCount: number;
  componentFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

export interface PackageComponentReviewInput {
  projectPath: string;
  slug: string;
}

export interface ImportComponentReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

export interface ComponentReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  componentCount: number;
  importedComponents: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

export type ComponentTechnicalReviewType = 'code' | 'security' | 'architecture' | 'tests' | 'performance' | 'accessibility' | 'dependencies';

export type ComponentTechnicalReviewSourceScope = 'component-source' | 'changed-files' | 'full-source';

export type ComponentTechnicalChangeStatus = 'draft' | 'proposed' | 'needs-review' | 'approved' | 'rejected' | 'superseded' | 'packaged' | 'delivered';

export type ComponentTechnicalChangeSource = 'manual' | 'technical-review';

export type ComponentTechnicalChangeRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface ComponentTechnicalReviewPackageInput {
  projectPath: string;
  slug: string;
  reviewTypes?: ComponentTechnicalReviewType[];
  sourceScope?: ComponentTechnicalReviewSourceScope;
}

export interface ComponentTechnicalReviewPackageResult {
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

export interface ImportComponentTechnicalReviewPackageInput {
  projectPath: string;
  slug: string;
  zipPath: string;
}

export interface CreateComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  title?: string;
  status?: ComponentTechnicalChangeStatus;
  risk?: ComponentTechnicalChangeRisk;
}

export interface UpdateComponentTechnicalChangeStatusInput {
  projectPath: string;
  slug: string;
  id: string;
  status: ComponentTechnicalChangeStatus;
}

export interface ComponentTechnicalChangeSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  editable: boolean;
}

export interface ReadComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
}

export interface SaveComponentTechnicalChangeInput {
  projectPath: string;
  slug: string;
  id: string;
  title?: string;
  status?: ComponentTechnicalChangeStatus;
  risk?: ComponentTechnicalChangeRisk;
  sections?: ComponentTechnicalChangeSection[];
}

export interface ComponentTechnicalChangeDetail extends ComponentTechnicalChangeRecord {
  sections: ComponentTechnicalChangeSection[];
}

export interface ComponentTechnicalChangeReviewPackageInput {
  projectPath: string;
  slug: string;
  id: string;
}

export interface ComponentTechnicalChangeReviewPackageResult {
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

export interface ImportComponentTechnicalChangeReviewPackageInput {
  projectPath: string;
  slug: string;
  id: string;
  zipPath: string;
}

export interface ComponentTechnicalChangeReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  componentSlug: string;
  technicalChangeId: string;
  importedFiles: string[];
  skippedFiles: string[];
  patchCount: number;
}

export interface ComponentTechnicalReviewChangeSummary {
  id: string;
  overviewPath?: string;
  status: string;
  patches: string[];
}

export interface ComponentTechnicalReviewRecord {
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

export interface ComponentTechnicalReviewImportResult {
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

export interface ComponentTechnicalChangeRecord {
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

export interface CapabilityReviewPackageResult {
  filePath: string;
  fileName: string;
  capabilityCount: number;
  capabilityFileCount: number;
  foundationFileCount: number;
  entryCount: number;
}

export interface PackageCapabilityReviewInput {
  projectPath: string;
  slug: string;
}

export interface ImportCapabilityReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

export interface CapabilityReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  capabilityCount: number;
  importedCapabilities: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

export interface FoundationReviewPackageResult {
  filePath: string;
  fileName: string;
  foundationFileCount: number;
  entryCount: number;
}

export interface ImportFoundationReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

export interface ImportFoundationDocumentUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

export interface FoundationReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

export interface ComponentSectionInput {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: SetupStepStatus | string;
  skipReason?: string;
}

export interface CreateComponentInput {
  projectPath: string;
  title: string;
  description?: string;
  status?: SetupStepStatus | 'active' | 'deprecated';
  sourceProjects?: string[];
  source?: Partial<ComponentSourceConfig>;
  capabilities?: string[];
  sections?: ComponentSectionInput[];
}

export interface ReadComponentInput {
  projectPath: string;
  slug: string;
}

export interface DeleteComponentInput {
  projectPath: string;
  slug: string;
}

export interface GenerateComponentContractInput {
  projectPath: string;
  slug: string;
}

export interface UpdateComponentInput {
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

export interface CapabilitySectionInput {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: SetupStepStatus;
}

export interface CreateCapabilityInput {
  projectPath: string;
  title: string;
  description?: string;
  outcome?: string;
  componentSlugs?: string[];
  notes?: string;
  status?: SetupStepStatus;
  inlineComponent?: { title: string; description?: string };
  sections?: CapabilitySectionInput[];
  roadmapHorizon?: RoadmapHorizon | '';
  targetDate?: string;
  estimatedSize?: RoadmapSize | '';
  estimateConfidence?: RoadmapConfidence | '';
  riskLevel?: RoadmapRiskLevel | '';
  reviewBurden?: RoadmapReviewBurden | '';
  suggestedSplit?: boolean;
  estimateReason?: string[];
  unknowns?: string[];
}

export interface ReadCapabilityInput {
  projectPath: string;
  slug: string;
}

export interface UpdateCapabilityInput {
  projectPath: string;
  slug: string;
  title: string;
  description?: string;
  outcome?: string;
  notes?: string;
  status?: SetupStepStatus;
  componentSlugs?: string[];
  sections?: CapabilitySectionInput[];
  roadmapHorizon?: RoadmapHorizon | '';
  targetDate?: string;
  estimatedSize?: RoadmapSize | '';
  estimateConfidence?: RoadmapConfidence | '';
  riskLevel?: RoadmapRiskLevel | '';
  reviewBurden?: RoadmapReviewBurden | '';
  suggestedSplit?: boolean;
  estimateReason?: string[];
  unknowns?: string[];
}

export interface DeleteCapabilityInput {
  projectPath: string;
  slug: string;
}

export type RoadmapHorizon = 'now' | 'next' | 'later' | 'parking-lot';
export type RoadmapSize = 'tiny' | 'small' | 'medium' | 'large' | 'too-large';
export type RoadmapConfidence = 'low' | 'medium' | 'high';
export type RoadmapRiskLevel = 'low' | 'medium' | 'high';
export type RoadmapReviewBurden = 'low' | 'medium' | 'high';
export type RoadmapCourseStatus = 'on-course' | 'tight' | 'at-risk' | 'off-course' | 'unknown';

export interface EntityProvenance {
  lastChangedBy?: string;
  lastChangedEmail?: string;
  lastChangedAt?: string;
  source: 'git' | 'workspace' | 'import' | 'unknown';
}

export interface RoadmapCapabilityProgress {
  totalChanges: number;
  acceptedChanges: number;
  openChanges: number;
  readyChanges: number;
  inDeliveryChanges: number;
  inReviewChanges: number;
  deliveryPackageCount: number;
}

export interface RoadmapCapabilityCourse {
  status: RoadmapCourseStatus;
  reasons: string[];
  suggestedActions: string[];
}

export interface RoadmapCapability {
  slug: string;
  title: string;
  status: string;
  components: string[];
  roadmapHorizon?: RoadmapHorizon;
  targetDate?: string;
  estimatedSize?: RoadmapSize;
  estimateConfidence?: RoadmapConfidence;
  riskLevel?: RoadmapRiskLevel;
  reviewBurden?: RoadmapReviewBurden;
  suggestedSplit?: boolean;
  estimateReason: string[];
  unknowns: string[];
  provenance: EntityProvenance;
  progress: RoadmapCapabilityProgress;
  course: RoadmapCapabilityCourse;
}

export interface RoadmapSizeBucket {
  size: RoadmapSize;
  label: string;
  count: number;
}

export interface RoadmapPressureMonth {
  month: string;
  capabilityCount: number;
  largeOrTooLargeCount: number;
  atRiskCount: number;
  lowConfidenceCount: number;
}

export interface RoadmapReport {
  generatedAt: string;
  overallStatus: RoadmapCourseStatus;
  summary: {
    capabilityCount: number;
    targetedCapabilityCount: number;
    largeOrTooLargeCount: number;
    lowConfidenceCount: number;
    noLinkedChangeCount: number;
    offCourseCount: number;
    atRiskCount: number;
    tightCount: number;
    onCourseCount: number;
    unknownCount: number;
  };
  summaryReasons: string[];
  suggestedActions: string[];
  sizeBuckets: RoadmapSizeBucket[];
  pressureByTargetMonth: RoadmapPressureMonth[];
  capabilities: RoadmapCapability[];
}

export type ChangeType =
  | 'implement-capability'
  | 'update-capability'
  | 'component-change'
  | 'technical-refactor'
  | 'bug-fix'
  | 'ux-improvement'
  | 'documentation-standards-change'
  | 'spike-investigation';

export type ChangeStatus =
  | 'draft'
  | 'ready'
  | 'in-delivery'
  | 'in-review'
  | 'accepted'
  | 'rejected'
  | 'superseded';

export type ChangePriority = 'low' | 'normal' | 'high' | 'urgent';
export type ChangeRisk = 'low' | 'medium' | 'high' | 'unknown';
export type ChangeSource = 'manual' | 'capability' | 'component' | 'component-technical-change' | 'review-import';

export interface ChangeStatusHistoryEntry {
  status: ChangeStatus;
  changedAt: string;
}

export interface ChangeReadiness {
  ready: boolean;
  blockers: string[];
}

export interface ChangeSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  editable: boolean;
}

export interface ChangePlanPhase {
  id: string;
  title: string;
  status: string;
  fileName: string;
  body: string;
}

export interface ChangeRecord {
  id: string;
  title: string;
  type: ChangeType;
  status: ChangeStatus;
  priority: ChangePriority;
  risk: ChangeRisk;
  linkedCapabilities: string[];
  linkedComponents: string[];
  deliveryPackageIds: string[];
  source: ChangeSource;
  legacyTechnicalChange?: {
    componentSlug: string;
    technicalChangeId: string;
  } | null;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
  targetDate?: string;
  size?: RoadmapSize;
  blocked: boolean;
  blockedReason?: string;
  dependsOnChangeIds: string[];
  statusHistory: ChangeStatusHistoryEntry[];
}

export interface ChangeDetail extends ChangeRecord {
  sections: ChangeSection[];
  strategyBody: string;
  phases: ChangePlanPhase[];
  readiness: ChangeReadiness;
}

export interface ChangeReviewPackageInput {
  projectPath: string;
  id: string;
}

export interface ChangeReviewPackageResult {
  filePath: string;
  fileName: string;
  changeId: string;
  changeFileCount: number;
  capabilityFileCount: number;
  componentFileCount: number;
  standardsFileCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  templateFileCount: number;
  entryCount: number;
  warnings: string[];
}

export interface ImportChangeReviewPackageInput {
  projectPath: string;
  id: string;
  zipPath: string;
}

export interface ChangeReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  changeId: string;
  importedFiles: string[];
  skippedFiles: string[];
  backedUpFiles: string[];
  backupDirectory?: string;
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

export interface CreateChangeInput {
  projectPath: string;
  title: string;
  type: ChangeType;
  status?: ChangeStatus;
  priority?: ChangePriority;
  risk?: ChangeRisk;
  linkedCapabilities?: string[];
  linkedComponents?: string[];
  source?: ChangeSource;
  legacyTechnicalChange?: {
    componentSlug: string;
    technicalChangeId: string;
  } | null;
  sections?: ChangeSection[];
  strategyBody?: string;
  phases?: ChangePlanPhase[];
  targetDate?: string;
  size?: RoadmapSize;
  blocked?: boolean;
  blockedReason?: string;
  dependsOnChangeIds?: string[];
  statusHistory?: ChangeStatusHistoryEntry[];
}

export interface ReadChangeInput {
  projectPath: string;
  id: string;
}

export interface SaveChangeInput {
  projectPath: string;
  id: string;
  title?: string;
  type?: ChangeType;
  status?: ChangeStatus;
  priority?: ChangePriority;
  risk?: ChangeRisk;
  linkedCapabilities?: string[];
  linkedComponents?: string[];
  sections?: ChangeSection[];
  strategyBody?: string;
  phases?: ChangePlanPhase[];
  targetDate?: string;
  size?: RoadmapSize;
  blocked?: boolean;
  blockedReason?: string;
  dependsOnChangeIds?: string[];
  statusHistory?: ChangeStatusHistoryEntry[];
}

export interface UpdateChangeStatusInput {
  projectPath: string;
  id: string;
  status: ChangeStatus;
}

export interface DeleteChangeInput {
  projectPath: string;
  id: string;
}

export interface CreateChangeFromCapabilityInput {
  projectPath: string;
  capabilitySlug: string;
  type?: Extract<ChangeType, 'implement-capability' | 'update-capability'>;
}

export interface CreateChangeFromComponentInput {
  projectPath: string;
  componentSlug: string;
  type?: Extract<ChangeType, 'component-change' | 'technical-refactor' | 'bug-fix' | 'ux-improvement'>;
}

export interface CreateChangeFromTechnicalChangeInput {
  projectPath: string;
  componentSlug: string;
  technicalChangeId: string;
}

export interface CreateDeliveryPackageFromCapabilityInput {
  projectPath: string;
  capabilitySlug: string;
}

export interface CreateDeliveryPackageFromTechnicalChangeInput {
  projectPath: string;
  componentSlug: string;
  technicalChangeId: string;
}

export interface CreateDeliveryPackageFromChangesInput {
  projectPath: string;
  changeIds: string[];
  publishToWorkspace?: boolean;
}

export type DeliveryPackageType = 'capability' | 'technical' | 'change';

export interface DeliveryPackageSummary {
  id: string;
  title: string;
  packageType?: DeliveryPackageType;
  status: string;
  changeIds?: string[];
  sourceCapabilities?: string[];
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

export interface DeliveryWorkspacePublishInput {
  projectPath: string;
  packageId: string;
}

export interface DeliveryWorkspacePublishResult {
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

export interface DeliveryReviewPackageInput {
  projectPath: string;
  packageId: string;
}

export interface DeliveryReviewPackageResult {
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

export interface ImportDeliveryReviewPackageInput {
  projectPath: string;
  packageId: string;
  zipPath: string;
}

export interface DeliveryReviewPackageImportResult {
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

export interface DeleteDeliveryPackageInput {
  projectPath: string;
  id: string;
}

export interface ReturnDeliveryPackageToChangesInput {
  projectPath: string;
  packageId: string;
  removeWorkspacePackage?: boolean;
}

export interface ReturnDeliveryPackageToChangesResult {
  packageId: string;
  changeIds: string[];
  removedPackagePath: string;
  removedWorkspacePath?: string;
  deliveryPackages: DeliveryPackageSummary[];
  message: string;
}

export interface DeliveryPackagePhaseDetail {
  id: string;
  title: string;
  status: string;
  fileName: string;
  body: string;
}

export interface DeliveryPackageTechnicalChangeSummary {
  id: string;
  title: string;
  componentSlug: string;
  status: string;
  risk: string;
  patchCount: number;
  relativePath?: string;
}

export interface DeliveryPackageFileDetail {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  extension?: string;
  editable: boolean;
}

export interface DeliveryPackageDetail extends DeliveryPackageSummary {
  packagePath: string;
  snapshotBody: string;
  strategyBody: string;
  packagedBody: string;
  phases: DeliveryPackagePhaseDetail[];
  files: DeliveryPackageFileDetail[];
}

export interface SaveDeliveryPackageInput {
  projectPath: string;
  id: string;
  status?: string;
  title?: string;
  strategyBody?: string;
  snapshotBody?: string;
  phases?: DeliveryPackagePhaseDetail[];
}

export interface CreateDeliveryPackagePhaseInput {
  projectPath: string;
  packageId: string;
  title: string;
  body?: string;
}

export interface DefineStandardsInput {
  projectPath: string;
  body: string;
  status: SetupStepStatus;
}

export interface SaveStandardSectionInput {
  projectPath: string;
  fileName: string;
  status: SetupStepStatus;
  body: string;
}

export interface PrepareStandardSectionDragFileInput {
  projectPath: string;
  fileName: string;
  title?: string;
  status?: SetupStepStatus;
  body: string;
}

export interface StandardsReviewPackageResult {
  filePath: string;
  fileName: string;
  standardsFileCount: number;
  entryCount: number;
}

export interface ImportStandardsReviewPackageInput {
  projectPath: string;
  zipPath: string;
}

export interface ImportStandardSectionUpdateInput {
  projectPath: string;
  fileName: string;
  updateFilePath: string;
}

export interface StandardsReviewPackageImportResult {
  accepted: boolean;
  zipPath: string;
  importedFiles: string[];
  skippedFiles: string[];
  reviewIncluded: boolean;
  reviewMarkdown?: string;
}

export interface HealthEntity {
  kind: 'component' | 'capability' | 'change' | 'source-project' | 'delivery-package';
  rootDir: string;
  folder: string;
  manifestName: string;
  relativePath: string;
  data: any;
  slug: string;
  title: string;
}

export interface ProjectRepairReport {
  generatedAt: string;
  changed: boolean;
  changes: string[];
  warnings: string[];
  logs: ProjectRepairLogEntry[];
  logPath?: string;
  validation: ProjectValidationReport;
}

export type ComponentContractStatus = ComponentContractInfo['status'];

export interface DeliveryReviewSourceRoot {
  absolutePath: string;
  configuredDirectory: string;
  isInsideWorkspace: boolean;
  componentSlugs: string[];
  componentTitles: string[];
  packagePrefix: string;
}

export interface DeliveryReviewCollectedSource {
  entries: ZipEntryInput[];
  workspacePath: string;
  roots: DeliveryReviewSourceRoot[];
  skippedNestedRoots: Array<{ configuredDirectory: string; absolutePath: string; coveredBy: string; componentSlugs: string[] }>;
  includedFiles: string[];
  warnings: string[];
}

export interface DecisionInput {
  projectPath: string;
  title: string;
  context?: string;
  decision?: string;
  consequences?: string;
  status?: string;
}
