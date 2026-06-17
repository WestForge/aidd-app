import matter from '../../frontmatter';
import { buildAgentsManagedBlock, extractAgentsManagedBlock, replaceAgentsManagedBlock } from '../../publishing/agentInstructions';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CAPABILITY_TEMPLATE_SECTIONS } from './capabilityCore';
import { readCapability } from './capabilityReview';
import { COMPONENT_TEMPLATE_SECTIONS, componentSourceIsConfigured, normaliseComponentSource, normaliseComponentSourceDetection, resolveComponentSourceDirectory } from './componentCore';
import { readProjectName } from './componentReview';
import { normaliseStatusForDelivery, readDeliveryPackage, readDeliveryPackages } from './delivery';
import { CHANGE_SECTIONS, CHANGE_STATUSES, CHANGE_TYPES } from './changes';
import { TEMPLATE_ID, TEMPLATE_VERSION, exists, isObsoleteTemplateFile, readEntities, readJson, readProjects, readWorkspacePathForProject, slugify, templatePath, writeJson } from './projectCore';
import { isTerminalDeliveryStatus } from './projectStatus';
import { readSourceProjects } from './sourceDecisionsGit';
import { readFoundationDocuments, readStandardSections, standardSectionDone } from './standards';
import type { DeliveryPackageDetail, FoundationDocument, HealthEntity, ProjectValidationItem, ProjectValidationReport, ProjectValidationSection, SourceCodeProject, StandardSection, WorkspacePublishManifest, WorkspacePublishOutput, WorkspacePublishResult, WorkspacePublishStatus, WorkspacePublishWritableFile } from './types';

export function validationSection(id: string, title: string): ProjectValidationSection {
  return { id, title, items: [] };
}

export function pushValidation(section: ProjectValidationSection, item: Omit<ProjectValidationItem, 'category'>) {
  section.items.push({ ...item, category: section.title });
}

export function bodyLooksUseful(body: string) {
  const cleaned = body
    .replace(/^#.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .replace(/_No content captured\._/gi, '')
    .trim();
  return cleaned.length >= 40;
}

export function normaliseRelativePath(value: string) {
  return value.split('\\').join('/');
}

export function normaliseDiskPath(value: string) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function sameDiskPath(a: string, b: string) {
  return normaliseDiskPath(a) === normaliseDiskPath(b);
}

export function isSameOrInsideDiskPath(candidatePath: string, rootPath: string) {
  const candidate = normaliseDiskPath(candidatePath);
  const root = normaliseDiskPath(rootPath);
  if (!candidate || !root) return false;
  if (candidate === root) return true;
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(rootWithSeparator);
}

export function agentsTargetPathForWorkspace(workspacePath: string) {
  return path.join(workspacePath, 'AGENTS.md');
}

export const SOURCE_WORKSPACE_MARKER_FILES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'astro.config.mjs',
  'next.config.js',
  'Cargo.toml'.toLowerCase(),
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'gradlew',
  'CMakeLists.txt'.toLowerCase(),
  'Makefile'.toLowerCase(),
  'composer.json',
  'Gemfile'.toLowerCase()
]);

export const SOURCE_WORKSPACE_MARKER_DIRECTORIES = new Set([
  'src',
  'source',
  'app',
  'apps',
  'packages',
  'lib',
  'public',
  'private',
  'tests',
  'test'
]);

export const SOURCE_WORKSPACE_MARKER_EXTENSIONS = [
  '.sln',
  '.csproj',
  '.fsproj',
  '.vbproj',
  '.xcodeproj',
  '.xcworkspace',
  '.uproject',
  '.uplugin'
];

export async function detectSourceWorkspaceMarkers(workspacePath: string) {
  const markers: string[] = [];
  const entries = await fsp.readdir(workspacePath, { withFileTypes: true });

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory() && SOURCE_WORKSPACE_MARKER_DIRECTORIES.has(lowerName)) {
      markers.push(`${entry.name}/`);
      continue;
    }
    if (SOURCE_WORKSPACE_MARKER_FILES.has(lowerName)) {
      markers.push(entry.name);
      continue;
    }
    if (SOURCE_WORKSPACE_MARKER_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
      markers.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    }
  }

  return markers.slice(0, 8);
}

export const WORKSPACE_PUBLISH_SCHEMA_VERSION = 1;

export const WORKSPACE_PUBLISH_TEMPLATE_VERSION = '3';

export const DELIVERY_WRITABLE_FILE_TEMPLATES = [
  {
    fileName: 'progress.md',
    title: 'Progress',
    body: 'Use this file to record what has been done, what is in progress, and what remains.'
  },
  {
    fileName: 'changes.md',
    title: 'Changes',
    body: 'Record the implementation files changed and the reason for each meaningful change.'
  },
  {
    fileName: 'evidence.md',
    title: 'Evidence',
    body: 'Record tests run, checks completed, screenshots, logs, or manual verification notes.'
  },
  {
    fileName: 'questions.md',
    title: 'Questions',
    body: 'Record blockers, product questions, technical unknowns, and anything requiring human review.'
  },
  {
    fileName: 'handoff.md',
    title: 'Handoff',
    body: 'Summarise what changed, how it was verified, and what the next reviewer should look at.'
  },
  {
    fileName: 'proposed-aidd-updates.md',
    title: 'Proposed AIDD Updates',
    body: 'Record proposed changes to Foundation, Standards, Components, or Delivery rules. Do not edit generated AIDD docs directly.'
  }
] as const;

