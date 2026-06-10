import type { DeliveryBundle, ReadinessIssue, ReadinessResult } from './types';

export function checkReadiness(bundle: DeliveryBundle): ReadinessResult {
  const issues: ReadinessIssue[] = [];

  if (!bundle.goal.trim()) issues.push({ level: 'blocker', message: 'Add a clear goal.' });
  if (bundle.inScope.length === 0) issues.push({ level: 'blocker', message: 'Add what is in scope.' });
  if (bundle.outOfScope.length === 0) issues.push({ level: 'warning', message: 'Add what is out of scope to reduce AI drift.' });
  if (bundle.acceptanceCriteria.length === 0) issues.push({ level: 'blocker', message: 'Add acceptance criteria.' });
  if (bundle.verificationPlan.length === 0) issues.push({ level: 'blocker', message: 'Add a verification plan.' });
  if (bundle.linkedContext.length === 0) issues.push({ level: 'blocker', message: 'Link at least one context document.' });

  if (bundle.inScope.length > 4) {
    issues.push({ level: 'warning', message: 'Scope may be too large for one AI execution bundle.' });
  }

  const requiredApprovalValues = Object.values(bundle.approvals);
  const allApproved = requiredApprovalValues.every((approval) => approval === 'approved');
  const blockers = issues.filter((issue) => issue.level === 'blocker');
  const readyForReview = blockers.length === 0;
  const readyForAi = readyForReview && allApproved;

  const totalChecks = 6;
  const passed = totalChecks - blockers.length;
  const score = Math.max(0, Math.round((passed / totalChecks) * 100));

  return { readyForReview, readyForAi, issues, score };
}
