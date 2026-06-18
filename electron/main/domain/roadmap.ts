import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';
import { readChanges } from './changes';
import { exists, readEntities } from './projectCore';
import type {
  RoadmapCapability,
  RoadmapCourseStatus,
  RoadmapHorizon,
  RoadmapPressureMonth,
  RoadmapReport,
  RoadmapReviewBurden,
  RoadmapRiskLevel,
  RoadmapSize,
  RoadmapSizeBucket,
  RoadmapConfidence,
} from './types';

type GitLogEntry = Awaited<ReturnType<typeof git.log>>[number];

const VALID_HORIZONS = new Set<RoadmapHorizon>(['now', 'next', 'later', 'parking-lot']);
const VALID_SIZES = new Set<RoadmapSize>(['tiny', 'small', 'medium', 'large', 'too-large']);
const VALID_CONFIDENCE = new Set<RoadmapConfidence>(['low', 'medium', 'high']);
const VALID_RISK = new Set<RoadmapRiskLevel>(['low', 'medium', 'high']);
const VALID_REVIEW_BURDEN = new Set<RoadmapReviewBurden>(['low', 'medium', 'high']);

const SIZE_BUCKETS: RoadmapSize[] = ['tiny', 'small', 'medium', 'large', 'too-large'];
const HORIZON_RANK: Record<RoadmapHorizon, number> = {
  now: 0,
  next: 1,
  later: 2,
  'parking-lot': 3,
};

function normaliseOptionalString(value: unknown) {
  const text = String(value || '').trim();
  return text || undefined;
}

function normaliseRoadmapHorizon(value: unknown): RoadmapHorizon | undefined {
  const text = String(value || '').trim().toLowerCase() as RoadmapHorizon;
  return VALID_HORIZONS.has(text) ? text : undefined;
}

function normaliseRoadmapSize(value: unknown): RoadmapSize | undefined {
  const text = String(value || '').trim().toLowerCase() as RoadmapSize;
  return VALID_SIZES.has(text) ? text : undefined;
}

function normaliseRoadmapConfidence(value: unknown): RoadmapConfidence | undefined {
  const text = String(value || '').trim().toLowerCase() as RoadmapConfidence;
  return VALID_CONFIDENCE.has(text) ? text : undefined;
}

function normaliseRiskLevel(value: unknown): RoadmapRiskLevel | undefined {
  const text = String(value || '').trim().toLowerCase() as RoadmapRiskLevel;
  return VALID_RISK.has(text) ? text : undefined;
}

function normaliseReviewBurden(value: unknown): RoadmapReviewBurden | undefined {
  const text = String(value || '').trim().toLowerCase() as RoadmapReviewBurden;
  return VALID_REVIEW_BURDEN.has(text) ? text : undefined;
}

function normaliseTargetDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return match || undefined;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function capabilityRoadmapField(manifest: any, key: string) {
  return manifest?.roadmap?.[key] ?? manifest?.[key];
}

