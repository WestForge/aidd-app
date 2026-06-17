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
}

export interface ChangeSection {
  key: string;
  fileName: string;
  title: string;
  body: string;
  editable: boolean;
}

export interface ChangeReadiness {
  ready: boolean;
  blockers: string[];
}

export interface ChangeDetail extends ChangeRecord {
  sections: ChangeSection[];
  readiness: ChangeReadiness;
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
}

export interface CreateDeliveryPackageFromChangesInput {
  projectPath: string;
  changeIds: string[];
}
