import matter from '../../frontmatter';
import { dialog } from 'electron';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATE_VERSION, exists, readEntities, readWorkspacePathForProject } from './projectCore';
import { isSameOrInsideDiskPath, normaliseRelativePath } from './projectValidation';
import type { ComponentContractInfo, ComponentContractStatus, ComponentSectionInput, ComponentSourceConfig, ComponentSourceDetection, ComponentSourceDetectionConfidence, ComponentSourceDirectoryInput, ComponentSourceDirectorySelection, ComponentSourcePathMode, SetupStepStatus } from './types';

export async function refreshComponentsIndex(root: string) {
  const components = (await readEntities(root, 'components', 'component.json')).concat(await readEntities(root, 'modules', 'module.json'));
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((c: any) => ({ ...c, components: c.components || c.modules || [] }));
  const lines = [
    '# Components',
    '',
    'Components are the apps, plugins, modules, services, libraries, workflows, integrations, tools, data stores, or subsystems that help deliver capabilities.',
    '',
    '## Active components',
    '',
    components.length
      ? components.map((component) => `- [${component.title}](./${component.slug}/index.md)${caps.filter((c) => (c.components || []).includes(component.slug)).length ? ' — capabilities: ' + caps.filter((c) => (c.components || []).includes(component.slug)).map((c) => `[${c.title}](../capabilities/${c.slug}/index.md)`).join(', ') : ''}`).join('\n')
      : 'No active components yet.',
    '',
    '## Deprecated components',
    '',
    'No deprecated components.',
    '',
    '## Archived components',
    '',
    'No archived components.',
    ''
  ];
  await fsp.mkdir(path.join(root, 'components'), { recursive: true });
  await fsp.writeFile(path.join(root, 'components', 'index.md'), lines.join('\n'), 'utf8');
}

export async function refreshCapabilitiesIndex(root: string) {
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((c: any) => ({ ...c, components: c.components || c.modules || [] }));
  const lines = [
    '# Capabilities',
    '',
    'Capabilities describe things the system can do. They are user-value focused and may touch one or many components.',
    '',
    '## Active capabilities',
    '',
    caps.length ? caps.map((c) => `- [${c.title}](./${c.slug}/index.md)${(c.components || []).length ? ' — components: ' + c.components.join(', ') : ''}`).join('\n') : 'No active capabilities yet.',
    '',
    '## Deprecated capabilities',
    '',
    'No deprecated capabilities.',
    '',
    '## Archived capabilities',
    '',
    'No archived capabilities.',
    ''
  ];
  await fsp.writeFile(path.join(root, 'capabilities', 'index.md'), lines.join('\n'), 'utf8');
}

