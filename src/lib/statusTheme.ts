import { cn } from './utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral';

const statusToneClasses: Record<StatusTone, string> = {
  success: 'status-success',
  warning: 'status-warning',
  danger: 'status-danger',
  info: 'status-info',
  purple: 'status-purple',
  neutral: 'status-neutral',
};

const statusTextClasses: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  purple: 'text-purple',
  neutral: 'text-muted',
};

const successStatuses = new Set([
  'accepted',
  'active',
  'approved',
  'approved-for-ai',
  'complete',
  'completed',
  'connected',
  'current',
  'delivered',
  'done',
  'initialised',
  'local-ready',
  'on-course',
  'on-track',
  'published',
  'ready',
  'ready-to-complete',
  'ready-to-package',
  'synced',
  'up-to-date',
]);

const warningStatuses = new Set([
  'branch-not-found',
  'changes-requested',
  'empty-repository',
  'in-review',
  'local-changes',
  'needs-attention',
  'needs-detail',
  'needs-review',
  'needs-verification',
  'open-question',
  'out-of-date',
  'partially-resolved',
  'remote-mismatch',
  'remote-updates-available',
  'returned',
  'review-needed',
  'stale',
  'tight',
  'warning',
]);

const dangerStatuses = new Set([
  'at-risk',
  'blocked',
  'error',
  'failed',
  'high',
  'invalid',
  'local-not-ready',
  'missing',
  'missing-identity',
  'off-course',
  'rejected',
]);

const infoStatuses = new Set([
  'draft',
  'in-ai-execution',
  'in-delivery',
  'in-progress',
  'local-ready',
  'low',
  'medium',
  'not-started',
  'packaging',
  'pending',
  'preparing',
  'ready-to-publish',
  'ready-to-publish-first-version',
  'syncing',
]);

const purpleStatuses = new Set([
  'ai-review',
  'change',
  'findings',
  'finding',
  'imported',
  'importing',
  'patch',
  'review-imported',
  'source',
  'suggested-change',
  'technical',
  'technical-review',
]);

const neutralStatuses = new Set([
  'archived',
  'deprecated',
  'missing',
  'no-review-needed',
  'no-token',
  'no-workspace',
  'none',
  'not-configured',
  'not-connected',
  'not-published',
  'reference-only',
  'remote-not-configured',
  'skipped',
  'superseded',
  'unknown',
]);

export function normaliseStatus(value?: string | null) {
  return String(value || 'neutral')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

export function statusTone(status?: string | null): StatusTone {
  const normalised = normaliseStatus(status);

  if (normalised === 'success' || successStatuses.has(normalised)) return 'success';
  if (normalised === 'warning' || warningStatuses.has(normalised)) return 'warning';
  if (normalised === 'danger' || dangerStatuses.has(normalised)) return 'danger';
  if (normalised === 'info' || infoStatuses.has(normalised)) return 'info';
  if (normalised === 'purple' || purpleStatuses.has(normalised)) return 'purple';
  if (normalised === 'neutral' || neutralStatuses.has(normalised)) return 'neutral';

  return 'neutral';
}

export function statusToneClass(status?: string | null) {
  return statusToneClasses[statusTone(status)];
}

export function statusTextClass(status?: string | null) {
  return statusTextClasses[statusTone(status)];
}

export function statusPillClass(status?: string | null, className?: string) {
  return cn('status-pill', statusToneClass(status), className);
}

export function statusSurfaceClass(status?: string | null, className?: string) {
  return cn('status-surface', statusToneClass(status), className);
}

export function statusBarClass(status?: string | null, className?: string) {
  return cn('status-bar', statusToneClass(status), className);
}
