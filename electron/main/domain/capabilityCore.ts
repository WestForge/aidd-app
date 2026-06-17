import matter from '../../frontmatter';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATE_VERSION, exists, readEntities } from './projectCore';
import type { CapabilitySectionInput, CreateCapabilityInput, SetupStepStatus } from './types';

export const CAPABILITY_TEMPLATE_SECTIONS = [
  {
    key: 'outcomes',
    fileName: '01-outcomes.md',
    title: 'Outcomes',
    prompt: 'Describe what this capability should make possible for users or the business.',
    body: `## Purpose
Describe the user or business outcome this capability must enable.

## Success Criteria
- [ ] The capability has a clear reason to exist.
- [ ] Success can be observed or measured.
- [ ] The expected behaviour is specific enough for delivery work.

## Notes
- Primary users:
- Main problem solved:
- Expected result:`
  },
  {
    key: 'scope',
    fileName: '02-scope.md',
    title: 'Scope',
    prompt: 'Define what is in scope and out of scope for this capability.',
    body: `## In Scope
- 

## Out of Scope
- 

## Assumptions
- 

## Boundaries
Describe where this capability starts and stops, especially where another capability or component takes over.`
  },
  {
    key: 'user-journeys',
    fileName: '03-user-journeys.md',
    title: 'User Journeys',
    prompt: 'Describe the user journeys or workflows this capability supports.',
    body: `## Primary Journey
1. The user starts by...
2. The system responds by...
3. The user completes the task when...

## Alternate Journeys
- 

## Error / Recovery Journeys
- `
  },
  {
    key: 'functional-requirements',
    fileName: '04-functional-requirements.md',
    title: 'Functional Requirements',
    prompt: 'List the required product behaviours and rules.',
    body: `## Required Behaviours
- [ ] The system shall...
- [ ] The user can...
- [ ] The capability prevents...

## Rules
- 

## Acceptance Notes
Describe the minimum product behaviour required before implementation can be accepted.`
  },
  {
    key: 'ux-ui',
    fileName: '05-ux-ui.md',
    title: 'UX/UI',
    prompt: 'Describe user-facing screens, feedback, inspection tools, or UX expectations.',
    body: `## User Interface
Describe screens, panels, controls, messages, empty states, and error states.

## User Feedback
- Success feedback:
- Failure feedback:
- Progress / loading feedback:

## Accessibility Notes
- `
  },
  {
    key: 'risks',
    fileName: '06-risks.md',
    title: 'Risks',
    prompt: 'Capture product risks, unknowns, edge cases, and failure modes.',
    body: `## Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns
- 

## Edge Cases
- `
  },
  {
    key: 'validation',
    fileName: '07-validation.md',
    title: 'Validation',
    prompt: 'Describe how this capability should be verified.',
    body: `## Verification Approach
Describe how this capability will be checked before it is considered ready.

## Acceptance Checks
- [ ] 
- [ ] 
- [ ] 

## Test Notes
- User checks:
- Regression risks:
- Evidence required:`
  }
];

export const COMPONENT_LEGACY_SECTION_FILES: Record<string, string[]> = {
  dependencies: ['04-dependencies.md', '05-dependencies-and-integrations.md'],
  architecture: ['05-architecture.md', '06-internal-design.md', 'technical-shape.md'],
  standards: ['06-standards.md', '07-quality-requirements.md']
};

export const CAPABILITY_LEGACY_SECTION_FILES: Record<string, string[]> = {
  'ux-ui': ['09-ux-ui.md'],
  risks: ['10-risks.md'],
  validation: ['11-validation.md']
};

export async function readSectionFromFirstExistingFile(dir: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    const filePath = path.join(dir, fileName);
    if (!(await exists(filePath))) continue;
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const sectionAidd = (parsed.data as any)?.aidd || {};
    const body = sectionBodyFromMarkdown(raw);
    return {
      body,
      status: sectionAidd.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      skipReason: sectionAidd.skipReason ? String(sectionAidd.skipReason) : ''
    };
  }
  return null;
}

