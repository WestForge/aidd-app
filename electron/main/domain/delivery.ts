import matter from '../../frontmatter';
import type { ZipEntryInput } from '../shared/zip';
import { readZipFile, safeZipEntryName, safeZipReadEntryName, writeZipFile } from '../shared/zip';
import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readCapability } from './capabilityReview';
import { componentSourceIsConfigured, normaliseComponentSource, resolveComponentSourceDirectory } from './componentCore';
import { isSafeComponentTechnicalReviewSegment, readComponent, readComponentContractMarkdownForReview, readProjectName, shouldIncludeInReviewBundle } from './componentReview';
import { countTechnicalChangePatches, normaliseTechnicalChangeRecord, readComponentTechnicalChange, readComponentTechnicalChanges, writeTechnicalChangeMetadata } from './componentTechnicalChanges';
import { TEMPLATE_VERSION, copyDir, exists, readEntities, readJson, readTrackedProjectByPath, readWorkspacePathForProject, slugify, writeJson } from './projectCore';
import { collectMarkdownFiles } from './projectStatus';
import { WORKSPACE_PUBLISH_TEMPLATE_VERSION, buildPublishedComponentsMarkdown, buildPublishedFoundationMarkdown, buildPublishedStandardsMarkdown, deliveryReviewCapabilitySnapshotFileName, generatedDocHeader, isSameOrInsideDiskPath, normaliseDiskPath, normaliseRelativePath, sameDiskPath, setupStatusLabel, sha256Text, workspaceDeliveryPackagePath } from './projectValidation';
import { readSourceProjects } from './sourceDecisionsGit';
import { readFoundationDocuments, readStandardSections, standardSectionDone } from './standards';
import type { ComponentTechnicalChangeDetail, ComponentTechnicalChangeRecord, CreateDeliveryPackageFromCapabilityInput, CreateDeliveryPackageFromTechnicalChangeInput, CreateDeliveryPackagePhaseInput, DeleteDeliveryPackageInput, DeliveryPackageDetail, DeliveryPackageFileDetail, DeliveryPackagePhaseDetail, DeliveryPackageSummary, DeliveryPackageTechnicalChangeSummary, DeliveryPackageType, DeliveryReviewCollectedSource, DeliveryReviewPackageImportResult, DeliveryReviewPackageInput, DeliveryReviewPackageResult, DeliveryReviewSourceRoot, DeliveryWorkspacePublishInput, DeliveryWorkspacePublishResult, FoundationDocument, ImportDeliveryReviewPackageInput, SaveDeliveryPackageInput, StandardSection } from './types';

export async function assertProjectFoundationReady(projectPath: string) {
  const foundation = await readFoundationDocuments(projectPath);
  const standardSections = await readStandardSections(projectPath);
  const incompleteFoundation = foundation.filter((doc) => doc.required !== false && doc.status !== 'complete');
  const incompleteStandards = standardSections.filter((section) => !standardSectionDone(section));
  const blockers: string[] = [];
  for (const doc of incompleteFoundation) blockers.push(`${doc.title} is ${doc.status.replace(/-/g, ' ')}`);
  for (const section of incompleteStandards) blockers.push(`${section.title} standard is ${section.status.replace(/-/g, ' ')}`);
  if (blockers.length) {
    throw new Error(`Project Context must be complete before creating a delivery package. Missing: ${blockers.join('; ')}`);
  }
  return { foundation, standardSections };
}

export function buildProjectFoundationSnapshot(foundation: FoundationDocument[], standardSections: StandardSection[]) {
  const foundationSections = foundation.map((doc) => [
    `## ${doc.title}`,
    '',
    `- Status: ${doc.status}`,
    `- Source: foundation/${doc.fileName}`,
    '',
    doc.body.trim() || '_No content captured._'
  ].join('\n'));

  const standardsSections = standardSections.map((section) => [
    `## ${section.title}`,
    '',
    `- Status: ${section.status}`,
    `- Source: foundation/standards/${section.fileName}`,
    '',
    section.body.trim() || '_No content captured._'
  ].join('\n'));

  return [
    '## Project Context Snapshot',
    '',
    'This section is captured because every delivery package must inherit the approved project foundation and standards.',
    '',
    ...foundationSections,
    '',
    '## Project Standards Snapshot',
    '',
    ...standardsSections
  ].join('\n');
}

export async function assertProjectTechnicalStandardsReady(projectPath: string) {
  const standardSections = await readStandardSections(projectPath);
  const incompleteStandards = standardSections.filter((section) => !standardSectionDone(section));
  if (incompleteStandards.length) {
    throw new Error(`Project Standards must be complete before creating a technical delivery package. Missing: ${incompleteStandards.map((section) => `${section.title} is ${section.status.replace(/-/g, ' ')}`).join('; ')}`);
  }
  return { standardSections };
}

export function buildProjectTechnicalStandardsSnapshot(standardSections: StandardSection[]) {
  const standardsSections = standardSections.map((section) => [
    `## ${section.title}`,
    '',
    `- Status: ${section.status}`,
    `- Source: foundation/standards/${section.fileName}`,
    '',
    section.body.trim() || '_No content captured._'
  ].join('\n'));

  return [
    '## Technical Standards Snapshot',
    '',
    'This technical delivery package includes project standards and component constraints only. Product foundation narrative is intentionally omitted.',
    '',
    ...standardsSections
  ].join('\n');
}

export function buildComponentTechnicalConstraintsSnapshot(component: Awaited<ReturnType<typeof readComponent>>, componentContract: string) {
  const lines = [
    `## Component Technical Constraints: ${component.title}`,
    '',
    `- Component: \`${component.slug}\``,
    `- Status: \`${setupStatusLabel(component.status)}\``,
    component.source?.directory ? `- Source: \`${component.source.directory}\`` : '- Source: _not configured_',
    component.capabilities.length ? `- Linked capabilities: ${component.capabilities.map((item) => `\`${item}\``).join(', ')}` : '- Linked capabilities: _none_',
    '',
    '### Component Contract',
    '',
    componentContract.trim() || '_No component contract has been generated._',
    '',
    '### Component Sections',
    ''
  ];

  for (const section of component.sections || []) {
    lines.push(
      `#### ${section.title}`,
      '',
      `- Source: components/${component.slug}/${section.fileName}`,
      `- Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildTechnicalChangeSnapshot(change: ComponentTechnicalChangeDetail) {
  const lines = [
    `## Technical Change: ${change.title}`,
    '',
    `- Id: \`${change.id}\``,
    `- Component: \`${change.componentSlug}\``,
    `- Status: \`${change.status}\``,
    `- Risk: \`${change.risk}\``,
    `- Patch files: \`${change.patchCount}\``,
    '',
  ];

  for (const section of change.sections.filter((item) => !item.fileName.startsWith('patches/'))) {
    lines.push(
      `### ${section.title}`,
      '',
      section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function requireDeliveryWorkspace(projectPath: string) {
  const trackedProject = await readTrackedProjectByPath(projectPath);
  const workspacePath = trackedProject?.workspacePath?.trim();
  if (!workspacePath) throw new Error('Choose the implementation/source-code workspace on Home before publishing delivery packages.');
  if (!(await exists(workspacePath))) throw new Error(`The configured source workspace does not exist: ${workspacePath}`);
  const stat = await fsp.stat(workspacePath);
  if (!stat.isDirectory()) throw new Error(`The configured source workspace is not a directory: ${workspacePath}`);
  if (sameDiskPath(workspacePath, projectPath)) throw new Error('The source workspace cannot be the active AIDD project.');
  return workspacePath;
}

export function deliveryPackageSourceHash(detail: DeliveryPackageDetail) {
  return sha256Text(JSON.stringify({
    templateVersion: WORKSPACE_PUBLISH_TEMPLATE_VERSION,
    id: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: detail.status,
    sourceCapability: detail.sourceCapability,
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components,
    technicalChanges: detail.technicalChanges || [],
    strategyBody: detail.strategyBody,
    snapshotBody: detail.snapshotBody,
    phases: detail.phases.map((phase) => ({ id: phase.id, title: phase.title, status: phase.status, fileName: phase.fileName, body: phase.body }))
  }));
}

export function isDeliveryPhaseFileName(fileName: string) {
  return /^(phase|stage)-[\w-]+\.md$/i.test(fileName);
}

export function isWorkspaceDeliveryFileName(fileName: string) {
  return fileName === 'implementation-strategy.md' || isDeliveryPhaseFileName(fileName);
}

export function buildPublishedDeliveryStrategyFileMarkdown(detail: DeliveryPackageDetail) {
  return matter.stringify((detail.strategyBody || '').trim() + '\n', {
    aidd: { type: 'workspace-delivery-strategy', templateVersion: TEMPLATE_VERSION },
    deliveryPackage: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: detail.status,
    sourceCapability: detail.sourceCapability || '',
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components || [],
    publishedBy: 'AIDD'
  });
}

export function buildPublishedDeliveryPhaseFileMarkdown(detail: DeliveryPackageDetail, phase: DeliveryPackagePhaseDetail, index: number) {
  const title = phase.title?.trim() || `Phase ${index + 1}`;
  return matter.stringify((phase.body || '').trim() + '\n', {
    aidd: { type: 'workspace-delivery-phase', templateVersion: TEMPLATE_VERSION },
    id: phase.id || phaseIdFromFileName(phase.fileName),
    title,
    status: phase.status || detail.status || 'approved',
    deliveryPackage: detail.id,
    order: index + 1,
    publishedBy: 'AIDD'
  });
}

export function extractWorkspacePhaseStatus(markdown: string) {
  try {
    const parsed = matter(markdown);
    const frontmatterStatus = String((parsed.data as any)?.status || '').trim();
    if (frontmatterStatus) return normaliseStatusForDelivery(frontmatterStatus);
    const inlineStatus = parsed.content.match(/^\s*Status\s*:\s*([^\n]+)/im)?.[1]?.trim();
    if (inlineStatus) return normaliseStatusForDelivery(inlineStatus);
  } catch {
    const inlineStatus = markdown.match(/^\s*Status\s*:\s*([^\n]+)/im)?.[1]?.trim();
    if (inlineStatus) return normaliseStatusForDelivery(inlineStatus);
  }
  return '';
}

export function markdownHasCheckedTask(markdown: string) {
  return /-\s*\[[xX]\]/.test(markdown);
}

export async function readWorkspaceDeliveryExecutionState(targetPath: string, publishedManifest?: any) {
  const files: string[] = [];
  const phaseStatuses: string[] = [];
  let hasCheckedTask = false;

  if (await exists(targetPath)) {
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (!entry.isFile() || !isWorkspaceDeliveryFileName(entry.name)) continue;
      files.push(entry.name);
      if (!isDeliveryPhaseFileName(entry.name)) continue;
      const content = await fsp.readFile(path.join(targetPath, entry.name), 'utf8');
      const phaseStatus = extractWorkspacePhaseStatus(content);
      if (phaseStatus) phaseStatuses.push(phaseStatus);
      if (markdownHasCheckedTask(content)) hasCheckedTask = true;
    }
  }

  const phaseCount = files.filter(isDeliveryPhaseFileName).length;
  const manifestStatusRaw = String(publishedManifest?.status || '').trim();
  const manifestStatus = manifestStatusRaw ? normaliseStatusForDelivery(manifestStatusRaw) : '';
  const completeStatuses = new Set(['done', 'accepted', 'complete']);
  const inProgressStatuses = new Set(['in-progress', 'active']);

  let workspaceStatus = manifestStatus && manifestStatus !== 'packaging' ? manifestStatus : 'approved';
  if (phaseCount > 0 && phaseStatuses.length === phaseCount && phaseStatuses.every((status) => completeStatuses.has(status))) {
    workspaceStatus = 'done';
  } else if (phaseStatuses.some((status) => inProgressStatuses.has(status) || completeStatuses.has(status)) || hasCheckedTask) {
    workspaceStatus = 'in-progress';
  }

  return { files, phaseCount, workspaceStatus };
}

export function buildPublishedDeliveryBriefMarkdown(detail: DeliveryPackageDetail) {
  const phaseSections = detail.phases.length
    ? detail.phases.map((phase, index) => [
        `## Phase ${index + 1}: ${phase.title}`,
        '',
        `Status: ${phase.status}`,
        '',
        phase.body?.trim() || '_No phase content._'
      ].join('\n')).join('\n\n')
    : '_No implementation phases have been created._';

  return [
    `# ${detail.id} ${detail.title}`,
    '',
    '<!-- Generated by AIDD. Update the delivery package in AIDD and republish rather than editing this file directly. -->',
    '',
    `Status: ${detail.status}`,
    detail.sourceCapability ? `Source capability: ${detail.sourceCapability}` : '',
    detail.components.length ? `Components: ${detail.components.join(', ')}` : '',
    '',
    '## Operating context',
    '',
    'Read these generated workspace docs before implementing this delivery package:',
    '',
    '- `../../docs/foundation.md`',
    '- `../../docs/standards.md`',
    '- `../../docs/components.md`',
    '',
    'Update the writable files in this folder as work progresses. Do not edit generated workspace docs directly.',
    '',
    '## Implementation strategy',
    '',
    detail.strategyBody?.trim() || '_No implementation strategy has been captured._',
    '',
    '## Implementation phases',
    '',
    phaseSections,
    ''
  ].join('\n');
}

export function buildPublishedDeliveryContextMarkdown(detail: DeliveryPackageDetail) {
  return [
    `# ${detail.id} Context`,
    '',
    '<!-- Generated by AIDD. Update the delivery package in AIDD and republish rather than editing this file directly. -->',
    '',
    'This file contains the delivery context snapshot captured in AIDD when the package was created or updated.',
    '',
    detail.snapshotBody?.trim() || '_No context snapshot has been captured._',
    ''
  ].join('\n');
}

export function buildWorkspaceDeliveryWritableMarkdown(title: string, body: string) {
  return [
    `# ${title}`,
    '',
    '<!-- Writable by the implementation agent. AIDD will preserve this file when republishing the package. -->',
    '',
    body,
    ''
  ].join('\n');
}

export async function writeDeliveryGeneratedFile(targetPath: string, content: string, writtenFiles: string[], skippedFiles: string[], relativePath: string) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  if (await exists(targetPath)) {
    const current = await fsp.readFile(targetPath, 'utf8');
    if (sha256Text(current) === sha256Text(content)) {
      skippedFiles.push(relativePath);
      return;
    }
  }
  await fsp.writeFile(targetPath, content, 'utf8');
  writtenFiles.push(relativePath);
}

