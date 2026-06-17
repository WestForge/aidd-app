import matter from '../../frontmatter';
import { readZipFile, safeZipEntryName, safeZipReadEntryName, writeZipFile } from '../shared/zip';
import type { ZipEntryInput } from '../shared/zip';
import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { COMPONENT_LEGACY_SECTION_FILES, readComponentCapabilities, readSectionFromFirstExistingFile, sectionBodyFromMarkdown } from './capabilityCore';
import { readCapability, updateCapability } from './capabilityReview';
import { COMPONENT_TEMPLATE_SECTIONS, buildComponentContractMarkdown, buildComponentIndexMarkdown, buildComponentSectionMarkdown, componentContractBlockers, computeComponentContractHash, getComponentContractInfo, normaliseComponentSections, normaliseComponentSource, refreshCapabilitiesIndex, refreshComponentsIndex } from './componentCore';
import { createTechnicalChangeFromImportedReview, readComponentTechnicalChanges, readComponentTechnicalReviews } from './componentTechnicalChanges';
import { DELIVERY_REVIEW_EXCLUDED_SOURCE_DIRECTORIES, DELIVERY_REVIEW_SOURCE_EXTENSIONS, collectDeliveryReviewSourceEntries } from './delivery';
import { TEMPLATE_VERSION, buildFoundationMarkdown, exists, readEntities, readJson, slugify, writeJson } from './projectCore';
import { capabilitySlugsReferencingComponent, contentLooksComplete, firstMarkdownHeading, titleFromSlug } from './projectMaintenance';
import { collectMarkdownFiles, normalizeSetupStatus, readProjectSetup } from './projectStatus';
import { buildPublishedFoundationMarkdown, buildPublishedStandardsMarkdown, componentSourceReferenceLines, generatedDocHeader, isSameOrInsideDiskPath, normaliseRelativePath, parseMarkdownSafe, setupStatusLabel } from './projectValidation';
import { STANDARD_SECTION_DEFINITIONS, buildStandardSectionMarkdown, readFoundationDocuments, readStandardSections, writeStandardsManifest } from './standards';
import type { ComponentContractStatus, ComponentReviewBundleResult, ComponentReviewPackageImportResult, ComponentSectionInput, ComponentSourceConfig, ComponentTechnicalChangeRecord, ComponentTechnicalReviewChangeSummary, ComponentTechnicalReviewImportResult, ComponentTechnicalReviewPackageInput, ComponentTechnicalReviewPackageResult, ComponentTechnicalReviewSourceScope, ComponentTechnicalReviewType, DeleteComponentInput, FoundationReviewPackageImportResult, FoundationReviewPackageResult, GenerateComponentContractInput, ImportComponentReviewPackageInput, ImportComponentTechnicalReviewPackageInput, ImportFoundationDocumentUpdateInput, ImportFoundationReviewPackageInput, ImportStandardSectionUpdateInput, ImportStandardsReviewPackageInput, ProjectSetupState, ReadComponentInput, SetupStepStatus, StandardsReviewPackageImportResult, StandardsReviewPackageResult, UpdateComponentInput } from './types';

export async function createComponent(root: string, title: string, description?: string, status: string = 'draft', sourceProjects: string[] = [], sourceInput?: Partial<ComponentSourceConfig>, sectionsInput?: ComponentSectionInput[]) {
  const slug = slugify(title);
  const dir = path.join(root, 'components', slug);
  if (await exists(dir)) return slug;

  const linkedCapabilities: string[] = [];
  const sourceProjectIds = Array.from(new Set(sourceProjects));
  const source = normaliseComponentSource(sourceInput);
  const fallback: Partial<Record<string, string>> = { purpose: description || '' };
  const sections = normaliseComponentSections(sectionsInput, fallback);
  const initialContractBlockers = componentContractBlockers(sections);

  await fsp.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'component.json'), {
    slug,
    title,
    kind: 'component',
    status,
    lifecycle: status,
    sourceProjects: sourceProjectIds,
    source,
    createdAt: new Date().toISOString(),
    supportsCapabilities: linkedCapabilities,
    capabilitiesSupported: linkedCapabilities,
    dependsOn: [],
    exposes: [],
    dataOwned: [],
    sections: sections.map((section) => ({
      key: section.key,
      title: section.title,
      fileName: section.fileName,
      status: section.status || 'not-started',
      required: true,
      ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
    })),
    contract: {
      path: 'component.md',
      version: 0,
      sourceHash: '',
      status: initialContractBlockers.length ? 'blocked' : 'missing',
      blockers: initialContractBlockers
    },
    template: {
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(path.join(dir, 'index.md'), buildComponentIndexMarkdown({ slug, title, status, sourceProjects: sourceProjectIds, source, capabilities: linkedCapabilities, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildComponentSectionMarkdown({ slug, componentTitle: title, section, status, sourceProjects: sourceProjectIds, capabilities: linkedCapabilities }), 'utf8');
  }
  await refreshComponentsIndex(root);
  return slug;
}

export async function readComponent(input: ReadComponentInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  const markdownPath = path.join(dir, 'index.md');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const rawIndex = await exists(markdownPath) ? await fsp.readFile(markdownPath, 'utf8') : '';
  const parsedIndex = matter(rawIndex);
  const aidd = (parsedIndex.data as any)?.aidd || {};
  const title = String(manifest.title || aidd.title || slug);
  const status = String(manifest.status || manifest.lifecycle || aidd.status || 'draft');
  const sourceProjects = Array.isArray(manifest.sourceProjects)
    ? manifest.sourceProjects
    : Array.isArray(aidd.sourceProjects)
      ? aidd.sourceProjects
      : [];
  const source = normaliseComponentSource(manifest.source || aidd.source);
  const capabilities: string[] = Array.from(new Set<string>([
    ...(Array.isArray(manifest.supportsCapabilities) ? manifest.supportsCapabilities.map(String) : []),
    ...(Array.isArray(manifest.capabilitiesSupported) ? manifest.capabilitiesSupported.map(String) : []),
    ...(Array.isArray(aidd.capabilitiesSupported) ? aidd.capabilitiesSupported.map(String) : []),
    ...(await readComponentCapabilities(input.projectPath, slug))
  ].filter(Boolean)));

  const fallbackFromLegacyIndex: Partial<Record<string, string>> = {
    purpose: sectionBodyFromMarkdown(rawIndex)
  };

  const sections = [];
  for (const template of COMPONENT_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    let body = fallbackFromLegacyIndex[template.key] || '';
    let sectionStatus: SetupStepStatus = body.trim() ? 'draft' : 'not-started';
    if (await exists(filePath)) {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const sectionAidd = (parsed.data as any)?.aidd || {};
      body = sectionBodyFromMarkdown(raw);
      sectionStatus = sectionAidd.status || (body.trim() ? 'draft' : 'not-started');
      const skipReason = sectionAidd.skipReason ? String(sectionAidd.skipReason) : '';
      sections.push({
        key: template.key,
        fileName: template.fileName,
        title: template.title,
        body,
        status: sectionStatus,
        skipReason,
        prompt: template.prompt
      });
      continue;
    } else {
      const legacySection = await readSectionFromFirstExistingFile(dir, COMPONENT_LEGACY_SECTION_FILES[template.key] || []);
      if (legacySection) {
        body = legacySection.body;
        sectionStatus = legacySection.status;
        sections.push({
          key: template.key,
          fileName: template.fileName,
          title: template.title,
          body,
          status: sectionStatus,
          skipReason: legacySection.skipReason || '',
          prompt: template.prompt
        });
        continue;
      } else if (!body.trim()) {
        body = template.body;
        sectionStatus = 'draft';
      }
    }
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: sectionStatus,
      skipReason: '',
      prompt: template.prompt
    });
  }

  const contract = await getComponentContractInfo({
    dir,
    manifest,
    slug,
    title,
    status,
    sourceProjects,
    source,
    capabilities,
    sections
  });

  return {
    slug,
    title,
    status,
    sourceProjects,
    source,
    capabilities,
    sections,
    contract,
    technicalReviews: await readComponentTechnicalReviews(input.projectPath, slug),
    technicalChanges: await readComponentTechnicalChanges(input.projectPath, slug),
    description: sections.find((section) => section.key === 'purpose')?.body || parsedIndex.content.replace(/^\s*\n/, ''),
    filePath: markdownPath
  };
}