export function normaliseCapabilitySections(inputSections?: CapabilitySectionInput[], fallback?: Partial<Record<string, string>>) {
  const byKey = new Map<string, CapabilitySectionInput>();
  for (const section of inputSections || []) {
    if (!section?.key) continue;
    byKey.set(section.key, section);
  }

  return CAPABILITY_TEMPLATE_SECTIONS.map((template) => {
    const input = byKey.get(template.key);
    const body = input?.body ?? fallback?.[template.key] ?? template.body ?? '';
    return {
      key: template.key,
      fileName: template.fileName,
      title: template.title,
      body,
      status: input?.status || (body.trim() ? 'draft' : 'not-started') as SetupStepStatus,
      prompt: template.prompt
    };
  });
}

export function buildCapabilitySectionMarkdown(input: { slug: string; capabilityTitle: string; section: ReturnType<typeof normaliseCapabilitySections>[number]; capabilityStatus: string; components: string[] }) {
  const body = input.section.body?.trim() || input.section.prompt;
  return matter.stringify([
    `# ${input.capabilityTitle} ${input.section.title}`,
    '',
    body,
    ''
  ].join('\n'), {
    aidd: {
      type: 'capability-section',
      id: `${input.slug}-${input.section.key}`,
      title: `${input.capabilityTitle} ${input.section.title}`,
      status: input.section.status || 'not-started',
      required: true,
      capability: input.slug,
      section: input.section.key,
      components: input.components,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

export function buildCapabilityIndexMarkdown(input: { slug: string; title: string; status: string; components: string[]; sections: ReturnType<typeof normaliseCapabilitySections> }) {
  return matter.stringify([
    `# ${input.title}`,
    '',
    'This capability is managed by AIDD as a set of template-backed section files.',
    '',
    '## Sections',
    '',
    ...input.sections.map((section) => `- [${section.title}](./${section.fileName})`),
    '',
    '## Components Touched',
    '',
    input.components.length ? input.components.map((component) => `- ${component}`).join('\n') : 'No components linked yet.',
    ''
  ].join('\n'), {
    aidd: {
      type: 'capability',
      id: input.slug,
      title: input.title,
      status: input.status || 'draft',
      required: true,
      components: input.components,
      templateVersion: TEMPLATE_VERSION,
      updatedAt: new Date().toISOString()
    }
  });
}

export function sectionBodyFromMarkdown(raw: string) {
  const parsed = matter(raw || '');
  return parsed.content.replace(/^# .*\n+/, '').replace(/^\s*\n/, '').trim();
}

export function buildCapabilityOutcomeMarkdown(input: CreateCapabilityInput & { slug: string; title: string; components: string[] }) {
  const sections = [
    `# ${input.title}`,
    input.description?.trim() ? `## Description

${input.description.trim()}` : `## Description

Describe what this capability is and why it matters.`,
    input.outcome?.trim() ? `## Outcome

${input.outcome.trim()}` : `## Outcome

Describe what this capability should make possible.`,
    input.components.length ? `## Components Touched

${input.components.map((component) => `- ${component}`).join('\n')}` : `## Components Touched

No components linked yet.`,
    input.notes?.trim() ? `## Notes

${input.notes.trim()}` : `## Notes

Add useful constraints, open questions, or follow-up notes.`
  ];

  return `---
aidd:
  type: capability
  id: ${input.slug}
  title: ${input.title}
  status: ${input.status || 'draft'}
  required: true
  components:
${input.components.map((component) => `    - ${component}`).join('\n') || '    []'}
  templateVersion: ${TEMPLATE_VERSION}
  updatedAt: ${new Date().toISOString()}
---

${sections.join('\n\n')}
`;
}

export function buildCapabilityBehaviourMarkdown(input: { slug: string; title: string }) {
  return `---
aidd:
  type: capability
  id: ${input.slug}-behaviour
  title: ${input.title} Behaviour Examples
  status: not-started
  required: false
  templateVersion: ${TEMPLATE_VERSION}
  updatedAt: ${new Date().toISOString()}
---

# Behaviour Examples

Add behaviour examples later when the capability needs clearer acceptance scenarios.
`;
}

export async function readComponentCapabilities(root: string, slug: string) {
  const caps = (await readEntities(root, 'capabilities', 'capability.json')).map((capability: any) => ({
    ...capability,
    components: Array.isArray(capability.components) ? capability.components : Array.isArray(capability.modules) ? capability.modules : []
  }));
  return caps.filter((capability: any) => capability.components.includes(slug)).map((capability: any) => String(capability.slug || capability.id)).filter(Boolean);
}