export async function writeDeliveryGeneratedTree(sourceRoot: string, targetRoot: string, relativeRoot: string, writtenFiles: string[], skippedFiles: string[]) {
  const generatedFiles: string[] = [];
  if (!(await exists(sourceRoot))) return generatedFiles;

  async function walk(currentDir: string) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const sourcePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(sourcePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normaliseRelativePath(path.join(relativeRoot, path.relative(sourceRoot, sourcePath)));
      const content = await fsp.readFile(sourcePath, 'utf8');
      await writeDeliveryGeneratedFile(path.join(targetRoot, relativePath), content, writtenFiles, skippedFiles, relativePath);
      generatedFiles.push(relativePath);
    }
  }

  await walk(sourceRoot);
  return generatedFiles;
}

export async function readDeliveryWorkspacePublicationState(projectPath: string, packageId: string, manifest?: any): Promise<Partial<DeliveryPackageSummary>> {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  if (!workspacePath) return { workspacePublishStatus: 'not-configured', workspacePublished: false };
  const targetPath = workspaceDeliveryPackagePath(workspacePath, packageId);
  const manifestPath = path.join(targetPath, 'manifest.json');
  if (!(await exists(manifestPath))) {
    return { workspacePackagePath: targetPath, workspacePublishStatus: 'missing', workspacePublished: false };
  }

  let publishedAt = manifest?.workspaceDelivery?.publishedAt || '';
  let publishedManifest: any = {};
  try {
    publishedManifest = await readJson<any>(manifestPath);
    publishedAt = String(publishedManifest.publishedAt || publishedAt || '');
  } catch {
    // Keep the package visible; the Health Check can flag corrupt workspace files later.
  }

  const execution = await readWorkspaceDeliveryExecutionState(targetPath, publishedManifest);
  const sourceStatus = normaliseStatusForDelivery(manifest?.status || '');
  const effectiveWorkspaceStatus = sourceStatus === 'done' ? 'done' : execution.workspaceStatus;
  const updatedAt = manifest?.updatedAt || manifest?.createdAt || '';
  const manifestSourceHash = String(manifest?.workspaceDelivery?.sourceHash || '');
  const publishedSourceHash = String(publishedManifest?.sourceHash || '');
  const staleByHash = Boolean(manifestSourceHash && publishedSourceHash && manifestSourceHash !== publishedSourceHash);
  const staleByDate = Boolean(publishedAt && updatedAt && Date.parse(updatedAt) > Date.parse(publishedAt));
  const isStale = staleByHash || staleByDate;

  return {
    workspacePackagePath: targetPath,
    workspacePublished: true,
    workspacePublishedAt: publishedAt || undefined,
    workspacePublishStatus: isStale ? 'stale' : 'published',
    workspaceStatus: effectiveWorkspaceStatus,
    workspacePhaseCount: execution.phaseCount,
    workspaceDeliveryFiles: execution.files,
    status: effectiveWorkspaceStatus,
    ...(execution.phaseCount ? { phaseCount: execution.phaseCount } : {})
  };
}

