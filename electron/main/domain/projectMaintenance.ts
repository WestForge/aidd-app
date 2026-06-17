import matter from '../../frontmatter';
import { readGitIdentity } from '../../services/gitIdentityStore';
import { app } from 'electron';
import git from 'isomorphic-git';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CAPABILITY_LEGACY_SECTION_FILES, CAPABILITY_TEMPLATE_SECTIONS } from './capabilityCore';
import { readCapability, updateCapability } from './capabilityReview';
import { COMPONENT_TEMPLATE_SECTIONS } from './componentCore';
import { readComponent, updateComponent } from './componentReview';
import { normaliseTechnicalChangeRecord } from './componentTechnicalChanges';
import { deliveryTechnicalChangeSummary, normaliseDeliveryPackageTechnicalChanges } from './delivery';
import { OBSOLETE_CAPABILITY_SECTION_FILES, OBSOLETE_COMPONENT_SECTION_FILES, TEMPLATE_ID, TEMPLATE_VERSION, exists, isObsoleteTemplateFile, projectsStorePath, readEntities, readJson, readProjects, resolveTemplatePath, slugify, writeJson, writeProjects } from './projectCore';
import { normalizeSetupStatus } from './projectStatus';
import { collectProjectMarkdownFiles, collectRelativeFiles, listEntityFolders, normaliseRelativePath, parseMarkdownSafe, pushValidation, readJsonSafe, validateProject } from './projectValidation';
import { STANDARD_SECTION_DEFINITIONS } from './standards';
import type { DeliveryPackageTechnicalChangeSummary, DeliveryPackageType, ProjectRepairLogEntry, ProjectRepairReport, ProjectTemplateUpgradeReport, ProjectValidationReport, ProjectValidationSection, SetupStepStatus } from './types';

