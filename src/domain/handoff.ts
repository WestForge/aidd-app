import type { DeliveryBundle } from './types';

function bullets(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- None specified';
}

export function generateAiHandoff(bundle: DeliveryBundle): string {
  return `# ${bundle.id} AI Execution Handoff: ${bundle.title}\n\n## Goal\n${bundle.goal}\n\n## Rationale\n${bundle.rationale}\n\n## Workstream\n${bundle.workstream}\n\n## Capability\n${bundle.capability}\n\n## In Scope\n${bullets(bundle.inScope)}\n\n## Out of Scope\n${bullets(bundle.outOfScope)}\n\n## Required Context\n${bullets(bundle.linkedContext)}\n\n## Acceptance Criteria\n${bullets(bundle.acceptanceCriteria)}\n\n## Verification Plan\n${bullets(bundle.verificationPlan)}\n\n## Risks / Constraints\n${bullets(bundle.risks)}\n\n## Instructions for AI Agent\nImplement only the approved scope. Do not add features outside the acceptance criteria. If the implementation requires architecture or capability changes not described here, stop and ask for human review.\n`;
}