export const COMPONENT_TEMPLATE_SECTIONS = [
  {
    key: 'purpose',
    fileName: '01-purpose.md',
    title: 'Purpose',
    prompt: 'Define why this component exists and which outcomes it supports.',
    body: `## Purpose
TODO: Define why this component exists.

## Responsibilities

- TODO

## Outcomes Supported

- TODO

## Capabilities Supported

List capabilities this component helps deliver. Do not copy capability behaviour into this file.

- TODO`
  },
  {
    key: 'boundaries',
    fileName: '02-boundaries.md',
    title: 'Boundaries',
    prompt: 'Define ownership, consumers, exposed contracts, and forbidden coupling.',
    body: `## Owns

- TODO: List responsibilities, state, assets, or services this component owns.

## Does Not Own

- TODO: List responsibilities owned by other components or systems.

## May Depend On

- TODO: List allowed component or platform dependencies.

## May Be Used By

- TODO: List expected consumers.

## Exposes

- TODO: List public interfaces, events, data contracts, services, tools, or extension points.

## Forbidden Coupling

- TODO: List things implementations must not do across this boundary.

## Boundary Change Rules

Changing this component boundary requires a decision record when:

- a new component dependency is introduced
- ownership of runtime state moves between components
- another component starts writing component-owned state
- this component starts directly controlling another component's responsibilities
- a capability requires behaviour that does not fit the existing boundary`
  },
  {
    key: 'interfaces',
    fileName: '03-interfaces.md',
    title: 'Interfaces',
    prompt: 'Capture public and consumed contracts owned by this component.',
    body: `## Purpose

Define the public and consumed technical contracts for this component.

## Public Interfaces

- TODO: APIs, services, events, extension points, asset contracts, messages, commands, or UI/tooling entry points exposed by this component.

## Consumed Interfaces

- TODO: Interfaces this component consumes from other components or platform systems.

## Contract Rules

- TODO: Versioning, compatibility, validation, error behaviour, and ownership rules.

## Capability Relationship

Capabilities may require new or changed interfaces, but the interface definition belongs here when this component owns it.`
  },
  {
    key: 'data-and-state',
    fileName: '04-data-and-state.md',
    title: 'Data & State',
    prompt: 'Define owned data, state, validation rules, and persistence boundaries.',
    body: `## Purpose

Define data, state, persistence, and invariants owned by this component.

## Owned State

- TODO: Runtime state this component owns.

## Owned Data Assets / Documents

- TODO: Assets, files, records, schemas, tables, or documents this component owns.

## External Data Consumed

- TODO: Data read from other components or services.

## Data Not Owned

- TODO: Data this component must not write or treat as authoritative.

## Validation and Invariants

- TODO: Required validation, consistency rules, failure modes, and integrity checks.

## Persistence and Migration

- TODO: Persistence rules, migration rules, compatibility concerns, or versioning constraints.

## Capability Relationship

Capabilities can say what data is needed for behaviour. Ownership, schema shape, persistence, and invariants belong in this component file.`
  },
  {
    key: 'dependencies',
    fileName: '05-dependencies.md',
    title: 'Dependencies & Integrations',
    prompt: 'Define allowed dependencies, integrations, and dependency direction rules.',
    body: `## Purpose

Define allowed dependencies and integration points for this component.

## Allowed Dependencies

- TODO

## Forbidden Dependencies

- TODO

## Integrations

- TODO: Services, APIs, files, tools, engine systems, or other components this component integrates with.

## Required Dependency Direction

\`\`\`text
TODO: ComponentA -> ComponentB
\`\`\`

## Dependency Change Rule

Any new dependency or integration that crosses component, runtime/editor, product/platform, or generic/project-specific boundaries requires a decision record before implementation.`
  },
  {
    key: 'architecture',
    fileName: '06-architecture.md',
    title: 'Internal Design',
    prompt: 'Describe the component internal shape, flows, and failure model.',
    body: `## Purpose

Define the internal technical design of this component without turning the capability into architecture.

## Role in the System

TODO: Explain this component's role and where it fits.

## Main Areas

### Area 1

TODO

### Area 2

TODO

## Internal Flow

TODO: Describe important internal flows, lifecycle, ownership handoffs, or extension points.

## Failure Model

TODO: Describe expected failure handling, fallback behaviour, diagnostics, and recovery rules.

## Design Change Rule

Design changes that affect ownership, dependencies, state, or public interfaces require a component decision record and should be referenced by the delivery slice implementing the change.`
  },
  {
    key: 'standards',
    fileName: '07-standards.md',
    title: 'Quality Requirements',
    prompt: 'Define component-specific NFRs, quality attributes, testing expectations, and AI-agent rules.',
    body: `## Component Quality Attributes

- Performance:
- Reliability:
- Security:
- Accessibility:
- Observability:

## Testing and Verification Expectations

- TODO

## Documentation Expectations

- TODO

## Inherited Standards

Reference global standards from Foundation. Do not duplicate project-wide standards here unless this component has stricter requirements.

## AI Agent Rules

- Stay inside the delivery slice scope.
- Respect component boundaries and dependency direction.
- Do not move architecture, integrations, or data ownership into capability docs.
- Report missing component dependencies or boundary conflicts instead of silently introducing coupling.`
  },
  {
    key: 'risks',
    fileName: '08-risks.md',
    title: 'Risks',
    prompt: 'Capture component risks, unknowns, coupling risks, and operational concerns.',
    body: `## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns

- TODO

## Boundary / Coupling Risks

- TODO

## Operational Risks

- TODO`
  }
];