export function pushRepairLog(
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

export function formatRepairLogEntry(entry: ProjectRepairLogEntry) {
  const parts = [`[${entry.timestamp}]`, entry.level.toUpperCase(), entry.stage, '-', entry.message];
  if (entry.path) parts.push(`(${entry.path})`);
  if (entry.detail) parts.push(`— ${entry.detail}`);
  return parts.join(' ');
}

export async function writeRepairLogFile(
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

export function isGitMatrixRowChanged(row: Awaited<ReturnType<typeof git.statusMatrix>>[number]) {
  const [, head, workdir, stage] = row;
  return head !== workdir || workdir !== stage;
}

export function shouldSkipGitCheckpointPath(filePath: string) {
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

export async function listProjectGitChanges(projectPath: string) {
  if (!(await exists(path.join(projectPath, '.git')))) return [];
  const matrix = await git.statusMatrix({ fs, dir: projectPath });
  return matrix.filter((row) => isGitMatrixRowChanged(row)).filter(([filePath]) => !shouldSkipGitCheckpointPath(filePath));
}

export async function validateGitWorkingTree(projectPath: string, section: ProjectValidationSection) {
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

export async function getProjectGitAuthor(projectPath: string) {
  const saved = await readGitIdentity(app.getPath('userData'));
  if (saved) return { name: saved.authorName, email: saved.authorEmail };

  const name = await git.getConfig({ fs, dir: projectPath, path: 'user.name' });
  const email = await git.getConfig({ fs, dir: projectPath, path: 'user.email' });
  if (typeof name === 'string' && typeof email === 'string' && name.trim() && email.trim()) {
    return { name: name.trim(), email: email.trim() };
  }

  throw new Error('AIDD author identity is required before the template upgrade can create Git commits. Set it in Settings first.');
}

export async function commitProjectChanges(projectPath: string, message: string, author: { name: string; email: string }) {
  const changed = await listProjectGitChanges(projectPath);
  if (changed.length === 0) return { created: false, changedFiles: [] as string[], oid: undefined as string | undefined };

  for (const [filePath, _head, workdir] of changed) {
    if (workdir === 0) await git.remove({ fs, dir: projectPath, filepath: filePath });
    else await git.add({ fs, dir: projectPath, filepath: filePath });
  }

  const oid = await git.commit({ fs, dir: projectPath, message, author });
  return { created: true, changedFiles: changed.map(([filePath]) => filePath), oid };
}

export async function syncBundledTemplateFiles(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], stamp: string) {
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

export async function upgradeMarkdownFrontmatterVersions(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], now: string) {
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

export async function upgradeTemplateManifest(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[], now: string) {
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

export async function upgradeProjectTemplates(projectPath: string): Promise<ProjectTemplateUpgradeReport> {
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

export function hasWorkflowFrontmatter(content: string) {
  return content.startsWith('---\n') || content.startsWith('---\r\n');
}

export function contentLooksComplete(content: string) {
  const stripped = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
  if (!stripped) return false;
  if (/TODO:/i.test(stripped)) return false;
  if (/^#\s+.+\n\s*$/m.test(stripped) && stripped.split(/\r?\n/).length <= 3) return false;
  return true;
}

export function buildWorkflowMarkdown(type: string, id: string, title: string, status: SetupStepStatus, body: string, required = true) {
  return `---\naidd:\n  type: ${type}\n  id: ${id}\n  title: ${title}\n  status: ${status}\n  required: ${required}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${body.trim()}\n`;
}

export function logValidationIssues(logs: ProjectRepairLogEntry[], validation: ProjectValidationReport, stage: string) {
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

export async function archiveObsoleteEntitySectionFiles(
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

export function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || slug;
}

export function firstMarkdownHeading(content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

export async function readEntityIndexMetadata(projectPath: string, rootDir: string, folder: string) {
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

export async function capabilitySlugsReferencingComponent(projectPath: string, componentSlug: string) {
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

export async function ensureComponentManifestForFolder(projectPath: string, folder: string, changes: string[], logs: ProjectRepairLogEntry[]) {
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

export function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function firstStringArray(...values: unknown[]) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }
  return [] as string[];
}

export async function readCapabilityRepairMetadata(projectPath: string, folder: string) {
  const dir = path.join(projectPath, 'capabilities', folder);
  const titleCandidates: string[] = [];
  const components = new Set<string>();
  let status: SetupStepStatus = 'draft';

  async function readMarkdownMetadata(fileName: string) {
    const filePath = path.join(dir, fileName);
    if (!(await exists(filePath))) return;
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    const data = (parsed.ok ? (parsed.parsed.data || {}) : {}) as any;
    const aidd = data.aidd || {};

    for (const candidate of [aidd.title, data.title, firstMarkdownHeading(raw)]) {
      const title = String(candidate || '').trim();
      if (title) titleCandidates.push(title);
    }

    for (const component of firstStringArray(aidd.components, data.components, aidd.modules, data.modules)) {
      components.add(component);
    }

    const candidateStatus = normalizeSetupStatus(aidd.status || data.status);
    if (candidateStatus !== 'not-started') status = candidateStatus;
    else if (contentLooksComplete(raw)) status = strongestStatus(status, 'complete');
  }

  await readMarkdownMetadata('index.md');
  for (const template of CAPABILITY_TEMPLATE_SECTIONS) {
    await readMarkdownMetadata(template.fileName);
    for (const legacyFileName of CAPABILITY_LEGACY_SECTION_FILES[template.key] || []) {
      await readMarkdownMetadata(legacyFileName);
    }
  }

  const rawTitle = titleCandidates.find((candidate) => candidate.trim()) || titleFromSlug(folder);
  const title = rawTitle
    .replace(/\s+(Outcomes|Scope|User Journeys|Functional Requirements|Quality Requirements|UX\/UI|Risks|Validation)$/i, '')
    .trim() || titleFromSlug(folder);

  return { title, status, components: Array.from(components) };
}

export async function ensureCapabilityManifestForFolder(projectPath: string, folder: string, changes: string[], logs: ProjectRepairLogEntry[]) {
  const manifestPath = path.join(projectPath, 'capabilities', folder, 'capability.json');
  if (await exists(manifestPath)) return false;

  const metadata = await readCapabilityRepairMetadata(projectPath, folder);
  await writeJson(manifestPath, {
    slug: folder,
    title: metadata.title,
    status: metadata.status,
    components: metadata.components,
    createdAt: new Date().toISOString(),
    repairedAt: new Date().toISOString(),
    template: {
      id: TEMPLATE_ID,
      version: TEMPLATE_VERSION,
      sectionFiles: CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName)
    }
  });
  changes.push(`Rebuilt missing capability manifest for capabilities/${folder}`);
  pushRepairLog(logs, 'success', 'entity-repair', 'Rebuilt missing capability manifest.', {
    path: `capabilities/${folder}/capability.json`,
    detail: `Title: ${metadata.title}; components: ${metadata.components.length ? metadata.components.join(', ') : 'none'}`
  });
  return true;
}

export function titleFromDeliveryPackageFolder(folder: string) {
  const withoutDeliveryPrefix = folder.replace(/^DP-\d{1,5}-/i, '').replace(/^\d{1,5}[-_]+/, '');
  return titleFromSlug(withoutDeliveryPrefix || folder);
}

export function cleanDeliveryPackageTitle(value: unknown) {
  const title = String(value || '')
    .trim()
    .replace(/^Delivery Package Snapshot:\s*/i, '')
    .replace(/^Technical Delivery Snapshot:\s*/i, '')
    .replace(/^Delivery Package:\s*/i, '')
    .replace(/^Package:\s*/i, '');

  if (!title || /^Implementation Strategy$/i.test(title) || /^Context Snapshot$/i.test(title)) return '';
  return title;
}

export function normaliseDeliveryPackageTypeForRepair(value: unknown): DeliveryPackageType | undefined {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return undefined;
  if (text.includes('technical')) return 'technical';
  if (text.includes('capability') || text.includes('delivery')) return 'capability';
  return undefined;
}

export function normaliseDeliveryStatusForRepair(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (!status || status === 'draft' || status === 'not-started') return 'packaging';
  if (status === 'approved' || status === 'approved-for-ai') return 'approved';
  if (status === 'in-progress' || status === 'in-ai-execution' || status === 'active') return 'in-progress';
  if (status === 'done' || status === 'complete' || status === 'accepted' || status === 'delivered') return 'done';
  if (status === 'review' || status === 'in-review' || status === 'needs-review' || status === 'needs-verification' || status === 'changes-requested' || status === 'packaging') return 'packaging';
  return 'packaging';
}

export function deliverySourceTechnicalChangeFrom(value: any) {
  if (!value || typeof value !== 'object') return undefined;
  const componentSlug = firstNonEmptyString(value.componentSlug, value.component, value.componentId);
  const technicalChangeId = firstNonEmptyString(value.technicalChangeId, value.id, value.changeId);
  const title = firstNonEmptyString(value.title, technicalChangeId);
  if (!componentSlug && !technicalChangeId) return undefined;
  return { componentSlug, technicalChangeId, title };
}

export async function readDeliveryPackageRepairMarkdownMetadata(filePath: string, allowHeadingTitle: boolean) {
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = parseMarkdownSafe(raw);
  const data = (parsed.ok ? (parsed.parsed.data || {}) : {}) as any;
  const aidd = data.aidd || {};
  const heading = allowHeadingTitle ? firstMarkdownHeading(raw) : '';

  return {
    title: cleanDeliveryPackageTitle(firstNonEmptyString(data.title, data.name, aidd.title, heading)),
    status: firstNonEmptyString(data.status, aidd.status),
    packageType: normaliseDeliveryPackageTypeForRepair(firstNonEmptyString(data.packageType, aidd.packageType, data.type, aidd.type)),
    sourceCapability: firstNonEmptyString(data.sourceCapability, data.capability, data.capabilitySlug, aidd.sourceCapability, aidd.capability, aidd.capabilitySlug),
    sourceTechnicalChange: deliverySourceTechnicalChangeFrom(data.sourceTechnicalChange || aidd.sourceTechnicalChange),
    components: firstStringArray(data.components, data.modules, aidd.components, aidd.modules),
    createdAt: firstNonEmptyString(data.createdAt, aidd.createdAt),
    updatedAt: firstNonEmptyString(data.updatedAt, aidd.updatedAt),
    parsedOk: parsed.ok,
    parseError: parsed.ok ? '' : parsed.error
  };
}

export type DeliveryPackageRepairMarkdownMetadata = Awaited<ReturnType<typeof readDeliveryPackageRepairMarkdownMetadata>> & { fileName: string };

export async function readPackagedTechnicalChangeSummaries(projectPath: string, packageDir: string) {
  const root = path.join(packageDir, 'technical-changes');
  if (!(await exists(root))) return [] as DeliveryPackageTechnicalChangeSummary[];

  const summaries: DeliveryPackageTechnicalChangeSummary[] = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const changeDir = path.join(root, entry.name);
    const metadataPath = path.join(changeDir, 'technical-change.json');
    if (!(await exists(metadataPath))) continue;
    const raw = await readJsonSafe<any>(metadataPath);
    if (!raw.ok) continue;
    const componentSlug = firstNonEmptyString(raw.data?.componentSlug);
    const record = normaliseTechnicalChangeRecord(raw.data, projectPath, componentSlug, changeDir);
    summaries.push({
      ...deliveryTechnicalChangeSummary(record, normaliseRelativePath(path.relative(packageDir, changeDir))),
      status: record.status === 'packaged' ? 'approved' : record.status
    });
  }

  return summaries;
}

export async function ensureDeliveryPackageManifestForFolder(
  projectPath: string,
  folder: string,
  changes: string[],
  warnings: string[],
  logs: ProjectRepairLogEntry[]
) {
  const packageDir = path.join(projectPath, 'delivery', 'packages', folder);
  const manifestPath = path.join(packageDir, 'package.json');
  if (await exists(manifestPath)) return false;

  const now = new Date().toISOString();
  const legacyManifestPath = path.join(packageDir, 'bundle.json');
  let legacy: any = {};
  let legacyRead = false;
  if (await exists(legacyManifestPath)) {
    const result = await readJsonSafe<any>(legacyManifestPath);
    if (result.ok) {
      legacy = result.data || {};
      legacyRead = true;
    } else {
      const message = `delivery/packages/${folder}/bundle.json could not be parsed while rebuilding package.json: ${result.error}`;
      warnings.push(message);
      pushRepairLog(logs, 'warning', 'delivery-repair', message, { path: `delivery/packages/${folder}/bundle.json` });
    }
  }

  const markdownMetadata: DeliveryPackageRepairMarkdownMetadata[] = [];
  for (const fileName of ['snapshot.md', 'delivery-package.md', 'package.md', 'bundle.md', 'README.md', 'implementation-strategy.md']) {
    const filePath = path.join(packageDir, fileName);
    if (!(await exists(filePath))) continue;
    const metadata = await readDeliveryPackageRepairMarkdownMetadata(filePath, fileName !== 'implementation-strategy.md');
    markdownMetadata.push({ fileName, ...metadata });
    if (!metadata.parsedOk) {
      pushRepairLog(logs, 'warning', 'delivery-repair', 'Could not parse delivery package Markdown front matter while inferring manifest.', {
        path: `delivery/packages/${folder}/${fileName}`,
        detail: metadata.parseError
      });
    }
  }

  const firstMarkdown = <K extends keyof Awaited<ReturnType<typeof readDeliveryPackageRepairMarkdownMetadata>>>(key: K) => {
    for (const metadata of markdownMetadata) {
      const value = metadata[key];
      if (Array.isArray(value)) {
        if (value.length) return value;
      } else if (value) {
        return value;
      }
    }
    return undefined;
  };

  const technicalChanges = normaliseDeliveryPackageTechnicalChanges(legacy.technicalChanges);
  if (!technicalChanges.length) {
    technicalChanges.push(...await readPackagedTechnicalChangeSummaries(projectPath, packageDir));
  }

  const sourceTechnicalChange = deliverySourceTechnicalChangeFrom(legacy.sourceTechnicalChange)
    || firstMarkdown('sourceTechnicalChange')
    || (technicalChanges.length === 1
      ? {
          componentSlug: technicalChanges[0].componentSlug,
          technicalChangeId: technicalChanges[0].id,
          title: technicalChanges[0].title
        }
      : undefined);

  const components = Array.from(new Set([
    ...firstStringArray(legacy.components, legacy.modules),
    ...((firstMarkdown('components') as string[] | undefined) || []),
    ...(sourceTechnicalChange?.componentSlug ? [sourceTechnicalChange.componentSlug] : []),
    ...technicalChanges.map((change) => change.componentSlug).filter(Boolean)
  ]));

  const stat = await fsp.stat(packageDir);
  const legacyId = firstNonEmptyString(legacy.id, legacy.slug);
  const sourceCapability = firstNonEmptyString(
    legacy.sourceCapability,
    legacy.capability,
    legacy.capabilitySlug,
    firstMarkdown('sourceCapability')
  );
  const markdownPackageType = firstMarkdown('packageType') as DeliveryPackageType | undefined;
  const packageType = normaliseDeliveryPackageTypeForRepair(legacy.packageType || legacy.type)
    || markdownPackageType
    || (sourceTechnicalChange || technicalChanges.length || await exists(path.join(packageDir, 'technical-changes')) ? 'technical' : 'capability');

  const manifest: Record<string, unknown> = {
    id: folder,
    title: cleanDeliveryPackageTitle(firstNonEmptyString(legacy.title, legacy.name, firstMarkdown('title'))) || titleFromDeliveryPackageFolder(folder),
    packageType,
    status: normaliseDeliveryStatusForRepair(firstNonEmptyString(legacy.status, firstMarkdown('status'))),
    components,
    createdAt: firstNonEmptyString(legacy.createdAt, firstMarkdown('createdAt'), stat.birthtime?.toISOString(), now),
    repairedAt: now
  };

  if (legacyId && legacyId !== folder) manifest.legacyId = legacyId;
  if (sourceCapability) manifest.sourceCapability = sourceCapability;
  if (sourceTechnicalChange) manifest.sourceTechnicalChange = sourceTechnicalChange;
  if (technicalChanges.length) manifest.technicalChanges = technicalChanges;
  const excludedTechnicalChanges = normaliseDeliveryPackageTechnicalChanges(legacy.excludedTechnicalChanges);
  if (excludedTechnicalChanges.length) manifest.excludedTechnicalChanges = excludedTechnicalChanges;
  if (Number.isFinite(Number(legacy.priority))) manifest.priority = Number(legacy.priority);
  const updatedAt = firstNonEmptyString(legacy.updatedAt, firstMarkdown('updatedAt'));
  if (updatedAt) manifest.updatedAt = updatedAt;

  await writeJson(manifestPath, manifest);
  changes.push(`Rebuilt missing delivery package manifest for delivery/packages/${folder}`);
  pushRepairLog(logs, 'success', 'delivery-repair', 'Rebuilt missing delivery package manifest.', {
    path: `delivery/packages/${folder}/package.json`,
    detail: `Title: ${manifest.title}; type: ${packageType}; source: ${legacyRead ? 'bundle.json' : markdownMetadata.length ? markdownMetadata.map((item) => item.fileName).join(', ') : 'folder name'}`
  });
  return true;
}

export async function repairDeliveryPackageManifests(projectPath: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[]) {
  pushRepairLog(logs, 'info', 'delivery-repair', 'Checking delivery package manifests.');
  let repaired = 0;

  for (const folder of await listEntityFolders(projectPath, 'delivery/packages')) {
    try {
      if (await ensureDeliveryPackageManifestForFolder(projectPath, folder, changes, warnings, logs)) repaired++;
    } catch (error) {
      const message = `Could not repair delivery package manifest for ${folder}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pushRepairLog(logs, 'error', 'delivery-repair', 'Failed to rebuild delivery package manifest.', {
        path: `delivery/packages/${folder}/package.json`,
        detail: message
      });
    }
  }

  if (repaired === 0) {
    pushRepairLog(logs, 'info', 'delivery-repair', 'No delivery package manifests needed repair.');
  }
}

export async function archivePathForRepair(projectPath: string, stamp: string, relativePath: string) {
  return path.join(projectPath, '_archive', 'aidd-repair', stamp, relativePath);
}

export function markdownBodyWithoutFrontmatter(content: string) {
  const parsed = parseMarkdownSafe(content);
  if (parsed.ok) return String(parsed.parsed.content || '').replace(/^\s*\n/, '').trim();
  return content.replace(/^---[\s\S]*?---\s*/m, '').trim();
}

export function markdownContentScore(body: string) {
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

export function hasUsefulMarkdownBody(body: string) {
  return markdownContentScore(body) > 24;
}

export function markdownStatus(content: string): SetupStepStatus {
  const parsed = parseMarkdownSafe(content);
  const data = parsed.ok ? ((parsed.parsed.data || {}) as Record<string, any>) : {};
  return normalizeSetupStatus(data?.aidd?.status || data?.status || (contentLooksComplete(content) ? 'draft' : 'not-started'));
}

export function strongestStatus(a: SetupStepStatus, b: SetupStepStatus): SetupStepStatus {
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

export function mergeMarkdownIntoExistingFrontmatter(existingRaw: string, body: string, status: SetupStepStatus) {
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

export async function mergeLegacyMarkdownConflict(
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

export function summaryFromMarkdownBody(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-*]\s*TODO:?/i.test(line) && !/^TODO:?/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

export function descriptionIsMissingOrPlaceholder(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^no description provided\.?$/i.test(text) || /^describe what/i.test(text) || /^todo:?$/i.test(text);
}

export async function refreshProjectSummaryMetadata(projectPath: string, changes: string[], logs: ProjectRepairLogEntry[]) {
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

export async function moveOrArchiveLegacyEntry(
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

export async function migrateLegacyFolderContents(
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

export async function repairEntitySectionDocuments(projectPath: string, stamp: string, changes: string[], warnings: string[], logs: ProjectRepairLogEntry[]) {
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
      await ensureCapabilityManifestForFolder(projectPath, folder, changes, logs);
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

export async function repairProject(projectPath: string): Promise<ProjectRepairReport> {
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
  await repairDeliveryPackageManifests(projectPath, changes, warnings, logs);

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