export async function updateComponent(input: UpdateComponentInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  const markdownPath = path.join(dir, 'index.md');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);
  const manifest = await readJson<any>(manifestPath);
  const rawIndex = await exists(markdownPath) ? await fsp.readFile(markdownPath, 'utf8') : '';
  const title = input.title.trim() || manifest.title || slug;
  const status = input.status || manifest.status || manifest.lifecycle || 'draft';
  const sourceProjectSource = Array.isArray(input.sourceProjects)
    ? input.sourceProjects
    : Array.isArray(manifest.sourceProjects)
      ? manifest.sourceProjects
      : [];
  const sourceProjects: string[] = Array.from(new Set<string>(sourceProjectSource.map(String)));
  const source = normaliseComponentSource(input.source || manifest.source);
  const capabilities: string[] = Array.from(new Set<string>([
    ...(Array.isArray(input.capabilities) ? input.capabilities.map(String) : []),
    ...(Array.isArray(manifest.supportsCapabilities) ? manifest.supportsCapabilities.map(String) : []),
    ...(Array.isArray(manifest.capabilitiesSupported) ? manifest.capabilitiesSupported.map(String) : []),
    ...(await readComponentCapabilities(input.projectPath, slug))
  ].filter(Boolean)));
  const fallback: Partial<Record<string, string>> = {
    purpose: input.description || sectionBodyFromMarkdown(rawIndex)
  };
  const sections = normaliseComponentSections(input.sections, fallback);
  const contractSourceHash = computeComponentContractHash({ slug, title, status, sourceProjects, source, capabilities, sections });
  const contractBlockers = componentContractBlockers(sections);
  const previousContract = manifest.contract || {};
  const contractExists = await exists(path.join(dir, 'component.md'));
  const contractStatus: ComponentContractStatus = contractBlockers.length
    ? 'blocked'
    : (!contractExists || !previousContract.sourceHash)
      ? 'missing'
      : previousContract.sourceHash === contractSourceHash
        ? 'current'
        : 'stale';

  await writeJson(manifestPath, {
    ...manifest,
    slug,
    title,
    kind: manifest.kind || 'component',
    status,
    lifecycle: status,
    sourceProjects,
    source,
    supportsCapabilities: capabilities,
    capabilitiesSupported: capabilities,
    updatedAt: new Date().toISOString(),
    sections: sections.map((section) => ({
      key: section.key,
      title: section.title,
      fileName: section.fileName,
      status: section.status || 'not-started',
      required: true,
      ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
    })),
    contract: {
      ...previousContract,
      path: 'component.md',
      version: Number(previousContract.version || 0),
      sourceHash: previousContract.sourceHash || '',
      status: contractStatus,
      blockers: contractBlockers
    },
    template: {
      ...(manifest.template || {}),
      type: 'component',
      sectionFiles: sections.map((section) => section.fileName),
      templateVersion: TEMPLATE_VERSION
    }
  });
  await fsp.writeFile(markdownPath, buildComponentIndexMarkdown({ slug, title, status, sourceProjects, source, capabilities, sections }), 'utf8');
  for (const section of sections) {
    await fsp.writeFile(path.join(dir, section.fileName), buildComponentSectionMarkdown({ slug, componentTitle: title, section, status, sourceProjects, capabilities }), 'utf8');
  }
  await refreshComponentsIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}

export async function removeDeletedComponentFromCapabilities(projectPath: string, componentSlug: string) {
  const capabilities = await readEntities(projectPath, 'capabilities', 'capability.json');
  const updatedCapabilitySlugs: string[] = [];

  for (const capability of capabilities) {
    const capabilitySlug = String(capability.slug || capability.id || slugify(String(capability.title || ''))).trim();
    if (!capabilitySlug) continue;

    const linkedComponents: string[] = Array.isArray(capability.components)
      ? capability.components.map(String)
      : Array.isArray(capability.modules)
        ? capability.modules.map(String)
        : [];
    if (!linkedComponents.includes(componentSlug)) continue;

    const nextComponentSlugs = linkedComponents.filter((slug) => slug !== componentSlug);
    const detail = await readCapability({ projectPath, slug: capabilitySlug });
    await updateCapability({
      projectPath,
      slug: capabilitySlug,
      title: detail.title,
      status: detail.status as SetupStepStatus,
      componentSlugs: nextComponentSlugs,
      sections: detail.sections
    });
    updatedCapabilitySlugs.push(capabilitySlug);
  }

  return updatedCapabilitySlugs;
}

export async function deleteComponent(input: DeleteComponentInput) {
  const rawSlug = String(input.slug || '').trim();
  if (!input.projectPath || !rawSlug) throw new Error('Project path and component slug are required.');

  const slug = slugify(rawSlug);
  if (!slug || slug !== rawSlug) throw new Error('Component delete rejected: invalid component slug.');

  const candidates = [
    {
      root: path.resolve(input.projectPath, 'components'),
      dir: path.resolve(input.projectPath, 'components', slug),
      manifest: 'component.json'
    },
    {
      root: path.resolve(input.projectPath, 'modules'),
      dir: path.resolve(input.projectPath, 'modules', slug),
      manifest: 'module.json'
    }
  ];

  let target: typeof candidates[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.dir === candidate.root || !candidate.dir.startsWith(`${candidate.root}${path.sep}`)) {
      throw new Error('Component delete rejected: unsafe component path.');
    }
    if (await exists(path.join(candidate.dir, candidate.manifest))) {
      target = candidate;
      break;
    }
  }

  if (!target) throw new Error(`Component not found: ${slug}`);

  await fsp.rm(target.dir, { recursive: true, force: false });
  await removeDeletedComponentFromCapabilities(input.projectPath, slug);
  await refreshComponentsIndex(input.projectPath);
  await refreshCapabilitiesIndex(input.projectPath);
  return readProjectSetup(input.projectPath);
}

export async function generateComponentContract(input: GenerateComponentContractInput) {
  const slug = slugify(input.slug);
  const dir = path.join(input.projectPath, 'components', slug);
  const manifestPath = path.join(dir, 'component.json');
  if (!(await exists(manifestPath))) throw new Error(`Component not found: ${slug}`);

  const manifest = await readJson<any>(manifestPath);
  const component = await readComponent({ projectPath: input.projectPath, slug });
  const sections = normaliseComponentSections(component.sections, {});
  const sourceHash = computeComponentContractHash({
    slug,
    title: component.title,
    status: String(component.status || 'draft'),
    sourceProjects: component.sourceProjects || [],
    source: normaliseComponentSource(component.source),
    capabilities: component.capabilities || [],
    sections
  });
  const previousContract = manifest.contract || {};
  const previousVersion = Number(previousContract.version || 0);
  const version = previousContract.sourceHash === sourceHash && previousVersion > 0
    ? previousVersion
    : previousVersion + 1;

  await fsp.writeFile(path.join(dir, 'component.md'), buildComponentContractMarkdown({
    slug,
    title: component.title,
    status: String(component.status || 'draft'),
    sourceProjects: component.sourceProjects || [],
    source: normaliseComponentSource(component.source),
    capabilities: component.capabilities || [],
    sections,
    version,
    sourceHash
  }), 'utf8');

  await writeJson(manifestPath, {
    ...manifest,
    slug,
    title: component.title,
    source: normaliseComponentSource(component.source),
    contract: {
      path: 'component.md',
      version,
      sourceHash,
      status: 'current',
      blockers: [],
      sections: sections.map((section) => ({
        key: section.key,
        title: section.title,
        fileName: section.fileName,
        status: section.status || 'not-started',
        ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
      }))
    }
  });

  await refreshComponentsIndex(input.projectPath);
  return readComponent({ projectPath: input.projectPath, slug });
}