export function normaliseComponentSections(inputSections?: ComponentSectionInput[], fallback?: Partial<Record<string, string>>) {
  const byKey = new Map<string, ComponentSectionInput>();
  for (const section of inputSections || []) {
    if (!section?.key) continue;
    byKey.set(section.key, section);
  }

  return COMPONENT_TEMPLATE_SECTIONS.map((template) => {
    const input = byKey.get(template.key);
    const body = input?.body ?? fallback?.[template.key] ?? template.body ?? '';
    return {
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: input?.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      skipReason: input?.skipReason?.trim() || '',
      prompt: template.prompt
    };
  });
}

export function buildComponentSectionMarkdown(input: { slug: string; componentTitle: string; section: ReturnType<typeof normaliseComponentSections>[number]; status: string; sourceProjects: string[]; capabilities: string[] }) {
  const body = input.section.body?.trim() || input.section.prompt;
  const sectionAidd: Record<string, unknown> = {
    type: 'component-section',
    id: `${input.slug}-${input.section.key}`,
    title: `${input.componentTitle} ${input.section.title}`,
    status: input.section.status || 'not-started',
    required: true,
    component: input.slug,
    section: input.section.key,
    sourceProjects: input.sourceProjects,
    capabilitiesSupported: input.capabilities,
    templateVersion: TEMPLATE_VERSION,
    updatedAt: new Date().toISOString()
  };
  if (input.section.status === 'skipped' && input.section.skipReason?.trim()) {
    sectionAidd.skipReason = input.section.skipReason.trim();
  }

  return matter.stringify([
    `# ${input.componentTitle} ${input.section.title}`,
    '',
    body,
    ''
  ].join('\n'), {
    aidd: sectionAidd
  });
}

export function buildComponentIndexMarkdown(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: ReturnType<typeof normaliseComponentSections> }) {
  return matter.stringify([
    `# ${input.title}`,
    '',
    'This component is managed by AIDD as a set of template-backed section files.',
    '',
    '## Sections',
    '',
    ...input.sections.map((section) => `- [${section.title}](./${section.fileName})`),
    '',
    '## Source',
    '',
    componentSourceDisplay(input.source),
    '',
    '## Source Projects',
    '',
    input.sourceProjects.length ? input.sourceProjects.map((project) => `- ${project}`).join('\n') : 'No legacy source projects linked.',
    '',
    '## Capabilities Supported',
    '',
    input.capabilities.length ? input.capabilities.map((capability) => `- ${capability}`).join('\n') : 'No capabilities linked yet.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'component',
      id: input.slug,
      title: input.title,
      status: input.status || 'draft',
      required: true,
      sourceProjects: input.sourceProjects,
      source: input.source,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

export type NormalisedComponentSection = ReturnType<typeof normaliseComponentSections>[number];

export const COMPONENT_SOURCE_TYPES = new Set([
  'webapp',
  'desktop-app',
  'plugin',
  'library',
  'service',
  'api',
  'cli',
  'game-module',
  'shared-module',
  'test-suite',
  'other'
]);

export const SOURCE_SCAN_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'bin',
  'obj',
  'Intermediate',
  'Saved',
  'Binaries'
]);

export const SOURCE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.csproj': 'C# Project',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.mdx': 'MDX',
  '.md': 'Markdown'
};

export function normaliseComponentSourceDetection(input?: Partial<ComponentSourceDetection> | null): ComponentSourceDetection | null {
  if (!input) return null;
  const reasons = Array.isArray(input.reasons) ? input.reasons.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const detectedLanguages = Array.isArray(input.detectedLanguages) ? input.detectedLanguages.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const detectedFrameworks = Array.isArray(input.detectedFrameworks) ? input.detectedFrameworks.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const detectedMarkers = Array.isArray((input as any).detectedMarkers) ? (input as any).detectedMarkers.map(String).map((item: string) => item.trim()).filter(Boolean) : [];
  const suggestedType = normaliseComponentSourceType(input.suggestedType);
  const confidence = input.confidence === 'high' || input.confidence === 'medium' || input.confidence === 'low' ? input.confidence : 'low';
  if (!reasons.length && !detectedLanguages.length && !detectedFrameworks.length && !detectedMarkers.length && suggestedType === 'other') return null;
  return {
    suggestedType,
    confidence,
    detectedLanguages: Array.from(new Set(detectedLanguages)),
    detectedFrameworks: Array.from(new Set(detectedFrameworks)),
    detectedMarkers: Array.from(new Set(detectedMarkers)),
    ...(input.packageManager ? { packageManager: String(input.packageManager) } : {}),
    reasons
  };
}