export async function createDeliveryPackageFromCapability(input: CreateDeliveryPackageFromCapabilityInput) {
  const { foundation, standardSections } = await assertProjectFoundationReady(input.projectPath);
  const foundationSnapshot = buildProjectFoundationSnapshot(foundation, standardSections);
  const capability = await readCapability({ projectPath: input.projectPath, slug: input.capabilitySlug });
  const existing = await readEntities(input.projectPath, 'delivery/packages', 'package.json');
  const nextNumber = existing.length + 1;
  const id = `DP-${String(nextNumber).padStart(3, '0')}-${slugify(capability.title)}`;
  const dir = path.join(input.projectPath, 'delivery', 'packages', id);
  if (await exists(dir)) throw new Error(`Delivery package already exists: ${id}`);
  await fsp.mkdir(dir, { recursive: true });

  const componentSnapshots: string[] = [];
  for (const componentSlug of capability.components || []) {
    const componentDir = path.join(input.projectPath, 'components', componentSlug);
    const manifestPath = path.join(componentDir, 'component.json');
    const indexPath = path.join(componentDir, 'index.md');
    if (await exists(manifestPath)) {
      const manifest = await readJson<any>(manifestPath);
      const content = await exists(indexPath) ? await fsp.readFile(indexPath, 'utf8') : '';
      componentSnapshots.push([
        `## Component: ${manifest.title || componentSlug}`,
        '',
        `- Slug: ${componentSlug}`,
        `- Status: ${manifest.status || manifest.lifecycle || 'draft'}`,
        '',
        content.trim()
      ].join('\n'));
    }
  }
  const technicalChangeCandidates = await collectComponentTechnicalChangesForDelivery(input.projectPath, capability.components || []);
  const technicalChangeDelivery = await copyApprovedTechnicalChangesIntoDeliveryPackage({
    projectPath: input.projectPath,
    packageDir: dir,
    packageId: id,
    approved: technicalChangeCandidates.approved,
    excluded: technicalChangeCandidates.excluded
  });

  const snapshot = matter.stringify([
    `# Delivery Package Snapshot: ${capability.title}`,
    '',
    'This snapshot freezes the approved project foundation, capability, and component context at the point the delivery package was created.',
    '',
    foundationSnapshot,
    '',
    '## Capability Snapshot',
    '',
    Array.isArray((capability as any).sections) && (capability as any).sections.length
      ? (capability as any).sections.map((section: any) => [
          `### ${section.title}`,
          '',
          `- Source: capabilities/${capability.slug}/${section.fileName}`,
          `- Status: ${section.status || 'not-started'}`,
          '',
          section.body?.trim() || '_No content captured._'
        ].join('\n')).join('\n\n')
      : capability.body.trim(),
    '',
    '## Component Snapshots',
    '',
    componentSnapshots.length ? componentSnapshots.join('\n\n---\n\n') : 'No components were linked when this delivery package was created.',
    '',
    buildDeliveryTechnicalChangesIndexMarkdown(technicalChangeDelivery.included, technicalChangeDelivery.excluded).trim(),
    ''
  ].join('\n'), {
    aidd: { type: 'delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
    id,
    title: capability.title,
    packageType: 'capability',
    sourceCapability: capability.slug,
    components: capability.components || [],
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  const strategy = matter.stringify([
    '# Implementation Strategy',
    '',
    'This file should be refined before AI implementation starts.',
    '',
    '## Objective',
    '',
    `Implement or refine the capability: ${capability.title}.`,
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the implementation approach after refinement.',
    '',
    '## Source Code Reference',
    '',
    'TODO: Link the relevant source directory, files, or components.',
    '',
    '## Risks / Unknowns',
    '',
    'TODO: Capture risks, assumptions, and open questions.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define how the implementation will be verified.',
    ''
  ].join('\n'), {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${id}-strategy`,
    deliveryPackage: id,
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  await writeJson(path.join(dir, 'package.json'), {
    id,
    title: capability.title,
    packageType: 'capability',
    status: 'draft',
    sourceCapability: capability.slug,
    components: capability.components || [],
    technicalChanges: technicalChangeDelivery.included,
    excludedTechnicalChanges: technicalChangeDelivery.excluded,
    createdAt: new Date().toISOString()
  });
  await fsp.writeFile(path.join(dir, 'snapshot.md'), snapshot, 'utf8');
  await fsp.writeFile(path.join(dir, 'implementation-strategy.md'), strategy, 'utf8');
  return { id, path: dir };
}

export async function createDeliveryPackageFromTechnicalChange(input: CreateDeliveryPackageFromTechnicalChangeInput) {
  const { standardSections } = await assertProjectTechnicalStandardsReady(input.projectPath);
  const component = await readComponent({ projectPath: input.projectPath, slug: input.componentSlug });
  const change = await readComponentTechnicalChange({
    projectPath: input.projectPath,
    slug: component.slug,
    id: input.technicalChangeId
  });

  if (change.status !== 'approved') {
    throw new Error(`Only approved technical changes can be packaged for delivery. ${change.id} is ${change.status.replace(/-/g, ' ')}.`);
  }

  const existing = await readEntities(input.projectPath, 'delivery/packages', 'package.json');
  const nextNumber = existing.length + 1;
  const id = `DP-${String(nextNumber).padStart(3, '0')}-${slugify(change.title)}`;
  const dir = path.join(input.projectPath, 'delivery', 'packages', id);
  if (await exists(dir)) throw new Error(`Delivery package already exists: ${id}`);
  await fsp.mkdir(dir, { recursive: true });

  const technicalChangeDelivery = await copyApprovedTechnicalChangesIntoDeliveryPackage({
    projectPath: input.projectPath,
    packageDir: dir,
    packageId: id,
    approved: [change],
    excluded: []
  });
  const includedChange = technicalChangeDelivery.included[0] || deliveryTechnicalChangeSummary(change);
  const componentContract = await readComponentContractMarkdownForReview(input.projectPath, component);

  const snapshot = matter.stringify([
    `# Technical Delivery Snapshot: ${change.title}`,
    '',
    'This snapshot contains technical delivery context only. Product foundation and capability narrative are intentionally omitted so implementation stays focused on technical constraints.',
    '',
    buildProjectTechnicalStandardsSnapshot(standardSections),
    '',
    buildComponentTechnicalConstraintsSnapshot(component, componentContract).trim(),
    '',
    buildTechnicalChangeSnapshot(change).trim(),
    ''
  ].join('\n'), {
    aidd: { type: 'technical-delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
    id,
    title: change.title,
    packageType: 'technical',
    sourceTechnicalChange: {
      componentSlug: component.slug,
      technicalChangeId: change.id,
      title: change.title
    },
    components: [component.slug],
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  const strategy = matter.stringify([
    '# Implementation Strategy',
    '',
    'This package implements an approved technical change. Keep implementation inside the technical change scope and component constraints.',
    '',
    '## Objective',
    '',
    `Implement technical change ${change.id}: ${change.title}.`,
    '',
    '## Technical Constraints',
    '',
    '- Follow the included project standards.',
    '- Stay inside the component source area unless the technical change explicitly requires otherwise.',
    '- Treat the approved technical change files as the source of delivery intent.',
    '- Do not expand the work into unrelated product or capability changes.',
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the implementation approach after reviewing the technical change, component contract, and source code.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define tests, commands, manual checks, and evidence required for this technical change.',
    ''
  ].join('\n'), {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${id}-strategy`,
    deliveryPackage: id,
    packageType: 'technical',
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  await writeJson(path.join(dir, 'package.json'), {
    id,
    title: change.title,
    packageType: 'technical',
    status: 'draft',
    sourceTechnicalChange: {
      componentSlug: component.slug,
      technicalChangeId: change.id,
      title: change.title
    },
    components: [component.slug],
    technicalChanges: [{ ...includedChange, status: 'approved' }],
    excludedTechnicalChanges: [],
    createdAt: new Date().toISOString()
  });
  await fsp.writeFile(path.join(dir, 'snapshot.md'), snapshot, 'utf8');
  await fsp.writeFile(path.join(dir, 'implementation-strategy.md'), strategy, 'utf8');
  return { id, path: dir };
}

export function deliveryStatusFromManifest(manifest: any, packaged: boolean, phaseCount: number): string {
  const raw = String(manifest.status || '').trim().toLowerCase();
  if (raw) return normaliseStatusForDelivery(raw);
  if (manifest.acceptedAt || manifest.completedAt) return 'done';
  if (manifest.startedAt || manifest.inProgressAt) return 'in-progress';
  if (manifest.approvedAt) return 'approved';
  if (manifest.reviewRequestedAt || manifest.submittedAt) return 'packaging';
  if (packaged || phaseCount > 0) return 'packaging';
  return 'draft';
}

export function normaliseStatusForDelivery(status?: string) {
  const value = String(status || 'draft').trim().toLowerCase();
  if (value === 'approved-for-ai') return 'approved';
  if (value === 'in-ai-execution' || value === 'active') return 'in-progress';
  if (value === 'complete' || value === 'accepted') return 'done';
  if (value === 'review' || value === 'in-review' || value === 'needs-review' || value === 'needs-verification') return 'packaging';
  if (value === 'approved' || value === 'in-progress' || value === 'done') return value;
  return 'packaging';
}

export function deliveryTechnicalChangeSummary(change: ComponentTechnicalChangeRecord, relativePath?: string): DeliveryPackageTechnicalChangeSummary {
  return {
    id: change.id,
    title: change.title,
    componentSlug: change.componentSlug,
    status: change.status,
    risk: change.risk,
    patchCount: change.patchCount,
    ...(relativePath ? { relativePath } : change.relativePath ? { relativePath: change.relativePath } : {})
  };
}

export function normaliseDeliveryPackageTechnicalChanges(input: any): DeliveryPackageTechnicalChangeSummary[] {
  if (!Array.isArray(input)) return [];
  return input.map((item: any) => ({
    id: String(item?.id || ''),
    title: String(item?.title || item?.id || 'Technical change'),
    componentSlug: String(item?.componentSlug || ''),
    status: String(item?.status || ''),
    risk: String(item?.risk || 'unknown'),
    patchCount: Number.isFinite(Number(item?.patchCount)) ? Number(item.patchCount) : 0,
    ...(item?.relativePath ? { relativePath: normaliseRelativePath(String(item.relativePath)) } : {})
  })).filter((item) => item.id);
}

export async function collectComponentTechnicalChangesForDelivery(projectPath: string, componentSlugs: string[]) {
  const approved: ComponentTechnicalChangeRecord[] = [];
  const excluded: ComponentTechnicalChangeRecord[] = [];
  const seen = new Set<string>();

  for (const componentSlug of componentSlugs.map((item) => slugify(item)).filter(Boolean)) {
    if (seen.has(componentSlug)) continue;
    seen.add(componentSlug);
    const changes = await readComponentTechnicalChanges(projectPath, componentSlug);
    for (const change of changes) {
      if (change.status === 'approved') approved.push(change);
      else excluded.push(change);
    }
  }

  return { approved, excluded };
}

export async function markTechnicalChangePackaged(projectPath: string, change: ComponentTechnicalChangeRecord, packageId: string) {
  const changeDir = path.join(projectPath, change.relativePath);
  const metadataPath = path.join(changeDir, 'technical-change.json');
  if (!(await exists(metadataPath))) return;
  const raw = await readJson<any>(metadataPath);
  const current = normaliseTechnicalChangeRecord(raw, projectPath, change.componentSlug, changeDir);
  const deliveryPackageIds = Array.from(new Set([...(current.deliveryPackageIds || []), packageId]));
  await writeTechnicalChangeMetadata(changeDir, {
    ...current,
    status: 'packaged',
    patchCount: await countTechnicalChangePatches(changeDir),
    deliveryPackageIds,
    updatedAt: new Date().toISOString()
  });
}

export async function copyApprovedTechnicalChangesIntoDeliveryPackage(input: {
  projectPath: string;
  packageDir: string;
  packageId: string;
  approved: ComponentTechnicalChangeRecord[];
  excluded: ComponentTechnicalChangeRecord[];
}) {
  const targetRoot = path.join(input.packageDir, 'technical-changes');
  const usedFolders = new Set<string>();
  const included: DeliveryPackageTechnicalChangeSummary[] = [];

  for (const change of input.approved) {
    const sourceDir = path.join(input.projectPath, change.relativePath);
    if (!(await exists(sourceDir))) continue;
    let folderName = isSafeComponentTechnicalReviewSegment(change.id) ? change.id : slugify(change.id) || 'technical-change';
    if (usedFolders.has(folderName.toLowerCase()) || (await exists(path.join(targetRoot, folderName)))) {
      folderName = slugify(`${change.componentSlug}-${change.id}`) || folderName;
    }
    usedFolders.add(folderName.toLowerCase());
    const targetDir = path.join(targetRoot, folderName);
    await copyDir(sourceDir, targetDir);
    const relativePath = normaliseRelativePath(path.relative(input.packageDir, targetDir));
    included.push({
      ...deliveryTechnicalChangeSummary(change, relativePath),
      status: 'approved'
    });
    await markTechnicalChangePackaged(input.projectPath, change, input.packageId);
  }

  const excluded = input.excluded.map((change) => deliveryTechnicalChangeSummary(change));
  if (included.length) {
    await fsp.mkdir(targetRoot, { recursive: true });
    await fsp.writeFile(path.join(targetRoot, 'index.md'), buildDeliveryTechnicalChangesIndexMarkdown(included, []), 'utf8');
  }

  return { included, excluded };
}

export function buildDeliveryTechnicalChangesIndexMarkdown(included: DeliveryPackageTechnicalChangeSummary[], excluded: DeliveryPackageTechnicalChangeSummary[]) {
  const lines = [
    '# Technical Changes',
    '',
    'This delivery package includes approved technical changes only.',
    '',
    '## Included',
    '',
    included.length
      ? included.map((change) => `- ${change.id} ${change.title} (${change.componentSlug}, ${change.risk} risk, ${change.patchCount} patch${change.patchCount === 1 ? '' : 'es'})`).join('\n')
      : '- None',
    '',
    '## Excluded',
    '',
    excluded.length
      ? excluded.map((change) => `- ${change.id} ${change.title} (${change.componentSlug}) - ${change.status}`).join('\n')
      : '- None',
    ''
  ];
  return `${lines.join('\n').trim()}\n`;
}

export async function buildDeliveryPackageTechnicalChangeSection(packageDir: string, changes: DeliveryPackageTechnicalChangeSummary[]) {
  if (!changes.length) return '';
  const lines = ['## Approved Technical Changes', ''];
  for (const change of changes) {
    lines.push(`### ${change.id} ${change.title}`, '');
    lines.push(`- Component: \`${change.componentSlug}\``);
    lines.push(`- Risk: \`${change.risk}\``);
    lines.push(`- Patches: \`${change.patchCount}\``);
    if (change.relativePath) lines.push(`- Source: \`${change.relativePath}\``);
    const overviewPath = change.relativePath ? path.join(packageDir, change.relativePath, 'overview.md') : '';
    if (overviewPath && await exists(overviewPath)) {
      const overview = matter(await fsp.readFile(overviewPath, 'utf8')).content.trim();
      if (overview) lines.push('', overview);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export async function buildDeliveryTechnicalChangesContextMarkdown(packageDir: string, changes: DeliveryPackageTechnicalChangeSummary[]) {
  const body = await buildDeliveryPackageTechnicalChangeSection(packageDir, changes);
  return [
    generatedDocHeader('AIDD technical changes'),
    '# AIDD Technical Changes',
    '',
    'This file contains approved technical-change context for this delivery package. Treat it as delivery intent, not broad product context.',
    '',
    body || '_No approved technical changes were included._',
    ''
  ].join('\n');
}

export async function countPackagePhases(dir: string) {
  if (!(await exists(dir))) return 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)).length;
}

export async function readDeliveryPackageSummariesFrom(root: string, relativeDir: string, manifestName: string): Promise<DeliveryPackageSummary[]> {
  const dir = path.join(root, relativeDir);
  if (!(await exists(dir))) return [];
  const items: DeliveryPackageSummary[] = [];

  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const packageDir = path.join(dir, entry.name);
    const manifestPath = path.join(packageDir, manifestName);
    if (!(await exists(manifestPath))) continue;

    const manifest = await readJson<any>(manifestPath);
    const snapshotExists = await exists(path.join(packageDir, 'snapshot.md'));
    const strategyExists = await exists(path.join(packageDir, 'implementation-strategy.md'));
    const assembledExists = await exists(path.join(packageDir, 'delivery-package.md')) || await exists(path.join(packageDir, 'package.md'));
    const phaseCount = await countPackagePhases(packageDir);
    const packaged = Boolean(assembledExists || (snapshotExists && strategyExists));

    const id = String(manifest.id || entry.name);
    const workspacePublication = await readDeliveryWorkspacePublicationState(root, id, manifest);
    items.push({
      id,
      title: String(manifest.title || manifest.name || entry.name),
      packageType: manifest.packageType === 'technical' ? 'technical' : 'capability',
      status: deliveryStatusFromManifest(manifest, packaged, phaseCount),
      sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
      sourceTechnicalChange: manifest.sourceTechnicalChange && typeof manifest.sourceTechnicalChange === 'object'
        ? {
            componentSlug: String(manifest.sourceTechnicalChange.componentSlug || ''),
            technicalChangeId: String(manifest.sourceTechnicalChange.technicalChangeId || ''),
            title: String(manifest.sourceTechnicalChange.title || '')
          }
        : undefined,
      components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
      technicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.technicalChanges),
      excludedTechnicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.excludedTechnicalChanges),
      createdAt: manifest.createdAt || manifest.updatedAt,
      packaged,
      phaseCount,
      priority: typeof manifest.priority === 'number' ? manifest.priority : undefined,
      ...workspacePublication
    });
  }

  return items;
}

export async function readDeliveryPackages(projectPath: string): Promise<DeliveryPackageSummary[]> {
  const packages = await readDeliveryPackageSummariesFrom(projectPath, 'delivery/packages', 'package.json');
  const bundles = await readDeliveryPackageSummariesFrom(projectPath, 'delivery/bundles', 'bundle.json');
  const seen = new Set<string>();
  return [...packages, ...bundles]
    .filter((item) => {
      const key = item.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const priority = (a.priority ?? 999) - (b.priority ?? 999);
      if (priority !== 0) return priority;
      return a.id.localeCompare(b.id);
    });
}

export async function findDeliveryPackageTarget(projectPath: string, id: string) {
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new Error('Delivery package id is required.');

  const candidates = [
    { dir: path.join(projectPath, 'delivery', 'packages', cleanId), manifestName: 'package.json' },
    { dir: path.join(projectPath, 'delivery', 'bundles', cleanId), manifestName: 'bundle.json' }
  ];

  const projectRoot = path.resolve(projectPath);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.dir);
    if (!resolved.startsWith(projectRoot + path.sep)) continue;
    if (await exists(path.join(candidate.dir, candidate.manifestName))) return candidate;
  }

  throw new Error(`Delivery package not found: ${cleanId}`);
}

export async function readMarkdownBody(filePath: string) {
  if (!(await exists(filePath))) return '';
  const parsed = matter(await fsp.readFile(filePath, 'utf8'));
  return parsed.content.trim();
}

export async function writeMarkdownBody(filePath: string, body: string, fallbackData: Record<string, unknown> = {}) {
  let data = fallbackData;
  if (await exists(filePath)) {
    data = { ...fallbackData, ...matter(await fsp.readFile(filePath, 'utf8')).data };
  }
  await fsp.writeFile(filePath, matter.stringify((body || '').trim() + '\n', data), 'utf8');
}

export function phaseIdFromFileName(fileName: string) {
  return fileName.replace(/\.md$/i, '');
}

export async function listDeliveryPackageFiles(packageDir: string): Promise<DeliveryPackageFileDetail[]> {
  const files: DeliveryPackageFileDetail[] = [];

  async function walk(currentDir: string, relativeDir = '') {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name).replace(/\\/g, '/') : entry.name;
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        files.push({
          name: entry.name,
          relativePath,
          kind: 'directory',
          editable: false
        });
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = await fsp.stat(absolutePath);
      const extension = path.extname(entry.name).toLowerCase();
      files.push({
        name: entry.name,
        relativePath,
        kind: 'file',
        sizeBytes: stat.size,
        extension,
        editable: extension === '.md'
      });
    }
  }

  await walk(packageDir);
  return files;
}

export async function readDeliveryPackage(input: { projectPath: string; id: string }): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.id);
  const manifestPath = path.join(target.dir, target.manifestName);
  const manifest = await readJson<any>(manifestPath);
  const fallbackId = String(manifest.id || input.id);
  const summary = (await readDeliveryPackages(input.projectPath)).find((item) => item.id === fallbackId) || {
    id: fallbackId,
    title: String(manifest.title || manifest.name || input.id),
    packageType: manifest.packageType === 'technical' ? 'technical' : 'capability',
    status: String(manifest.status || 'draft'),
    sourceCapability: manifest.sourceCapability || manifest.capability || manifest.capabilitySlug,
    sourceTechnicalChange: manifest.sourceTechnicalChange && typeof manifest.sourceTechnicalChange === 'object'
      ? {
          componentSlug: String(manifest.sourceTechnicalChange.componentSlug || ''),
          technicalChangeId: String(manifest.sourceTechnicalChange.technicalChangeId || ''),
          title: String(manifest.sourceTechnicalChange.title || '')
        }
      : undefined,
    components: Array.isArray(manifest.components) ? manifest.components.map(String) : [],
    technicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.technicalChanges),
    excludedTechnicalChanges: normaliseDeliveryPackageTechnicalChanges(manifest.excludedTechnicalChanges),
    createdAt: manifest.createdAt || manifest.updatedAt,
    packaged: false,
    phaseCount: 0,
    ...(await readDeliveryWorkspacePublicationState(input.projectPath, fallbackId, manifest))
  };

  const entries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phases: DeliveryPackagePhaseDetail[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^(phase|stage)-[\w-]+\.md$/i.test(entry.name)) continue;
    const filePath = path.join(target.dir, entry.name);
    const parsed = matter(await fsp.readFile(filePath, 'utf8'));
    phases.push({
      id: String(parsed.data.id || phaseIdFromFileName(entry.name)),
      title: String(parsed.data.title || phaseIdFromFileName(entry.name).replace(/^(phase|stage)-/, '').replace(/-/g, ' ')),
      status: String(parsed.data.status || 'draft'),
      fileName: entry.name,
      body: parsed.content.trim()
    });
  }
  phases.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

  return {
    ...summary,
    packagePath: target.dir,
    snapshotBody: await readMarkdownBody(path.join(target.dir, 'snapshot.md')),
    strategyBody: await readMarkdownBody(path.join(target.dir, 'implementation-strategy.md')),
    packagedBody: await readMarkdownBody(path.join(target.dir, 'delivery-package.md')) || await readMarkdownBody(path.join(target.dir, 'package.md')),
    phases,
    files: await listDeliveryPackageFiles(target.dir)
  };
}