export function isSafeComponentReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('components/')) return false;
  const parts = normalised.split('/');
  if (parts.length < 3) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  const base = path.basename(normalised).toLowerCase();
  if (base === 'component.md' || base === 'index.md') return false;
  return true;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const COMPONENT_REVIEW_TITLE_SUFFIXES = Array.from(new Set([
  ...COMPONENT_TEMPLATE_SECTIONS.map((section) => section.title),
  ...COMPONENT_TEMPLATE_SECTIONS.map((section) => section.key.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')),
  'Purpose',
  'Boundaries',
  'Interfaces',
  'Data And State',
  'Data & State',
  'Dependencies',
  'Dependencies & Integrations',
  'Architecture',
  'Internal Design',
  'Standards',
  'Quality Requirements',
  'Risks'
])).sort((a, b) => b.length - a.length);

export function componentTitleCandidateFromReviewTitle(rawTitle: string, slug: string) {
  let title = String(rawTitle || '').trim().replace(/\s+/g, ' ');
  if (!title) return '';

  for (const suffix of COMPONENT_REVIEW_TITLE_SUFFIXES) {
    const re = new RegExp(`(?:\\s+[-–—:]?\\s*)${escapeRegExp(suffix)}$`, 'i');
    title = title.replace(re, '').trim();
  }

  if (!title || slugify(title) === slugify(slug)) return title || titleFromSlug(slug);
  return title;
}

export async function readComponentReviewSectionMetadata(projectPath: string, slug: string) {
  const dir = path.join(projectPath, 'components', slug);
  const titleCandidates: string[] = [];
  const sourceProjects = new Set<string>();
  const capabilities = new Set<string>();
  const sections: ComponentSectionInput[] = [];

  for (const template of COMPONENT_TEMPLATE_SECTIONS) {
    const filePath = path.join(dir, template.fileName);
    if (!(await exists(filePath))) continue;

    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = parseMarkdownSafe(raw);
    const aidd = parsed.ok ? ((parsed.parsed.data as any)?.aidd || {}) : {};
    const body = sectionBodyFromMarkdown(raw);
    const heading = firstMarkdownHeading(raw);
    const aiddTitle = String(aidd.title || '').trim();

    if (aiddTitle) titleCandidates.push(componentTitleCandidateFromReviewTitle(aiddTitle, slug));
    if (heading) titleCandidates.push(componentTitleCandidateFromReviewTitle(heading, slug));

    if (Array.isArray(aidd.sourceProjects)) {
      for (const item of aidd.sourceProjects) {
        const value = String(item || '').trim();
        if (value) sourceProjects.add(value);
      }
    }
    if (Array.isArray(aidd.capabilitiesSupported)) {
      for (const item of aidd.capabilitiesSupported) {
        const value = String(item || '').trim();
        if (value) capabilities.add(value);
      }
    }

    const status = String(aidd.status || (contentLooksComplete(raw) ? 'complete' : 'draft')) as SetupStepStatus;
    sections.push({
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status,
      skipReason: aidd.skipReason ? String(aidd.skipReason) : ''
    });
  }

  const title = titleCandidates.find((candidate) => candidate.trim()) || titleFromSlug(slug);
  const status = sections.length && sections.every((section) => section.status === 'complete' || section.status === 'skipped')
    ? 'complete'
    : 'draft';

  return {
    title,
    status: status as SetupStepStatus,
    sourceProjects: Array.from(sourceProjects),
    capabilities: Array.from(capabilities),
    sections: normaliseComponentSections(sections, {})
  };
}

export async function reconcileComponentAfterReviewImport(projectPath: string, slug: string) {
  const canonicalSlug = slugify(slug);
  const dir = path.join(projectPath, 'components', canonicalSlug);
  const manifestPath = path.join(dir, 'component.json');
  const indexPath = path.join(dir, 'index.md');
  const metadata = await readComponentReviewSectionMetadata(projectPath, canonicalSlug);
  const linkedCapabilities = await capabilitySlugsReferencingComponent(projectPath, canonicalSlug);
  const capabilities = Array.from(new Set([...metadata.capabilities, ...linkedCapabilities]));
  const source = normaliseComponentSource();
  const createdManifest = !(await exists(manifestPath));

  await fsp.mkdir(dir, { recursive: true });

  if (createdManifest) {
    await writeJson(manifestPath, {
      slug: canonicalSlug,
      title: metadata.title,
      kind: 'component',
      status: metadata.status,
      lifecycle: metadata.status,
      sourceProjects: metadata.sourceProjects,
      source,
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      supportsCapabilities: capabilities,
      capabilitiesSupported: capabilities,
      dependsOn: [],
      exposes: [],
      dataOwned: [],
      sections: metadata.sections.map((section) => ({
        key: section.key,
        title: section.title,
        fileName: section.fileName,
        status: section.status || 'not-started',
        required: true,
        ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
      })),
      contract: {
        path: 'component.md',
        version: 0,
        sourceHash: '',
        status: componentContractBlockers(metadata.sections).length ? 'blocked' : 'missing',
        blockers: componentContractBlockers(metadata.sections)
      },
      template: {
        type: 'component',
        sectionFiles: COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName),
        templateVersion: TEMPLATE_VERSION
      }
    });
  }

  if (!(await exists(indexPath))) {
    await fsp.writeFile(indexPath, buildComponentIndexMarkdown({
      slug: canonicalSlug,
      title: metadata.title,
      status: metadata.status,
      sourceProjects: metadata.sourceProjects,
      source,
      capabilities,
      sections: metadata.sections
    }), 'utf8');
  }

  const component = await readComponent({ projectPath, slug: canonicalSlug });
  await updateComponent({
    projectPath,
    slug: canonicalSlug,
    title: component.title,
    status: component.status as SetupStepStatus,
    sourceProjects: component.sourceProjects,
    source: component.source,
    capabilities: component.capabilities,
    sections: component.sections
  });

  return { slug: canonicalSlug, createdManifest };
}

