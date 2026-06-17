import fsp from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATE_VERSION, exists, parseFrontmatter, writeJson } from './projectCore';
import type { FoundationDocument, SetupStepStatus, StandardSection } from './types';

export const STANDARD_SECTION_DEFINITIONS = [
  {
    id: 'project-standards',
    title: 'Standards Overview',
    fileName: 'index.md',
    required: true,
    body: '# Project Standards\n\nUse these standards to guide capabilities, components, delivery packages, implementation, and AI review.\n\n## Sections\n\n- Coding Style\n- Security\n- Testing\n- Architecture\n- Hosting & Platform'
  },
  {
    id: 'coding-style',
    title: 'Coding Style',
    fileName: '01-coding-style.md',
    required: false,
    body: '# Coding Style\n\nDefine the coding conventions people and AI agents should follow.\n\n## Rules\n\n- TODO: Define naming, formatting, linting, and code organisation expectations.\n\n## Avoid\n\n- TODO: Define patterns, shortcuts, or implementation habits to avoid.'
  },
  {
    id: 'security',
    title: 'Security',
    fileName: '02-security.md',
    required: false,
    body: '# Security\n\nDefine the baseline security expectations for this project.\n\n## Rules\n\n- TODO: Define authentication, authorisation, secret handling, dependency, and data protection expectations.\n\n## Review Checks\n\n- TODO: Define what must be checked before security-sensitive work is accepted.'
  },
  {
    id: 'testing',
    title: 'Testing',
    fileName: '03-testing.md',
    required: false,
    body: '# Testing\n\nDefine how changes should be verified before they are accepted.\n\n## Required Tests\n\n- TODO: Define unit, integration, end-to-end, accessibility, or manual verification expectations.\n\n## Evidence\n\n- TODO: Define what test results or review notes must be captured in delivery packages.'
  },
  {
    id: 'architecture',
    title: 'Architecture',
    fileName: '04-architecture.md',
    required: false,
    body: '# Architecture\n\nDefine the architectural principles that should shape implementation decisions.\n\n## Principles\n\n- TODO: Define layering, boundaries, dependency direction, data ownership, and integration expectations.\n\n## Decision Rules\n\n- TODO: Define when an architecture decision record is required.'
  },
  {
    id: 'hosting-platform',
    title: 'Hosting & Platform',
    fileName: '05-hosting-platform.md',
    required: false,
    body: '# Hosting & Platform\n\nDefine the runtime, hosting, deployment, and operational expectations for this project.\n\n## Platform Choices\n\n- TODO: Define hosting platform, environments, deployment approach, observability, and operational constraints.\n\n## Constraints\n\n- TODO: Define platform limits AI agents and delivery packages must respect.'
  }
] as const;

export function buildStandardSectionMarkdown(section: { id: string; title: string; status: SetupStepStatus; required?: boolean; body: string }) {
  return `---\naidd:\n  type: standards\n  id: ${section.id}\n  title: ${section.title}\n  status: ${section.status}\n  required: ${section.required !== false}\n  templateVersion: ${TEMPLATE_VERSION}\n  updatedAt: ${new Date().toISOString()}\n---\n\n${section.body.trim()}\n`;
}

export function standardSectionDone(section: StandardSection) {
  return section.status === 'complete' || (section.required === false && section.status === 'skipped');
}

export function deriveStandardsStatus(sections: StandardSection[]): SetupStepStatus {
  if (!sections.length || sections.every((section) => section.status === 'not-started')) return 'not-started';
  if (sections.every(standardSectionDone)) return 'complete';
  if (sections.some((section) => section.status === 'in-review')) return 'in-review';
  if (sections.some((section) => section.status === 'active')) return 'active';
  if (sections.some((section) => section.status === 'deprecated')) return 'deprecated';
  return 'draft';
}

export function combineStandardsBody(sections: StandardSection[]) {
  return sections
    .map((section) => {
      const body = section.body.trim() || `# ${section.title}\n\nTODO`;
      return [`<!-- Source: foundation/standards/${section.fileName} -->`, body].join('\n\n');
    })
    .join('\n\n---\n\n');
}

export async function readStandardSections(projectPath: string): Promise<StandardSection[]> {
  const standardsDir = path.join(projectPath, 'foundation', 'standards');
  const sections: StandardSection[] = [];

  for (const definition of STANDARD_SECTION_DEFINITIONS) {
    const filePath = path.join(standardsDir, definition.fileName);
    const fileExists = await exists(filePath);
    const raw = fileExists
      ? await fsp.readFile(filePath, 'utf8')
      : buildStandardSectionMarkdown({
          id: definition.id,
          title: definition.title,
          status: 'not-started',
          required: definition.required,
          body: definition.body
        });
    const parsed = parseFrontmatter(raw);
    sections.push({
      id: parsed.id || definition.id,
      title: parsed.title || definition.title,
      fileName: definition.fileName,
      filePath,
      status: parsed.status,
      required: fileExists ? parsed.required : definition.required,
      body: parsed.body.trim() || definition.body
    });
  }

  return sections;
}

export async function writeStandardsManifest(projectPath: string, sections?: StandardSection[]) {
  const standardsDir = path.join(projectPath, 'foundation', 'standards');
  const standardSections = sections ?? await readStandardSections(projectPath);
  const overallStatus = deriveStandardsStatus(standardSections);
  await fsp.mkdir(standardsDir, { recursive: true });
  await writeJson(path.join(standardsDir, 'standards.json'), {
    profiles: overallStatus === 'complete' ? ['project-defined'] : [],
    sections: standardSections.map((section) => ({
      id: section.id,
      fileName: section.fileName,
      title: section.title,
      status: section.status,
      required: section.required
    })),
    updatedAt: new Date().toISOString()
  });
}

export async function fileStatus(filePath: string): Promise<SetupStepStatus> {
  if (!(await exists(filePath))) return 'not-started';
  const parsed = parseFrontmatter(await fsp.readFile(filePath, 'utf8'));
  return parsed.status;
}

export async function readFoundationDocuments(projectPath: string): Promise<FoundationDocument[]> {
  const foundationDir = 'foundation';
  const definitions = [
    ['project-overview', 'Project Overview', '01-project-overview.md'],
    ['product-definition', 'Product definition', '02-product-definition.md'],
    ['audience-and-users', 'Audience & users', '03-audience-and-users.md'],
    ['goals-and-success-metrics', 'Goals & Success Metrics', '04-goals-and-success-metrics.md']
  ] as const;
  const docs: FoundationDocument[] = [];
  for (const [id, fallbackTitle, fileName] of definitions) {
    const filePath = path.join(projectPath, foundationDir, fileName);
    const raw = await exists(filePath) ? await fsp.readFile(filePath, 'utf8') : '';
    const parsed = parseFrontmatter(raw || `# ${fallbackTitle}\n\nTODO\n`);
    docs.push({ id: parsed.id || id, title: parsed.title || fallbackTitle, fileName, filePath, status: parsed.status, required: parsed.required, body: parsed.body });
  }
  return docs;
}