export async function saveDeliveryPackage(input: SaveDeliveryPackageInput): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.id);
  const manifestPath = path.join(target.dir, target.manifestName);
  const manifest = await readJson<any>(manifestPath);

  if (typeof input.status === 'string') manifest.status = input.status;
  if (typeof input.title === 'string') manifest.title = input.title;
  manifest.updatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  if (typeof input.snapshotBody === 'string') {
    await writeMarkdownBody(path.join(target.dir, 'snapshot.md'), input.snapshotBody, {
      aidd: { type: 'delivery-package-snapshot', templateVersion: TEMPLATE_VERSION },
      id: input.id,
      title: manifest.title,
      status: manifest.status
    });
  }

  if (typeof input.strategyBody === 'string') {
    await writeMarkdownBody(path.join(target.dir, 'implementation-strategy.md'), input.strategyBody, {
      aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
      id: `${input.id}-strategy`,
      deliveryPackage: input.id,
      status: manifest.status || 'draft'
    });
  }

  if (Array.isArray(input.phases)) {
    const existingEntries = await fsp.readdir(target.dir, { withFileTypes: true });
    for (const entry of existingEntries) {
      if (entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)) {
        await fsp.rm(path.join(target.dir, entry.name), { force: true });
      }
    }

    for (const [index, phase] of input.phases.entries()) {
      const title = phase.title?.trim() || `Phase ${index + 1}`;
      const safeFileName = `phase-${String(index + 1).padStart(2, '0')}-${slugify(title)}.md`;
      await writeMarkdownBody(path.join(target.dir, safeFileName), phase.body || '', {
        aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
        id: phaseIdFromFileName(safeFileName),
        title,
        status: phase.status || 'packaging',
        deliveryPackage: input.id,
        order: index + 1
      });
    }
  }

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.id });
}