export async function importComponentReviewPackage(input: ImportComponentReviewPackageInput): Promise<ComponentReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasComponentsDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'components/' || name.startsWith('components/');
  });
  if (!hasComponentsDirectory) {
    throw new Error('Review response rejected: the zip must contain a components/ directory.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let reviewMarkdown: string | undefined;

  for (const entry of entries) {
    const relativePath = safeZipReadEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeComponentReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data, 'utf8');
    importedFiles.push(relativePath);
  }

  const componentSlugs = Array.from(new Set(importedFiles.map((file) => file.split('/')[1]).filter(Boolean).map((slug) => slugify(slug)))).sort((a, b) => a.localeCompare(b));
  const importedComponents: string[] = [];

  for (const slug of componentSlugs) {
    const result = await reconcileComponentAfterReviewImport(root, slug);
    importedComponents.push(result.slug);
  }

  await refreshComponentsIndex(root);

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    componentCount: componentSlugs.length,
    importedComponents: Array.from(new Set(importedComponents)).sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

export function shouldIncludeInReviewBundle(raw: string) {
  try {
    const parsed = matter(raw || '');
    const data = (parsed.data || {}) as any;
    const aidd = data.aidd || {};
    if (data.includeInReviewBundle === false || aidd.includeInReviewBundle === false) return false;
    if (data.excludeFromReviewBundle === true || aidd.excludeFromReviewBundle === true) return false;
  } catch {
    return true;
  }
  return true;
}

export function frontmatterValueAsString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export const FOUNDATION_REVIEW_FILES = new Set([
  'foundation/01-project-overview.md',
  'foundation/02-product-definition.md',
  'foundation/03-audience-and-users.md',
  'foundation/04-goals-and-success-metrics.md'
]);

export async function readProjectName(root: string) {
  const templateManifestPath = path.join(root, 'aidd.template.json');
  const templateManifest = await exists(templateManifestPath)
    ? await readJson<any>(templateManifestPath).catch(() => null)
    : null;
  return String(templateManifest?.project?.name || path.basename(root) || 'AIDD project');
}

export async function readStandardsReviewMarkdown(projectPath: string) {
  const sections = await readStandardSections(projectPath);
  const included: string[] = [];

  for (const section of sections) {
    if (!(await exists(section.filePath))) continue;
    const raw = await fsp.readFile(section.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    const parsed = matter(raw);
    included.push([
      `## ${section.title}`,
      '',
      `Source: foundation/standards/${section.fileName}`,
      `Status: ${section.status}`,
      '',
      parsed.content.trim() || '_No content captured._'
    ].join('\n'));
  }

  if (!included.length) return '_No project standards files were found or included._\n';
  return included.join('\n\n');
}

export function buildFoundationReviewPackageReadme(input: { projectName: string; foundationFileCount: number }) {
  return `# AIDD Foundation Review Package

This zip was generated by AIDD for Foundation review.

## Review scope

You are reviewing **only the Foundation files included in this package**.

Do not review or modify components, capabilities, delivery packages, source code, generated files, or project structure.

\`CONTEXT-STANDARDS.md\` is **context only**. Use it to understand project expectations, but do not return it.

Focus your review on:

- clarity of project overview
- clarity of product definition
- audience and user understanding
- goals and success metrics
- consistency between overview, product, audience, and goals
- missing or unclear assumptions
- pros and cons
- usefulness for future component, capability, and delivery-package work

## Your task

Review the Markdown files under \`foundation/\` and improve them so they are clearer, more complete, and easier to use as AIDD project context.

## Allowed changes

You may update only these files:

- \`foundation/01-project-overview.md\`
- \`foundation/02-product-definition.md\`
- \`foundation/03-audience-and-users.md\`
- \`foundation/04-goals-and-success-metrics.md\`

You must return a zip containing only:

- updated Markdown files under \`foundation/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated Foundation files.

## Do not return

Do not return:

- \`CONTEXT-STANDARDS.md\`
- \`README.md\`
- \`MANIFEST.json\`
- source code
- components
- capabilities
- delivery packages
- files outside \`foundation/\`
- any unknown Foundation files

## Required return shape

\`\`\`txt
foundation/
  01-project-overview.md
  02-product-definition.md
  03-audience-and-users.md
  04-goals-and-success-metrics.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`foundation/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review packages

To exclude a Markdown file from future review packages, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Foundation files included: ${input.foundationFileCount}
`;
}

export function buildFoundationReviewTemplate(input: { projectName: string }) {
  return `# Foundation Review

Project: ${input.projectName}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

export async function collectFoundationReviewEntries(projectPath: string) {
  const docs = await readFoundationDocuments(projectPath);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];

  for (const doc of docs) {
    const relativePath = `foundation/${doc.fileName}`;
    if (!FOUNDATION_REVIEW_FILES.has(relativePath)) continue;
    if (!(await exists(doc.filePath))) continue;
    const raw = await fsp.readFile(doc.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    entries.push({ name: relativePath, data: Buffer.from(raw, 'utf8') });
    includedFiles.push(relativePath);
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)) };
}

export async function createFoundationReviewPackage(projectPath: string): Promise<FoundationReviewPackageResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-foundation-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-packages', slugify(projectName), 'foundation');
  const filePath = path.join(outputDir, fileName);

  const foundation = await collectFoundationReviewEntries(root);
  if (!foundation.includedFiles.length) {
    throw new Error('No Foundation files were available to package for review.');
  }

  const manifest = {
    bundleType: 'foundation-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      'foundation/01-project-overview.md',
      'foundation/02-product-definition.md',
      'foundation/03-audience-and-users.md',
      'foundation/04-goals-and-success-metrics.md',
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'README.md',
      'MANIFEST.json',
      'CONTEXT-STANDARDS.md',
      'components/**',
      'capabilities/**',
      'delivery/**',
      'code/**',
      'source-code/**'
    ],
    foundationFiles: foundation.includedFiles,
    returnInstructions: {
      zipMustContain: ['foundation/<updated-foundation-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnKnownFoundationFiles: true
    }
  };

  const standardsMarkdown = await readStandardsReviewMarkdown(root);
  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildFoundationReviewPackageReadme({ projectName, foundationFileCount: foundation.includedFiles.length }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildFoundationReviewTemplate({ projectName }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    { name: 'CONTEXT-STANDARDS.md', data: Buffer.from(`# Project Standards Context\n\n${standardsMarkdown.trim()}\n`, 'utf8') },
    ...foundation.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    foundationFileCount: foundation.includedFiles.length,
    entryCount: zipEntries.length
  };
}

export function isSafeFoundationReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('foundation/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  return FOUNDATION_REVIEW_FILES.has(normalised);
}

export async function importFoundationReviewPackage(input: ImportFoundationReviewPackageInput): Promise<FoundationReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasFoundationDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'foundation/' || name.startsWith('foundation/');
  });
  if (!hasFoundationDirectory) {
    throw new Error('Review response rejected: the zip must contain a foundation/ directory.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let reviewMarkdown: string | undefined;

  for (const entry of entries) {
    const relativePath = safeZipReadEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeFoundationReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data, 'utf8');
    importedFiles.push(relativePath);
  }

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

export async function importFoundationDocumentUpdate(input: ImportFoundationDocumentUpdateInput): Promise<ProjectSetupState> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Foundation file name is required.');
  if (!input.updateFilePath) throw new Error('Dropped Markdown update path is required.');
  if (path.basename(input.fileName) !== input.fileName || path.extname(input.fileName).toLowerCase() !== '.md') {
    throw new Error(`Invalid Foundation file name: ${input.fileName}`);
  }

  const updateFilePath = path.resolve(input.updateFilePath);
  if (!(await exists(updateFilePath))) throw new Error(`Dropped Markdown file does not exist: ${input.updateFilePath}`);
  if (path.extname(updateFilePath).toLowerCase() !== '.md') throw new Error('Foundation updates must be Markdown .md files.');

  const docs = await readFoundationDocuments(input.projectPath);
  const existing = docs.find((doc) => doc.fileName === input.fileName);
  if (!existing) throw new Error(`Unknown foundation document: ${input.fileName}`);

  const raw = await fsp.readFile(updateFilePath, 'utf8');
  const parsed = matter(raw);
  const incomingStatus = normalizeSetupStatus(parsed.data?.aidd?.status || parsed.data?.status || existing.status);
  const body = parsed.content ?? raw;

  await fsp.mkdir(path.dirname(existing.filePath), { recursive: true });
  await fsp.writeFile(existing.filePath, buildFoundationMarkdown({
    id: existing.id,
    title: existing.title,
    status: incomingStatus,
    required: existing.required,
    body,
  }), 'utf8');

  return readProjectSetup(input.projectPath);
}

export const STANDARDS_REVIEW_FILES = new Set(
  STANDARD_SECTION_DEFINITIONS.map((section) => `foundation/standards/${section.fileName}`)
);

export function buildStandardsReviewPackageReadme(input: { projectName: string; standardsFileCount: number }) {
  return `# AIDD Standards Review Package

This zip was generated by AIDD for Standards review.

## Review scope

You are reviewing **only the Standards files included in this package**.

Do not review or modify Foundation, components, capabilities, delivery packages, source code, generated files, or project structure.

Focus your review on:

- clarity of coding style expectations
- security expectations and review checks
- testing and evidence requirements
- architectural principles and decision rules
- hosting/platform constraints
- usefulness for future components, capabilities, delivery packages, and AI agents

## Your task

Review the Markdown files under \`foundation/standards/\` and improve them so they are clearer, more complete, and easier for humans and AI agents to follow.

## Allowed changes

You may update only known Standards Markdown files under:

- \`foundation/standards/\`

You must return a zip containing only:

- updated Markdown files under \`foundation/standards/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated Standards files.

## Do not return

Do not return:

- \`README.md\`
- \`MANIFEST.json\`
- source code
- foundation files outside \`foundation/standards/\`
- components
- capabilities
- delivery packages
- files outside \`foundation/standards/\`
- any unknown Standards files

## Required return shape

\`\`\`txt
foundation/
  standards/
    index.md
    01-coding-style.md
    02-security.md
    03-testing.md
    04-architecture.md
    05-hosting-platform.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`foundation/standards/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review packages

To exclude a Markdown file from future review packages, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Standards files included: ${input.standardsFileCount}
`;
}

export function buildStandardsReviewTemplate(input: { projectName: string }) {
  return `# Standards Review

Project: ${input.projectName}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

export async function collectStandardsReviewEntries(projectPath: string) {
  const sections = await readStandardSections(projectPath);
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];

  for (const section of sections) {
    const relativePath = `foundation/standards/${section.fileName}`;
    if (!STANDARDS_REVIEW_FILES.has(relativePath)) continue;
    if (!(await exists(section.filePath))) continue;
    const raw = await fsp.readFile(section.filePath, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;
    entries.push({ name: relativePath, data: Buffer.from(raw, 'utf8') });
    includedFiles.push(relativePath);
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)) };
}

export async function createStandardsReviewPackage(projectPath: string): Promise<StandardsReviewPackageResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-standards-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-packages', slugify(projectName), 'standards');
  const filePath = path.join(outputDir, fileName);

  const standards = await collectStandardsReviewEntries(root);
  if (!standards.includedFiles.length) {
    throw new Error('No Standards files were available to package for review.');
  }

  const manifest = {
    bundleType: 'standards-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      ...Array.from(STANDARDS_REVIEW_FILES),
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'README.md',
      'MANIFEST.json',
      'foundation/*.md',
      'components/**',
      'capabilities/**',
      'delivery/**',
      'code/**',
      'source-code/**'
    ],
    standardsFiles: standards.includedFiles,
    returnInstructions: {
      zipMustContain: ['foundation/standards/<updated-standards-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnKnownStandardsFiles: true
    }
  };

  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildStandardsReviewPackageReadme({ projectName, standardsFileCount: standards.includedFiles.length }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildStandardsReviewTemplate({ projectName }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...standards.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    standardsFileCount: standards.includedFiles.length,
    entryCount: zipEntries.length
  };
}

export function isSafeStandardsReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised || !normalised.startsWith('foundation/standards/')) return false;
  if (!normalised.toLowerCase().endsWith('.md')) return false;
  return STANDARDS_REVIEW_FILES.has(normalised);
}

