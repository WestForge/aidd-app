import matter from '../../frontmatter';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CAPABILITY_TEMPLATE_SECTIONS, sectionBodyFromMarkdown } from './capabilityCore';
import { readChanges } from './changes';
import { componentSourceIsConfigured, normaliseComponentSource } from './componentCore';
import { TEMPLATE_VERSION, exists, parseFrontmatter, readEntities, readJson } from './projectCore';
import { combineStandardsBody, deriveStandardsStatus, fileStatus, readFoundationDocuments, readStandardSections } from './standards';
import type { HomeWork, HomeWorkCapabilityItem, HomeWorkComponentItem, HomeWorkDeliveryItem, ProjectSetupState, ProjectStatus, ProjectStatusItem, SaveWorkflowDocumentInput, SetupStepStatus, WorkflowDocument } from './types';

export function isTextWorkflowMarkdown(relativePath: string) {
  const normal = relativePath.split('\\').join('/');
  if (!normal.endsWith('.md')) return false;
  if (normal.includes('/.git/') || normal.startsWith('.git/')) return false;
  if (normal.includes('/node_modules/') || normal.startsWith('node_modules/')) return false;
  if (normal.includes('/.aidd/templates/') || normal.startsWith('.aidd/templates/')) return false;
  if (normal.includes('/.aidd-app/') || normal.startsWith('.aidd-app/')) return false;
  return true;
}