export function sha256Text(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function workspacePublishDocsPath(workspacePath: string) {
  return path.join(workspacePath, 'docs');
}

export function workspacePublishManifestPath(workspacePath: string) {
  return path.join(workspacePath, 'docs', '.aidd-publish-manifest.json');
}

export function workspaceDeliveryRootPath(workspacePath: string) {
  return path.join(workspacePath, 'delivery');
}

export function workspaceDeliveryPackagePath(workspacePath: string, packageId: string) {
  return path.join(workspaceDeliveryRootPath(workspacePath), packageId);
}

export function toWorkspacePublishPath(relativePath: string) {
  return normaliseRelativePath(relativePath).replace(/^\/+/, '');
}

export function publishOutputHashFor(kind: WorkspacePublishOutput['kind'], content: string) {
  return kind === 'agents' ? sha256Text(extractAgentsManagedBlock(content) || content) : sha256Text(content);
}

export function buildPublishOutput(kind: WorkspacePublishOutput['kind'], relativePath: string, content: string): WorkspacePublishOutput & { content: string } {
  const normalPath = toWorkspacePublishPath(relativePath);
  const outputHash = publishOutputHashFor(kind, content);
  const sourceHash = sha256Text(JSON.stringify({ templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION, kind, path: normalPath, content }));
  return {
    path: normalPath,
    kind,
    sourceHash,
    outputHash,
    status: 'missing',
    message: 'Not checked yet.',
    content
  };
}

export function generatedDocHeader(sourceLabel: string) {
  return [
    '<!-- Generated by AIDD. Do not edit directly. Regenerate from AIDD Home > Publish workspace docs. -->',
    `<!-- Source: ${sourceLabel} -->`,
    ''
  ].join('\n');
}

export function markdownSection(title: string, body: string) {
  const cleanBody = body.trim() || '_No content captured._';
  return [`## ${title}`, '', cleanBody].join('\n');
}

export function setupStatusLabel(status?: string) {
  return String(status || 'not-started').replace(/-/g, ' ');
}

export function buildPublishedFoundationMarkdown(projectName: string, docs: FoundationDocument[]) {
  const lines = [
    generatedDocHeader('AIDD foundation sections'),
    '# AIDD Foundation',
    '',
    `Project: ${projectName}`,
    '',
    'This file is generated from approved AIDD Foundation sections and is safe for AI agents to read as project context.',
    '',
    '## Section status',
    '',
    ...docs.map((doc) => `- ${doc.title}: ${setupStatusLabel(doc.status)}`),
    ''
  ];

  for (const doc of docs) {
    lines.push('---', '', `## ${doc.title}`, '', `Source: \`foundation/${doc.fileName}\``, `Status: \`${doc.status}\``, '', doc.body.trim() || '_No content captured._', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildPublishedStandardsMarkdown(projectName: string, sections: StandardSection[]) {
  const lines = [
    generatedDocHeader('AIDD standards sections'),
    '# AIDD Standards',
    '',
    `Project: ${projectName}`,
    '',
    'These are the approved project standards that AI agents should follow during implementation.',
    '',
    '## Section status',
    '',
    ...sections.map((section) => `- ${section.title}: ${setupStatusLabel(section.status)}`),
    ''
  ];

  for (const section of sections) {
    lines.push('---', '', `## ${section.title}`, '', `Source: \`foundation/standards/${section.fileName}\``, `Status: \`${section.status}\``, '', section.status === 'skipped' ? '_This section was skipped in AIDD._' : section.body.trim() || '_No content captured._', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function componentSourceReferenceLines(component: any) {
  const source = normaliseComponentSource(component.source);
  const lines: string[] = [];
  if (componentSourceIsConfigured(source)) {
    lines.push(`- Source path: \`${source.directory}\``);
    lines.push(`- Path mode: \`${source.pathMode}\``);
    lines.push(`- Portable: \`${source.isInsideWorkspace ? 'yes' : 'no'}\``);
    lines.push(`- Source type: \`${source.type || 'other'}\``);
    if (source.warning) lines.push(`- Source warning: ${source.warning}`);
    const detection = normaliseComponentSourceDetection(source.detection);
    if (detection?.detectedMarkers.length) lines.push(`- Detected markers: ${detection.detectedMarkers.map((item) => `\`${item}\``).join(', ')}`);
    if (detection?.detectedFrameworks.length) lines.push(`- Detected frameworks: ${detection.detectedFrameworks.map((item) => `\`${item}\``).join(', ')}`);
    if (detection?.detectedLanguages.length) lines.push(`- Detected languages: ${detection.detectedLanguages.map((item) => `\`${item}\``).join(', ')}`);
  }
  const sourceProjects: string[] = Array.isArray(component.sourceProjects) ? component.sourceProjects.map(String).filter(Boolean) : [];
  if (sourceProjects.length) lines.push(`- Source projects: ${sourceProjects.map((item) => `\`${item}\``).join(', ')}`);
  const capabilities = Array.from(new Set<string>([
    ...(Array.isArray(component.supportsCapabilities) ? component.supportsCapabilities.map(String) : []),
    ...(Array.isArray(component.capabilitiesSupported) ? component.capabilitiesSupported.map(String) : [])
  ].filter(Boolean)));
  if (capabilities.length) lines.push(`- Capabilities: ${capabilities.map((item) => `\`${item}\``).join(', ')}`);
  if (!lines.length) lines.push('- Source location has not been configured.');
  return lines;
}

export function buildPublishedComponentsMarkdown(projectName: string, components: any[], sourceProjects: SourceCodeProject[]) {
  const lines = [
    generatedDocHeader('AIDD components'),
    '# AIDD Components',
    '',
    `Project: ${projectName}`,
    '',
    'This generated component map helps agents find the relevant source code without scanning the whole workspace first.',
    '',
    '## Component inventory',
    '',
    components.length
      ? components.map((component) => `- ${component.title || component.slug || component.id} (${setupStatusLabel(component.status || component.lifecycle || 'draft')})`).join('\n')
      : 'No components have been defined yet.',
    ''
  ];

  if (sourceProjects.length) {
    lines.push('## Source projects', '');
    for (const sourceProject of sourceProjects) {
      lines.push(`- ${sourceProject.name}: \`${sourceProject.path}\` (${sourceProject.detectedType})`);
    }
    lines.push('');
  }

  for (const component of components) {
    const title = String(component.title || component.slug || component.id || 'Untitled component');
    lines.push('---', '', `## ${title}`, '', `Status: \`${component.status || component.lifecycle || 'draft'}\``, '');
    lines.push(...componentSourceReferenceLines(component), '');
    if (Array.isArray(component.sections) && component.sections.length) {
      lines.push('### AIDD section status', '');
      for (const section of component.sections) {
        lines.push(`- ${section.title || section.key}: ${setupStatusLabel(section.status)}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildPublishedCapabilityMarkdown(projectName: string, capability: Awaited<ReturnType<typeof readCapability>>) {
  const lines = [
    generatedDocHeader(`AIDD capability ${capability.slug}`),
    `# AIDD Capability: ${capability.title}`,
    '',
    `Project: ${projectName}`,
    `Slug: \`${capability.slug}\``,
    `Status: \`${setupStatusLabel(capability.status)}\``,
    capability.components.length ? `Components: ${capability.components.map((component: string) => `\`${component}\``).join(', ')}` : 'Components: _none captured_',
    '',
    'This file is a generated snapshot of the linked capability at the time the delivery review package was created.',
    'Treat it as read-only review context. If the delivery work reveals needed AIDD updates, record them in the delivery files rather than editing this snapshot.',
    ''
  ];

  if (capability.body.trim()) {
    lines.push('## Capability index', '', capability.body.trim(), '');
  }

  for (const section of capability.sections || []) {
    lines.push(
      '---',
      '',
      `## ${section.title}`,
      '',
      `Source: \`capabilities/${capability.slug}/${section.fileName}\``,
      `Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export function deliveryReviewCapabilitySnapshotFileName(capabilitySlug: string | null | undefined) {
  const slug = slugify(capabilitySlug || 'capability');
  return `capability-${slug || 'context'}.md`;
}

export function buildDeliveryBriefMarkdown(detail: DeliveryPackageDetail) {
  const lines = [
    generatedDocHeader(`AIDD delivery package ${detail.id}`),
    `# ${detail.id} · ${detail.title}`,
    '',
    `Status: \`${detail.status}\``,
    detail.sourceCapability ? `Source capability: \`${detail.sourceCapability}\`` : '',
    detail.components.length ? `Components: ${detail.components.map((item) => `\`${item}\``).join(', ')}` : 'Components: _none captured_',
    '',
    'This generated brief is read-only. Agents should update the writable files beside it: progress.md, changes.md, evidence.md, questions.md, handoff.md, and proposed-aidd-updates.md.',
    ''
  ].filter(Boolean);

  if (detail.snapshotBody.trim()) lines.push(markdownSection('Snapshot', detail.snapshotBody), '');
  if (detail.strategyBody.trim()) lines.push(markdownSection('Implementation strategy', detail.strategyBody), '');
  if (detail.packagedBody.trim()) lines.push(markdownSection('Packaged instructions', detail.packagedBody), '');
  if (detail.phases.length) {
    lines.push('## Phases', '');
    for (const phase of detail.phases) {
      lines.push(`### ${phase.title}`, '', `Status: \`${phase.status}\``, '', phase.body.trim() || '_No phase detail captured._', '');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildDeliveryWritableMarkdown(packageId: string, title: string, body: string) {
  return [
    `# ${packageId} ${title}`,
    '',
    body,
    '',
    '<!-- This file is intentionally writable by the agent during implementation. -->',
    ''
  ].join('\n');
}

export function buildPublishedDeliveryIndexMarkdown(projectName: string, deliveries: DeliveryPackageDetail[]) {
  const lines = [
    generatedDocHeader('AIDD delivery packages'),
    '# AIDD Delivery',
    '',
    `Project: ${projectName}`,
    '',
    'This file lists active delivery packages published for agentic implementation.',
    '',
    '## Active delivery packages',
    '',
    deliveries.length
      ? deliveries.map((item) => `- [${item.id} · ${item.title}](../delivery/${item.id}/implementation-strategy.md) — ${setupStatusLabel(item.status)}`).join('\n')
      : 'No active delivery packages are currently published.',
    ''
  ];

  if (deliveries.length) {
    lines.push('## Workspace delivery files', '', 'Agents may update the implementation strategy and phase/stage Markdown files inside each workspace delivery package folder:', '', '- `implementation-strategy.md`', '- `phase-*.md`', '- `stage-*.md`', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function readWorkspacePublishManifest(workspacePath: string): Promise<WorkspacePublishManifest | null> {
  const manifestPath = workspacePublishManifestPath(workspacePath);
  if (!(await exists(manifestPath))) return null;
  try {
    return await readJson<WorkspacePublishManifest>(manifestPath);
  } catch {
    return null;
  }
}

export async function readActiveDeliveryPackageDetails(projectPath: string) {
  const summaries = (await readDeliveryPackages(projectPath)).filter((item) => !isTerminalDeliveryStatus(item.status));
  const details: DeliveryPackageDetail[] = [];
  for (const summary of summaries) {
    try {
      details.push(await readDeliveryPackage({ projectPath, id: summary.id }));
    } catch {
      // Ignore packages that disappear between the summary and detail read.
    }
  }
  return details;
}

export async function buildWorkspacePublishPlan(projectPath: string) {
  const trackedProject = (await readProjects()).find((project) => sameDiskPath(project.path, projectPath));
  const projectName = trackedProject?.name || await readProjectName(projectPath);
  const workspacePath = trackedProject?.workspacePath?.trim();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const outputs: Array<WorkspacePublishOutput & { content: string }> = [];
  const writableFiles: Array<WorkspacePublishWritableFile & { content: string }> = [];

  if (!trackedProject) blockers.push('Open this project from the Projects screen so AIDD can read its source workspace setting.');
  if (!workspacePath) blockers.push('Choose the implementation/source-code workspace on Home.');

  if (workspacePath) {
    if (!(await exists(workspacePath))) blockers.push(`The configured source workspace does not exist: ${workspacePath}`);
    else {
      const stat = await fsp.stat(workspacePath);
      if (!stat.isDirectory()) blockers.push(`The configured source workspace is not a directory: ${workspacePath}`);
      if (sameDiskPath(workspacePath, projectPath)) blockers.push('The source workspace cannot be the active AIDD project.');
      else {
        if (isSameOrInsideDiskPath(projectPath, workspacePath)) warnings.push('The source workspace contains the active AIDD project. Publishing is allowed, but agents may scan AIDD source files from this workspace.');
        if (isSameOrInsideDiskPath(workspacePath, projectPath)) warnings.push('The source workspace is inside the active AIDD project. Publishing is allowed, but this layout may confuse agents and generated docs.');
      }
      const markers = stat.isDirectory() ? await detectSourceWorkspaceMarkers(workspacePath) : [];
      if (!markers.length) warnings.push('The configured workspace does not look like a source-code directory. Publishing is allowed, but check the workspace path.');
      const legacyAiddDocsPath = path.join(workspacePath, 'docs', 'aidd');
      if (await exists(legacyAiddDocsPath)) warnings.push('A legacy docs/aidd directory exists from an older publishing layout. New AIDD publishing writes directly to docs/. Remove docs/aidd if it was generated by AIDD and is no longer needed.');
    }
  }

  const foundation = await readFoundationDocuments(projectPath);
  const incompleteFoundation = foundation.filter((doc) => doc.required !== false && doc.status !== 'complete');
  if (incompleteFoundation.length) blockers.push(`Complete Foundation before publishing: ${incompleteFoundation.map((doc) => doc.title).join(', ')}.`);

  const standards = await readStandardSections(projectPath);
  const incompleteStandards = standards.filter((section) => !standardSectionDone(section));
  if (incompleteStandards.length) blockers.push(`Complete or skip Standards sections before publishing: ${incompleteStandards.map((section) => section.title).join(', ')}.`);

  const components = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));
  const sourceProjects = await readSourceProjects(projectPath);

  if (workspacePath) {
    outputs.push(buildPublishOutput('doc', 'docs/foundation.md', buildPublishedFoundationMarkdown(projectName, foundation)));
    outputs.push(buildPublishOutput('doc', 'docs/standards.md', buildPublishedStandardsMarkdown(projectName, standards)));
    outputs.push(buildPublishOutput('doc', 'docs/components.md', buildPublishedComponentsMarkdown(projectName, components, sourceProjects)));
    const agentsBlock = buildAgentsManagedBlock({ projectName, projectPath, workspacePath, components, sourceProjects });
    outputs.unshift(buildPublishOutput('agents', 'AGENTS.md', agentsBlock));
  }

  return { trackedProject, projectName, projectPath, workspacePath, blockers, warnings, outputs, writableFiles };
}

export async function evaluateWorkspacePublishStatus(projectPath: string): Promise<WorkspacePublishStatus> {
  const plan = await buildWorkspacePublishPlan(projectPath);
  const workspacePath = plan.workspacePath;
  const checkedAt = new Date().toISOString();
  const manifest = workspacePath ? await readWorkspacePublishManifest(workspacePath) : null;
  const hasPublishedManifest = Boolean(manifest?.publishedAt);
  const manifestOutputByPath = new Map((manifest?.outputs || []).map((output) => [output.path, output]));

  const outputs: WorkspacePublishOutput[] = [];
  for (const output of plan.outputs) {
    const absolutePath = path.join(workspacePath || '', output.path);
    const previous = manifestOutputByPath.get(output.path);
    const fileExists = Boolean(workspacePath) && await exists(absolutePath);
    let currentHash = '';
    let hasManagedAgentsBlock = true;
    if (fileExists) {
      const current = await fsp.readFile(absolutePath, 'utf8');
      if (output.kind === 'agents') {
        const managed = extractAgentsManagedBlock(current);
        hasManagedAgentsBlock = Boolean(managed);
        currentHash = managed ? sha256Text(managed) : '';
      } else {
        currentHash = sha256Text(current);
      }
    }

    let status: WorkspacePublishOutput['status'] = 'up-to-date';
    let message = 'Published output is up to date.';
    if (!fileExists || (output.kind === 'agents' && !hasManagedAgentsBlock)) {
      status = 'missing';
      if (!hasPublishedManifest) {
        message = output.kind === 'agents'
          ? 'AGENTS.md will receive the generated managed block on first publish.'
          : 'This generated file will be created on first publish.';
      } else {
        message = output.kind === 'agents' ? 'AGENTS.md is missing the generated managed block.' : 'Published file is missing.';
      }
    } else if (!previous) {
      status = 'stale';
      message = 'Published file is not tracked in the AIDD publish manifest.';
    } else if (previous.sourceHash !== output.sourceHash) {
      status = 'stale';
      message = 'Source context content has changed since the last publish.';
    } else if (currentHash !== previous.outputHash) {
      status = 'modified';
      message = output.kind === 'agents' ? 'The generated block in AGENTS.md was edited outside the app.' : 'Published file was edited outside AIDD.';
    }

    outputs.push({ path: output.path, kind: output.kind, sourceHash: output.sourceHash, outputHash: output.outputHash, status, message });
  }

  const summary = {
    total: outputs.length,
    missing: outputs.filter((output) => output.status === 'missing').length,
    stale: outputs.filter((output) => output.status === 'stale').length,
    modified: outputs.filter((output) => output.status === 'modified').length,
    upToDate: outputs.filter((output) => output.status === 'up-to-date').length
  };

  let state: WorkspacePublishStatus['state'] = 'up-to-date';
  let label = 'Published docs up to date';
  let message = 'AGENTS.md and docs are current.';
  if (!workspacePath) {
    state = 'not-configured';
    label = 'Workspace not configured';
    message = 'Choose a source workspace before publishing workspace docs.';
  } else if (plan.blockers.length) {
    state = 'blocked';
    label = 'Publishing blocked';
    message = plan.blockers[0];
  } else if (summary.missing) {
    state = 'missing';
    if (!hasPublishedManifest) {
      label = 'Not published yet';
      message = 'Publish will create AGENTS.md plus docs/foundation.md, docs/standards.md, and docs/components.md.';
    } else {
      label = 'Published docs missing';
      message = `${summary.missing} publish output${summary.missing === 1 ? '' : 's'} need to be recreated.`;
    }
  } else if (summary.modified) {
    state = 'modified';
    label = 'Published docs modified';
    message = `${summary.modified} published output${summary.modified === 1 ? '' : 's'} changed outside AIDD.`;
  } else if (summary.stale) {
    state = 'stale';
    label = 'Published docs stale';
    message = `${summary.stale} published output${summary.stale === 1 ? '' : 's'} need to be regenerated.`;
  }

  return {
    checkedAt,
    state,
    label,
    message,
    canPublish: Boolean(workspacePath) && plan.blockers.length === 0,
    projectPath,
    ...(workspacePath ? {
      workspacePath,
      docsPath: workspacePublishDocsPath(workspacePath),
      agentsPath: agentsTargetPathForWorkspace(workspacePath),
      manifestPath: workspacePublishManifestPath(workspacePath)
    } : {}),
    ...(manifest?.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
    blockers: plan.blockers,
    warnings: plan.warnings,
    outputs,
    writableFiles: plan.writableFiles.map((file) => ({ path: file.path, outputHash: file.outputHash })),
    summary
  };
}

export async function publishWorkspaceDocs(projectPath: string): Promise<WorkspacePublishResult> {
  const plan = await buildWorkspacePublishPlan(projectPath);
  const workspacePath = plan.workspacePath;
  if (!workspacePath || plan.blockers.length) {
    const status = await evaluateWorkspacePublishStatus(projectPath);
    return { ...status, published: false, writtenFiles: [], skippedFiles: [], createdWritableFiles: [] };
  }

  const previousStatus = await evaluateWorkspacePublishStatus(projectPath);
  const outputStatusByPath = new Map(previousStatus.outputs.map((output) => [output.path, output.status]));
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const createdWritableFiles: string[] = [];

  for (const output of plan.outputs) {
    const status = outputStatusByPath.get(output.path);
    if (status === 'up-to-date') {
      skippedFiles.push(output.path);
      continue;
    }

    const absolutePath = path.join(workspacePath, output.path);
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    if (output.kind === 'agents') {
      const existing = await exists(absolutePath) ? await fsp.readFile(absolutePath, 'utf8') : '';
      await fsp.writeFile(absolutePath, replaceAgentsManagedBlock(existing, output.content), 'utf8');
    } else {
      await fsp.writeFile(absolutePath, output.content, 'utf8');
    }
    writtenFiles.push(output.path);
  }

  for (const writable of plan.writableFiles) {
    const absolutePath = path.join(workspacePath, writable.path);
    if (await exists(absolutePath)) continue;
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, writable.content, 'utf8');
    createdWritableFiles.push(writable.path);
  }

  const publishedAt = new Date().toISOString();
  const manifest: WorkspacePublishManifest = {
    schemaVersion: WORKSPACE_PUBLISH_SCHEMA_VERSION,
    templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION,
    projectName: plan.projectName,
    projectPath,
    workspacePath,
    docsPath: workspacePublishDocsPath(workspacePath),
    agentsPath: agentsTargetPathForWorkspace(workspacePath),
    publishedAt,
    outputs: plan.outputs.map((output) => ({ path: output.path, kind: output.kind, sourceHash: output.sourceHash, outputHash: output.outputHash })),
    writableFiles: plan.writableFiles.map((file) => file.path)
  };
  await writeJson(workspacePublishManifestPath(workspacePath), manifest);

  const status = await evaluateWorkspacePublishStatus(projectPath);
  return { ...status, published: true, writtenFiles, skippedFiles, createdWritableFiles };
}

export function isSkippedHealthPath(relativePath: string) {
  const normal = normaliseRelativePath(relativePath);
  return (
    normal.startsWith('.git/') ||
    normal.startsWith('node_modules/') ||
    normal.startsWith('.aidd-app/') ||
    normal.startsWith('.aidd/drag-files/') ||
    normal.startsWith('.aidd/template-archive/') ||
    normal.startsWith('_archive/') ||
    normal.startsWith('dist/') ||
    normal.startsWith('build/') ||
    normal.startsWith('out/')
  );
}

export async function collectRelativeFiles(root: string, current = root): Promise<string[]> {
  if (!(await exists(current))) return [];
  const out: string[] = [];
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    const relative = normaliseRelativePath(path.relative(root, full));
    if (entry.isDirectory()) {
      if (isSkippedHealthPath(relative + '/')) continue;
      out.push(...await collectRelativeFiles(root, full));
      continue;
    }
    if (!isSkippedHealthPath(relative)) out.push(relative);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export async function collectProjectMarkdownFiles(projectPath: string) {
  return (await collectRelativeFiles(projectPath)).filter((relativePath) => relativePath.endsWith('.md'));
}

export async function validateTemplateFiles(projectPath: string, section: ProjectValidationSection) {
  const expectedRoot = path.join(templatePath(), '.aidd', 'templates');
  const actualRoot = path.join(projectPath, '.aidd', 'templates');

  if (!(await exists(expectedRoot))) {
    pushValidation(section, {
      id: 'app-template-root-missing',
      title: 'Bundled template files could not be found',
      message: `The app template folder was not found at ${expectedRoot}`,
      severity: 'error',
      action: 'Reinstall or rebuild the app template resources.'
    });
    return;
  }

  if (!(await exists(actualRoot))) {
    pushValidation(section, {
      id: 'project-template-root-missing',
      title: 'Project template folder missing',
      message: 'The project does not contain .aidd/templates.',
      severity: 'error',
      path: '.aidd/templates',
      action: 'Run the template upgrade to restore missing template files.'
    });
    return;
  }

  const bundledFiles = await collectRelativeFiles(expectedRoot);
  const expectedFiles = bundledFiles.filter((relativePath) => !isObsoleteTemplateFile(relativePath));
  const actualFiles = await collectRelativeFiles(actualRoot);
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);
  let issueCount = 0;

  for (const relativePath of expectedFiles) {
    if (actual.has(relativePath)) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-missing-${relativePath}`,
      title: 'Template file missing',
      message: `${relativePath} exists in the app template but is missing from this project.`,
      severity: 'error',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run the template upgrade to restore missing template files.'
    });
  }

  for (const relativePath of actualFiles) {
    if (expected.has(relativePath)) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-extra-${relativePath}`,
      title: 'Unexpected template file',
      message: `${relativePath} is not part of the current app template.`,
      severity: 'warning',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run the template upgrade to archive template files that should not be there.'
    });
  }

  for (const relativePath of actualFiles.filter((item) => item.endsWith('.md') && expected.has(item))) {
    const raw = await fsp.readFile(path.join(actualRoot, relativePath), 'utf8');
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      issueCount++;
      pushValidation(section, {
        id: `template-frontmatter-corrupt-${relativePath}`,
        title: 'Template front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: `.aidd/templates/${relativePath}`,
        action: 'Fix the YAML front matter or restore the template file from the bundled app template.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
    const version = aidd?.templateVersion;
    if (!aidd || version === TEMPLATE_VERSION) continue;
    issueCount++;
    pushValidation(section, {
      id: `template-version-${relativePath}`,
      title: 'Template front matter is out of sync',
      message: `${relativePath} uses templateVersion ${version || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: `.aidd/templates/${relativePath}`,
      action: 'Run Repair issues to update front matter versions.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'template-files-current',
      title: 'Template files match the app template',
      message: `.aidd/templates has all expected files, no unexpected files, and current front matter versions (${TEMPLATE_VERSION}).`,
      severity: 'success',
      path: '.aidd/templates'
    });
  }
}

export async function readJsonSafe<T = any>(filePath: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: JSON.parse(await fsp.readFile(filePath, 'utf8')) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseMarkdownSafe(content: string): { ok: true; parsed: any } | { ok: false; error: string } {
  try {
    return { ok: true, parsed: matter(content) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validateJsonIntegrity(projectPath: string, relativePath: string, section: ProjectValidationSection, required = true) {
  const filePath = path.join(projectPath, relativePath);
  if (!(await exists(filePath))) {
    if (required) {
      pushValidation(section, {
        id: `json-missing-${relativePath}`,
        title: 'Required JSON file missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues to restore missing AIDD data files.'
      });
      return false;
    }
    return true;
  }

  const result = await readJsonSafe(filePath);
  if (!result.ok) {
    pushValidation(section, {
      id: `json-corrupt-${relativePath}`,
      title: 'JSON file is corrupt',
      message: `${relativePath} could not be parsed: ${result.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Open the file and fix the JSON syntax, or restore it from version control.'
    });
    return false;
  }

  return true;
}

export async function validateMarkdownIntegrity(projectPath: string, relativePath: string, section: ProjectValidationSection, required = true) {
  const filePath = path.join(projectPath, relativePath);
  if (!(await exists(filePath))) {
    if (required) {
      pushValidation(section, {
        id: `markdown-missing-${relativePath}`,
        title: 'Required Markdown file missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues to restore missing AIDD data files.'
      });
      return false;
    }
    return true;
  }

  const parsed = parseMarkdownSafe(await fsp.readFile(filePath, 'utf8'));
  if (!parsed.ok) {
    pushValidation(section, {
      id: `markdown-corrupt-${relativePath}`,
      title: 'Markdown front matter is corrupt',
      message: `${relativePath} could not be parsed: ${parsed.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Fix the YAML front matter or restore the file from version control.'
    });
    return false;
  }

  return true;
}

export async function validateTemplateManifest(projectPath: string, section: ProjectValidationSection) {
  const relativePath = 'aidd.template.json';
  const manifestPath = path.join(projectPath, relativePath);
  if (!(await exists(manifestPath))) {
    pushValidation(section, {
      id: 'template-manifest-missing',
      title: 'Template manifest missing',
      message: 'The project does not contain aidd.template.json.',
      severity: 'error',
      path: relativePath,
      action: 'Run Repair issues to recreate the AIDD template manifest.'
    });
    return;
  }

  const result = await readJsonSafe<any>(manifestPath);
  if (!result.ok) {
    pushValidation(section, {
      id: 'template-manifest-corrupt',
      title: 'Template manifest is corrupt',
      message: `aidd.template.json could not be parsed: ${result.error}`,
      severity: 'error',
      path: relativePath,
      action: 'Fix the JSON syntax or restore the manifest from version control.'
    });
    return;
  }

  const manifest = result.data;
  if (manifest.templateId && manifest.templateId !== TEMPLATE_ID) {
    pushValidation(section, {
      id: 'template-id-drift',
      title: 'Template id differs from the app template',
      message: `Project uses ${manifest.templateId}; app expects ${TEMPLATE_ID}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Check whether this project is meant to use the bundled AIDD template.'
    });
  }

  if (manifest.templateVersion !== TEMPLATE_VERSION) {
    pushValidation(section, {
      id: 'template-version-drift',
      title: 'Template manifest version is out of sync',
      message: `Project uses ${manifest.templateVersion || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Run Repair issues to upgrade the template manifest version.'
    });
    return;
  }

  pushValidation(section, {
    id: 'template-manifest-current',
    title: 'Template manifest is current',
    message: `${manifest.templateId || TEMPLATE_ID}@${manifest.templateVersion}`,
    severity: 'success',
    path: relativePath
  });
}

export async function validateProjectDataIntegrity(projectPath: string, section: ProjectValidationSection) {
  const before = section.items.length;
  const requiredDirs = [
    '.aidd',
    '.aidd/templates',
    'foundation',
    'foundation/standards',
    'foundation/delivery-planning',
    'capabilities',
    'components',
    'changes',
    'delivery',
    'delivery/packages',
    'source-code',
    'source-code/projects'
  ];

  for (const relativePath of requiredDirs) {
    if (await exists(path.join(projectPath, relativePath))) continue;
    pushValidation(section, {
      id: `dir-missing-${relativePath}`,
      title: 'Required folder missing',
      message: `${relativePath} does not exist.`,
      severity: 'error',
      path: relativePath,
      action: 'Run Repair issues to restore the expected AIDD folder structure.'
    });
  }

  const legacyFolders = [
    { from: 'common', to: 'foundation' },
    { from: 'modules', to: 'components' },
    { from: 'bundles', to: 'delivery/packages' },
    { from: 'delivery/bundles', to: 'delivery/packages' }
  ];

  for (const legacy of legacyFolders) {
    if (!(await exists(path.join(projectPath, legacy.from)))) continue;
    pushValidation(section, {
      id: `legacy-folder-${legacy.from}`,
      title: 'Legacy AIDD folder found',
      message: `${legacy.from} is from an older project layout. Current projects use ${legacy.to}.`,
      severity: 'warning',
      path: legacy.from,
      action: 'Run Repair issues to migrate legacy folders where it is safe.'
    });
  }

  await validateJsonIntegrity(projectPath, 'aidd.config.json', section, false);
  await validateJsonIntegrity(projectPath, 'aidd.template.json', section, true);
  await validateJsonIntegrity(projectPath, 'foundation/standards/standards.json', section, false);
  await validateJsonIntegrity(projectPath, 'delivery/roadmap.json', section, false);

  const requiredMarkdown = [
    'foundation/01-project-overview.md',
    'foundation/02-product-definition.md',
    'foundation/03-audience-and-users.md',
    'foundation/04-goals-and-success-metrics.md',
    'foundation/standards/index.md',
    'foundation/delivery-planning/index.md',
    'capabilities/index.md',
    'components/index.md',
    'changes/index.md',
    'delivery/packages/index.md'
  ];

  for (const relativePath of requiredMarkdown) {
    await validateMarkdownIntegrity(projectPath, relativePath, section, true);
  }

  if (section.items.length === before) {
    pushValidation(section, {
      id: 'project-data-present',
      title: 'Required AIDD data files are present',
      message: 'Required folders, JSON files, and Markdown files are present and parseable.',
      severity: 'success'
    });
  }
}

export async function listEntityFolders(projectPath: string, rootDir: string) {
  const dir = path.join(projectPath, rootDir);
  if (!(await exists(dir))) return [] as string[];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

export async function collectHealthEntities(projectPath: string, section: ProjectValidationSection, rootDir: string, manifestName: string, kind: HealthEntity['kind']) {
  const entities: HealthEntity[] = [];
  const folders = await listEntityFolders(projectPath, rootDir);

  for (const folder of folders) {
    const relativePath = `${rootDir}/${folder}/${manifestName}`;
    const filePath = path.join(projectPath, relativePath);
    if (!(await exists(filePath))) {
      pushValidation(section, {
        id: `${kind}-manifest-missing-${folder}`,
        title: 'Entity manifest missing',
        message: `${relativePath} does not exist.`,
        severity: 'error',
        path: relativePath,
        action: 'Run Repair issues if this is a legacy item, or recreate the missing manifest from version control.'
      });
      continue;
    }

    const result = await readJsonSafe<any>(filePath);
    if (!result.ok) {
      pushValidation(section, {
        id: `${kind}-manifest-corrupt-${folder}`,
        title: 'Entity manifest is corrupt',
        message: `${relativePath} could not be parsed: ${result.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the JSON syntax or restore the manifest from version control.'
      });
      continue;
    }

    const data = result.data;
    const slug = String(data.slug || data.id || folder).trim();
    const title = String(data.title || data.name || slug || folder).trim();
    if (!slug || !title) {
      pushValidation(section, {
        id: `${kind}-manifest-incomplete-${folder}`,
        title: 'Entity manifest is incomplete',
        message: `${relativePath} should include at least a slug/id and title/name.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open the item and save it again so AIDD can normalise the manifest.'
      });
    }

    if (slug && slug !== folder && kind !== 'source-project') {
      pushValidation(section, {
        id: `${kind}-folder-slug-mismatch-${folder}`,
        title: 'Entity folder and slug differ',
        message: `${relativePath} uses slug ${slug}, but the folder is ${folder}.`,
        severity: 'warning',
        path: relativePath,
        action: 'Rename the folder or update the manifest slug so links remain stable.'
      });
    }

    entities.push({ kind, rootDir, folder, manifestName, relativePath, data, slug, title });
  }

  return entities;
}

export async function validateEntitySectionFiles(projectPath: string, section: ProjectValidationSection, entity: HealthEntity, templates: Array<{ fileName: string; key: string; title: string }>, expectedType: string) {
  const entityDir = path.join(projectPath, entity.rootDir, entity.folder);
  const configuredFiles = Array.isArray(entity.data.template?.sectionFiles)
    ? entity.data.template.sectionFiles.map((value: unknown) => String(value))
    : templates.map((template) => template.fileName);
  const allowed = new Set(['index.md', ...configuredFiles]);

  for (const fileName of configuredFiles) {
    const relativePath = `${entity.rootDir}/${entity.folder}/${fileName}`;
    const filePath = path.join(projectPath, relativePath);
    if (!(await exists(filePath))) {
      pushValidation(section, {
        id: `${entity.kind}-section-missing-${entity.folder}-${fileName}`,
        title: 'Entity section file missing',
        message: `${entity.title} is missing ${fileName}.`,
        severity: 'error',
        path: relativePath,
        action: 'Open and save the item again, or restore the missing section from version control.'
      });
      continue;
    }

    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      pushValidation(section, {
        id: `${entity.kind}-section-corrupt-${entity.folder}-${fileName}`,
        title: 'Entity section front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the YAML front matter or restore the file from version control.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
    if (!aidd) {
      pushValidation(section, {
        id: `${entity.kind}-section-frontmatter-missing-${entity.folder}-${fileName}`,
        title: 'Entity section front matter missing',
        message: `${relativePath} is missing AIDD front matter.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open and save the item again so AIDD can rebuild the section front matter.'
      });
    } else if (aidd.type && aidd.type !== expectedType) {
      pushValidation(section, {
        id: `${entity.kind}-section-type-mismatch-${entity.folder}-${fileName}`,
        title: 'Entity section type differs from expected type',
        message: `${relativePath} uses aidd.type ${aidd.type}; expected ${expectedType}.`,
        severity: 'warning',
        path: relativePath,
        action: 'Open and save the item again so AIDD can normalise the section metadata.'
      });
    }
  }

  if (!(await exists(entityDir))) return;
  for (const entry of await fsp.readdir(entityDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (allowed.has(entry.name)) continue;
    const relativePath = `${entity.rootDir}/${entity.folder}/${entry.name}`;
    pushValidation(section, {
      id: `${entity.kind}-unexpected-section-${entity.folder}-${entry.name}`,
      title: 'Unexpected entity section file',
      message: `${relativePath} is not part of the current ${entity.kind} template file list.`,
      severity: 'warning',
      path: relativePath,
      action: 'Review the file. If it is obsolete, move it to an archive or merge useful content into the current sections.'
    });
  }
}

export async function validateEntityDataIntegrity(projectPath: string, section: ProjectValidationSection) {
  const before = section.items.length;
  const components = await collectHealthEntities(projectPath, section, 'components', 'component.json', 'component');
  const capabilities = await collectHealthEntities(projectPath, section, 'capabilities', 'capability.json', 'capability');
  const changes = await collectHealthEntities(projectPath, section, 'changes', 'change.json', 'change');
  const sourceProjects = await collectHealthEntities(projectPath, section, 'source-code/projects', 'source-project.json', 'source-project');
  const deliveryPackages = await collectHealthEntities(projectPath, section, 'delivery/packages', 'package.json', 'delivery-package');

  const componentSlugs = new Set(components.map((component) => component.slug));
  const sourceIds = new Set(sourceProjects.map((sourceProject) => String(sourceProject.data.id || sourceProject.slug)));
  const capabilitySlugs = new Set(capabilities.map((capability) => capability.slug));
  const changeIds = new Set(changes.map((change) => change.slug));
  const knownDeliveryPackageIds = new Set(deliveryPackages.map((deliveryPackage) => deliveryPackage.slug));

  for (const capability of capabilities) {
    if (Array.isArray(capability.data.modules) && !Array.isArray(capability.data.components)) {
      pushValidation(section, {
        id: `capability-legacy-modules-${capability.folder}`,
        title: 'Capability uses legacy module links',
        message: `${capability.relativePath} uses modules instead of components.`,
        severity: 'warning',
        path: capability.relativePath,
        action: 'Open and save the capability to normalise links to components.'
      });
    }

    const linkedComponents = Array.isArray(capability.data.components) ? capability.data.components : Array.isArray(capability.data.modules) ? capability.data.modules : [];
    const missing = linkedComponents.map((value: unknown) => String(value)).filter((slug: string) => slug && !componentSlugs.has(slug));
    if (missing.length) {
      pushValidation(section, {
        id: `capability-missing-component-links-${capability.folder}`,
        title: 'Capability links to missing components',
        message: `${capability.title} references missing components: ${missing.join(', ')}.`,
        severity: 'error',
        path: capability.relativePath,
        action: 'Create the missing components or remove the broken links.'
      });
    }

    await validateEntitySectionFiles(projectPath, section, capability, CAPABILITY_TEMPLATE_SECTIONS, 'capability-section');
  }

  for (const component of components) {
    const mappedSources = Array.isArray(component.data.sourceProjects) ? component.data.sourceProjects : [];
    const missingSources = mappedSources.map((value: unknown) => String(value)).filter((id: string) => id && !sourceIds.has(id));
    if (missingSources.length) {
      pushValidation(section, {
        id: `component-missing-source-links-${component.folder}`,
        title: 'Component links to missing source projects',
        message: `${component.title} references missing source projects: ${missingSources.join(', ')}.`,
        severity: 'error',
        path: component.relativePath,
        action: 'Add the missing source project references or remove the broken links.'
      });
    }

    await validateEntitySectionFiles(projectPath, section, component, COMPONENT_TEMPLATE_SECTIONS, 'component-section');
  }

  for (const change of changes) {
    const type = String(change.data.type || '').trim();
    if (!CHANGE_TYPES.has(type as any)) {
      pushValidation(section, {
        id: `change-invalid-type-${change.folder}`,
        title: 'Change type is invalid',
        message: `${change.relativePath} uses type ${type || 'missing'}.`,
        severity: 'error',
        path: change.relativePath,
        action: 'Open the Change and choose a valid type.'
      });
    }

    const status = String(change.data.status || '').trim();
    if (!CHANGE_STATUSES.has(status as any)) {
      pushValidation(section, {
        id: `change-invalid-status-${change.folder}`,
        title: 'Change status is invalid',
        message: `${change.relativePath} uses status ${status || 'missing'}.`,
        severity: 'error',
        path: change.relativePath,
        action: 'Open the Change and choose a valid status.'
      });
    }

    const linkedCapabilities = Array.isArray(change.data.linkedCapabilities) ? change.data.linkedCapabilities.map(String).filter(Boolean) : [];
    const missingCapabilities = linkedCapabilities.filter((slug: string) => !capabilitySlugs.has(slug));
    if (missingCapabilities.length) {
      pushValidation(section, {
        id: `change-missing-capability-links-${change.folder}`,
        title: 'Change links to missing capabilities',
        message: `${change.title} references missing capabilities: ${missingCapabilities.join(', ')}.`,
        severity: 'error',
        path: change.relativePath,
        action: 'Create the missing capabilities or remove the broken links.'
      });
    }

    const linkedComponents = Array.isArray(change.data.linkedComponents) ? change.data.linkedComponents.map(String).filter(Boolean) : [];
    const missingComponents = linkedComponents.filter((slug: string) => !componentSlugs.has(slug));
    if (missingComponents.length) {
      pushValidation(section, {
        id: `change-missing-component-links-${change.folder}`,
        title: 'Change links to missing components',
        message: `${change.title} references missing components: ${missingComponents.join(', ')}.`,
        severity: 'error',
        path: change.relativePath,
        action: 'Create the missing components or remove the broken links.'
      });
    }

    const linkedDeliveryPackageIds = Array.isArray(change.data.deliveryPackageIds) ? change.data.deliveryPackageIds.map(String).filter(Boolean) : [];
    const missingPackages = linkedDeliveryPackageIds.filter((id: string) => !knownDeliveryPackageIds.has(id));
    if (missingPackages.length) {
      pushValidation(section, {
        id: `change-missing-delivery-links-${change.folder}`,
        title: 'Change links to missing delivery packages',
        message: `${change.title} references missing delivery packages: ${missingPackages.join(', ')}.`,
        severity: 'warning',
        path: change.relativePath,
        action: 'Remove stale package ids or restore the missing delivery packages.'
      });
    }

    for (const template of CHANGE_SECTIONS) {
      await validateMarkdownIntegrity(projectPath, `${change.rootDir}/${change.folder}/${template.fileName}`, section, true);
    }
  }

  for (const deliveryPackage of deliveryPackages) {
    const sourceCapability = String(deliveryPackage.data.sourceCapability || deliveryPackage.data.capability || '').trim();
    if (sourceCapability && !capabilitySlugs.has(sourceCapability)) {
      pushValidation(section, {
        id: `delivery-missing-capability-${deliveryPackage.folder}`,
        title: 'Delivery package references a missing capability',
        message: `${deliveryPackage.title} references ${sourceCapability}, but no matching capability exists.`,
        severity: 'error',
        path: deliveryPackage.relativePath,
        action: 'Reconnect the delivery package to an existing capability or restore the missing capability.'
      });
    }

    await validateMarkdownIntegrity(projectPath, `${deliveryPackage.rootDir}/${deliveryPackage.folder}/snapshot.md`, section, false);
    await validateMarkdownIntegrity(projectPath, `${deliveryPackage.rootDir}/${deliveryPackage.folder}/implementation-strategy.md`, section, false);

    const linkedChangeIds = Array.isArray(deliveryPackage.data.changeIds) ? deliveryPackage.data.changeIds.map(String).filter(Boolean) : [];
    const missingChanges = linkedChangeIds.filter((id: string) => !changeIds.has(id));
    if (missingChanges.length) {
      pushValidation(section, {
        id: `delivery-missing-changes-${deliveryPackage.folder}`,
        title: 'Delivery package references missing Changes',
        message: `${deliveryPackage.title} references missing Changes: ${missingChanges.join(', ')}.`,
        severity: 'warning',
        path: deliveryPackage.relativePath,
        action: 'Restore the missing Changes or remove stale change ids from the delivery package manifest.'
      });
    }
  }

  const legacyModules = await listEntityFolders(projectPath, 'modules');
  if (legacyModules.length) {
    pushValidation(section, {
      id: 'legacy-modules-folder',
      title: 'Legacy module entities found',
      message: `${legacyModules.length} module folder${legacyModules.length === 1 ? '' : 's'} still exist under modules/.`,
      severity: 'warning',
      path: 'modules',
      action: 'Run Repair issues to migrate modules to components where it is safe.'
    });
  }

  if (section.items.length === before) {
    pushValidation(section, {
      id: 'entity-data-parseable',
      title: 'Entity data is parseable',
      message: 'Component, capability, source project, and delivery package manifests and section files are readable.',
      severity: 'success'
    });
  }
}

export async function validateProjectFrontmatterVersions(projectPath: string, section: ProjectValidationSection) {
  const markdownFiles = await collectProjectMarkdownFiles(projectPath);
  let issueCount = 0;

  for (const relativePath of markdownFiles) {
    const raw = await fsp.readFile(path.join(projectPath, relativePath), 'utf8');
    const parsed = parseMarkdownSafe(raw);
    if (!parsed.ok) {
      issueCount++;
      pushValidation(section, {
        id: `frontmatter-corrupt-${relativePath}`,
        title: 'AIDD front matter is corrupt',
        message: `${relativePath} could not be parsed: ${parsed.error}`,
        severity: 'error',
        path: relativePath,
        action: 'Fix the YAML front matter or restore the file from version control.'
      });
      continue;
    }

    const aidd = (parsed.parsed.data as any)?.aidd;
    if (!aidd) continue;
    const version = aidd.templateVersion;
    if (version === TEMPLATE_VERSION) continue;
    issueCount++;
    pushValidation(section, {
      id: `frontmatter-version-${relativePath}`,
      title: 'AIDD front matter version is out of sync',
      message: `${relativePath} uses templateVersion ${version || 'missing'}; app expects ${TEMPLATE_VERSION}.`,
      severity: 'warning',
      path: relativePath,
      action: 'Run Repair issues to update front matter versions.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'frontmatter-current',
      title: 'AIDD front matter is current',
      message: `All AIDD Markdown files with front matter use templateVersion ${TEMPLATE_VERSION}.`,
      severity: 'success'
    });
  }
}

export async function validateWorkspaceConfiguration(projectPath: string, section: ProjectValidationSection) {
  const trackedProject = (await readProjects()).find((project) => sameDiskPath(project.path, projectPath));
  const workspacePath = trackedProject?.workspacePath?.trim();

  if (!trackedProject) {
    pushValidation(section, {
      id: 'workspace-project-not-tracked',
      title: 'Source workspace cannot be checked',
      message: 'This AIDD project is not currently in the tracked project list, so the source workspace setting could not be read.',
      severity: 'warning',
      action: 'Open the project from the Projects screen, then set the source workspace from Home.'
    });
    return;
  }

  if (!workspacePath) {
    pushValidation(section, {
      id: 'workspace-directory-missing',
      title: 'Source workspace is not configured',
      message: 'Set the workspace to the implementation/source-code directory where AGENTS.md and published AIDD docs should be generated.',
      severity: 'warning',
      action: 'Open Home and choose the source-code workspace before generating AGENTS.md.'
    });
    return;
  }

  if (!(await exists(workspacePath))) {
    pushValidation(section, {
      id: 'workspace-directory-not-found',
      title: 'Source workspace was not found',
      message: `The configured source workspace does not exist: ${workspacePath}`,
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the directory that contains the source code.'
    });
    return;
  }

  const workspaceStat = await fsp.stat(workspacePath);
  if (!workspaceStat.isDirectory()) {
    pushValidation(section, {
      id: 'workspace-directory-not-directory',
      title: 'Source workspace is not a directory',
      message: `The configured source workspace is not a directory: ${workspacePath}`,
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the directory that contains the source code.'
    });
    return;
  }

  let issueCount = 0;

  if (sameDiskPath(workspacePath, projectPath)) {
    issueCount++;
    pushValidation(section, {
      id: 'workspace-directory-is-aidd-project',
      title: 'Source workspace cannot be the AIDD project',
      message: 'The configured workspace is the active AIDD project. Choose the separate implementation directory that contains the source code.',
      severity: 'warning',
      path: workspacePath,
      action: 'Open Home and choose the source-code workspace, not the AIDD project directory.'
    });
  } else {
    if (isSameOrInsideDiskPath(projectPath, workspacePath)) {
      issueCount++;
      pushValidation(section, {
        id: 'workspace-directory-contains-aidd-project',
        title: 'Source workspace contains the active AIDD project',
        message: `The active AIDD project is inside the configured source workspace. Workspace: ${workspacePath}. AIDD project: ${projectPath}. Agents may scan the AIDD source files if this is not corrected.`,
        severity: 'warning',
        path: workspacePath,
        action: 'Choose the implementation/source-code directory only, keeping the AIDD project outside that workspace.'
      });
    }

    if (isSameOrInsideDiskPath(workspacePath, projectPath)) {
      issueCount++;
      pushValidation(section, {
        id: 'workspace-directory-inside-aidd-project',
        title: 'Source workspace is inside the active AIDD project',
        message: `The configured source workspace is nested inside the AIDD project. Workspace: ${workspacePath}. AIDD project: ${projectPath}.`,
        severity: 'warning',
        path: workspacePath,
        action: 'Choose the real implementation/source-code directory outside the AIDD project.'
      });
    }
  }

  const sourceMarkers = await detectSourceWorkspaceMarkers(workspacePath);
  if (sourceMarkers.length === 0) {
    issueCount++;
    pushValidation(section, {
      id: 'workspace-directory-no-source-markers',
      title: 'Source workspace does not look like a code workspace',
      message: 'No common source-code markers were found at the workspace root, such as src/, Source/, package.json, .sln, .uproject, go.mod, pyproject.toml, or Cargo.toml.',
      severity: 'warning',
      path: workspacePath,
      action: 'Choose the directory that contains the project source code.'
    });
  } else {
    pushValidation(section, {
      id: 'workspace-directory-source-markers-found',
      title: 'Source workspace markers found',
      message: `Found source-code marker${sourceMarkers.length === 1 ? '' : 's'}: ${sourceMarkers.join(', ')}.`,
      severity: 'success',
      path: workspacePath
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'workspace-directory-ready',
      title: 'Source workspace is configured',
      message: `AGENTS.md will be generated at ${agentsTargetPathForWorkspace(workspacePath)}.`,
      severity: 'success',
      path: workspacePath
    });
  }
}

export async function validateWorkspacePublishing(projectPath: string, section: ProjectValidationSection) {
  const status = await evaluateWorkspacePublishStatus(projectPath);

  if (status.state === 'up-to-date') {
    pushValidation(section, {
      id: 'workspace-publishing-up-to-date',
      title: 'Published AIDD docs are up to date',
      message: `AGENTS.md and docs are current in the source workspace.${status.publishedAt ? ` Last published: ${status.publishedAt}.` : ''}`,
      severity: 'success',
      path: status.docsPath
    });
    return;
  }

  if (status.state === 'not-configured') {
    pushValidation(section, {
      id: 'workspace-publishing-not-configured',
      title: 'Workspace publishing is not configured',
      message: 'Set the source workspace on Home before publishing AGENTS.md and docs.',
      severity: 'warning',
      action: 'Open Home and choose the source workspace.'
    });
    return;
  }

  if (status.blockers.length) {
    pushValidation(section, {
      id: 'workspace-publishing-blocked',
      title: 'Workspace publishing is blocked',
      message: status.blockers.join(' '),
      severity: 'warning',
      path: status.docsPath || status.workspacePath,
      action: 'Resolve the publishing blockers, then use Home > Publish workspace docs.'
    });
    return;
  }

  if (status.state === 'missing' && !status.publishedAt) {
    pushValidation(section, {
      id: 'workspace-publishing-not-yet-published',
      title: 'Workspace docs have not been published yet',
      message: 'Use Home > Publish workspace docs to create AGENTS.md, docs/foundation.md, docs/standards.md, and docs/components.md.',
      severity: 'warning',
      path: status.docsPath,
      action: 'Open Home and click Publish workspace docs.'
    });
    return;
  }

  const issueParts = [
    status.summary.missing ? `${status.summary.missing} missing` : '',
    status.summary.stale ? `${status.summary.stale} stale` : '',
    status.summary.modified ? `${status.summary.modified} modified outside AIDD` : ''
  ].filter(Boolean);

  pushValidation(section, {
    id: 'workspace-publishing-needs-publish',
    title: status.label,
    message: issueParts.length ? `Published workspace docs need attention: ${issueParts.join(', ')}.` : status.message,
    severity: 'warning',
    path: status.docsPath,
    action: 'Open Home and click Publish workspace docs.'
  });
}

export async function validateComponentSourceLocations(projectPath: string, section: ProjectValidationSection) {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  const components = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));

  if (!components.length) {
    pushValidation(section, {
      id: 'component-source-no-components',
      title: 'No components to validate',
      message: 'Component source locations can be added after components are created.',
      severity: 'info'
    });
    return;
  }

  let configuredCount = 0;
  let issueCount = 0;

  for (const component of components) {
    const slug = String(component.slug || component.id || '').trim() || 'component';
    const title = String(component.title || slug);
    const source = normaliseComponentSource(component.source);
    if (!componentSourceIsConfigured(source)) continue;
    configuredCount += 1;

    const absolutePath = resolveComponentSourceDirectory(projectPath, source.directory, workspacePath);
    const insideWorkspace = Boolean(workspacePath && isSameOrInsideDiskPath(absolutePath, workspacePath));

    if (!workspacePath) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-workspace-missing`,
        title: `${title} source cannot be checked against workspace`,
        message: 'Set the source workspace on Home so AIDD can store component source paths relative to the workspace.',
        severity: 'warning',
        path: source.directory,
        action: 'Open Home and choose the implementation/source-code workspace.'
      });
    }

    if (!(await exists(absolutePath))) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-missing`,
        title: `${title} source location was not found`,
        message: `The configured component source path does not exist: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Open Components and choose the current source directory for this component.'
      });
      continue;
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isDirectory()) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-not-directory`,
        title: `${title} source location is not a directory`,
        message: `The configured component source path is not a directory: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Open Components and choose a directory for this component source location.'
      });
      continue;
    }

    if (workspacePath && !insideWorkspace) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-outside-workspace`,
        title: `${title} source location is outside the workspace`,
        message: `The source path is stored as an absolute path and may break for other users: ${source.directory}`,
        severity: 'warning',
        path: source.directory,
        action: 'Prefer a directory inside the configured source workspace when this component belongs to the project.'
      });
    }

    if (source.pathMode === 'absolute') {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-absolute`,
        title: `${title} source location is not portable`,
        message: 'This component source location is stored as an absolute path. It can be kept, but it may not work for other users or agents on another machine.',
        severity: 'warning',
        path: source.directory,
        action: 'Choose a source location inside the workspace to save a workspace-relative path.'
      });
    }

    const detection = normaliseComponentSourceDetection(source.detection);
    if (!detection) {
      issueCount += 1;
      pushValidation(section, {
        id: `component-source-${slug}-undetected`,
        title: `${title} source type has not been detected`,
        message: 'Run Detect in the component source card so AIDD can publish useful source type, language, and framework hints for agents.',
        severity: 'warning',
        path: source.directory,
        action: 'Open Components, configure source, then click Detect.'
      });
    } else if (detection.confidence === 'low') {
      pushValidation(section, {
        id: `component-source-${slug}-low-confidence`,
        title: `${title} source type detection is low confidence`,
        message: `Detected ${detection.suggestedType}, but with low confidence. Evidence: ${detection.reasons.slice(0, 2).join(' ')}`,
        severity: 'info',
        path: source.directory,
        action: 'Review the component source type if this looks wrong.'
      });
    }
  }

  if (configuredCount === 0) {
    pushValidation(section, {
      id: 'component-source-none-configured',
      title: 'No component source locations configured',
      message: 'Source locations are optional, but adding them helps AGENTS.md point agents at the right source directories without broad scanning.',
      severity: 'info',
      action: 'Open Components and add source locations for the components agents are likely to modify.'
    });
    return;
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'component-source-ready',
      title: 'Component source locations are usable',
      message: `${configuredCount} component source location${configuredCount === 1 ? '' : 's'} configured and portable inside the source workspace.`,
      severity: 'success'
    });
  }
}

export function buildValidationReport(sections: ProjectValidationSection[]): ProjectValidationReport {
  const items = sections.flatMap((section) => section.items);
  const summary = {
    total: items.length,
    errors: items.filter((item) => item.severity === 'error').length,
    warnings: items.filter((item) => item.severity === 'warning').length,
    info: items.filter((item) => item.severity === 'info').length,
    success: items.filter((item) => item.severity === 'success').length
  };
  const score = summary.total ? Math.max(0, Math.round(((summary.success + summary.info * 0.5) / summary.total) * 100)) : 0;
  const nextActions = items
    .filter((item) => item.severity === 'error' || item.severity === 'warning')
    .map((item) => item.action || item.title)
    .filter((value, index, array) => value && array.indexOf(value) === index)
    .slice(0, 5) as string[];

  return {
    generatedAt: new Date().toISOString(),
    status: summary.errors ? 'fail' : summary.warnings ? 'warning' : 'pass',
    score,
    canCreateDeliveryPackage: summary.errors === 0,
    summary,
    sections,
    nextActions
  };
}

export async function validateWorkspaceDeliveryPackages(projectPath: string, section: ProjectValidationSection) {
  const packages = await readDeliveryPackages(projectPath);
  const approvedPackages = packages.filter((item) => normaliseStatusForDelivery(item.status) === 'approved');

  if (!approvedPackages.length) {
    pushValidation(section, {
      id: 'workspace-delivery-no-approved-packages',
      title: 'No approved delivery packages to publish',
      message: 'Delivery packages will be published to workspace/delivery when they are approved.',
      severity: 'info'
    });
    return;
  }

  let issueCount = 0;
  for (const item of approvedPackages) {
    if (item.workspacePublishStatus === 'published') continue;
    issueCount++;
    pushValidation(section, {
      id: `workspace-delivery-${item.id}-${item.workspacePublishStatus || 'missing'}`,
      title: `${item.id} is approved but not current in workspace/delivery`,
      message: item.workspacePublishStatus === 'not-configured'
        ? 'Set the source workspace on Home so the approved delivery package can be published.'
        : item.workspacePublishStatus === 'stale'
          ? 'The AIDD delivery package changed after it was published. Republish it to workspace/delivery.'
          : 'Publish the approved package to workspace/delivery so the implementation agent can work from it.',
      severity: 'warning',
      path: item.workspacePackagePath,
      action: 'Open Delivery, select the package, then use Approve & publish or Publish to workspace.'
    });
  }

  if (issueCount === 0) {
    pushValidation(section, {
      id: 'workspace-delivery-published',
      title: 'Approved delivery packages are published',
      message: `${approvedPackages.length} approved delivery package${approvedPackages.length === 1 ? '' : 's'} available in workspace/delivery.`,
      severity: 'success'
    });
  }
}

export async function validateProject(projectPath: string): Promise<ProjectValidationReport> {
  const manifestSection = validationSection('template-manifest', 'Template manifest');
  const templateSection = validationSection('templates', 'Template files');
  const frontmatterSection = validationSection('frontmatter', 'Front matter versions');
  const dataSection = validationSection('data', 'Required data files');
  const entitySection = validationSection('entities', 'Entity data integrity');
  const workspaceSection = validationSection('workspace', 'Source workspace configuration');
  const componentSourceSection = validationSection('component-source-locations', 'Component source locations');
  const publishSection = validationSection('workspace-publishing', 'Workspace publishing');
  const deliveryPublishSection = validationSection('workspace-delivery', 'Workspace delivery packages');

  if (!projectPath || !(await exists(projectPath))) {
    pushValidation(dataSection, {
      id: 'project-path-missing',
      title: 'Project folder not found',
      message: `The selected project folder does not exist: ${projectPath || 'not set'}`,
      severity: 'error',
      action: 'Open a valid AIDD project from the Projects screen.'
    });
    return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection, workspaceSection, componentSourceSection, publishSection, deliveryPublishSection]);
  }

  await validateTemplateManifest(projectPath, manifestSection);
  await validateTemplateFiles(projectPath, templateSection);
  await validateProjectFrontmatterVersions(projectPath, frontmatterSection);
  await validateProjectDataIntegrity(projectPath, dataSection);
  await validateEntityDataIntegrity(projectPath, entitySection);
  await validateWorkspaceConfiguration(projectPath, workspaceSection);
  await validateComponentSourceLocations(projectPath, componentSourceSection);
  await validateWorkspacePublishing(projectPath, publishSection);
  await validateWorkspaceDeliveryPackages(projectPath, deliveryPublishSection);

  return buildValidationReport([manifestSection, templateSection, frontmatterSection, dataSection, entitySection, workspaceSection, componentSourceSection, publishSection, deliveryPublishSection]);
}