export async function importStandardsReviewPackage(input: ImportStandardsReviewPackageInput): Promise<StandardsReviewPackageImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.zipPath) throw new Error('Review response zip path is required.');
  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Review response must be a .zip file.');

  const entries = await readZipFile(zipPath);
  const hasStandardsDirectory = entries.some((entry) => {
    const name = normaliseRelativePath(entry.name).replace(/^\/+/, '');
    return name === 'foundation/standards/' || name.startsWith('foundation/standards/');
  });
  if (!hasStandardsDirectory) {
    throw new Error('Review response rejected: the zip must contain a foundation/standards/ directory.');
  }

  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let reviewMarkdown: string | undefined;

  for (const entry of entries) {
    const relativePath = safeZipReadEntryName(entry.name);
    if (!relativePath || entry.directory) continue;
    if (relativePath === 'REVIEW.md') {
      reviewMarkdown = entry.data.toString('utf8');
      continue;
    }
    if (!isSafeStandardsReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }

    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data, 'utf8');
    importedFiles.push(relativePath);
  }

  await writeStandardsManifest(root);

  return {
    accepted: true,
    zipPath,
    importedFiles: importedFiles.sort((a, b) => a.localeCompare(b)),
    skippedFiles: skippedFiles.sort((a, b) => a.localeCompare(b)),
    reviewIncluded: Boolean(reviewMarkdown),
    ...(reviewMarkdown ? { reviewMarkdown } : {})
  };
}

export async function importStandardSectionUpdate(input: ImportStandardSectionUpdateInput): Promise<ProjectSetupState> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.fileName) throw new Error('Standards file name is required.');
  if (!input.updateFilePath) throw new Error('Dropped Markdown update path is required.');
  if (path.basename(input.fileName) !== input.fileName || path.extname(input.fileName).toLowerCase() !== '.md') {
    throw new Error(`Invalid Standards file name: ${input.fileName}`);
  }

  const definition = STANDARD_SECTION_DEFINITIONS.find((section) => section.fileName === input.fileName);
  if (!definition) throw new Error(`Unknown Standards section: ${input.fileName}`);

  const updateFilePath = path.resolve(input.updateFilePath);
  if (!(await exists(updateFilePath))) throw new Error(`Dropped Markdown file does not exist: ${input.updateFilePath}`);
  if (path.extname(updateFilePath).toLowerCase() !== '.md') throw new Error('Standards updates must be Markdown .md files.');

  const sections = await readStandardSections(input.projectPath);
  const existing = sections.find((section) => section.fileName === input.fileName);
  if (!existing) throw new Error(`Unknown Standards section: ${input.fileName}`);

  const raw = await fsp.readFile(updateFilePath, 'utf8');
  const parsed = matter(raw);
  const incomingStatus = normalizeSetupStatus(parsed.data?.aidd?.status || parsed.data?.status || existing.status);
  const body = parsed.content ?? raw;

  await fsp.mkdir(path.dirname(existing.filePath), { recursive: true });
  await fsp.writeFile(existing.filePath, buildStandardSectionMarkdown({
    id: existing.id || definition.id,
    title: existing.title || definition.title,
    status: incomingStatus,
    required: existing.required,
    body
  }), 'utf8');

  await writeStandardsManifest(input.projectPath);
  return readProjectSetup(input.projectPath);
}

export async function buildProjectFoundationReviewMarkdown(projectPath: string) {
  const foundationRoot = path.join(projectPath, 'foundation');
  const files = await collectMarkdownFiles(foundationRoot);
  const includedFiles: string[] = [];
  const sections: string[] = [];

  for (const relativeFile of files) {
    const full = path.join(foundationRoot, relativeFile);
    const raw = await fsp.readFile(full, 'utf8');
    if (!shouldIncludeInReviewBundle(raw)) continue;

    const parsed = matter(raw);
    const data = (parsed.data || {}) as any;
    const aidd = data.aidd || {};
    const title = frontmatterValueAsString(aidd.title) || frontmatterValueAsString(data.title) || path.basename(relativeFile, '.md');
    const status = frontmatterValueAsString(aidd.status) || frontmatterValueAsString(data.status) || 'unknown';
    const body = parsed.content.trim() || '_No content captured._';
    includedFiles.push(`foundation/${normaliseRelativePath(relativeFile)}`);
    sections.push([
      `## ${title}`,
      '',
      `- Source: \`foundation/${normaliseRelativePath(relativeFile)}\``,
      `- Status: \`${status}\``,
      '',
      body,
      ''
    ].join('\n'));
  }

  const markdown = [
    '# Project Context',
    '',
    'This file was generated by AIDD for review context only.',
    'Do not return this file in the review zip.',
    '',
    sections.length ? sections.join('\n') : '_No foundation files were included in this review bundle._',
    ''
  ].join('\n');

  return { markdown, includedFiles };
}

export async function collectComponentReviewEntries(projectPath: string, componentSlug?: string) {
  const componentsRoot = path.join(projectPath, 'components');
  const entries: ZipEntryInput[] = [];
  const includedFiles: string[] = [];
  const requestedSlug = componentSlug ? slugify(componentSlug) : null;
  let componentCount = 0;

  if (!(await exists(componentsRoot))) {
    return { entries, includedFiles, componentCount };
  }

  for (const componentDirEntry of await fsp.readdir(componentsRoot, { withFileTypes: true })) {
    if (!componentDirEntry.isDirectory() || componentDirEntry.name.startsWith('_')) continue;

    const slug = componentDirEntry.name;
    if (requestedSlug && slug !== requestedSlug) continue;
    const componentDir = path.join(componentsRoot, slug);
    const manifestPath = path.join(componentDir, 'component.json');
    if (!(await exists(manifestPath))) continue;
    componentCount += 1;

    let sectionFiles = COMPONENT_TEMPLATE_SECTIONS.map((section) => section.fileName);
    try {
      const manifest = await readJson<any>(manifestPath);
      const manifestSectionFiles = Array.isArray(manifest?.template?.sectionFiles)
        ? manifest.template.sectionFiles.map(String)
        : Array.isArray(manifest?.sections)
          ? manifest.sections.map((section: any) => String(section.fileName || '')).filter(Boolean)
          : [];
      if (manifestSectionFiles.length) sectionFiles = manifestSectionFiles;
    } catch {}

    const existingMarkdown = (await collectMarkdownFiles(componentDir)).filter((relativeFile) => {
      const base = path.basename(relativeFile).toLowerCase();
      const normalised = normaliseRelativePath(relativeFile).toLowerCase();
      return base !== 'index.md' && base !== 'component.md' && !normalised.startsWith('technical-reviews/');
    });

    const candidateFiles = Array.from(new Set([...sectionFiles, ...existingMarkdown])).filter((fileName) => {
      const normalised = normaliseRelativePath(fileName);
      const base = path.basename(normalised).toLowerCase();
      const unsafe = path.isAbsolute(fileName) || normalised.split('/').some((part) => part === '..' || part === '.');
      return !unsafe && normalised.toLowerCase().endsWith('.md') && base !== 'index.md' && base !== 'component.md';
    });

    for (const relativeFile of candidateFiles) {
      const full = path.join(componentDir, relativeFile);
      if (!(await exists(full))) continue;
      const raw = await fsp.readFile(full, 'utf8');
      if (!shouldIncludeInReviewBundle(raw)) continue;
      const zipPath = `components/${slug}/${normaliseRelativePath(relativeFile)}`;
      entries.push({ name: zipPath, data: Buffer.from(raw, 'utf8') });
      includedFiles.push(zipPath);
    }
  }

  return { entries, includedFiles: includedFiles.sort((a, b) => a.localeCompare(b)), componentCount };
}

