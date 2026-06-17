export interface AgentInstructionSourceProject {
  name?: string;
  path?: string;
  detectedType?: string;
}

export interface AgentInstructionsInput {
  projectName: string;
  projectPath?: string;
  workspacePath: string;
  components: any[];
  sourceProjects: AgentInstructionSourceProject[];
}

export const AGENTS_START_MARKER = '<!-- GENERATED_AGENT_INSTRUCTIONS:START -->';
export const AGENTS_END_MARKER = '<!-- GENERATED_AGENT_INSTRUCTIONS:END -->';

const LEGACY_AGENTS_START_MARKER = '<!-- AIDD:START -->';
const LEGACY_AGENTS_END_MARKER = '<!-- AIDD:END -->';

interface ManagedBlockRange {
  start: number;
  end: number;
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = cleanString(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function isAbsoluteDisplayPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

function appendPath(root: string, child: string) {
  if (isAbsoluteDisplayPath(child)) return child;
  const cleanRoot = root.replace(/[\\/]+$/g, '');
  const separator = cleanRoot.includes('\\') ? '\\' : '/';
  const cleanChild = child.replace(/^[\\/]+/g, '').replace(/[\\/]+/g, separator);
  return `${cleanRoot}${separator}${cleanChild}`;
}

function componentTitle(component: any) {
  return cleanString(component?.title)
    || cleanString(component?.name)
    || cleanString(component?.slug)
    || cleanString(component?.id)
    || 'Untitled component';
}

function componentSourcePath(component: any) {
  return cleanString(component?.source?.directory)
    || cleanString(component?.sourceDirectory)
    || cleanString(component?.sourcePath)
    || cleanString(component?.directory)
    || '';
}

function collectSourceRoots(input: AgentInstructionsInput) {
  return uniqueStrings([
    ...input.sourceProjects.map((sourceProject) => sourceProject.path),
    ...input.components.map((component) => componentSourcePath(component))
  ]);
}

function managedBlockRanges(content: string) {
  const markerPairs = [
    { startMarker: AGENTS_START_MARKER, endMarker: AGENTS_END_MARKER },
    { startMarker: LEGACY_AGENTS_START_MARKER, endMarker: LEGACY_AGENTS_END_MARKER }
  ];
  const ranges: ManagedBlockRange[] = [];

  for (const pair of markerPairs) {
    let searchFrom = 0;
    while (searchFrom < content.length) {
      const start = content.indexOf(pair.startMarker, searchFrom);
      if (start === -1) break;
      const endMarkerStart = content.indexOf(pair.endMarker, start + pair.startMarker.length);
      if (endMarkerStart === -1) break;
      ranges.push({ start, end: endMarkerStart + pair.endMarker.length });
      searchFrom = endMarkerStart + pair.endMarker.length;
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

export function extractAgentsManagedBlock(content: string) {
  const [range] = managedBlockRanges(content);
  return range ? content.slice(range.start, range.end) : '';
}

export function replaceAgentsManagedBlock(existingContent: string, generatedBlock: string) {
  const ranges = managedBlockRanges(existingContent);
  if (ranges.length) {
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const before = existingContent.slice(0, first.start).replace(/\s+$/g, '');
    const after = existingContent.slice(last.end).replace(/^\s+/g, '');
    return [before, generatedBlock.trim(), after].filter(Boolean).join('\n\n') + '\n';
  }

  const cleanExisting = existingContent.trim();
  return cleanExisting ? `${cleanExisting}\n\n${generatedBlock.trim()}\n` : `${generatedBlock.trim()}\n`;
}

export function buildAgentsManagedBlock(input: AgentInstructionsInput) {
  const sourceRoots = collectSourceRoots(input);
  const componentRows = input.components
    .map((component) => ({ title: componentTitle(component), sourcePath: componentSourcePath(component) }))
    .filter((component) => component.sourcePath);

  const primaryProjectRoot = sourceRoots.length ? appendPath(input.workspacePath, sourceRoots[0]) : input.workspacePath;
  const sourceProjectsWithPaths = input.sourceProjects
    .map((sourceProject) => ({ ...sourceProject, path: cleanString(sourceProject.path) }))
    .filter((sourceProject) => sourceProject.path);

  const lines = [
    AGENTS_START_MARKER,
    '# Agent Instructions',
    '',
    'This generated block is maintained by the project context publisher. Edit the source context and republish rather than editing this block directly.',
    '',
    '## Scope',
    '',
    'This file applies to the implementation workspace and repositories beneath it:',
    '',
    '```text',
    input.workspacePath,
    ...sourceRoots.map((sourceRoot) => appendPath(input.workspacePath, sourceRoot)),
    '```',
    '',
    '## Machine paths',
    '',
    `- Implementation workspace: \`${input.workspacePath}\``,
    `- Project root: \`${primaryProjectRoot}\``,
    `- Root agent instruction file: \`${appendPath(input.workspacePath, 'AGENTS.md')}\``,
    '',
    '## Read first',
    '',
    'Before changing code, read the relevant project context files:',
    '',
    '```text',
    'docs/foundation.md',
    'docs/standards.md',
    'docs/components.md',
    '```',
    '',
    'For delivery work, also read the active package instructions under:',
    '',
    '```text',
    'delivery/<package-id>/',
    '```',
    '',
    '## Source roots',
    ''
  ];

  if (sourceRoots.length) {
    lines.push('Use these source roots before searching the wider workspace:', '', '```text', ...sourceRoots, '```', '');
  } else {
    lines.push('No source roots have been published yet. Start from the implementation workspace root.', '');
  }

  if (componentRows.length) {
    lines.push('## Component map', '');
    for (const component of componentRows) {
      lines.push(`- ${component.title}: \`${component.sourcePath}\``);
    }
    lines.push('');
  }

  if (sourceProjectsWithPaths.length) {
    lines.push('## Source projects', '');
    for (const sourceProject of sourceProjectsWithPaths) {
      const name = cleanString(sourceProject.name) || sourceProject.path || 'Source project';
      lines.push(`- ${name}: \`${sourceProject.path}\``);
    }
    lines.push('');
  }

  lines.push(
    '## Working rules',
    '',
    '- Work inside the implementation workspace unless the task explicitly says otherwise.',
    '- Prefer the listed source roots before searching unrelated folders.',
    '- Treat `docs/` as generated project context. Do not rewrite generated context unless the task requires it.',
    '- Use the active `delivery/<package-id>/` folder as the execution record for package-based work.',
    '- Avoid unrelated files, generated files, build output, caches, and local editor settings.',
    '- Keep changes small, focused, and traceable to the requested delivery task.',
    '- When behaviour, architecture, standards, or component boundaries change, record the required context updates in the delivery package instead of silently changing the generated docs.',
    '',
    AGENTS_END_MARKER,
    ''
  );

  return lines.join('\n');
}