export async function collectMarkdownFiles(root: string, current = root): Promise<string[]> {
  const ignored = new Set(['.git', 'node_modules', '.aidd-app']);
  const out: string[] = [];
  if (!(await exists(current))) return out;
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    const relative = path.relative(root, full).split('\\').join('/');
    if (entry.isDirectory()) {
      if (relative === '.aidd/templates') continue;
      out.push(...await collectMarkdownFiles(root, full));
    } else if (isTextWorkflowMarkdown(relative)) {
      out.push(relative);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function inferDocumentType(relativePath: string, data: Record<string, any>) {
  const fromMatter = data?.aidd?.type || data?.type;
  if (fromMatter) return String(fromMatter);
  if (relativePath.startsWith('foundation/')) return 'foundation';
  if (relativePath.startsWith('components/')) return 'component';
  if (relativePath.startsWith('modules/')) return 'component';
  if (relativePath.startsWith('capabilities/')) return 'capability';
  if (relativePath.startsWith('delivery/')) return 'delivery';
  if (relativePath.startsWith('reviews/')) return 'review';
  return 'document';
}

export function inferDocumentTitle(relativePath: string, body: string, data: Record<string, any>) {
  const fromMatter = data?.aidd?.title || data?.title;
  if (fromMatter) return String(fromMatter);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(relativePath, '.md').replace(/^\d+-/, '').split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

export function normalizeSetupStatus(value: unknown): SetupStepStatus {
  const valid: SetupStepStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];
  return valid.includes(value as SetupStepStatus) ? value as SetupStepStatus : 'not-started';
}

export async function readWorkflowDocuments(projectPath: string): Promise<WorkflowDocument[]> {
  const files = await collectMarkdownFiles(projectPath);
  const docs: WorkflowDocument[] = [];
  for (const relativePath of files) {
    const filePath = path.join(projectPath, relativePath);
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const data: any = parsed.data || {};
    const aidd = data.aidd || {};
    docs.push({
      id: String(aidd.id || data.id || relativePath.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()),
      title: inferDocumentTitle(relativePath, parsed.content, data),
      type: inferDocumentType(relativePath, data),
      status: normalizeSetupStatus(aidd.status || data.status),
      required: aidd.required !== false && data.required !== false,
      relativePath,
      filePath,
      body: parsed.content.replace(/^\s*\n/, ''),
      updatedAt: aidd.updatedAt || data.updatedAt
    });
  }
  return docs;
}

export async function saveWorkflowDocument(input: SaveWorkflowDocumentInput): Promise<WorkflowDocument[]> {
  const relativePath = input.relativePath.split('\\').join('/');
  if (!isTextWorkflowMarkdown(relativePath)) throw new Error('Only Markdown workflow documents can be saved.');
  const filePath = path.join(input.projectPath, relativePath);
  if (!(await exists(filePath))) throw new Error(`Document not found: ${relativePath}`);
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = matter(raw);
  const data: any = parsed.data || {};
  data.aidd = {
    ...(data.aidd || {}),
    id: data.aidd?.id || data.id || relativePath.replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    title: input.title.trim() || inferDocumentTitle(relativePath, input.body, data),
    type: data.aidd?.type || inferDocumentType(relativePath, data),
    status: input.status,
    required: data.aidd?.required ?? data.required ?? true,
    templateVersion: data.aidd?.templateVersion || TEMPLATE_VERSION,
    updatedAt: new Date().toISOString()
  };
  const next = matter.stringify(input.body.trim() + '\n', data);
  await fsp.writeFile(filePath, next, 'utf8');
  return readWorkflowDocuments(input.projectPath);
}

export async function readProjectSetup(projectPath: string): Promise<ProjectSetupState> {
  const standardsPath = path.join(projectPath, 'foundation', 'standards', 'index.md');
  const standardsSections = await readStandardSections(projectPath);
  const standardsStatus = deriveStandardsStatus(standardsSections);
  let profiles: string[] = [];
  try {
    const standardsJson = await readJson<any>(path.join(projectPath, 'foundation', 'standards', 'standards.json'));
    profiles = Array.isArray(standardsJson.profiles) ? standardsJson.profiles : [];
  } catch {}
  return {
    foundation: await readFoundationDocuments(projectPath),
    standards: { status: standardsStatus, filePath: standardsPath, body: combineStandardsBody(standardsSections), profiles, sections: standardsSections },
    components: (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json')).map((component: any) => ({ ...component, source: normaliseComponentSource(component.source) })),
    capabilities: (await readEntities(projectPath, 'capabilities', 'capability.json')).map((cap: any) => ({ ...cap, components: cap.components || cap.modules || [] })),
    gitInitialized: await exists(path.join(projectPath, '.git'))
  };
}

export async function fileHasUsefulContent(filePath: string) {
  if (!(await exists(filePath))) return false;
  const content = await fsp.readFile(filePath, 'utf8');
  const parsed = parseFrontmatter(content);
  if (parsed.status === 'complete') return true;
  if (parsed.status === 'skipped') return false;
  const body = parsed.body
    .replace(/^#.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .trim();
  return body.length > 48;
}

export async function dirCount(root: string, dirName: string, manifest: string) {
  return (await readEntities(root, dirName, manifest)).length;
}

export async function deliveryBundleCount(root: string) {
  return (await readEntities(root, 'delivery/packages', 'package.json')).length || (await readEntities(root, 'delivery/bundles', 'bundle.json')).length;
}

export function isTerminalHomeStatus(status?: string) {
  return ['active', 'accepted', 'complete', 'deprecated', 'skipped', 'superseded'].includes(String(status || '').toLowerCase());
}

export function isTerminalDeliveryStatus(status?: string) {
  return ['accepted', 'complete', 'deprecated', 'skipped', 'superseded'].includes(String(status || '').toLowerCase());
}

export async function readCapabilityIncompleteSectionCount(projectPath: string, capability: any) {
  const slug = String(capability.slug || capability.id || '').trim();
  if (!slug) return 0;
  const capabilityDir = path.join(projectPath, 'capabilities', slug);
  const templateFiles = Array.isArray(capability.template?.sectionFiles) ? capability.template.sectionFiles : CAPABILITY_TEMPLATE_SECTIONS.map((section) => section.fileName);
  let incomplete = 0;
  for (const fileName of templateFiles) {
    const sectionPath = path.join(capabilityDir, String(fileName));
    if (!(await exists(sectionPath))) {
      incomplete += 1;
      continue;
    }
    const raw = await fsp.readFile(sectionPath, 'utf8');
    const parsed = matter(raw);
    const aidd = (parsed.data as any)?.aidd || {};
    const sectionStatus = String(aidd.status || 'not-started');
    const body = sectionBodyFromMarkdown(raw);
    if (!['complete', 'skipped'].includes(sectionStatus) || !body.trim()) incomplete += 1;
  }
  return incomplete;
}

export async function readHomeWork(projectPath: string): Promise<HomeWork> {
  const componentsRaw = (await readEntities(projectPath, 'components', 'component.json')).concat(await readEntities(projectPath, 'modules', 'module.json'));
  const capabilitiesRaw = (await readEntities(projectPath, 'capabilities', 'capability.json')).map((capability: any) => ({
    ...capability,
    components: Array.isArray(capability.components) ? capability.components : Array.isArray(capability.modules) ? capability.modules : []
  }));
  const deliveriesRaw = (await readEntities(projectPath, 'delivery/packages', 'package.json')).concat(await readEntities(projectPath, 'delivery/bundles', 'bundle.json'));

  const capabilityByComponent = new Map<string, string[]>();
  for (const capability of capabilitiesRaw) {
    const title = String(capability.title || capability.slug || capability.id || 'Untitled capability');
    for (const componentSlug of capability.components || []) {
      const list = capabilityByComponent.get(componentSlug) || [];
      list.push(title);
      capabilityByComponent.set(componentSlug, list);
    }
  }

  const components: HomeWorkComponentItem[] = componentsRaw
    .map((component: any) => {
      const slug = String(component.slug || component.id || '').trim();
      const status = String(component.status || component.lifecycle || 'draft');
      const sourceProjects = Array.isArray(component.sourceProjects) ? component.sourceProjects : [];
      const source = normaliseComponentSource(component.source);
      const hasSourceMapping = sourceProjects.length > 0 || componentSourceIsConfigured(source);
      const capabilities = capabilityByComponent.get(slug) || [];
      const reasons: string[] = [];
      if (!isTerminalHomeStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
      if (!hasSourceMapping) reasons.push('No source mapping');
      if (!capabilities.length) reasons.push('No capability mapping');
      return {
        slug,
        title: String(component.title || slug || 'Untitled component'),
        status,
        sourceProjects,
        source,
        capabilities,
        reason: reasons.join(' · ') || 'Needs review'
      };
    })
    .filter((component) => !isTerminalHomeStatus(component.status) || !(component.sourceProjects.length > 0 || componentSourceIsConfigured(component.source)) || !component.capabilities.length)
    .sort((a, b) => a.title.localeCompare(b.title));

  const capabilities: HomeWorkCapabilityItem[] = [];
  for (const capability of capabilitiesRaw) {
    const slug = String(capability.slug || capability.id || '').trim();
    const status = String(capability.status || capability.lifecycle || 'draft');
    const components = Array.isArray(capability.components) ? capability.components : [];
    const incompleteSections = await readCapabilityIncompleteSectionCount(projectPath, capability);
    const reasons: string[] = [];
    if (!isTerminalHomeStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
    if (!components.length) reasons.push('No components selected');
    if (incompleteSections > 0) reasons.push(`${incompleteSections} section${incompleteSections === 1 ? '' : 's'} incomplete`);
    if (reasons.length) {
      capabilities.push({
        slug,
        title: String(capability.title || slug || 'Untitled capability'),
        status,
        components,
        incompleteSections,
        reason: reasons.join(' · ')
      });
    }
  }
  capabilities.sort((a, b) => a.title.localeCompare(b.title));

  const delivery: HomeWorkDeliveryItem[] = deliveriesRaw
    .map((pkg: any) => {
      const status = String(pkg.status || 'draft');
      const components = Array.isArray(pkg.components) ? pkg.components : [];
      const phaseCount = Array.isArray(pkg.phases) ? pkg.phases.length : Number(pkg.phaseCount || 0);
      const reasons: string[] = [];
      if (!isTerminalDeliveryStatus(status)) reasons.push(`Status is ${status.replace(/-/g, ' ')}`);
      if (!components.length) reasons.push('No components captured');
      if (!phaseCount && status !== 'draft') reasons.push('No phases defined');
      return {
        id: String(pkg.id || pkg.slug || 'delivery-package'),
        title: String(pkg.title || pkg.name || 'Untitled delivery package'),
        status,
        sourceCapability: pkg.sourceCapability ? String(pkg.sourceCapability) : undefined,
        components,
        phaseCount,
        priority: typeof pkg.priority === 'number' ? pkg.priority : undefined,
        reason: reasons.join(' · ') || 'Delivery package needs attention'
      };
    })
    .filter((pkg) => !isTerminalDeliveryStatus(pkg.status))
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.id.localeCompare(b.id));

  return {
    delivery,
    capabilities,
    components,
    total: delivery.length + capabilities.length + components.length
  };
}

export async function readProjectStatus(projectPath: string): Promise<ProjectStatus> {
  const manifestPath = path.join(projectPath, 'aidd.template.json');
  const manifest = await exists(manifestPath) ? await readJson<any>(manifestPath) : {};
  const foundationDir = 'foundation';
  const foundationFiles = [
    ['overview', 'Project overview', '01-project-overview.md', 'Summarises what the project is, why it exists, and what success looks like.'],
    ['product', 'Product definition', '02-product-definition.md', 'Defines the product intent future work inherits.'],
    ['audience', 'Audience & users', '03-audience-and-users.md', 'Identifies who the product is for.'],
    ['goals', 'Goals & success metrics', '04-goals-and-success-metrics.md', 'Defines measurable outcomes used to judge delivery success.']
  ] as const;
  const foundation: ProjectStatusItem[] = [];
  const foundationStatuses: SetupStepStatus[] = [];
  for (const [id, label, file, detail] of foundationFiles) {
    const status = await fileStatus(path.join(projectPath, foundationDir, file));
    foundationStatuses.push(status);
    foundation.push({ id, label, complete: status === 'complete', detail });
  }
  const componentCount = await dirCount(projectPath, 'components', 'component.json') || await dirCount(projectPath, 'modules', 'module.json');
  const capabilityCount = await dirCount(projectPath, 'capabilities', 'capability.json');
  const bundleCount = await deliveryBundleCount(projectPath);
  const changes = await readChanges(projectPath);
  const changeCount = changes.length;
  const readyChangeCount = changes.filter((change) => change.status === 'ready').length;
  const changesInDeliveryCount = changes.filter((change) => change.status === 'in-delivery').length;
  const changesInReviewCount = changes.filter((change) => change.status === 'in-review').length;
  const acceptedChangeCount = changes.filter((change) => change.status === 'accepted').length;
  const gitInitialized = await exists(path.join(projectPath, '.git'));
  const standardSections = await readStandardSections(projectPath);
  const standardsStatus = deriveStandardsStatus(standardSections);
  const standardsComplete = standardsStatus === 'complete';

  const setup: ProjectStatusItem[] = [
    { id: 'foundation', label: 'Project Context started', complete: foundationStatuses.some((status) => status !== 'not-started'), detail: 'Shared context exists for the project.' },
    { id: 'foundation-complete', label: 'Project Context complete', complete: foundation.every((item) => item.complete), detail: 'All required foundation sections have useful content.' },
    { id: 'standards', label: 'Project Standards defined', complete: standardsComplete, detail: standardsComplete ? 'Standards are marked complete.' : 'Define standards before creating components and capabilities.' },
    { id: 'capability', label: 'First capability created', complete: capabilityCount > 0, detail: `${capabilityCount} capabilit${capabilityCount === 1 ? 'y' : 'ies'} found.` },
    { id: 'component', label: 'First component created', complete: componentCount > 0, detail: `${componentCount} component${componentCount === 1 ? '' : 's'} found.` },
    { id: 'git', label: 'Git versioning initialised', complete: gitInitialized, detail: gitInitialized ? 'Local Git repository exists.' : 'No local Git repository found.' },
    { id: 'change', label: 'First Change planned', complete: changeCount > 0, detail: `${changeCount} Change${changeCount === 1 ? '' : 's'} found.` },
    { id: 'package', label: 'First delivery package created', complete: bundleCount > 0, detail: `${bundleCount} delivery package${bundleCount === 1 ? '' : 's'} found.` }
  ];

  const completed = setup.filter((item) => item.complete).length;
  const total = setup.length;
  let status: ProjectStatus['status'] = 'draft';
  let label = 'Draft';
  let nextAction = 'Complete the project overview.';

  if (!gitInitialized) {
    status = 'needs-attention';
    label = 'Needs attention';
    nextAction = 'Initialise Git versioning for the project.';
  } else if (!foundation.every((item) => item.complete)) {
    status = 'setting-up';
    label = 'Setting up';
    nextAction = 'Complete the Project Context.';
  } else if (!standardsComplete) {
    status = 'setting-up';
    label = 'Setting up';
    nextAction = 'Define the project standards.';
  } else if (capabilityCount === 0 || componentCount === 0) {
    status = 'ready-for-planning';
    label = 'Ready for planning';
    nextAction = capabilityCount === 0 ? 'Create the first capability.' : 'Create the first component.';
  } else if (changeCount === 0) {
    status = 'ready-for-ai-delivery';
    label = 'Ready for AI delivery';
    nextAction = 'Plan the first Change.';
  } else if (bundleCount === 0) {
    status = readyChangeCount > 0 ? 'ready-for-ai-delivery' : 'active';
    label = readyChangeCount > 0 ? 'Ready for AI delivery' : 'Active';
    nextAction = readyChangeCount > 0 ? 'Create a delivery package from a ready Change.' : 'Mark a Change ready when its scope and acceptance criteria are clear.';
  } else {
    status = 'active';
    label = 'Active';
    nextAction = 'Review active delivery packages and move approved work through AI review and verification.';
  }

  return {
    status,
    label,
    completed,
    total,
    templateVersion: manifest.templateVersion || 'unknown',
    gitInitialized,
    componentCount,
    capabilityCount,
    bundleCount,
    changeCount,
    readyChangeCount,
    changesInDeliveryCount,
    changesInReviewCount,
    acceptedChangeCount,
    foundation,
    setup,
    nextAction
  };
}
