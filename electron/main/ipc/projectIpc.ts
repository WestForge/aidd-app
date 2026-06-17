import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { requireGitIdentity } from '../../services/gitIdentityStore';
import {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  buildFoundationMarkdown,
  copyDir,
  evaluateWorkspacePublishStatus,
  exists,
  initialiseGit,
  packageName,
  publishWorkspaceDocs,
  readHomeWork,
  readJson,
  readProjectStatus,
  readProjects,
  repairProject,
  replaceInTree,
  sameDiskPath,
  slugify,
  templatePath,
  updateTrackedProject,
  upgradeProjectTemplates,
  validateProject,
  writeJson,
  writeProjects
} from '../domain/aiddProjectService';
import type {
  CreateProjectInput,
  SetWorkspaceDirectoryInput,
  TrackedProject
} from '../domain/aiddProjectService';

export function registerProjectIpcHandlers() {
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
}
