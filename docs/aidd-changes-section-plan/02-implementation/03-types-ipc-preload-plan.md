# Types, IPC, and Preload Plan

## Domain types

Update:

```text
electron/main/domain/types.ts
src/vite-env.d.ts
```

Add:

```ts
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
  source: 'manual' | 'capability' | 'component' | 'component-technical-change' | 'review-import';
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

export interface ChangeDetail extends ChangeRecord {
  sections: ChangeSection[];
  readiness: ChangeReadiness;
}

export interface ChangeReadiness {
  ready: boolean;
  blockers: string[];
}
```

## Input types

Add:

```ts
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

export interface CreateDeliveryPackageFromChangesInput {
  projectPath: string;
  changeIds: string[];
}
```

## IPC handlers

Update:

```text
electron/main/ipc/projectDomainIpc.ts
```

Add handlers:

```ts
project:readChanges
project:readChange
project:createChange
project:saveChange
project:updateChangeStatus
project:deleteChange
project:createChangeFromCapability
project:createChangeFromComponent
project:createChangeFromTechnicalChange
project:createDeliveryPackageFromChanges
```

Use `withProjectSaveSync` for mutating operations.

## Preload API

Update:

```text
electron/preload.ts
```

Add:

```ts
readChanges: (projectPath: string) => ipcRenderer.invoke('project:readChanges', projectPath),
readChange: (input: unknown) => ipcRenderer.invoke('project:readChange', input),
createChange: (input: unknown) => ipcRenderer.invoke('project:createChange', input),
saveChange: (input: unknown) => ipcRenderer.invoke('project:saveChange', input),
updateChangeStatus: (input: unknown) => ipcRenderer.invoke('project:updateChangeStatus', input),
deleteChange: (input: unknown) => ipcRenderer.invoke('project:deleteChange', input),
createChangeFromCapability: (input: unknown) => ipcRenderer.invoke('project:createChangeFromCapability', input),
createChangeFromComponent: (input: unknown) => ipcRenderer.invoke('project:createChangeFromComponent', input),
createChangeFromTechnicalChange: (input: unknown) => ipcRenderer.invoke('project:createChangeFromTechnicalChange', input),
createDeliveryPackageFromChanges: (input: unknown) => ipcRenderer.invoke('project:createDeliveryPackageFromChanges', input),
```

## Service exports

Update:

```text
electron/main/domain/aiddProjectService.ts
```

Export the Change domain functions if this file remains the aggregation point.
