// Draft additions for window.aidd / preload / vite-env.

interface AiddApiChangeAdditions {
  readChanges: (projectPath: string) => Promise<AiddChangeRecord[]>;
  readChange: (input: { projectPath: string; id: string }) => Promise<AiddChangeDetail>;
  createChange: (input: AiddCreateChangeInput) => Promise<AiddChangeDetail>;
  saveChange: (input: AiddSaveChangeInput) => Promise<AiddChangeDetail>;
  updateChangeStatus: (input: { projectPath: string; id: string; status: AiddChangeStatus }) => Promise<AiddChangeRecord[]>;
  deleteChange: (input: { projectPath: string; id: string }) => Promise<AiddChangeRecord[]>;
  createChangeFromCapability: (input: { projectPath: string; capabilitySlug: string; type?: 'implement-capability' | 'update-capability' }) => Promise<AiddChangeDetail>;
  createChangeFromComponent: (input: { projectPath: string; componentSlug: string; type?: AiddChangeType }) => Promise<AiddChangeDetail>;
  createChangeFromTechnicalChange: (input: { projectPath: string; componentSlug: string; technicalChangeId: string }) => Promise<AiddChangeDetail>;
  createDeliveryPackageFromChanges: (input: { projectPath: string; changeIds: string[] }) => Promise<{ id: string; path: string }>;
}