export function normaliseComponentSourceType(value?: string | null) {
  const normalised = String(value || '').trim() || 'other';
  return COMPONENT_SOURCE_TYPES.has(normalised) ? normalised : 'other';
}

export function normaliseComponentSourcePathMode(value: unknown, directory: string): ComponentSourcePathMode {
  if (value === 'absolute') return 'absolute';
  if (value === 'workspace-relative') return 'workspace-relative';
  return directory && path.isAbsolute(directory) ? 'absolute' : 'workspace-relative';
}

export function normaliseComponentSource(input?: Partial<ComponentSourceConfig> | null): ComponentSourceConfig {
  const directory = String(input?.directory || '').trim().replace(/\\/g, '/');
  const pathMode = normaliseComponentSourcePathMode((input as any)?.pathMode, directory);
  const absolutePath = String((input as any)?.absolutePath || '').trim().replace(/\\/g, '/');
  const isInsideWorkspace = typeof (input as any)?.isInsideWorkspace === 'boolean'
    ? Boolean((input as any).isInsideWorkspace)
    : pathMode === 'workspace-relative';
  const warning = String((input as any)?.warning || '').trim();

  return {
    directory,
    type: normaliseComponentSourceType(input?.type),
    pathMode,
    isInsideWorkspace,
    ...(pathMode === 'absolute' && (absolutePath || directory) ? { absolutePath: absolutePath || directory } : {}),
    ...(warning ? { warning } : {}),
    detection: normaliseComponentSourceDetection((input as any)?.detection)
  };
}

export function componentSourceIsConfigured(source?: Partial<ComponentSourceConfig> | null) {
  return Boolean(String(source?.directory || '').trim());
}