export async function createDeliveryPackagePhase(input: CreateDeliveryPackagePhaseInput): Promise<DeliveryPackageDetail> {
  const target = await findDeliveryPackageTarget(input.projectPath, input.packageId);
  const title = input.title.trim() || 'Implementation Phase';
  const entries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phaseNumber = entries.filter((entry) => entry.isFile() && /^(phase|stage)-[\w-]+\.md$/i.test(entry.name)).length + 1;
  const fileName = `phase-${String(phaseNumber).padStart(2, '0')}-${slugify(title)}.md`;
  const body = input.body?.trim() || [
    `# ${title}`,
    '',
    '## Goal',
    '',
    'Describe the outcome this phase should deliver.',
    '',
    '## Implementation Steps',
    '',
    '- TODO: Add implementation steps.',
    '',
    '## Files / Components',
    '',
    '- TODO: List files, components, or areas touched.',
    '',
    '## Verification',
    '',
    '- TODO: Define how this phase will be checked.',
    ''
  ].join('\n');

  await writeMarkdownBody(path.join(target.dir, fileName), body, {
    aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
    id: phaseIdFromFileName(fileName),
    title,
    status: 'packaging',
    deliveryPackage: input.packageId,
    createdAt: new Date().toISOString()
  });

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
}

export async function assembleDeliveryPackage(input: { projectPath: string; packageId: string }): Promise<DeliveryPackageDetail> {
  const detail = await readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
  const target = await findDeliveryPackageTarget(input.projectPath, input.packageId);
  const technicalChangesBody = await buildDeliveryPackageTechnicalChangeSection(target.dir, detail.technicalChanges || []);
  const body = [
    `# ${detail.id} ${detail.title}`,
    '',
    `Status: ${detail.status}`,
    '',
    '> This package is the implementation instruction set for the AI agent. Project snapshot/context is used to refine the strategy, but is intentionally excluded from this assembled handoff to reduce token load.',
    '',
    '## Implementation Strategy',
    '',
    detail.strategyBody || '_No implementation strategy content._',
    '',
    '## Implementation Phases',
    '',
    detail.phases.length
      ? detail.phases.map((phase, index) => [`### Phase ${index + 1}: ${phase.title}`, '', phase.body || '_No phase content._'].join('\n')).join('\n\n')
      : '_No implementation phases have been created._',
    '',
    technicalChangesBody || '## Approved Technical Changes\n\n_No approved technical changes were included._',
    ''
  ].join('\n');

  await writeMarkdownBody(path.join(target.dir, 'delivery-package.md'), body, {
    aidd: { type: 'assembled-delivery-package', templateVersion: TEMPLATE_VERSION },
    id: `${input.packageId}-assembled`,
    deliveryPackage: input.packageId,
    status: detail.status,
    includes: ['implementation-strategy', 'implementation-phases', 'approved-technical-changes'],
    excludes: ['project-snapshot'],
    updatedAt: new Date().toISOString()
  });

  return readDeliveryPackage({ projectPath: input.projectPath, id: input.packageId });
}

export const DELIVERY_REVIEW_SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp',
  '.m', '.mm', '.cs', '.java', '.kt', '.kts', '.swift',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.pyw', '.go', '.rs', '.php', '.rb', '.lua', '.gd',
  '.vue', '.svelte', '.astro', '.qml',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.glsl', '.hlsl', '.wgsl', '.metal', '.shader', '.usf', '.ush'
]);

export const DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.vs',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'output', 'bin', 'obj', 'target', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  'intermediate', 'saved', 'binaries', 'deriveddatacache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv',
  'docs', 'delivery', '.aidd', '.aidd-app'
]);