export function buildComponentReviewBundleReadme(input: { projectName: string; componentCount: number; componentFileCount: number; foundationFileCount: number; targetComponent?: string | null }) {
  const targetComponent = input.targetComponent || '<included-component-id>';
  return `# AIDD Component Review Package

This zip was generated by AIDD for component review.

## Review scope

You are reviewing **only the component included in this package**.

Target component: \`${targetComponent}\`

Do not review or modify any other components, capabilities, delivery packages, source code, or project structure unless explicitly required to understand this component.

\`PROJECT.md\` is **context only**.

Focus your review on:

- clarity of purpose
- responsibilities and boundaries
- internal architecture
- risks and edge cases
- missing or unclear design decisions
- pros and cons
- suitability for implementation in a delivery package

## Your task

Review the included component section files under \`components/${targetComponent}/\` and improve them so they are clearer, more complete, and more useful for coding delivery packages.

Use \`PROJECT.md\` only as background context.

## Allowed changes

You may update files only under:

- \`components/${targetComponent}/\`

You must return a zip containing only:

- updated Markdown files under \`components/${targetComponent}/\`
- \`REVIEW.md\`

The included \`REVIEW.md\` is a template. Complete it and return it with the updated component files.

## Do not return

Do not return:

- \`PROJECT.md\`
- \`README.md\`
- \`MANIFEST.json\`
- generated \`component.md\` files
- component \`index.md\` files
- source code
- files outside \`components/${targetComponent}/\`
- any unrelated components

## Required return shape

\`\`\`txt
components/
  ${targetComponent}/
    <updated-section-files>.md
REVIEW.md
\`\`\`

AIDD will accept a returned zip only when it contains a \`components/\` directory.

## REVIEW.md must include

- Summary of changes
- Pros: what is already strong or useful
- Cons: gaps, inconsistencies, weak areas, or risks
- Components reviewed
- Files changed
- Assumptions made
- Questions or unresolved issues

## Excluding files from future review bundles

To exclude a Markdown file from future review bundles, add this to its front matter:

\`\`\`yaml
aidd:
  includeInReviewBundle: false
\`\`\`

## Package summary

- Project: ${input.projectName}
- Target component: ${targetComponent}
- Foundation files included: ${input.foundationFileCount}
- Components found: ${input.componentCount}
- Component files included: ${input.componentFileCount}
`;
}

export function buildComponentReviewTemplate(input: { projectName: string; targetComponent?: string | null }) {
  return `# Component Review

Project: ${input.projectName}
Target component: ${input.targetComponent || '<included-component-id>'}

## Summary of changes

- TODO

## Pros

- TODO

## Cons

- TODO

## Components reviewed

- TODO

## Files changed

- TODO

## Assumptions made

- TODO

## Questions or unresolved issues

- TODO
`;
}

export async function createComponentReviewBundle(projectPath: string, componentSlug?: string): Promise<ComponentReviewBundleResult> {
  if (!projectPath) throw new Error('Project path is required.');
  const root = path.resolve(projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${projectPath}`);

  const projectName = await readProjectName(root);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const requestedSlug = componentSlug ? slugify(componentSlug) : null;
  const fileName = requestedSlug
    ? `${slugify(projectName)}-${requestedSlug}-component-review-${stamp}.zip`
    : `${slugify(projectName)}-component-review-${stamp}.zip`;
  const outputDir = requestedSlug
    ? path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), requestedSlug)
    : path.join(app.getPath('userData'), 'review-bundles', slugify(projectName));
  const filePath = path.join(outputDir, fileName);

  const foundation = await buildProjectFoundationReviewMarkdown(root);
  const components = await collectComponentReviewEntries(root, requestedSlug || undefined);
  if (requestedSlug && components.componentCount === 0) {
    throw new Error(`Component not found or has no reviewable files: ${requestedSlug}`);
  }
  const manifest = {
    bundleType: 'component-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    allowedReturnPaths: [
      'components/**/*.md',
      'REVIEW.md'
    ],
    disallowedReturnPaths: [
      'PROJECT.md',
      'README.md',
      'MANIFEST.json',
      'components/**/component.md',
      'components/**/index.md',
      '**/*.json',
      'code/**',
      'foundation/**',
      'capabilities/**',
      'delivery/**'
    ],
    foundationSources: foundation.includedFiles,
    targetComponent: requestedSlug || null,
    componentFiles: components.includedFiles,
    returnInstructions: {
      zipMustContain: ['components/<component-id>/<updated-section-files>.md', 'REVIEW.md'],
      reviewTemplateIncluded: true,
      onlyReturnChangedComponentSectionFiles: true,
      doNotReturnGeneratedComponentContracts: true
    }
  };

  const zipEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildComponentReviewBundleReadme({ projectName, componentCount: components.componentCount, componentFileCount: components.includedFiles.length, foundationFileCount: foundation.includedFiles.length, targetComponent: requestedSlug || null }), 'utf8') },
    { name: 'REVIEW.md', data: Buffer.from(buildComponentReviewTemplate({ projectName, targetComponent: requestedSlug || null }), 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    { name: 'PROJECT.md', data: Buffer.from(foundation.markdown, 'utf8') },
    ...components.entries
  ];

  await writeZipFile(filePath, zipEntries);
  return {
    filePath,
    fileName,
    componentCount: components.componentCount,
    componentFileCount: components.includedFiles.length,
    foundationFileCount: foundation.includedFiles.length,
    entryCount: zipEntries.length
  };
}

export const DEFAULT_COMPONENT_TECHNICAL_REVIEW_TYPES: ComponentTechnicalReviewType[] = ['code', 'security', 'architecture', 'tests'];

export const COMPONENT_TECHNICAL_REVIEW_TYPES = new Set<ComponentTechnicalReviewType>([
  'code',
  'security',
  'architecture',
  'tests',
  'performance',
  'accessibility',
  'dependencies'
]);

export function normaliseComponentTechnicalReviewTypes(input?: ComponentTechnicalReviewType[]) {
  const selected = Array.isArray(input)
    ? input.filter((item): item is ComponentTechnicalReviewType => COMPONENT_TECHNICAL_REVIEW_TYPES.has(item))
    : [];
  return selected.length ? Array.from(new Set(selected)) : DEFAULT_COMPONENT_TECHNICAL_REVIEW_TYPES;
}

export function normaliseComponentTechnicalReviewSourceScope(input?: ComponentTechnicalReviewSourceScope) {
  return input === 'changed-files' || input === 'full-source' ? input : 'component-source';
}

export function buildComponentTechnicalReviewComponentMarkdown(input: {
  projectName: string;
  component: Awaited<ReturnType<typeof readComponent>>;
}) {
  const { component } = input;
  const lines = [
    generatedDocHeader(`AIDD component ${component.slug}`),
    `# AIDD Component: ${component.title}`,
    '',
    `Project: ${input.projectName}`,
    `Slug: \`${component.slug}\``,
    `Status: \`${setupStatusLabel(component.status)}\``,
    component.capabilities.length ? `Capabilities: ${component.capabilities.map((item) => `\`${item}\``).join(', ')}` : 'Capabilities: _none linked_',
    '',
    'This file is generated by AIDD as read-only context for a component technical review.',
    '',
    '## Source mapping',
    '',
    ...componentSourceReferenceLines({
      ...component,
      supportsCapabilities: component.capabilities,
      capabilitiesSupported: component.capabilities
    }),
    ''
  ];

  for (const section of component.sections || []) {
    lines.push(
      '---',
      '',
      `## ${section.title}`,
      '',
      `Source: \`components/${component.slug}/${section.fileName}\``,
      `Status: \`${setupStatusLabel(section.status)}\``,
      '',
      section.status === 'skipped'
        ? `_This section was skipped in AIDD.${section.skipReason ? ` Reason: ${section.skipReason}` : ''}_`
        : section.body.trim() || '_No content captured._',
      ''
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function readComponentContractMarkdownForReview(projectPath: string, component: Awaited<ReturnType<typeof readComponent>>) {
  const contractPath = path.join(projectPath, 'components', component.slug, 'component.md');
  if (await exists(contractPath)) return fsp.readFile(contractPath, 'utf8');
  return [
    `# Component Contract: ${component.title}`,
    '',
    `Component: \`${component.slug}\``,
    '',
    'AIDD did not have a generated component contract file when this technical review package was created.',
    'Use `context/component.md` and the source snapshot as review context.',
    ''
  ].join('\n');
}