export function componentSourceDisplay(source: ComponentSourceConfig) {
  if (!componentSourceIsConfigured(source)) return 'Source location has not been configured for this component.';
  const detection = normaliseComponentSourceDetection(source.detection);
  const lines = [
    `- Path: \`${source.directory}\``,
    `- Path mode: \`${source.pathMode}\``,
    `- Portable: \`${source.isInsideWorkspace ? 'yes' : 'no'}\``,
    `- Source type: \`${source.type || 'other'}\``
  ];
  if (source.absolutePath && source.pathMode === 'absolute') lines.push(`- Absolute path: \`${source.absolutePath}\``);
  if (source.warning) lines.push(`- Warning: ${source.warning}`);
  if (detection) {
    lines.push(`- Detection confidence: \`${detection.confidence}\``);
    lines.push(`- Suggested type: \`${detection.suggestedType}\``);
    if (detection.packageManager) lines.push(`- Package manager: \`${detection.packageManager}\``);
    if (detection.detectedMarkers.length) lines.push(`- Detected markers: ${detection.detectedMarkers.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.detectedFrameworks.length) lines.push(`- Detected frameworks: ${detection.detectedFrameworks.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.detectedLanguages.length) lines.push(`- Detected languages: ${detection.detectedLanguages.map((item) => `\`${item}\``).join(', ')}`);
    if (detection.reasons.length) {
      lines.push('- Detection evidence:');
      for (const reason of detection.reasons) lines.push(`  - ${reason}`);
    }
  }
  return lines.join('\n');
}

export function componentSourcePathInfo(projectPath: string, absolutePath: string, workspacePath?: string | null) {
  const resolved = path.resolve(absolutePath);
  const workspace = String(workspacePath || '').trim();
  const isInsideWorkspace = Boolean(workspace && isSameOrInsideDiskPath(resolved, workspace));
  const directory = isInsideWorkspace
    ? (path.relative(workspace, resolved) || '.')
    : resolved;
  const pathMode: ComponentSourcePathMode = isInsideWorkspace ? 'workspace-relative' : 'absolute';
  const warning = !workspace
    ? 'No source workspace is configured, so this source location is stored as an absolute path and may break for other users.'
    : isInsideWorkspace
      ? ''
      : 'This source location is outside the configured workspace and is stored as an absolute path. It may break for other users.';

  return {
    directory: normaliseRelativePath(directory),
    absolutePath: resolved.replace(/\\/g, '/'),
    pathMode,
    isInsideWorkspace,
    ...(warning ? { warning } : {})
  };
}

export function componentSourceDirectoryToStoredPath(projectPath: string, absolutePath: string, workspacePath?: string | null) {
  return componentSourcePathInfo(projectPath, absolutePath, workspacePath).directory;
}

export function resolveComponentSourceDirectory(projectPath: string, sourceDirectory?: string | null, workspacePath?: string | null) {
  const value = String(sourceDirectory || '').trim();
  if (!value) return String(workspacePath || '').trim() || projectPath;
  return path.isAbsolute(value) ? value : path.resolve(String(workspacePath || '').trim() || projectPath, value);
}

export async function collectSourceFileEvidence(root: string, maxDepth = 5, maxFiles = 2500) {
  const files: string[] = [];
  const extensionCounts = new Map<string, number>();

  async function visit(dir: string, depth: number) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (SOURCE_SCAN_IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = path.join(dir, entry.name);
      const relative = normaliseRelativePath(path.relative(root, absolute));
      files.push(relative);
      const lowerName = entry.name.toLowerCase();
      const extension = lowerName.endsWith('.build.cs') ? '.build.cs' : path.extname(lowerName);
      if (extension) extensionCounts.set(extension, (extensionCounts.get(extension) || 0) + 1);
    }
  }

  await visit(root, 0);
  return { files, extensionCounts };
}

export async function readJsonIfPresent(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function dependencyNames(packageJson: any) {
  const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return new Set(groups.flatMap((group) => Object.keys(packageJson?.[group] || {})));
}

export function detectPackageManager(files: Set<string>) {
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('package-lock.json')) return 'npm';
  return undefined;
}

export function topLanguages(extensionCounts: Map<string, number>) {
  return Array.from(extensionCounts.entries())
    .map(([extension, count]) => ({ language: SOURCE_LANGUAGE_BY_EXTENSION[extension], count }))
    .filter((item): item is { language: string; count: number } => Boolean(item.language))
    .sort((a, b) => b.count - a.count)
    .map((item) => item.language)
    .filter((language, index, all) => all.indexOf(language) === index)
    .slice(0, 6);
}

export async function detectComponentSourceDirectory(directoryPath: string): Promise<ComponentSourceDetection> {
  const root = path.resolve(directoryPath);
  const { files, extensionCounts } = await collectSourceFileEvidence(root);
  const fileSet = new Set(files.map((file) => file.toLowerCase()));
  const basenames = new Set(files.map((file) => path.basename(file).toLowerCase()));
  const packageJson = await readJsonIfPresent(path.join(root, 'package.json'));
  const deps = dependencyNames(packageJson);
  const reasons: string[] = [];
  const frameworks = new Set<string>();
  const languages = topLanguages(extensionCounts);
  const packageManager = detectPackageManager(fileSet);
  const markers = new Set<string>();
  const addMarker = (marker: string, condition: boolean) => { if (condition) markers.add(marker); };

  const hasFile = (fileName: string) => fileSet.has(fileName.toLowerCase()) || basenames.has(fileName.toLowerCase());
  const hasAnyFile = (...fileNames: string[]) => fileNames.some(hasFile);
  const hasDep = (...names: string[]) => names.some((name) => deps.has(name));
  const hasRelativeMatch = (predicate: (file: string) => boolean) => files.some((file) => predicate(file.toLowerCase()));

  addMarker('package.json', Boolean(packageJson));
  addMarker('tsconfig.json', hasAnyFile('tsconfig.json'));
  addMarker('vite.config', hasAnyFile('vite.config.js', 'vite.config.mjs', 'vite.config.ts'));
  addMarker('next.config', hasAnyFile('next.config.js', 'next.config.mjs', 'next.config.ts'));
  addMarker('astro.config', hasAnyFile('astro.config.js', 'astro.config.mjs', 'astro.config.ts'));
  addMarker('angular.json', hasAnyFile('angular.json'));
  addMarker('.sln', hasRelativeMatch((file) => file.endsWith('.sln')));
  addMarker('.csproj', hasRelativeMatch((file) => file.endsWith('.csproj')));
  addMarker('.uproject', hasRelativeMatch((file) => file.endsWith('.uproject')));
  addMarker('.uplugin', hasRelativeMatch((file) => file.endsWith('.uplugin')));
  addMarker('.Build.cs', hasRelativeMatch((file) => file.endsWith('.build.cs')));
  addMarker('pyproject.toml', hasAnyFile('pyproject.toml'));
  addMarker('requirements.txt', hasAnyFile('requirements.txt'));
  addMarker('go.mod', hasAnyFile('go.mod'));
  addMarker('Cargo.toml', hasAnyFile('cargo.toml'));
  addMarker('Dockerfile', hasAnyFile('dockerfile'));

  let suggestedType = 'other';
  let confidence: ComponentSourceDetectionConfidence = 'low';
  let confidenceRank = 1;
  const confidenceRanks: Record<ComponentSourceDetectionConfidence, number> = { low: 1, medium: 2, high: 3 };

  const useSuggestion = (type: string, nextConfidence: ComponentSourceDetectionConfidence, reason: string) => {
    const nextRank = confidenceRanks[nextConfidence];
    if (nextRank >= confidenceRank) {
      suggestedType = type;
      confidence = nextConfidence;
      confidenceRank = nextRank;
    }
    reasons.push(reason);
  };

  if (packageJson) reasons.push('package.json found.');
  if (packageManager) {
    reasons.push(`${packageManager} lockfile found.`);
    markers.add(`${packageManager} lockfile`);
  }

  if (hasAnyFile('tauri.conf.json') || hasRelativeMatch((file) => file.endsWith('/tauri.conf.json'))) {
    frameworks.add('Tauri');
    useSuggestion('desktop-app', 'high', 'Tauri configuration found.');
  }
  if (hasDep('electron') || hasAnyFile('electron-builder.json', 'electron.vite.config.ts', 'electron.vite.config.js')) {
    frameworks.add('Electron');
    useSuggestion('desktop-app', 'high', 'Electron dependency or configuration found.');
  }

  if (hasRelativeMatch((file) => file.endsWith('.uproject'))) {
    frameworks.add('Unreal Engine');
    useSuggestion('game-module', 'high', 'Unreal .uproject file found.');
  }
  if (hasRelativeMatch((file) => file.endsWith('.uplugin'))) {
    frameworks.add('Unreal Plugin');
    useSuggestion('plugin', 'high', 'Unreal .uplugin file found.');
  }
  if (hasRelativeMatch((file) => file.endsWith('.build.cs'))) {
    frameworks.add('Unreal Build');
    useSuggestion(suggestedType === 'plugin' ? 'plugin' : 'game-module', 'medium', 'Unreal Build.cs file found.');
  }

  const manifest = await readJsonIfPresent(path.join(root, 'manifest.json'));
  if (manifest?.manifest_version && (manifest.background || manifest.content_scripts || manifest.action || manifest.browser_action)) {
    frameworks.add('Browser extension');
    useSuggestion('plugin', 'high', 'Browser extension manifest found.');
  }

  if (hasDep('next') || hasAnyFile('next.config.js', 'next.config.mjs', 'next.config.ts')) {
    frameworks.add('Next.js');
    useSuggestion('webapp', 'high', 'Next.js dependency or configuration found.');
  }
  if (hasDep('astro') || hasAnyFile('astro.config.js', 'astro.config.mjs', 'astro.config.ts')) {
    frameworks.add('Astro');
    useSuggestion('webapp', 'high', 'Astro dependency or configuration found.');
  }
  if (hasDep('@angular/core') || hasAnyFile('angular.json')) {
    frameworks.add('Angular');
    useSuggestion('webapp', 'high', 'Angular dependency or workspace file found.');
  }
  if (hasDep('vite') || hasAnyFile('vite.config.js', 'vite.config.mjs', 'vite.config.ts')) {
    frameworks.add('Vite');
    if (hasDep('react')) frameworks.add('React');
    if (hasDep('vue')) frameworks.add('Vue');
    if (hasDep('svelte')) frameworks.add('Svelte');
    useSuggestion('webapp', confidenceRank >= confidenceRanks.high ? 'medium' : 'high', 'Vite configuration or dependency found.');
  }
  if (hasDep('react') || hasDep('vue') || hasDep('svelte') || hasDep('solid-js')) {
    if (hasDep('react')) frameworks.add('React');
    if (hasDep('vue')) frameworks.add('Vue');
    if (hasDep('svelte')) frameworks.add('Svelte');
    if (hasDep('solid-js')) frameworks.add('Solid');
    useSuggestion('webapp', confidenceRank >= confidenceRanks.high ? 'medium' : 'medium', 'Front-end framework dependency found.');
  }

  if (packageJson?.bin && Object.keys(packageJson.bin).length) {
    useSuggestion('cli', 'high', 'package.json exposes a bin entry.');
  }

  if (hasDep('express', 'fastify', '@nestjs/core', 'hono', 'koa', 'elysia', '@apollo/server') || hasAnyFile('openapi.yaml', 'openapi.yml', 'swagger.yaml', 'swagger.yml')) {
    if (hasDep('@nestjs/core')) frameworks.add('NestJS');
    if (hasDep('express')) frameworks.add('Express');
    if (hasDep('fastify')) frameworks.add('Fastify');
    if (hasDep('hono')) frameworks.add('Hono');
    if (hasDep('koa')) frameworks.add('Koa');
    useSuggestion(suggestedType === 'webapp' || suggestedType === 'desktop-app' ? suggestedType : 'api', suggestedType === 'webapp' || suggestedType === 'desktop-app' ? 'medium' : 'high', 'API/server framework or OpenAPI file found.');
  }

  if (hasAnyFile('playwright.config.ts', 'playwright.config.js', 'cypress.config.ts', 'cypress.config.js', 'vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js')) {
    frameworks.add('Test tooling');
    if (suggestedType === 'other') useSuggestion('test-suite', 'medium', 'Dedicated test tool configuration found.');
    else reasons.push('Test tool configuration found.');
  }

  const hasLibraryShape = Boolean(packageJson?.exports || packageJson?.types || packageJson?.typings || packageJson?.main || hasAnyFile('index.ts', 'index.js', 'src/index.ts', 'src/index.js'));
  if (hasLibraryShape && suggestedType === 'other') {
    useSuggestion('library', packageJson ? 'medium' : 'low', 'Library-style entry point or package metadata found.');
  }

  if (!reasons.length) {
    reasons.push(files.length ? 'Source files found, but no strong framework indicators were detected.' : 'No source files or known project indicators were detected.');
  }

  return {
    suggestedType: normaliseComponentSourceType(suggestedType),
    confidence,
    detectedLanguages: languages,
    detectedFrameworks: Array.from(frameworks).sort(),
    detectedMarkers: Array.from(markers).sort(),
    ...(packageManager ? { packageManager } : {}),
    reasons: Array.from(new Set(reasons)).slice(0, 12)
  };
}

export async function selectComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection | null> {
  const workspacePath = await readWorkspacePathForProject(input.projectPath);
  const currentDirectory = input.currentDirectory || input.directory || '';
  const fallbackPath = workspacePath || input.projectPath;
  const defaultPath = currentDirectory ? resolveComponentSourceDirectory(input.projectPath, currentDirectory, workspacePath) : fallbackPath;
  const result = await dialog.showOpenDialog({
    title: 'Select component source directory',
    defaultPath: await exists(defaultPath) ? defaultPath : fallbackPath,
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const absolutePath = path.resolve(result.filePaths[0]);
  const sourcePathInfo = componentSourcePathInfo(input.projectPath, absolutePath, workspacePath);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    ...sourcePathInfo,
    detection
  };
}

export async function detectStoredComponentSourceDirectory(input: ComponentSourceDirectoryInput): Promise<ComponentSourceDirectorySelection> {
  if (!input.directory?.trim()) throw new Error('Source directory is required.');
  const workspacePath = await readWorkspacePathForProject(input.projectPath);
  const absolutePath = resolveComponentSourceDirectory(input.projectPath, input.directory, workspacePath);
  if (!(await exists(absolutePath))) throw new Error(`Source directory does not exist: ${input.directory}`);
  const sourcePathInfo = componentSourcePathInfo(input.projectPath, absolutePath, workspacePath);
  const detection = await detectComponentSourceDirectory(absolutePath);
  return {
    ...sourcePathInfo,
    detection
  };
}

export function componentSectionIsContractReady(section: NormalisedComponentSection) {
  if (section.status === 'skipped') return Boolean(section.skipReason?.trim());
  return section.status === 'complete' || section.status === 'active';
}

export function componentContractBlockers(_sections: NormalisedComponentSection[]) {
  return [] as string[];
}

export function componentContractSource(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }) {
  return {
    slug: input.slug,
    title: input.title,
    status: input.status,
    sourceProjects: [...input.sourceProjects].sort(),
    source: normaliseComponentSource(input.source),
    capabilities: [...input.capabilities].sort(),
    sections: input.sections.map((section) => ({
      key: section.key,
      fileName: section.fileName,
      title: section.title,
      status: section.status || 'not-started',
      skipReason: section.skipReason?.trim() || '',
      body: section.body?.trim() || ''
    }))
  };
}

export function computeComponentContractHash(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }) {
  return createHash('sha256')
    .update(JSON.stringify(componentContractSource(input)))
    .digest('hex');
}

export async function getComponentContractInfo(input: { dir: string; manifest: any; slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[] }): Promise<ComponentContractInfo> {
  const blockers = componentContractBlockers(input.sections);
  const sourceHash = computeComponentContractHash(input);
  const stored = input.manifest.contract || {};
  const version = Number(stored.version || 0);
  const contractExists = await exists(path.join(input.dir, 'component.md'));
  let status: ComponentContractStatus = 'missing';
  if (blockers.length) status = 'blocked';
  else if (!contractExists || !stored.sourceHash) status = 'missing';
  else if (stored.sourceHash === sourceHash) status = 'current';
  else status = 'stale';

  return {
    path: 'component.md',
    version,
    sourceHash,
    status,
    blockers
  };
}

export function buildComponentContractMarkdown(input: { slug: string; title: string; status: string; sourceProjects: string[]; source: ComponentSourceConfig; capabilities: string[]; sections: NormalisedComponentSection[]; version: number; sourceHash: string }) {
  const sectionBlocks = input.sections.map((section) => {
    const body = section.status === 'skipped'
      ? `Skipped: ${section.skipReason?.trim() || 'No reason provided.'}`
      : (section.body?.trim() || section.prompt || 'No content provided.');
    return [`## ${section.title}`, '', body, ''].join('\n');
  }).join('\n');

  const sourceProjects = input.sourceProjects.length
    ? input.sourceProjects.map((project) => `- ${project}`).join('\n')
    : 'No legacy source projects linked.';
  const source = componentSourceDisplay(input.source);
  const capabilities = input.capabilities.length
    ? input.capabilities.map((capability) => `- ${capability}`).join('\n')
    : 'No capabilities linked yet.';

  return matter.stringify([
    `# Component: ${input.title}`,
    '',
    'Generated by AIDD from component definition sections.',
    'Do not edit this file directly. Update the component sections and regenerate this contract.',
    '',
    '## Contract status',
    '',
    `- Component ID: \`${input.slug}\``,
    `- Contract version: \`${input.version}\``,
    '- Source sections: ready/skipped',
    '',
    '## Source',
    '',
    source,
    '',
    '## Source projects',
    '',
    sourceProjects,
    '',
    '## Capabilities supported',
    '',
    capabilities,
    '',
    sectionBlocks,
    '## AI coding instructions',
    '',
    '- Preserve the responsibilities, boundaries, interfaces, data ownership, dependencies, and architecture defined above.',
    '- Do not move ownership to another component without updating AIDD component documentation.',
    '- Follow project coding standards before modifying source code.',
    '- Update the component sections and regenerate this contract when implementation changes the architecture.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'component-contract',
      id: `${input.slug}-component-contract`,
      title: `${input.title} Component Contract`,
      component: input.slug,
      contractVersion: input.version,
      sourceHash: input.sourceHash,
      source: input.source,
      sourceSections: input.sections.map((section) => ({
        key: section.key,
        fileName: section.fileName,
        status: section.status || 'not-started',
        ...(section.status === 'skipped' ? { skipReason: section.skipReason?.trim() || '' } : {})
      })),
      sourceProjects: input.sourceProjects,
      capabilitiesSupported: input.capabilities,
      templateVersion: TEMPLATE_VERSION
    }
  });
}