export function deliveryReviewSourceFileAllowed(fileName: string) {
  return DELIVERY_REVIEW_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function deliveryReviewSourceDirectoryExcluded(directoryName: string) {
  const lower = directoryName.toLowerCase();
  if (DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES.has(lower)) return true;
  return lower.startsWith('.') && lower !== '.github';
}

export function shortHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

export function packagePrefixForDeliveryReviewSourceRoot(rootPath: string, workspacePath: string) {
  if (workspacePath && isSameOrInsideDiskPath(rootPath, workspacePath)) {
    const relative = normaliseRelativePath(path.relative(workspacePath, rootPath)).replace(/^\.\/?$/, '');
    return relative;
  }
  const baseName = slugify(path.basename(rootPath) || 'external-source');
  return `_external/${baseName}-${shortHash(rootPath)}`;
}

export function deliveryReviewSourceEntryPath(root: DeliveryReviewSourceRoot, relativeFile: string) {
  return ['src', root.packagePrefix, normaliseRelativePath(relativeFile)].filter(Boolean).join('/');
}

export function buildDeliveryReviewStrategyMarkdown(detail: DeliveryPackageDetail) {
  const body = (detail.strategyBody || '').trim() || [
    '# Implementation Strategy',
    '',
    '## Objective',
    '',
    'TODO: Describe the implementation objective for this delivery package.',
    '',
    '## Proposed Approach',
    '',
    'TODO: Describe the planned implementation approach.',
    '',
    '## Source Code Reference',
    '',
    'TODO: List the source files, components, or directories that should be reviewed.',
    '',
    '## Risks / Unknowns',
    '',
    'TODO: Capture risks, assumptions, and open questions.',
    '',
    '## Verification Strategy',
    '',
    'TODO: Define how the implementation will be verified.',
    ''
  ].join('\n');

  return matter.stringify(`${body}\n`, {
    aidd: { type: 'implementation-strategy', templateVersion: TEMPLATE_VERSION },
    id: `${detail.id}-strategy`,
    deliveryPackage: detail.id,
    status: detail.status || 'packaging',
    generatedForReview: true
  });
}

export function buildDeliveryReviewSamplePhaseMarkdown(detail: DeliveryPackageDetail) {
  const title = 'Sample Implementation Phase';
  const body = [
    `# Phase 01 — ${title}`,
    '',
    '> AIDD generated this sample phase because the delivery package did not contain any phase or stage files when the review bundle was created.',
    '',
    '## Objective',
    '',
    'Describe the goal of this phase.',
    '',
    '## Scope',
    '',
    'This phase includes:',
    '',
    '- [ ] Understand the delivery objective and linked context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '',
    'This phase does not include:',
    '',
    '- Out-of-scope item 1',
    '- Out-of-scope item 2',
    '',
    '## Source areas',
    '',
    'Expected source locations:',
    '',
    '- `src/...`',
    '',
    '## Implementation notes',
    '',
    '- Keep changes within the listed source areas unless the package explicitly requires otherwise.',
    '- Follow `package/standards.md`.',
    '- Use `package/components.md` and the delivery package files for component/capability context.',
    '- Record required AIDD updates in this delivery package rather than changing the snapshot context files.',
    '',
    '## Progress',
    '',
    'Status: Not started',
    '',
    'Allowed values:',
    '',
    '- Not started',
    '- In progress',
    '- Blocked',
    '- Complete',
    '- Needs review',
    '',
    '## Tasks',
    '',
    '- [ ] Understand the phase objective and relevant context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '- [ ] Add or update tests where appropriate.',
    '- [ ] Run the relevant verification steps.',
    '- [ ] Record changed files.',
    '- [ ] Record evidence.',
    '- [ ] Record any questions or blockers.',
    '- [ ] Mark the phase complete only when acceptance criteria are satisfied.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Criterion 1',
    '- [ ] Criterion 2',
    '- [ ] Criterion 3',
    '',
    '## Changed files',
    '',
    'Record files changed during this phase:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Verification evidence',
    '',
    'Record commands run, test results, screenshots, logs, or manual checks:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Questions / blockers',
    '',
    '- None',
    '',
    '## Proposed AIDD updates',
    '',
    '- None',
    '',
    '## Completion note',
    '',
    'Summarise what was completed in this phase.',
    ''
  ].join('\n');

  return matter.stringify(`${body}\n`, {
    aidd: { type: 'delivery-package-phase', templateVersion: TEMPLATE_VERSION },
    id: `${detail.id}-sample-phase`,
    title,
    status: 'packaging',
    deliveryPackage: detail.id,
    order: 1,
    generatedForReview: true
  });
}

export function buildDeliveryPhaseTemplateMarkdown(input: { packageId: string }) {
  return [
    '# Delivery Phase Template',
    '',
    `Delivery package: ${input.packageId}`,
    '',
    'Use this template when creating or updating phase files in the returned delivery package.',
    '',
    '## File naming rules',
    '',
    'Place phase files directly under `delivery/`.',
    '',
    'Use this naming format:',
    '',
    '```text',
    'delivery/phase-01-short-kebab-name.md',
    'delivery/phase-02-short-kebab-name.md',
    'delivery/phase-03-short-kebab-name.md',
    '```',
    '',
    'Rules:',
    '',
    '- Use `phase-` as the prefix for new phase files.',
    '- Use a two-digit sequence number: `01`, `02`, `03`.',
    '- Use lowercase kebab-case after the sequence number.',
    '- Keep one phase per file.',
    '- Existing `stage-*.md` files may be edited if the package already contains them, but new files should use the `phase-##-name.md` pattern.',
    '',
    'AIDD import accepts returned updates from:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md`',
    '',
    'Do not return snapshot context files, `_templates/`, or `src/`.',
    '',
    '---',
    '',
    '# Phase {{phase_number}} — {{phase_title}}',
    '',
    '## Objective',
    '',
    'Describe the goal of this phase.',
    '',
    '## Scope',
    '',
    'This phase includes:',
    '',
    '- [ ] Task 1',
    '- [ ] Task 2',
    '- [ ] Task 3',
    '',
    'This phase does not include:',
    '',
    '- Out-of-scope item 1',
    '- Out-of-scope item 2',
    '',
    '## Source areas',
    '',
    'Expected source locations:',
    '',
    '- `src/...`',
    '',
    '## Implementation notes',
    '',
    'Guidance for the agentic AI:',
    '',
    '- Keep changes within the listed source areas unless the package explicitly requires otherwise.',
    '- Follow `package/standards.md`.',
    '- Use `package/components.md` and the delivery package files for component/capability context.',
    '- Record any required AIDD updates in the delivery notes rather than changing the snapshot context files.',
    '',
    '## Progress',
    '',
    'Status: Not started',
    '',
    'Allowed values:',
    '',
    '- Not started',
    '- In progress',
    '- Blocked',
    '- Complete',
    '- Needs review',
    '',
    '## Tasks',
    '',
    '- [ ] Understand the phase objective and relevant context.',
    '- [ ] Inspect the listed source areas.',
    '- [ ] Implement the required changes.',
    '- [ ] Add or update tests where appropriate.',
    '- [ ] Run the relevant verification steps.',
    '- [ ] Record changed files.',
    '- [ ] Record evidence.',
    '- [ ] Record any questions or blockers.',
    '- [ ] Mark the phase complete only when acceptance criteria are satisfied.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Criterion 1',
    '- [ ] Criterion 2',
    '- [ ] Criterion 3',
    '',
    '## Changed files',
    '',
    'Record files changed during this phase:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Verification evidence',
    '',
    'Record commands run, test results, screenshots, logs, or manual checks:',
    '',
    '```text',
    '',
    '```',
    '',
    '## Questions / blockers',
    '',
    '- None',
    '',
    '## Proposed AIDD updates',
    '',
    '- None',
    '',
    '## Completion note',
    '',
    'Summarise what was completed in this phase.',
    ''
  ].join('\n');
}

export function isDeliveryPhaseOrStageMarkdownFile(relativePath: string) {
  return /^(phase|stage)-[\w-]+\.md$/i.test(path.basename(relativePath));
}

export async function collectDeliveryPackageEntries(projectPath: string, detail: DeliveryPackageDetail, warnings: string[]) {
  const target = await findDeliveryPackageTarget(projectPath, detail.id);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const entryNames = new Set<string>();
  const base = 'delivery';
  let strategyFileCount = 0;
  let phaseFileCount = 0;

  async function addBuffer(relativePath: string, data: Buffer | string) {
    const zipPath = `${base}/${normaliseRelativePath(relativePath)}`;
    if (entryNames.has(zipPath)) return false;
    entries.push({ name: zipPath, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') });
    includedFiles.push(zipPath);
    entryNames.add(zipPath);
    return true;
  }

  async function addFile(relativePath: string, absolutePath: string) {
    if (!(await exists(absolutePath))) return false;
    const data = await fsp.readFile(absolutePath);
    return addBuffer(relativePath, data);
  }

  async function addReviewMarkdownFile(relativePath: string, absolutePath: string) {
    if (!(await exists(absolutePath))) return false;
    const raw = await fsp.readFile(absolutePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) return false;
    return addBuffer(relativePath, raw);
  }

  async function addTechnicalChangeTree(relativeRoot: string, absoluteRoot: string) {
    if (!(await exists(absoluteRoot))) return;
    const entries = await fsp.readdir(absoluteRoot, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      const relativePath = normaliseRelativePath(path.join(relativeRoot, entry.name));
      const absolutePath = path.join(absoluteRoot, entry.name);
      if (entry.isDirectory()) {
        await addTechnicalChangeTree(relativePath, absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!['.md', '.json', '.patch', '.diff'].includes(extension)) continue;
      await addFile(relativePath, absolutePath);
    }
  }

  await addFile(target.manifestName, path.join(target.dir, target.manifestName));

  const strategyPath = path.join(target.dir, 'implementation-strategy.md');
  const addedStrategy = await addReviewMarkdownFile('implementation-strategy.md', strategyPath);
  if (addedStrategy) {
    strategyFileCount = 1;
  } else {
    await addBuffer('implementation-strategy.md', buildDeliveryReviewStrategyMarkdown(detail));
    strategyFileCount = 1;
    if (await exists(strategyPath)) {
      warnings.push('implementation-strategy.md was excluded from normal review packaging, so AIDD generated a strategy copy from the saved package state.');
    } else {
      warnings.push('implementation-strategy.md was missing, so AIDD generated a strategy file for this review bundle.');
    }
  }

  const directEntries = await fsp.readdir(target.dir, { withFileTypes: true });
  const phaseOrStageFiles = directEntries
    .filter((entry) => entry.isFile() && isDeliveryPhaseOrStageMarkdownFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const fileName of phaseOrStageFiles) {
    const added = await addReviewMarkdownFile(fileName, path.join(target.dir, fileName));
    if (added) phaseFileCount += 1;
  }

  if (phaseFileCount === 0) {
    await addBuffer('phase-01-sample-implementation-phase.md', buildDeliveryReviewSamplePhaseMarkdown(detail));
    phaseFileCount = 1;
    if (phaseOrStageFiles.length) {
      warnings.push('Phase/stage files existed but none were included in the review bundle, so AIDD added a sample phase file.');
    } else {
      warnings.push('No phase/stage files were found, so AIDD added a sample phase file to the review bundle.');
    }
  }

  const markdownFiles = await collectMarkdownFiles(target.dir);
  for (const relativeFile of markdownFiles) {
    if (relativeFile === 'implementation-strategy.md') continue;
    if (isDeliveryPhaseOrStageMarkdownFile(relativeFile)) continue;
    if (normaliseRelativePath(relativeFile).startsWith('technical-changes/')) continue;
    const absolutePath = path.join(target.dir, relativeFile);
    const raw = await fsp.readFile(absolutePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    await addBuffer(relativeFile, raw);
  }

  await addTechnicalChangeTree('technical-changes', path.join(target.dir, 'technical-changes'));

  return {
    entries,
    includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)),
    strategyFileCount,
    phaseFileCount
  };
}

export async function collectDeliveryReviewComponents(projectPath: string, detail: DeliveryPackageDetail, warnings: string[]) {
  const componentSlugs = new Set<string>((detail.components || []).map((component) => slugify(component)).filter(Boolean));
  let capabilitySlug = detail.sourceCapability ? slugify(detail.sourceCapability) : '';
  let capability: Awaited<ReturnType<typeof readCapability>> | null = null;

  if (capabilitySlug) {
    try {
      capability = await readCapability({ projectPath, slug: capabilitySlug });
      capabilitySlug = capability.slug;
      for (const component of capability.components || []) {
        const slug = slugify(String(component));
        if (slug) componentSlugs.add(slug);
      }
    } catch (error) {
      warnings.push(`The source capability could not be included: ${capabilitySlug} (${error instanceof Error ? error.message : String(error)})`);
      capability = null;
    }
  } else if (detail.packageType !== 'technical') {
    warnings.push('This delivery package does not reference a source capability.');
  }

  const components: Awaited<ReturnType<typeof readComponent>>[] = [];

  for (const componentSlug of Array.from(componentSlugs).sort((a, b) => a.localeCompare(b))) {
    try {
      const component = await readComponent({ projectPath, slug: componentSlug });
      components.push(component);
    } catch (error) {
      warnings.push(`Component could not be included: ${componentSlug} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return {
    capabilitySlug: capability?.slug || capabilitySlug || null,
    capability,
    capabilitySnapshotFileName: capability ? deliveryReviewCapabilitySnapshotFileName(capability.slug) : null,
    components
  };
}

export async function collectDeliveryReviewSourceRoots(projectPath: string, components: Awaited<ReturnType<typeof readComponent>>[], warnings: string[]) {
  const workspacePath = await readWorkspacePathForProject(projectPath);
  if (!workspacePath) warnings.push('No source workspace is configured, so component source paths may not resolve as intended.');

  const byPath = new Map<string, DeliveryReviewSourceRoot>();

  for (const component of components) {
    const source = normaliseComponentSource(component.source);
    if (!componentSourceIsConfigured(source)) {
      warnings.push(`Component ${component.slug} has no source code location configured.`);
      continue;
    }

    const absolutePath = path.resolve(resolveComponentSourceDirectory(projectPath, source.directory, workspacePath));
    if (!(await exists(absolutePath))) {
      warnings.push(`Component ${component.slug} source location was not found: ${source.directory}`);
      continue;
    }

    const stat = await fsp.stat(absolutePath);
    if (!stat.isDirectory()) {
      warnings.push(`Component ${component.slug} source location is not a directory: ${source.directory}`);
      continue;
    }

    const key = normaliseDiskPath(absolutePath);
    const existing = byPath.get(key);
    if (existing) {
      existing.componentSlugs.push(component.slug);
      existing.componentTitles.push(component.title);
      continue;
    }

    byPath.set(key, {
      absolutePath,
      configuredDirectory: source.directory,
      isInsideWorkspace: Boolean(workspacePath && isSameOrInsideDiskPath(absolutePath, workspacePath)),
      componentSlugs: [component.slug],
      componentTitles: [component.title],
      packagePrefix: ''
    });
  }

  const orderedRoots = Array.from(byPath.values()).sort((a, b) => {
    const lengthDiff = normaliseDiskPath(a.absolutePath).length - normaliseDiskPath(b.absolutePath).length;
    return lengthDiff || a.absolutePath.localeCompare(b.absolutePath);
  });
  const roots: DeliveryReviewSourceRoot[] = [];
  const skippedNestedRoots: DeliveryReviewCollectedSource['skippedNestedRoots'] = [];

  for (const candidate of orderedRoots) {
    const parent = roots.find((kept) => isSameOrInsideDiskPath(candidate.absolutePath, kept.absolutePath));
    if (parent) {
      skippedNestedRoots.push({
        configuredDirectory: candidate.configuredDirectory,
        absolutePath: candidate.absolutePath,
        coveredBy: parent.absolutePath,
        componentSlugs: candidate.componentSlugs
      });
      warnings.push(`Skipped nested source root ${candidate.configuredDirectory}; it is already covered by ${parent.configuredDirectory}.`);
      continue;
    }
    candidate.packagePrefix = packagePrefixForDeliveryReviewSourceRoot(candidate.absolutePath, workspacePath);
    roots.push(candidate);
  }

  return { workspacePath, roots, skippedNestedRoots };
}

export async function collectDeliveryReviewSourceEntries(projectPath: string, components: Awaited<ReturnType<typeof readComponent>>[]): Promise<DeliveryReviewCollectedSource> {
  const warnings: string[] = [];
  const { roots, skippedNestedRoots } = await collectDeliveryReviewSourceRoots(projectPath, components, warnings);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const entryNames = new Set<string>();

  async function walk(root: DeliveryReviewSourceRoot, currentDir: string, relativeDir = '') {
    let directoryEntries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      directoryEntries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Could not read source directory ${currentDir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    directoryEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of directoryEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (deliveryReviewSourceDirectoryExcluded(entry.name)) continue;
        await walk(root, absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!deliveryReviewSourceFileAllowed(entry.name)) continue;

      const zipPath = deliveryReviewSourceEntryPath(root, relativePath);
      if (entryNames.has(zipPath)) continue;
      try {
        const data = await fsp.readFile(absolutePath);
        entries.push({ name: zipPath, data });
        includedFiles.push(zipPath);
        entryNames.add(zipPath);
      } catch (error) {
        warnings.push(`Could not include source file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const root of roots) {
    await walk(root, root.absolutePath);
  }

  return {
    entries,
    roots,
    skippedNestedRoots,
    includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)),
    warnings
  };
}

export function buildDeliveryReviewPackageReadme(input: {
  projectName: string;
  packageId: string;
  title: string;
  packageType?: DeliveryPackageType;
  strategyFileCount: number;
  phaseFileCount: number;
  sourceRootCount: number;
  sourceFileCount: number;
  warnings: string[];
}) {
  const isTechnical = input.packageType === 'technical';
  const lines = [
    '# AIDD Delivery Package Review',
    '',
    'This zip was generated by AIDD for delivery package review.',
    '',
    isTechnical
      ? 'The bundle is a self-contained technical snapshot. Review it and create an implementation plan for the approved technical change against the included source code. Use the Standards, Components, and Technical Changes snapshots to steer the implementation plan.'
      : 'The bundle is a self-contained snapshot. Review it and create an implementation plan for the delivery capability against the included source code. Use the Foundation and Standards snapshots to steer the implementation plan, and use the Components snapshot to understand where the relevant source code lives.',
    '',
    '## Bundle layout',
    '',
    'Root files:',
    '',
    '- `README.md` — these instructions',
    '- `MANIFEST.json` — machine-readable package metadata for AIDD and tooling',
    '',
    'Package context snapshots:',
    '',
    ...(isTechnical
      ? [
          '- `package/standards.md`',
          '- `package/components.md`',
          '- `package/technical-changes.md`'
        ]
      : [
          '- `package/foundation.md`',
          '- `package/standards.md`',
          '- `package/components.md`'
        ]),
    '',
    'Editable delivery package files:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md` when existing stages are present',
    '',
    'Approved technical changes, when present:',
    '',
    '- `delivery/technical-changes/`',
    '',
    'The phase template is included at:',
    '',
    '- `_templates/delivery/phase-template.md`',
    '',
    'Source code is included for review context under:',
    '',
    '- `src/`',
    '',
    '## Your task',
    '',
    isTechnical
      ? 'Review the delivery package and create a practical implementation plan for the approved technical change using the included source code.'
      : 'Review the delivery package and create a practical implementation plan for the capability using the included source code.',
    '',
    'Use:',
    '',
    ...(isTechnical
      ? [
          '- `package/standards.md` to steer implementation, testing, security, and delivery expectations',
          '- `package/components.md` to understand the component constraints and source-code locations',
          '- `package/technical-changes.md` to understand the approved technical change being delivered'
        ]
      : [
          '- `package/foundation.md` to understand product intent and project context',
          '- `package/standards.md` to steer implementation, testing, security, and delivery expectations',
          '- `package/components.md` to understand the component map and source-code locations'
        ]),
    '- `delivery/implementation-strategy.md` as the main plan',
    '- `delivery/phase-*.md` or `delivery/stage-*.md` as the implementation phases',
    '- `delivery/technical-changes/` as approved change context',
    '- `src/` as read-only source-code context',
    '',
    'Do not modify the source-code snapshot in this review bundle. Use it to make the implementation plan specific and grounded.',
    '',
    '## Phase file naming',
    '',
    'New phase files must be placed directly under `delivery/` and use this structure:',
    '',
    '```text',
    'delivery/phase-01-short-kebab-name.md',
    'delivery/phase-02-short-kebab-name.md',
    'delivery/phase-03-short-kebab-name.md',
    '```',
    '',
    'Rules:',
    '',
    '- Use `phase-` for new phase files.',
    '- Use a two-digit phase number.',
    '- Use lowercase kebab-case after the number.',
    '- Keep one phase per file.',
    '- Existing `stage-*.md` files may be edited if they were included in the package, but new files should use `phase-##-name.md`.',
    '',
    '## Source-code snapshot rules',
    '',
    'AIDD has included a source-code snapshot under `src/` so the delivery package can be reviewed against the actual implementation surface.',
    '',
    'AIDD includes only source-code files under `src/`. It excludes build output, dependencies, generated folders, docs, delivery folders, and other non-source directories.',
    '',
    'When components point to nested source locations, AIDD keeps the highest source root and skips child roots so the same files are not included twice.',
    '',
    '## Progress tracking',
    '',
    'Markdown checkboxes are useful, but they are not enough on their own. When marking work as complete, also record changed files, verification evidence, blockers, and proposed AIDD updates in the delivery phase files.',
    '',
    '## Return package rule',
    '',
    'When returning a revised package, provide a download zip that contains only the updated `delivery/` folder and its matching files.',
    '',
    'AIDD accepts `delivery/` at the zip root, or inside one wrapping folder if the zip tool adds a parent directory.',
    '',
    'AIDD will import returned files from:',
    '',
    '- `delivery/implementation-strategy.md`',
    '- `delivery/phase-*.md`',
    '- `delivery/stage-*.md`',
    '',
    'Do not include `src/`, `package/`, `_templates/`, `MANIFEST.json`, or duplicated review context in the returned zip. The included source code and package context are snapshots for review only.',
    '',
    '## Package summary',
    '',
    `- Project: ${input.projectName}`,
    `- Delivery package: ${input.packageId} — ${input.title}`,
    `- Strategy files: ${input.strategyFileCount}`,
    `- Phase/stage files: ${input.phaseFileCount}`,
    `- Source roots: ${input.sourceRootCount}`,
    `- Source files: ${input.sourceFileCount}`,
    ''
  ];

  if (input.warnings.length) {
    lines.push('## Warnings', '', ...input.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n')}\n`;
}

export function normaliseDeliveryReviewReturnEntryName(entryName: string) {
  const normalised = safeZipReadEntryName(entryName);
  if (!normalised) return null;
  if (normalised === 'REVIEW.md') return normalised;
  if (normalised.startsWith('delivery/')) return normalised;

  const parts = normalised.split('/');
  const isSingleWrapperDeliveryPath = parts.length >= 3 && Boolean(parts[0]) && parts[1] === 'delivery';
  if (isSingleWrapperDeliveryPath) return parts.slice(1).join('/');

  const isSingleWrapperReviewFile = parts.length === 2 && Boolean(parts[0]) && parts[1] === 'REVIEW.md';
  if (isSingleWrapperReviewFile) return 'REVIEW.md';

  return null;
}

export function isSafeDeliveryReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('delivery/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  const parts = normalised.split('/');
  if (parts.length !== 2) return false;
  const fileName = parts[1].toLowerCase();
  if (fileName === 'implementation-strategy.md') return true;
  return /^(phase|stage)-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(fileName);
}

export function deliveryReviewImportBodyFromMarkdown(raw: Buffer | string) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  try {
    return matter(text).content.trim();
  } catch {
    return text.trim();
  }
}

export function deliveryReviewImportHasSubstantialContent(body: string) {
  const cleaned = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[>#*_`\-\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;
  if (/^(todo|tbd|n\/?a|none|no content|not provided|placeholder)$/i.test(cleaned)) return false;
  return cleaned.split(/\s+/).filter(Boolean).length >= 8;
}

export async function backupDeliveryReviewImportTarget(input: {
  projectRoot: string;
  packageId: string;
  stamp: string;
  deliveryRelativePath: string;
  targetPath: string;
}) {
  if (!(await exists(input.targetPath))) return null;
  const backupRoot = path.join(input.projectRoot, '.aidd', 'backups', 'delivery-review-imports', slugify(input.packageId), input.stamp);
  const backupPath = path.join(backupRoot, input.deliveryRelativePath);
  await fsp.mkdir(path.dirname(backupPath), { recursive: true });
  await fsp.copyFile(input.targetPath, backupPath);
  return { backupRoot, backupPath };
}

export async function importDeliveryReviewPackage(input: ImportDeliveryReviewPackageInput): Promise<DeliveryReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.packageId) throw new Error('Delivery package id is required.');
  if (!input.zipPath) throw new Error('Delivery review response zip path is required.');

  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Delivery review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Delivery review response must be a .zip file.');

  const target = await findDeliveryPackageTarget(root, input.packageId);
  const entries = await readZipFile(zipPath);
  const normalisedEntries = entries
    .map((entry) => normaliseDeliveryReviewReturnEntryName(entry.name))
    .filter((entryName): entryName is string => Boolean(entryName));
  const hasDeliveryDirectory = normalisedEntries.some((name) => name === 'delivery/' || name.startsWith('delivery/'));
  if (!hasDeliveryDirectory) {
    throw new Error('Delivery review response rejected: the zip must contain delivery files at delivery/ or inside one wrapping folder, for example delivery/implementation-strategy.md or returned-package/delivery/implementation-strategy.md.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const backedUpFiles: string[] = [];
  const importStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  let backupDirectory: string | undefined;
  let reviewMarkdown: string | undefined;
  let strategyImported = false;
  let phaseFileCount = 0;

  for (const entry of entries) {
    const relativePath = normaliseDeliveryReviewReturnEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeDeliveryReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const deliveryRelativePath = normaliseRelativePath(relativePath.slice('delivery/'.length));
    if (!deliveryRelativePath || deliveryRelativePath.startsWith('../') || path.isAbsolute(deliveryRelativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const targetPath = path.resolve(target.dir, deliveryRelativePath);
    if (!isSameOrInsideDiskPath(targetPath, target.dir)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const importedBody = deliveryReviewImportBodyFromMarkdown(entry.data);
    const importedHasContent = deliveryReviewImportHasSubstantialContent(importedBody);
    if (!importedHasContent) {
      const existingBody = await readMarkdownBody(targetPath);
      const existingHasContent = deliveryReviewImportHasSubstantialContent(existingBody);
      skippedFiles.push(`${relativePath} was skipped because it did not contain enough content${existingHasContent ? ' to safely replace the existing file' : ''}.`);
      continue;
    }

    const backup = await backupDeliveryReviewImportTarget({
      projectRoot: root,
      packageId: input.packageId,
      stamp: importStamp,
      deliveryRelativePath,
      targetPath
    });
    if (backup) {
      backupDirectory = backup.backupRoot;
      backedUpFiles.push(deliveryRelativePath);
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, entry.data);
    importedFiles.push(relativePath);
    if (deliveryRelativePath === 'implementation-strategy.md') strategyImported = true;
    if (/^(phase|stage)-/i.test(path.basename(deliveryRelativePath))) phaseFileCount += 1;
  }

  if (!importedFiles.length) {
    throw new Error('Delivery review response did not contain any importable delivery files. Expected delivery/implementation-strategy.md or delivery/phase-*.md files. Existing delivery files were not changed.');
  }

  let assembledPackageUpdated = false;
  try {
    const assembled = await assembleDeliveryPackage({ projectPath: root, packageId: input.packageId });
    assembledPackageUpdated = Boolean(assembled.packagedBody);
  } catch (error) {
    skippedFiles.push(`delivery-package.md could not be regenerated: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    accepted: true,
    zipPath,
    packageId: input.packageId,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    backedUpFiles: backedUpFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ...(backupDirectory ? { backupDirectory } : {}),
    strategyImported,
    phaseFileCount,
    assembledPackageUpdated,
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

export async function createDeliveryPackageReviewBundle(input: DeliveryReviewPackageInput): Promise<DeliveryReviewPackageResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.packageId) throw new Error('Delivery package id is required.');
  const root = path.resolve(input.projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);

  const detail = await readDeliveryPackage({ projectPath: root, id: input.packageId });
  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-${slugify(detail.id)}-delivery-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'delivery', slugify(detail.id));
  const filePath = path.join(outputDir, fileName);
  const warnings: string[] = [];

  const delivery = await collectDeliveryPackageEntries(root, detail, warnings);
  if (detail.excludedTechnicalChanges?.length) {
    warnings.push(`${detail.excludedTechnicalChanges.length} technical change(s) are not approved and were excluded from delivery packaging.`);
  }
  const related = await collectDeliveryReviewComponents(root, detail, warnings);
  const source = await collectDeliveryReviewSourceEntries(root, related.components);
  warnings.push(...source.warnings);

  const standards = await readStandardSections(root);
  const sourceProjects = await readSourceProjects(root);
  const packageType = detail.packageType === 'technical' ? 'technical' : 'capability';
  const componentContext = related.components.length
    ? related.components
    : (await readEntities(root, 'components', 'component.json')).concat(await readEntities(root, 'modules', 'module.json'));
  const contextEntries: ZipEntryInput[] = [];
  if (packageType === 'capability') {
    const foundation = await readFoundationDocuments(root);
    contextEntries.push({ name: 'package/foundation.md', data: Buffer.from(buildPublishedFoundationMarkdown(projectName, foundation), 'utf8') });
  }
  contextEntries.push(
    { name: 'package/standards.md', data: Buffer.from(buildPublishedStandardsMarkdown(projectName, standards), 'utf8') },
    { name: 'package/components.md', data: Buffer.from(buildPublishedComponentsMarkdown(projectName, componentContext, sourceProjects), 'utf8') }
  );
  if (packageType === 'technical') {
    const target = await findDeliveryPackageTarget(root, detail.id);
    contextEntries.push({
      name: 'package/technical-changes.md',
      data: Buffer.from(await buildDeliveryTechnicalChangesContextMarkdown(target.dir, detail.technicalChanges || []), 'utf8')
    });
  }

  const templateEntries: ZipEntryInput[] = [
    {
      name: '_templates/delivery/phase-template.md',
      data: Buffer.from(buildDeliveryPhaseTemplateMarkdown({ packageId: detail.id }), 'utf8')
    }
  ];

  const contextFiles = contextEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const templateFiles = templateEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));

  const allEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildDeliveryReviewPackageReadme({
      projectName,
      packageId: detail.id,
      title: detail.title,
      strategyFileCount: delivery.strategyFileCount,
      phaseFileCount: delivery.phaseFileCount,
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length,
      packageType,
      warnings
    }), 'utf8') },
    ...contextEntries,
    ...delivery.entries,
    ...templateEntries,
    ...source.entries
  ];

  const manifest = {
    bundleType: 'delivery-package-review',
    schemaVersion: 2,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    snapshotIsSelfContained: true,
    packageId: detail.id,
    packageTitle: detail.title,
    packageType,
    sourceCapability: related.capabilitySlug,
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: related.components.map((component) => ({
      slug: component.slug,
      title: component.title,
      source: normaliseComponentSource(component.source)
    })),
    deliveryPackage: {
      directory: 'delivery',
      strategyFileCount: delivery.strategyFileCount,
      phaseFileCount: delivery.phaseFileCount,
      strategyPath: 'delivery/implementation-strategy.md',
      phasePatterns: ['delivery/phase-##-short-kebab-name.md'],
      technicalChanges: detail.technicalChanges || [],
      excludedTechnicalChanges: detail.excludedTechnicalChanges || [],
      acceptedReturnPaths: ['delivery/implementation-strategy.md', 'delivery/phase-*.md', 'delivery/stage-*.md']
    },
    includedFiles: {
      context: contextFiles,
      delivery: delivery.includedFiles,
      templates: templateFiles,
      source: source.includedFiles
    },
    sourceSnapshot: {
      directory: 'src',
      allowedExtensions: Array.from(DELIVERY_REVIEW_SOURCE_EXTENSIONS).sort((a, b) => a.localeCompare(b)),
      excludedDirectories: Array.from(DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES).sort((a, b) => a.localeCompare(b)),
      roots: source.roots.map((sourceRoot) => ({
        configuredDirectory: sourceRoot.configuredDirectory,
        absolutePath: sourceRoot.absolutePath,
        packagePrefix: sourceRoot.packagePrefix ? `src/${sourceRoot.packagePrefix}` : 'src',
        isInsideWorkspace: sourceRoot.isInsideWorkspace,
        componentSlugs: sourceRoot.componentSlugs,
        componentTitles: sourceRoot.componentTitles
      })),
      skippedNestedRoots: source.skippedNestedRoots
    },
    warnings,
    returnInstructions: {
      returnedZipShouldContainOnly: ['delivery/'],
      deliveryDirectory: 'delivery',
      strategyPath: 'delivery/implementation-strategy.md',
      phasePatterns: ['delivery/phase-*.md', 'delivery/stage-*.md'],
      newPhaseNaming: 'delivery/phase-##-short-kebab-name.md',
      sourceCodeIsIncludedForReview: true,
      sourceCodeIsContextOnly: true,
      doNotReturnBundledSourceCodeAsEditedFiles: true,
      doNotReturnSnapshotContext: contextFiles
    }
  };

  allEntries.push({ name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });

  const uniqueEntries = new Map<string, ZipEntryInput>();
  for (const entry of allEntries) {
    const name = safeZipEntryName(entry.name);
    if (!uniqueEntries.has(name)) uniqueEntries.set(name, { ...entry, name });
  }

  await writeZipFile(filePath, Array.from(uniqueEntries.values()));
  return {
    filePath,
    fileName,
    packageId: detail.id,
    strategyFileCount: delivery.strategyFileCount,
    phaseFileCount: delivery.phaseFileCount,
    standardsFileCount: 1,
    capabilityFileCount: 0,
    componentFileCount: 1,
    sourceRootCount: source.roots.length,
    sourceFileCount: source.includedFiles.length,
    entryCount: uniqueEntries.size,
    warnings
  };
}

export async function publishDeliveryPackageToWorkspace(input: DeliveryWorkspacePublishInput): Promise<DeliveryWorkspacePublishResult> {
  const packageId = String(input.packageId || '').trim();
  if (!input.projectPath || !packageId) throw new Error('Project path and delivery package id are required.');

  const detail = await readDeliveryPackage({ projectPath: input.projectPath, id: packageId });
  if (normaliseStatusForDelivery(detail.status) !== 'approved') {
    throw new Error('Only approved delivery packages can be published to the workspace. Mark the package as approved first.');
  }

  const workspacePath = await requireDeliveryWorkspace(input.projectPath);
  const targetPath = workspaceDeliveryPackagePath(workspacePath, detail.id);
  const sourceHash = deliveryPackageSourceHash(detail);
  const publishedAt = new Date().toISOString();
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const createdWritableFiles: string[] = [];
  const removedFiles: string[] = [];
  const sourceTarget = await findDeliveryPackageTarget(input.projectPath, detail.id);

  const deliveryFiles = [
    { relativePath: 'implementation-strategy.md', content: buildPublishedDeliveryStrategyFileMarkdown(detail) },
    ...detail.phases.map((phase, index) => ({
      relativePath: phase.fileName,
      content: buildPublishedDeliveryPhaseFileMarkdown(detail, phase, index)
    }))
  ];

  for (const file of deliveryFiles) {
    await writeDeliveryGeneratedFile(path.join(targetPath, file.relativePath), file.content, writtenFiles, skippedFiles, file.relativePath);
  }
  const technicalChangeFiles = await writeDeliveryGeneratedTree(
    path.join(sourceTarget.dir, 'technical-changes'),
    targetPath,
    'technical-changes',
    writtenFiles,
    skippedFiles
  );

  // Older AIDD builds wrote brief/context/progress-style files into workspace delivery packages.
  // Do not remove agent-authored notes, but remove generated read-only files that no longer form part of the package contract.
  for (const obsoleteFile of ['brief.md', 'context.md']) {
    const obsoletePath = path.join(targetPath, obsoleteFile);
    if (await exists(obsoletePath)) {
      await fsp.rm(obsoletePath, { force: true });
      removedFiles.push(obsoleteFile);
    }
  }

  const workspaceManifest = {
    schemaVersion: 2,
    type: 'aidd-workspace-delivery-package',
    packageId: detail.id,
    title: detail.title,
    packageType: detail.packageType || 'capability',
    status: 'approved',
    sourceCapability: detail.sourceCapability || '',
    sourceTechnicalChange: detail.sourceTechnicalChange || null,
    components: detail.components,
    technicalChanges: detail.technicalChanges || [],
    aiddProjectPath: input.projectPath,
    workspacePath,
    publishedAt,
    sourceHash,
    deliveryDirectory: 'delivery',
    generatedFiles: deliveryFiles.map((file) => file.relativePath).concat(technicalChangeFiles, ['manifest.json']),
    editableFiles: deliveryFiles.map((file) => file.relativePath),
    strategyPath: 'implementation-strategy.md',
    phasePatterns: ['phase-*.md', 'stage-*.md'],
    instructions: 'This folder is the agent-facing delivery package. Implement against the source workspace, update implementation-strategy.md and phase/stage Markdown files as progress is made, and return/import the delivery folder when review is complete.'
  };

  const manifestContent = JSON.stringify(workspaceManifest, null, 2) + '\n';
  await writeDeliveryGeneratedFile(path.join(targetPath, 'manifest.json'), manifestContent, writtenFiles, skippedFiles, 'manifest.json');

  const sourceManifestPath = path.join(sourceTarget.dir, sourceTarget.manifestName);
  const sourceManifest = await readJson<any>(sourceManifestPath);
  await writeJson(sourceManifestPath, {
    ...sourceManifest,
    status: 'approved',
    approvedAt: sourceManifest.approvedAt || publishedAt,
    updatedAt: publishedAt,
    workspaceDelivery: {
      path: targetPath,
      publishedAt,
      sourceHash,
      manifestPath: path.join(targetPath, 'manifest.json'),
      deliveryFiles: deliveryFiles.map((file) => file.relativePath)
    }
  });

  return {
    packageId: detail.id,
    workspacePath,
    targetPath,
    published: true,
    writtenFiles,
    skippedFiles,
    createdWritableFiles,
    removedFiles,
    message: `Published ${detail.id} delivery files to ${targetPath}`
  };
}

export async function deleteDeliveryPackage(input: DeleteDeliveryPackageInput) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('Delivery package id is required.');

  const candidates = [
    path.join(input.projectPath, 'delivery', 'packages', id),
    path.join(input.projectPath, 'delivery', 'bundles', id)
  ];

  const projectRoot = path.resolve(input.projectPath);
  const target = candidates.find((candidate) => {
    const resolved = path.resolve(candidate);
    return resolved.startsWith(projectRoot + path.sep) && fs.existsSync(resolved);
  });

  if (!target) throw new Error(`Delivery package not found: ${id}`);
  await fsp.rm(target, { recursive: true, force: true });
  return readDeliveryPackages(input.projectPath);
}
