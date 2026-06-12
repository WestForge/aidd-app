import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'electron', 'main.ts');
if (!fs.existsSync(mainPath)) {
  console.error('Run this script from the app repo root. electron/main.ts was not found.');
  process.exit(1);
}

let main = fs.readFileSync(mainPath, 'utf8');
const sections = "const CAPABILITY_TEMPLATE_SECTIONS = [\n  {\n    key: 'outcomes',\n    fileName: '01-outcomes.md',\n    title: 'Outcomes',\n    prompt: 'Describe what this capability should make possible.',\n    body: `## Purpose\nDescribe the user or business outcome this capability must enable.\n\n## Success Criteria\n- [ ] The capability has a clear reason to exist.\n- [ ] Success can be observed or measured.\n- [ ] The expected behaviour is specific enough for delivery work.\n\n## Notes\n- Primary users:\n- Main problem solved:\n- Expected result:`\n  },\n  {\n    key: 'scope',\n    fileName: '02-scope.md',\n    title: 'Scope',\n    prompt: 'Define what is in scope and out of scope.',\n    body: `## In Scope\n- \n\n## Out of Scope\n- \n\n## Assumptions\n- \n\n## Boundaries\nDescribe where this capability starts and stops, especially where another capability or component takes over.`\n  },\n  {\n    key: 'user-journeys',\n    fileName: '03-user-journeys.md',\n    title: 'User Journeys',\n    prompt: 'Describe the journeys or workflows this capability supports.',\n    body: `## Primary Journey\n1. The user starts by...\n2. The system responds by...\n3. The user completes the task when...\n\n## Alternate Journeys\n- \n\n## Error / Recovery Journeys\n- `\n  },\n  {\n    key: 'functional-requirements',\n    fileName: '04-functional-requirements.md',\n    title: 'Functional Requirements',\n    prompt: 'List the required behaviours and functions.',\n    body: `## Required Behaviours\n- [ ] The system shall...\n- [ ] The user can...\n- [ ] The capability prevents...\n\n## Rules\n- \n\n## Acceptance Notes\nDescribe the minimum behaviour required before implementation can be accepted.`\n  },\n  {\n    key: 'non-functional-requirements',\n    fileName: '05-non-functional-requirements.md',\n    title: 'Quality Requirements',\n    prompt: 'List quality, performance, reliability, security, or accessibility needs.',\n    body: `## Quality Attributes\n- Performance:\n- Reliability:\n- Security:\n- Accessibility:\n- Observability:\n\n## Constraints\n- \n\n## Service Expectations\nDescribe any limits, response times, scale, offline behaviour, or compatibility needs.`\n  },\n  {\n    key: 'ux-ui',\n    fileName: '06-ux-ui.md',\n    title: 'UX/UI',\n    prompt: 'Describe user-facing screens, feedback, inspection tools, or UX expectations.',\n    body: `## User Interface\nDescribe screens, panels, controls, messages, empty states, and error states.\n\n## User Feedback\n- Success feedback:\n- Failure feedback:\n- Progress / loading feedback:\n\n## Accessibility Notes\n- `\n  },\n  {\n    key: 'risks',\n    fileName: '07-risks.md',\n    title: 'Risks',\n    prompt: 'Capture risks, unknowns, edge cases, and failure modes.',\n    body: `## Risks\n| Risk | Impact | Mitigation |\n| --- | --- | --- |\n|  |  |  |\n\n## Unknowns\n- \n\n## Edge Cases\n- `\n  },\n  {\n    key: 'validation',\n    fileName: '08-validation.md',\n    title: 'Validation',\n    prompt: 'Describe how this capability should be verified.',\n    body: `## Verification Approach\nDescribe how this capability will be checked before it is considered ready.\n\n## Acceptance Checks\n- [ ] \n- [ ] \n- [ ] \n\n## Test Notes\n- Unit checks:\n- Integration checks:\n- Manual checks:\n- Regression risks:`\n  }\n];";
const before = main;
main = main.replace(/const CAPABILITY_TEMPLATE_SECTIONS = \[[\s\S]*?\];/, sections);
main = main.replace(/  const fallback: Partial<Record<string, string>> = \{[\s\S]*?
  \};
  const sections = normaliseCapabilitySections\(input\.sections, fallback\);/, `  const fallback: Partial<Record<string, string>> = {
    outcomes: input.outcome || input.description || '',
    scope: '',
    'user-journeys': '',
    'functional-requirements': '',
    'non-functional-requirements': '',
    'ux-ui': '',
    risks: input.notes || '',
    validation: ''
  };
  const sections = normaliseCapabilitySections(input.sections, fallback);`);
