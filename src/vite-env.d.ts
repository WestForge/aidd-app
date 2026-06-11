/// <reference types="vite/client" />

interface AiddProjectCreateInput {
  name: string;
  description: string;
  parentLocation: string;
  initializeGit: boolean;
}

interface AiddNotifyInput {
  title: string;
  body?: string;
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

interface AiddProjectRepairReport {
  generatedAt: string;
  changed: boolean;
  changes: string[];
  warnings: string[];
  validation: AiddProjectValidationReport;
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

interface AiddComponentSummary {
  slug: string;
  title: string;
  status?: string;
  sourceProjects?: string[];
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

interface AiddCreateComponentInput {
  projectPath: string;
  title: string;
  description?: string;
  status?: AiddSetupStatus;
  sourceProjects?: string[];
  capabilities?: string[];
}

interface AiddComponentDetail {
  slug: string;
  title: string;
  status: AiddSetupStatus | string;
  sourceProjects: string[];
  capabilities: string[];
  description: string;
  filePath: string;
}

interface AiddReadComponentInput {
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
  capabilities?: string[];
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

interface AiddDeliveryPackageDetail extends AiddDeliveryPackageSummary {
  packagePath: string;
  snapshotBody: string;
  strategyBody: string;
  packagedBody: string;
  phases: AiddDeliveryPackagePhase[];
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

interface Window {
  aidd: {
    notify: (input: AiddNotifyInput) => Promise<boolean>;
    showItemInFolder: (filePath: string) => Promise<boolean>;
    selectProjectFolder: () => Promise<string | null>;
    listProjects: () => Promise<AiddTrackedProject[]>;
    forgetProject: (projectId: string) => Promise<AiddTrackedProject[]>;
    readProjectStatus: (projectPath: string) => Promise<AiddProjectStatus>;
    validateProject: (projectPath: string) => Promise<AiddProjectValidationReport>;
    repairProject: (projectPath: string) => Promise<AiddProjectRepairReport>;
    readProjectSetup: (projectPath: string) => Promise<AiddProjectSetupState>;
    prepareFoundationReviewPackage: (projectPath: string) => Promise<{ filePath: string; fileName: string }>;
    readWorkflowDocuments: (projectPath: string) => Promise<AiddWorkflowDocument[]>;
    saveWorkflowDocument: (input: AiddSaveWorkflowDocumentInput) => Promise<AiddWorkflowDocument[]>;
    saveFoundationDocument: (input: AiddSaveFoundationInput) => Promise<AiddProjectSetupState>;
    defineStandards: (input: AiddDefineStandardsInput) => Promise<AiddProjectSetupState>;
    createComponent: (input: AiddCreateComponentInput) => Promise<AiddProjectSetupState>;
    readComponent: (input: AiddReadComponentInput) => Promise<AiddComponentDetail>;
    updateComponent: (input: AiddUpdateComponentInput) => Promise<AiddProjectSetupState>;
    createCapability: (input: AiddCreateCapabilityInput) => Promise<AiddProjectSetupState>;
    readCapability: (input: AiddReadCapabilityInput) => Promise<AiddCapabilityDetail>;
    updateCapability: (input: AiddUpdateCapabilityInput) => Promise<AiddProjectSetupState>;
    createDeliveryPackageFromCapability: (input: { projectPath: string; capabilitySlug: string }) => Promise<{ id: string; path: string }>;
    readDeliveryPackages: (projectPath: string) => Promise<AiddDeliveryPackageSummary[]>;
    reorderDeliveryPackage: (input: { projectPath: string; id: string; direction: 'up' | 'down' }) => Promise<AiddDeliveryPackageSummary[]>;
    readDeliveryPackage: (input: { projectPath: string; id: string }) => Promise<AiddDeliveryPackageDetail>;
    saveDeliveryPackage: (input: { projectPath: string; id: string; status?: string; strategyBody?: string; phases?: AiddDeliveryPackagePhase[] }) => Promise<AiddDeliveryPackageDetail>;
    createDeliveryPackagePhase: (input: { projectPath: string; packageId: string; title: string }) => Promise<AiddDeliveryPackageDetail>;
    assembleDeliveryPackage: (input: { projectPath: string; packageId: string }) => Promise<AiddDeliveryPackageDetail>;
    readSourceReference: (projectPath: string) => Promise<AiddSourceReference | null>;
    readSourceProjects: (projectPath: string) => Promise<AiddSourceCodeProject[]>;
    addSourceProject: (projectPath: string) => Promise<AiddSourceCodeProject | null>;
    selectSourceDirectory: (projectPath: string) => Promise<AiddSourceReference | null>;
    createProject: (input: AiddProjectCreateInput) => Promise<AiddTrackedProject>;
    openExistingProject: () => Promise<AiddTrackedProject | null>;
    readText: (filePath: string) => Promise<string>;
    writeText: (filePath: string, content: string) => Promise<boolean>;
  };
}