function parseDateOnly(value?: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysUntil(targetDate?: string) {
  const target = parseDateOnly(targetDate);
  if (!target) return null;
  return Math.ceil((target.getTime() - startOfToday().getTime()) / (1000 * 60 * 60 * 24));
}

function monthKey(targetDate?: string) {
  const target = parseDateOnly(targetDate);
  if (!target) return 'No target date';
  return target.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function isOpenChangeStatus(status: string) {
  return !['accepted', 'rejected', 'superseded'].includes(status);
}

function courseRank(status: RoadmapCourseStatus) {
  const ranks: Record<RoadmapCourseStatus, number> = {
    unknown: 0,
    'on-course': 1,
    tight: 2,
    'at-risk': 3,
    'off-course': 4,
  };
  return ranks[status] ?? 0;
}

function deriveCourseStatus(input: {
  targetDate?: string;
  estimatedSize?: RoadmapSize;
  estimateConfidence?: RoadmapConfidence;
  riskLevel?: RoadmapRiskLevel;
  reviewBurden?: RoadmapReviewBurden;
  totalChanges: number;
  acceptedChanges: number;
  readyChanges: number;
  inDeliveryChanges: number;
  inReviewChanges: number;
}): { status: RoadmapCourseStatus; reasons: string[]; suggestedActions: string[] } {
  const reasons: string[] = [];
  const suggestedActions: string[] = [];
  const days = daysUntil(input.targetDate);
  const openChanges = Math.max(0, input.totalChanges - input.acceptedChanges);
  const hasTarget = Boolean(input.targetDate);
  const hasScopeSignals = Boolean(input.estimatedSize || input.totalChanges || input.riskLevel || input.reviewBurden);

  if (!hasTarget && !hasScopeSignals) {
    return {
      status: 'unknown',
      reasons: ['No target date or scope assessment has been set yet.'],
      suggestedActions: ['Set a roadmap horizon, target date, and plain-language size.'],
    };
  }

  if (hasTarget && days !== null && days < 0 && openChanges > 0) {
    reasons.push('Target date has passed and linked Changes are still open.');
    suggestedActions.push('Move the target date or reduce the remaining scope.');
    return { status: 'off-course', reasons, suggestedActions };
  }

  if (hasTarget && days !== null && days < 0 && input.totalChanges === 0) {
    reasons.push('Target date has passed and no scoped Changes are linked.');
    suggestedActions.push('Create or link Changes before treating this capability as planned.');
    return { status: 'off-course', reasons, suggestedActions };
  }

  let status: RoadmapCourseStatus = 'on-course';

  if (input.totalChanges === 0) {
    status = 'at-risk';
    reasons.push('No Changes are linked to this capability.');
    suggestedActions.push('Create scoped Changes before packaging delivery work.');
  }

  if (input.estimatedSize === 'too-large') {
    status = 'at-risk';
    reasons.push('Capability is marked too large.');
    suggestedActions.push('Split the capability into smaller slices.');
  }

  if (input.estimatedSize === 'large' && days !== null && days <= 30) {
    status = courseRank(status) < courseRank('at-risk') ? 'at-risk' : status;
    reasons.push('Large capability is close to its target date.');
    suggestedActions.push('Split or defer lower-value scope.');
  }

  if (input.estimateConfidence === 'low') {
    status = courseRank(status) < courseRank('at-risk') ? 'at-risk' : status;
    reasons.push('Scope assessment confidence is low.');
    suggestedActions.push('Clarify unknowns before relying on the date.');
  }

  if (input.riskLevel === 'high' || input.reviewBurden === 'high') {
    status = courseRank(status) < courseRank('tight') ? 'tight' : status;
    reasons.push(input.riskLevel === 'high' ? 'Risk is high.' : 'Review burden is high.');
    suggestedActions.push('Keep delivery packages small and reviewable.');
  }

  if (days !== null && days <= 14 && openChanges > 0) {
    status = courseRank(status) < courseRank('tight') ? 'tight' : status;
    reasons.push('Target date is within two weeks and Changes remain open.');
    suggestedActions.push('Move ready Changes into Delivery or adjust the target.');
  }

  if (input.readyChanges > 0 && input.inDeliveryChanges === 0 && input.inReviewChanges === 0) {
    status = courseRank(status) < courseRank('tight') ? 'tight' : status;
    reasons.push('Ready Changes exist but none are in Delivery or Review.');
    suggestedActions.push('Create a Delivery package from the ready Changes.');
  }

  if (reasons.length === 0) {
    reasons.push(openChanges === 0 && input.totalChanges > 0 ? 'All linked Changes are accepted.' : 'No obvious roadmap pressure detected.');
  }

  return { status, reasons: Array.from(new Set(reasons)), suggestedActions: Array.from(new Set(suggestedActions)) };
}

async function readLastGitChange(projectPath: string, relativePaths: string[], fallbackDate?: string) {
  if (!(await exists(path.join(projectPath, '.git')))) {
    return {
      lastChangedAt: fallbackDate,
      source: fallbackDate ? 'workspace' as const : 'unknown' as const,
    };
  }

  const commits: GitLogEntry[] = [];
  for (const relativePath of relativePaths) {
    try {
      const entries = await git.log({ fs, dir: projectPath, filepath: relativePath.replace(/\\/g, '/'), depth: 1 });
      if (entries[0]) commits.push(entries[0]);
    } catch {
      // Untracked or missing paths simply have no Git attribution yet.
    }
  }

  commits.sort((a, b) => (b.commit.committer.timestamp || 0) - (a.commit.committer.timestamp || 0));
  const last = commits[0];
  if (!last) {
    return {
      lastChangedAt: fallbackDate,
      source: fallbackDate ? 'workspace' as const : 'unknown' as const,
    };
  }

  return {
    lastChangedBy: last.commit.author.name,
    lastChangedEmail: last.commit.author.email,
    lastChangedAt: new Date((last.commit.author.timestamp || last.commit.committer.timestamp) * 1000).toISOString(),
    source: 'git' as const,
  };
}

function deliveryPackageLinkedToCapability(packageRecord: any, capabilitySlug: string, linkedChangeIds: Set<string>) {
  const sourceCapability = String(packageRecord?.sourceCapability || '').trim();
  const sourceCapabilities = toArray(packageRecord?.sourceCapabilities);
  const changeIds = toArray(packageRecord?.changeIds);
  return sourceCapability === capabilitySlug || sourceCapabilities.includes(capabilitySlug) || changeIds.some((id) => linkedChangeIds.has(id));
}

export async function readRoadmap(projectPath: string): Promise<RoadmapReport> {
  const generatedAt = new Date().toISOString();
  const capabilitiesRaw = (await readEntities(projectPath, 'capabilities', 'capability.json')).map((capability: any) => ({
    ...capability,
    components: Array.isArray(capability.components) ? capability.components : Array.isArray(capability.modules) ? capability.modules : [],
  }));
  const changes = await readChanges(projectPath);
  const deliveryPackages = (await readEntities(projectPath, 'delivery/packages', 'package.json')).concat(await readEntities(projectPath, 'delivery/bundles', 'bundle.json'));

  const capabilities: RoadmapCapability[] = [];

  for (const capability of capabilitiesRaw) {
    const slug = String(capability.slug || capability.id || '').trim();
    if (!slug) continue;
    const linkedChanges = changes.filter((change) => change.linkedCapabilities.includes(slug));
    const linkedChangeIds = new Set(linkedChanges.map((change) => change.id));
    const linkedDeliveryPackages = deliveryPackages.filter((packageRecord: any) => deliveryPackageLinkedToCapability(packageRecord, slug, linkedChangeIds));

    const targetDate = normaliseTargetDate(capabilityRoadmapField(capability, 'targetDate'));
    const horizon = normaliseRoadmapHorizon(capabilityRoadmapField(capability, 'roadmapHorizon') ?? capabilityRoadmapField(capability, 'horizon'));
    const estimatedSize = normaliseRoadmapSize(capabilityRoadmapField(capability, 'estimatedSize'));
    const estimateConfidence = normaliseRoadmapConfidence(capabilityRoadmapField(capability, 'estimateConfidence'));
    const riskLevel = normaliseRiskLevel(capabilityRoadmapField(capability, 'riskLevel'));
    const reviewBurden = normaliseReviewBurden(capabilityRoadmapField(capability, 'reviewBurden'));
    const suggestedSplit = Boolean(capabilityRoadmapField(capability, 'suggestedSplit')) || estimatedSize === 'too-large';

    const totalChanges = linkedChanges.length;
    const acceptedChanges = linkedChanges.filter((change) => change.status === 'accepted').length;
    const readyChanges = linkedChanges.filter((change) => change.status === 'ready').length;
    const inDeliveryChanges = linkedChanges.filter((change) => change.status === 'in-delivery').length;
    const inReviewChanges = linkedChanges.filter((change) => change.status === 'in-review').length;
    const openChanges = linkedChanges.filter((change) => isOpenChangeStatus(change.status)).length;

    const course = deriveCourseStatus({
      targetDate,
      estimatedSize,
      estimateConfidence,
      riskLevel,
      reviewBurden,
      totalChanges,
      acceptedChanges,
      readyChanges,
      inDeliveryChanges,
      inReviewChanges,
    });

    const provenance = await readLastGitChange(projectPath, [
      `capabilities/${slug}/capability.json`,
      `capabilities/${slug}/index.md`,
    ], normaliseOptionalString(capability.updatedAt || capability.createdAt));

    capabilities.push({
      slug,
      title: String(capability.title || slug),
      status: String(capability.status || 'draft'),
      components: toArray(capability.components),
      roadmapHorizon: horizon,
      targetDate,
      estimatedSize,
      estimateConfidence,
      riskLevel,
      reviewBurden,
      suggestedSplit,
      estimateReason: toArray(capabilityRoadmapField(capability, 'estimateReason')),
      unknowns: toArray(capabilityRoadmapField(capability, 'unknowns')),
      provenance,
      progress: {
        totalChanges,
        acceptedChanges,
        openChanges,
        readyChanges,
        inDeliveryChanges,
        inReviewChanges,
        deliveryPackageCount: linkedDeliveryPackages.length,
      },
      course,
    });
  }

  capabilities.sort((a, b) => {
    const horizonA = a.roadmapHorizon ? HORIZON_RANK[a.roadmapHorizon] : 4;
    const horizonB = b.roadmapHorizon ? HORIZON_RANK[b.roadmapHorizon] : 4;
    if (horizonA !== horizonB) return horizonA - horizonB;
    const dateA = a.targetDate || '9999-99-99';
    const dateB = b.targetDate || '9999-99-99';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.title.localeCompare(b.title);
  });

  const sizeBuckets: RoadmapSizeBucket[] = SIZE_BUCKETS.map((size) => ({
    size,
    label: size.replace('-', ' '),
    count: capabilities.filter((capability) => capability.estimatedSize === size).length,
  }));

  const pressureByMonth = new Map<string, RoadmapPressureMonth>();
  for (const capability of capabilities) {
    const key = monthKey(capability.targetDate);
    const current = pressureByMonth.get(key) || {
      month: key,
      capabilityCount: 0,
      largeOrTooLargeCount: 0,
      atRiskCount: 0,
      lowConfidenceCount: 0,
    };
    current.capabilityCount += 1;
    if (capability.estimatedSize === 'large' || capability.estimatedSize === 'too-large') current.largeOrTooLargeCount += 1;
    if (capability.course.status === 'at-risk' || capability.course.status === 'off-course') current.atRiskCount += 1;
    if (capability.estimateConfidence === 'low') current.lowConfidenceCount += 1;
    pressureByMonth.set(key, current);
  }

  const pressureByTargetMonth = Array.from(pressureByMonth.values()).sort((a, b) => {
    if (a.month === 'No target date') return 1;
    if (b.month === 'No target date') return -1;
    return a.month.localeCompare(b.month);
  });

  const statusCounts = capabilities.reduce<Record<RoadmapCourseStatus, number>>((counts, capability) => {
    counts[capability.course.status] = (counts[capability.course.status] || 0) + 1;
    return counts;
  }, { unknown: 0, 'on-course': 0, tight: 0, 'at-risk': 0, 'off-course': 0 });

  const overallStatus: RoadmapCourseStatus =
    statusCounts['off-course'] > 0 ? 'off-course'
      : statusCounts['at-risk'] > 0 ? 'at-risk'
        : statusCounts.tight > 0 ? 'tight'
          : capabilities.length === 0 || statusCounts.unknown === capabilities.length ? 'unknown'
            : 'on-course';

  const summaryReasons = capabilities
    .filter((capability) => ['off-course', 'at-risk', 'tight', 'unknown'].includes(capability.course.status))
    .flatMap((capability) => capability.course.reasons.map((reason) => `${capability.title}: ${reason}`))
    .slice(0, 8);

  const suggestedActions = Array.from(new Set(capabilities.flatMap((capability) => capability.course.suggestedActions))).slice(0, 8);

  return {
    generatedAt,
    overallStatus,
    summary: {
      capabilityCount: capabilities.length,
      targetedCapabilityCount: capabilities.filter((capability) => Boolean(capability.targetDate)).length,
      largeOrTooLargeCount: capabilities.filter((capability) => capability.estimatedSize === 'large' || capability.estimatedSize === 'too-large').length,
      lowConfidenceCount: capabilities.filter((capability) => capability.estimateConfidence === 'low').length,
      noLinkedChangeCount: capabilities.filter((capability) => capability.progress.totalChanges === 0).length,
      offCourseCount: statusCounts['off-course'],
      atRiskCount: statusCounts['at-risk'],
      tightCount: statusCounts.tight,
      onCourseCount: statusCounts['on-course'],
      unknownCount: statusCounts.unknown,
    },
    summaryReasons,
    suggestedActions,
    sizeBuckets,
    pressureByTargetMonth,
    capabilities,
  };
}
