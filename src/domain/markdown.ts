import matter from 'gray-matter';
import type { DeliveryBundle } from './types';

function list(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- ';
}

export function bundleToMarkdown(bundle: DeliveryBundle): string {
  return matter.stringify(
    `# Goal\n\n${bundle.goal}\n\n# Rationale\n\n${bundle.rationale}\n\n# In Scope\n\n${list(bundle.inScope)}\n\n# Out of Scope\n\n${list(bundle.outOfScope)}\n\n# Linked Context\n\n${list(bundle.linkedContext)}\n\n# Acceptance Criteria\n\n${list(bundle.acceptanceCriteria)}\n\n# Verification Plan\n\n${list(bundle.verificationPlan)}\n\n# Risks\n\n${list(bundle.risks)}\n\n# Verification Notes\n\n${bundle.verificationNotes}\n`,
    {
      id: bundle.id,
      title: bundle.title,
      status: bundle.status,
      workstream: bundle.workstream,
      capability: bundle.capability,
      owner: bundle.owner,
      approvals: bundle.approvals,
      lastUpdated: bundle.lastUpdated
    }
  );
}