if (main === before) {
  console.warn('electron/main.ts was not changed. Check the capability template block manually.');
} else {
  fs.writeFileSync(mainPath, main, 'utf8');
  console.log('Updated electron/main.ts capability section template.');
}

const sectionFiles = {
  '06-ux-ui.md': `# UX/UI

Describe user-facing screens, feedback, diagnostics, empty states, and accessibility needs.
`,
  '07-risks.md': `# Risks

## Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns
- 

## Edge Cases
- 
`,
  '08-validation.md': `# Validation

## Verification Approach
Describe how this capability will be checked before it is considered ready.

## Acceptance Checks
- [ ] 
- [ ] 
- [ ] 

## Test Notes
- Unit checks:
- Integration checks:
- Manual checks:
- Regression risks:
`,
};
const aiddSectionFiles = {
  '06-ux-ui.md': `---
aidd:
  type: capability-document
  id: __CAPABILITY_SLUG__-06-ux-ui
  title: UX/UI
  status: draft
  required: true
  templateVersion: 0.8.0
---

# __CAPABILITY_TITLE__ UX/UI

Describe user-facing screens, feedback, diagnostics, empty states, and accessibility needs.
`,
  '07-risks.md': `---
aidd:
  type: capability-document
  id: __CAPABILITY_SLUG__-07-risks
  title: Risks
  status: draft
  required: true
  templateVersion: 0.8.0
---

# __CAPABILITY_TITLE__ Risks

## Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns
- 

## Edge Cases
- 
`,
  '08-validation.md': `---
aidd:
  type: capability-document
  id: __CAPABILITY_SLUG__-08-validation
  title: Validation
  status: draft
  required: true
  templateVersion: 0.8.0
---

# __CAPABILITY_TITLE__ Validation

## Verification Approach
Describe how this capability will be checked before it is considered ready.

## Acceptance Checks
- [ ] 
- [ ] 
- [ ] 

## Test Notes
- Unit checks:
- Integration checks:
- Manual checks:
- Regression risks:
`,
};
const obsolete = [
  '06-data-model.md',
  '07-integrations.md',
  '08-architecture.md',
  '09-ux-ui.md',
  '10-risks.md',
  '11-validation.md',
];
const dirs = [
  path.join(root, 'resources/templates/aidd-default/capability'),
  path.join(root, 'resources/templates/aidd-default/.aidd/templates/capability'),
];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of obsolete) {
    fs.rmSync(path.join(dir, file), { force: true });
  }
  const files = dir.includes(`${path.sep}.aidd${path.sep}`) ? aiddSectionFiles : sectionFiles;
  for (const [file, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), body, 'utf8');
  }
}
const templateIndex = path.join(root, 'resources/templates/aidd-default/.aidd/templates/capability/index.md');
if (fs.existsSync(templateIndex)) {
  fs.writeFileSync(templateIndex, `---
aidd:
  type: capability
  id: __CAPABILITY_SLUG__
  title: __CAPABILITY_TITLE__
  status: draft
  templateVersion: 0.8.0
---

# __CAPABILITY_TITLE__

## Capability files

1. [Outcomes](./01-outcomes.md)
2. [Scope](./02-scope.md)
3. [User Journeys](./03-user-journeys.md)
4. [Functional Requirements](./04-functional-requirements.md)
5. [Quality Requirements](./05-non-functional-requirements.md)
6. [UX/UI](./06-ux-ui.md)
7. [Risks](./07-risks.md)
8. [Validation](./08-validation.md)
`, 'utf8');
}
console.log('Updated capability resource templates and removed technical capability section files.');
