import { dialog, ipcMain } from 'electron';
import { checkpointAndShareProjectAfterSave, withProjectSaveSync } from './saveSync';
import {
  assembleDeliveryPackage,
  createCapability,
  createCapabilityReviewBundle,
  createComponent,
  createComponentReviewBundle,
  createComponentTechnicalChange,
  createComponentTechnicalChangeReviewPackage,
  createComponentTechnicalReviewBundle,
  createChange,
  createChangeFromCapability,
  createChangeFromComponent,
  createChangeFromTechnicalChange,
  createChangeReviewBundle,
  createDecisionRecord,
  createDeliveryPackageFromChanges,
  createDeliveryPackageFromCapability,
  createDeliveryPackageFromTechnicalChange,
  createDeliveryPackagePhase,
  createDeliveryPackageReviewBundle,
  deleteChange,
  deleteCapability,
  deleteComponent,
  deleteDeliveryPackage,
  detectStoredComponentSourceDirectory,
  generateComponentContract,
  importCapabilityReviewPackage,
  importComponentReviewPackage,
  importComponentTechnicalChangeReviewPackage,
  importComponentTechnicalReviewPackage,
  importChangeReviewPackage,
  importDeliveryReviewPackage,
  publishDeliveryPackageToWorkspace,
  readChange,
  readChanges,
  readCapability,
  readComponent,
  readComponentTechnicalChange,
  readDecisions,
  readDeliveryPackage,
  readDeliveryPackages,
  readProjectSetup,
  readRoadmap,
  returnDeliveryPackageToChanges,
  readSourceProjects,
  readSourceReference,
  saveChange,
  saveComponentTechnicalChange,
  saveDeliveryPackage,
  selectComponentSourceDirectory,
  updateCapability,
  updateChangeStatus,
  updateComponent,
  updateComponentTechnicalChangeStatus,
  writeSourceProject,
  writeSourceReference
} from '../domain/aiddProjectService';
import type {
  ComponentSourceDirectoryInput,
  ComponentTechnicalChangeReviewPackageInput,
  ComponentTechnicalReviewPackageInput,
  ChangeReviewPackageInput,
  CreateCapabilityInput,
  CreateChangeFromCapabilityInput,
  CreateChangeFromComponentInput,
  CreateChangeFromTechnicalChangeInput,
  CreateChangeInput,
  CreateDeliveryPackageFromChangesInput,
  CreateComponentInput,
  CreateComponentTechnicalChangeInput,
  CreateDeliveryPackageFromCapabilityInput,
  CreateDeliveryPackageFromTechnicalChangeInput,
  CreateDeliveryPackagePhaseInput,
  DecisionInput,
  DeleteChangeInput,
  DeleteCapabilityInput,
  DeleteComponentInput,
  DeleteDeliveryPackageInput,
  DeliveryReviewPackageInput,
  DeliveryWorkspacePublishInput,
  GenerateComponentContractInput,
  ImportCapabilityReviewPackageInput,
  ImportChangeReviewPackageInput,
  ImportComponentReviewPackageInput,
  ImportComponentTechnicalChangeReviewPackageInput,
  ImportComponentTechnicalReviewPackageInput,
  ImportDeliveryReviewPackageInput,
  PackageCapabilityReviewInput,
  PackageComponentReviewInput,
  ReadChangeInput,
  ReadCapabilityInput,
  ReadComponentInput,
  ReadComponentTechnicalChangeInput,
  ReturnDeliveryPackageToChangesInput,
  SaveComponentTechnicalChangeInput,
  SaveChangeInput,
  SaveDeliveryPackageInput,
  UpdateChangeStatusInput,
  UpdateCapabilityInput,
  UpdateComponentInput,
  UpdateComponentTechnicalChangeStatusInput
} from '../domain/aiddProjectService';