export function buildComponentTechnicalReviewReadme(input: {
  projectName: string;
  component: Awaited<ReturnType<typeof readComponent>>;
  reviewTypes: ComponentTechnicalReviewType[];
  sourceRootCount: number;
  sourceFileCount: number;
  warnings: string[];
}) {
  const lines = [
    '# AIDD Component Technical Review',
    '',
    'This zip was generated by AIDD for a component technical review.',
    '',
    '## Review scope',
    '',
    `Project: ${input.projectName}`,
    `Component: ${input.component.title} (\`${input.component.slug}\`)`,
    `Review types: ${input.reviewTypes.map((item) => `\`${item}\``).join(', ')}`,
    '',
    'Use the component context, contract, foundation, standards, and source snapshot to identify technical findings and proposed changes.',
    '',
    '## Bundle layout',
    '',
    '- `instructions/technical-review.md` - review task and constraints',
    '- `instructions/return-format.md` - required return zip shape',
    '- `context/foundation.md` - project foundation context',
    '- `context/standards.md` - project standards context',
    '- `context/component.md` - generated component documentation snapshot',
    '- `context/component-contract.md` - generated component contract when available',
    '- `src/` - read-only source-code snapshot',
    '- `_return-template/` - example returned artefacts',
    '',
    '## Source-code snapshot rules',
    '',
    'Source code is included for review context only. Do not return edited source files.',
    'All proposed implementation changes must be represented as patches under `changes/<change-id>/patches/` in the returned zip.',
    '',
    '## Return package rule',
    '',
    'Return a zip containing only `SUMMARY.md`, optional `REVIEW.md`, optional `MANIFEST.json`, `findings/`, `changes/`, and `patches/index.md`.',
    'Do not include `src/`, `context/`, `instructions/`, component folders, capabilities, delivery packages, executables, environment files, or private keys.',
    '',
    '## Package summary',
    '',
    `- Source roots: ${input.sourceRootCount}`,
    `- Source files: ${input.sourceFileCount}`,
    ''
  ];

  if (input.warnings.length) {
    lines.push('## Warnings', '', ...input.warnings.map((warning) => `- ${warning}`), '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildComponentTechnicalReviewInstructions(input: {
  component: Awaited<ReturnType<typeof readComponent>>;
  reviewTypes: ComponentTechnicalReviewType[];
}) {
  return [
    '# Technical Review Instructions',
    '',
    `Review component: ${input.component.title} (\`${input.component.slug}\`)`,
    '',
    '## Goals',
    '',
    '- Identify concrete technical findings in the component source and AIDD context.',
    '- Propose focused technical changes that can be reviewed by a human before application.',
    '- Provide patches only as proposed artefacts; do not return edited source files.',
    '- Link each proposed change to findings where possible.',
    '',
    '## Review types',
    '',
    ...input.reviewTypes.map((item) => `- ${item}`),
    '',
    '## Constraints',
    '',
    '- Treat all files under `src/` as read-only source context.',
    '- Treat all files under `context/` as read-only AIDD context.',
    '- Do not invent source paths outside the bundled source snapshot unless the finding explicitly explains why.',
    '- Keep patch files reviewable and narrowly scoped.',
    '- If a patch is unsafe or speculative, put the reasoning in `changes/<change-id>/rationale.md` instead of forcing a diff.',
    ''
  ].join('\n');
}

export function buildComponentTechnicalReviewReturnFormat() {
  return [
    '# Return Format',
    '',
    'Returned zips must not contain edited source files.',
    'All source-code changes must be proposed as patches inside `changes/<change-id>/patches/`.',
    '',
    '## Accepted files',
    '',
    '```text',
    'SUMMARY.md',
    'REVIEW.md',
    'MANIFEST.json',
    'findings/<finding-id>.md',
    'findings/<finding-id>.json',
    'changes/<change-id>/overview.md',
    'changes/<change-id>/affected-files.md',
    'changes/<change-id>/rationale.md',
    'changes/<change-id>/verification.md',
    'changes/<change-id>/linked-findings.json',
    'changes/<change-id>/patches/<patch-name>.patch',
    'changes/<change-id>/patches/<patch-name>.diff',
    'changes/<change-id>/patches/notes.md',
    'patches/index.md',
    '```',
    '',
    '## Rejected content',
    '',
    '- `src/**`',
    '- `source/**`',
    '- `components/**`',
    '- `capabilities/**`',
    '- `delivery/**`',
    '- `foundation/**`',
    '- source files such as `.ts`, `.tsx`, `.js`, `.cs`, `.py` outside patch artefacts',
    '- executables, libraries, environment files, private keys, or paths containing `../`',
    ''
  ].join('\n');
}

export function buildComponentTechnicalReviewSummaryTemplate(input: Awaited<ReturnType<typeof readComponent>>) {
  return [
    '# Component Technical Review Summary',
    '',
    `Component: ${input.title} (${input.slug})`,
    '',
    '## Executive summary',
    '',
    '- TODO',
    '',
    '## Findings',
    '',
    '- TODO',
    '',
    '## Proposed changes',
    '',
    '- TODO',
    '',
    '## Verification',
    '',
    '- TODO',
    '',
    '## Residual risk',
    '',
    '- TODO',
    ''
  ].join('\n');
}

export function componentTechnicalReviewReturnPath(relativePath: string) {
  const normalised = safeZipReadEntryName(relativePath);
  if (!normalised) return null;
  const stripped = normalised.startsWith('component-technical-review-return/')
    ? normalised.slice('component-technical-review-return/'.length)
    : normalised;
  const clean = stripped.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return clean;
}

export function isSafeComponentTechnicalReviewSegment(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

export function isSafeComponentTechnicalReviewFileName(fileName: string, allowedExtensions: string[]) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) return false;
  if (fileName === '.' || fileName === '..') return false;
  return allowedExtensions.includes(path.extname(fileName).toLowerCase());
}

export function isSafeComponentTechnicalReviewReturnPath(relativePath: string) {
  const normalised = componentTechnicalReviewReturnPath(relativePath);
  if (!normalised) return false;
  const lower = normalised.toLowerCase();
  if (lower === 'summary.md' || lower === 'review.md' || lower === 'manifest.json') return true;

  const parts = normalised.split('/');
  if (parts[0] === 'findings' && parts.length === 2) {
    return isSafeComponentTechnicalReviewFileName(parts[1], ['.md', '.json']);
  }

  if (parts[0] === 'patches' && parts.length === 2) {
    return parts[1].toLowerCase() === 'index.md';
  }

  if (parts[0] !== 'changes' || parts.length < 3) return false;
  const changeId = parts[1];
  if (!isSafeComponentTechnicalReviewSegment(changeId)) return false;
  const fileName = parts[2].toLowerCase();

  if (parts.length === 3) {
    return [
      'overview.md',
      'affected-files.md',
      'rationale.md',
      'verification.md',
      'linked-findings.json'
    ].includes(fileName);
  }

  if (parts.length === 4 && parts[2] === 'patches') {
    if (parts[3].toLowerCase() === 'notes.md') return true;
    return isSafeComponentTechnicalReviewFileName(parts[3], ['.patch', '.diff']);
  }

  return false;
}