export function registerProjectDomainIpcHandlers() {
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

  ipcMain.handle('project:readChanges', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return readChanges(projectPath);
  });

  ipcMain.handle('project:readChange', async (_event, input: ReadChangeInput) => {
    if (!input?.projectPath || !input?.id) throw new Error('Project path and change id are required.');
    return readChange(input);
  });

  ipcMain.handle('project:createChange', async (_event, input: CreateChangeInput) => {
    if (!input?.projectPath || !input?.title?.trim() || !input?.type) throw new Error('Project path, change title and change type are required.');
    return withProjectSaveSync(input.projectPath, () => createChange(input));
  });

  ipcMain.handle('project:saveChange', async (_event, input: SaveChangeInput) => {
    if (!input?.projectPath || !input?.id) throw new Error('Project path and change id are required.');
    return withProjectSaveSync(input.projectPath, () => saveChange(input));
  });

  ipcMain.handle('project:updateChangeStatus', async (_event, input: UpdateChangeStatusInput) => {
    if (!input?.projectPath || !input?.id || !input?.status) throw new Error('Project path, change id and status are required.');
    return withProjectSaveSync(input.projectPath, () => updateChangeStatus(input));
  });

  ipcMain.handle('project:packageChangeForReview', async (_event, input: ChangeReviewPackageInput) => {
    if (!input?.projectPath || !input?.id) throw new Error('Project path and change id are required.');
    return createChangeReviewBundle(input);
  });

  ipcMain.handle('project:importChangeReviewPackage', async (_event, input: ImportChangeReviewPackageInput) => {
    if (!input?.projectPath || !input?.id || !input?.zipPath) throw new Error('Project path, change id and review response zip path are required.');
    return withProjectSaveSync(input.projectPath, () => importChangeReviewPackage(input));
  });

  ipcMain.handle('project:deleteChange', async (_event, input: DeleteChangeInput) => {
    if (!input?.projectPath || !input?.id) throw new Error('Project path and change id are required.');
    return withProjectSaveSync(input.projectPath, () => deleteChange(input));
  });

  ipcMain.handle('project:readRoadmap', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('Project path is required.');
    return readRoadmap(projectPath);
  });

  ipcMain.handle('project:createChangeFromCapability', async (_event, input: CreateChangeFromCapabilityInput) => {
    if (!input?.projectPath || !input?.capabilitySlug) throw new Error('Project path and capability slug are required.');
    return withProjectSaveSync(input.projectPath, () => createChangeFromCapability(input));
  });

  ipcMain.handle('project:createChangeFromComponent', async (_event, input: CreateChangeFromComponentInput) => {
    if (!input?.projectPath || !input?.componentSlug) throw new Error('Project path and component slug are required.');
    return withProjectSaveSync(input.projectPath, () => createChangeFromComponent(input));
  });

  ipcMain.handle('project:createChangeFromTechnicalChange', async (_event, input: CreateChangeFromTechnicalChangeInput) => {
    if (!input?.projectPath || !input?.componentSlug || !input?.technicalChangeId) throw new Error('Project path, component slug and technical change id are required.');
    return withProjectSaveSync(input.projectPath, () => createChangeFromTechnicalChange(input));
  });

  ipcMain.handle('project:createDeliveryPackageFromCapability', async (_event, input: CreateDeliveryPackageFromCapabilityInput) => {
    if (!input.projectPath || !input.capabilitySlug) throw new Error('Project path and capability slug are required.');
    return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromCapability(input));
  });

  ipcMain.handle('project:createDeliveryPackageFromTechnicalChange', async (_event, input: CreateDeliveryPackageFromTechnicalChangeInput) => {
    if (!input.projectPath || !input.componentSlug || !input.technicalChangeId) throw new Error('Project path, component slug and technical change id are required.');
    return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromTechnicalChange(input));
  });

  ipcMain.handle('project:createDeliveryPackageFromChanges', async (_event, input: CreateDeliveryPackageFromChangesInput) => {
    if (!input?.projectPath || !Array.isArray(input.changeIds) || input.changeIds.length === 0) throw new Error('Project path and at least one change id are required.');
    return withProjectSaveSync(input.projectPath, () => createDeliveryPackageFromChanges(input));
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
  ipcMain.handle('project:returnDeliveryPackageToChanges', async (_event, input: ReturnDeliveryPackageToChangesInput) => {
    return withProjectSaveSync(input.projectPath, () => returnDeliveryPackageToChanges(input));
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
}