export function summarizeComponentTechnicalReviewImport(input: {
  componentSlug: string;
  importedAt: string;
  reviewDirectory: string;
  importedFiles: string[];
  skippedFiles: string[];
}) {
  const findingFiles = input.importedFiles.filter((file) => file.startsWith('findings/') && (file.endsWith('.md') || file.endsWith('.json')));
  const changes = new Map<string, ComponentTechnicalReviewChangeSummary & { patchSet: Set<string> }>();

  for (const file of input.importedFiles) {
    const parts = file.split('/');
    if (parts[0] !== 'changes' || parts.length < 3) continue;
    const changeId = parts[1];
    const current = changes.get(changeId) || { id: changeId, status: 'proposed', patches: [], patchSet: new Set<string>() };
    if (parts.length === 3 && parts[2] === 'overview.md') current.overviewPath = file;
    if (parts.length === 4 && parts[2] === 'patches' && (file.endsWith('.patch') || file.endsWith('.diff'))) {
      current.patchSet.add(file);
    }
    changes.set(changeId, current);
  }

  const changeSummaries = Array.from(changes.values())
    .map((change) => ({
      id: change.id,
      ...(change.overviewPath ? { overviewPath: change.overviewPath } : {}),
      status: change.status,
      patches: Array.from(change.patchSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const patchCount = changeSummaries.reduce((sum, change) => sum + change.patches.length, 0);

  return {
    type: 'component-technical-review-import' as const,
    schemaVersion: 1 as const,
    componentSlug: input.componentSlug,
    importedAt: input.importedAt,
    status: 'pending-review',
    reviewDirectory: input.reviewDirectory,
    ...(input.importedFiles.includes('SUMMARY.md') ? { summaryPath: 'SUMMARY.md' } : {}),
    importedFiles: input.importedFiles,
    skippedFiles: input.skippedFiles,
    findingCount: findingFiles.length,
    changeCount: changeSummaries.length,
    patchCount,
    changes: changeSummaries
  };
}

export async function importComponentTechnicalReviewPackage(input: ImportComponentTechnicalReviewPackageInput): Promise<ComponentTechnicalReviewImportResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  if (!input.zipPath) throw new Error('Technical review response zip path is required.');

  const root = path.resolve(input.projectPath);
  const zipPath = path.resolve(input.zipPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);
  if (!(await exists(zipPath))) throw new Error(`Technical review response zip does not exist: ${input.zipPath}`);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Technical review response must be a .zip file.');

  const component = await readComponent({ projectPath: root, slug: input.slug });
  const entries = await readZipFile(zipPath);
  const importedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const importedFileSet = new Set<string>();
  const importedAt = new Date().toISOString();
  const stamp = importedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const reviewRelativeDirectory = `components/${component.slug}/technical-reviews/${stamp}`;
  const reviewDirectory = path.join(root, 'components', component.slug, 'technical-reviews', stamp);

  for (const entry of entries) {
    if (entry.directory) continue;
    const relativePath = componentTechnicalReviewReturnPath(entry.name);
    if (!relativePath) {
      skippedFiles.push(normaliseRelativePath(entry.name));
      continue;
    }
    if (!isSafeComponentTechnicalReviewReturnPath(relativePath)) {
      skippedFiles.push(relativePath);
      continue;
    }
    if (importedFileSet.has(relativePath)) {
      skippedFiles.push(`${relativePath} was skipped because it appeared more than once.`);
      continue;
    }

    const target = path.resolve(reviewDirectory, relativePath);
    if (!isSameOrInsideDiskPath(target, reviewDirectory)) {
      skippedFiles.push(relativePath);
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data);
    importedFiles.push(relativePath);
    importedFileSet.add(relativePath);
  }

  if (!importedFiles.length) {
    throw new Error('Technical review response did not contain any importable review artefacts. Expected SUMMARY.md, findings/, changes/, or patches/index.md. Source files were not imported.');
  }

  const sortedImportedFiles = importedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sortedSkippedFiles = skippedFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const record = summarizeComponentTechnicalReviewImport({
    componentSlug: component.slug,
    importedAt,
    reviewDirectory: reviewRelativeDirectory,
    importedFiles: sortedImportedFiles,
    skippedFiles: sortedSkippedFiles
  });

  await writeJson(path.join(reviewDirectory, 'technical-review.json'), {
    ...record,
    sourceZipPath: zipPath
  });

  const technicalChanges: ComponentTechnicalChangeRecord[] = [];
  for (const change of record.changes) {
    const technicalChange = await createTechnicalChangeFromImportedReview({
      projectPath: root,
      componentSlug: component.slug,
      reviewRelativeDirectory,
      reviewDirectory,
      changeId: change.id,
      importedAt
    });
    if (technicalChange) technicalChanges.push(technicalChange);
  }

  return {
    accepted: true,
    zipPath,
    componentSlug: component.slug,
    reviewDirectory,
    importedFiles: sortedImportedFiles,
    skippedFiles: sortedSkippedFiles,
    findingCount: record.findingCount,
    changeCount: record.changeCount,
    patchCount: record.patchCount,
    technicalChangeCount: technicalChanges.length
  };
}

export async function createComponentTechnicalReviewBundle(input: ComponentTechnicalReviewPackageInput): Promise<ComponentTechnicalReviewPackageResult> {
  if (!input.projectPath) throw new Error('Project path is required.');
  if (!input.slug) throw new Error('Component slug is required.');
  const root = path.resolve(input.projectPath);
  if (!(await exists(root))) throw new Error(`Project path does not exist: ${input.projectPath}`);

  const projectName = await readProjectName(root);
  const component = await readComponent({ projectPath: root, slug: input.slug });
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `${slugify(projectName)}-${component.slug}-component-technical-review-${stamp}.zip`;
  const outputDir = path.join(app.getPath('userData'), 'review-bundles', slugify(projectName), 'components', component.slug, 'technical');
  const filePath = path.join(outputDir, fileName);
  const reviewTypes = normaliseComponentTechnicalReviewTypes(input.reviewTypes);
  const sourceScope = normaliseComponentTechnicalReviewSourceScope(input.sourceScope);
  const warnings: string[] = [];

  if (sourceScope !== 'component-source') {
    warnings.push(`Source scope "${sourceScope}" is not implemented yet; packaged the configured component source directory instead.`);
  }

  const source = await collectDeliveryReviewSourceEntries(root, [component]);
  warnings.push(...source.warnings);
  if (!source.includedFiles.length) {
    warnings.push('No source files were included. Configure the component source directory before requesting a technical source review.');
  }

  const foundation = await readFoundationDocuments(root);
  const standards = await readStandardSections(root);
  const componentContextMarkdown = buildComponentTechnicalReviewComponentMarkdown({ projectName, component });
  const componentContractMarkdown = await readComponentContractMarkdownForReview(root, component);
  const contextEntries: ZipEntryInput[] = [
    { name: 'context/foundation.md', data: Buffer.from(buildPublishedFoundationMarkdown(projectName, foundation), 'utf8') },
    { name: 'context/standards.md', data: Buffer.from(buildPublishedStandardsMarkdown(projectName, standards), 'utf8') },
    { name: 'context/component.md', data: Buffer.from(componentContextMarkdown, 'utf8') },
    { name: 'context/component-contract.md', data: Buffer.from(componentContractMarkdown, 'utf8') }
  ];
  const templateEntries: ZipEntryInput[] = [
    { name: '_return-template/SUMMARY.md', data: Buffer.from(buildComponentTechnicalReviewSummaryTemplate(component), 'utf8') },
    { name: '_return-template/findings/FINDING-001.md', data: Buffer.from('# FINDING-001\n\n## Summary\n\nTODO\n\n## Evidence\n\nTODO\n\n## Impact\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/overview.md', data: Buffer.from('# TC-001 Short Name\n\n## Proposed change\n\nTODO\n\n## Linked findings\n\n- FINDING-001\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/affected-files.md', data: Buffer.from('# Affected Files\n\n- `src/...`\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/rationale.md', data: Buffer.from('# Rationale\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/verification.md', data: Buffer.from('# Verification\n\nTODO\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/linked-findings.json', data: Buffer.from('{\n  "findings": ["FINDING-001"]\n}\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/patches/proposed.patch', data: Buffer.from('# Add a unified diff here.\n', 'utf8') },
    { name: '_return-template/changes/TC-001-short-name/patches/notes.md', data: Buffer.from('# Patch Notes\n\nTODO\n', 'utf8') },
    { name: '_return-template/patches/index.md', data: Buffer.from('# Patch Index\n\n- TC-001-short-name: `changes/TC-001-short-name/patches/proposed.patch`\n', 'utf8') }
  ];
  const contextFiles = contextEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const templateFiles = templateEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const instructionEntries: ZipEntryInput[] = [
    { name: 'instructions/technical-review.md', data: Buffer.from(buildComponentTechnicalReviewInstructions({ component, reviewTypes }), 'utf8') },
    { name: 'instructions/return-format.md', data: Buffer.from(buildComponentTechnicalReviewReturnFormat(), 'utf8') }
  ];

  const allEntries: ZipEntryInput[] = [
    { name: 'README.md', data: Buffer.from(buildComponentTechnicalReviewReadme({
      projectName,
      component,
      reviewTypes,
      sourceRootCount: source.roots.length,
      sourceFileCount: source.includedFiles.length,
      warnings
    }), 'utf8') },
    ...instructionEntries,
    ...contextEntries,
    ...source.entries,
    ...templateEntries
  ];

  const manifest = {
    bundleType: 'component-technical-review',
    schemaVersion: 1,
    projectName,
    createdAt,
    generatedBy: 'AIDD',
    outputIsOutsideProject: true,
    snapshotIsSelfContained: true,
    componentSlug: component.slug,
    componentTitle: component.title,
    reviewTypes,
    sourceScope: 'component-source',
    sourceCodeIsContextOnly: true,
    patchesMustBeProposedOnly: true,
    returnShape: {
      required: [
        'SUMMARY.md',
        'changes/<change-id>/overview.md'
      ],
      allowed: [
        'findings/**/*.md',
        'findings/**/*.json',
        'changes/**/overview.md',
        'changes/**/affected-files.md',
        'changes/**/rationale.md',
        'changes/**/verification.md',
        'changes/**/linked-findings.json',
        'changes/**/patches/*.patch',
        'changes/**/patches/*.diff',
        'changes/**/patches/notes.md',
        'patches/index.md'
      ]
    },
    includedFiles: {
      instructions: instructionEntries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b)),
      context: contextFiles,
      source: source.includedFiles,
      templates: templateFiles
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
      returnedZipShouldContainOnly: ['SUMMARY.md', 'REVIEW.md', 'MANIFEST.json', 'findings/', 'changes/', 'patches/index.md'],
      doNotReturnSourceFiles: true,
      patchesAreProposalsOnly: true,
      importedReviewsAreStoredUnder: `components/${component.slug}/technical-reviews/<timestamp>/`
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
    componentSlug: component.slug,
    componentTitle: component.title,
    componentFileCount: contextEntries.length,
    sourceRootCount: source.roots.length,
    sourceFileCount: source.includedFiles.length,
    entryCount: uniqueEntries.size,
    warnings
  };
}
