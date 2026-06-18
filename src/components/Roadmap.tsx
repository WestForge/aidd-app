import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clipboard, GitCommit, HelpCircle, Map, RefreshCw, Route, Scissors, ShieldAlert } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { cn } from '../lib/utils';

interface RoadmapProps {
  activeProject: AiddTrackedProject | null;
}

type EditableRoadmapField =
  | 'roadmapHorizon'
  | 'targetDate'
  | 'estimatedSize'
  | 'estimateConfidence'
  | 'riskLevel'
  | 'reviewBurden'
  | 'suggestedSplit';

const HORIZON_LABELS: Record<AiddRoadmapHorizon, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
  'parking-lot': 'Parking lot',
};

const SIZE_LABELS: Record<AiddRoadmapSize, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  'too-large': 'Too large',
};

const COURSE_LABELS: Record<AiddRoadmapCourseStatus, string> = {
  'on-course': 'On course',
  tight: 'Tight',
  'at-risk': 'At risk',
  'off-course': 'Off course',
  unknown: 'Unknown',
};

const COURSE_VARIANTS: Record<AiddRoadmapCourseStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'on-course': 'default',
  tight: 'secondary',
  'at-risk': 'destructive',
  'off-course': 'destructive',
  unknown: 'outline',
};

function formatDate(value?: string) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value?: string) {
  if (!value) return 'No Git date yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fieldValue(value?: string) {
  return value || '';
}

function roadmapReviewPrompt(capability: AiddRoadmapCapability) {
  return [
    'Assess this AIDD capability scope for the Roadmap.',
    '',
    'Important rules:',
    '- Do not use story points.',
    '- Do not assign an owner.',
    '- Use plain language size: tiny, small, medium, large, or too-large.',
    '- Explain confidence, risk, review burden, unknowns, and whether the capability should be split.',
    '',
    `Capability: ${capability.title}`,
    `Slug: ${capability.slug}`,
    `Roadmap horizon: ${capability.roadmapHorizon ? HORIZON_LABELS[capability.roadmapHorizon] : 'not set'}`,
    `Target date: ${capability.targetDate || 'not set'}`,
    `Current size: ${capability.estimatedSize ? SIZE_LABELS[capability.estimatedSize] : 'not set'}`,
    `Confidence: ${capability.estimateConfidence || 'not set'}`,
    `Risk: ${capability.riskLevel || 'not set'}`,
    `Review burden: ${capability.reviewBurden || 'not set'}`,
    `Suggested split: ${capability.suggestedSplit ? 'yes' : 'not currently marked'}`,
    '',
    'Current delivery signal:',
    `- Linked Changes: ${capability.progress.totalChanges}`,
    `- Accepted Changes: ${capability.progress.acceptedChanges}`,
    `- Ready Changes: ${capability.progress.readyChanges}`,
    `- In Delivery: ${capability.progress.inDeliveryChanges}`,
    `- In Review: ${capability.progress.inReviewChanges}`,
    `- Delivery packages: ${capability.progress.deliveryPackageCount}`,
    '',
    'Return JSON with:',
    '{',
    '  "estimatedSize": "tiny | small | medium | large | too-large",',
    '  "estimateConfidence": "low | medium | high",',
    '  "riskLevel": "low | medium | high",',
    '  "reviewBurden": "low | medium | high",',
    '  "suggestedSplit": true,',
    '  "estimateReason": ["..."],',
    '  "unknowns": ["..."],',
    '  "suggestedChanges": ["..."]',
    '}',
  ].join('\n');
}

export function Roadmap({ activeProject }: RoadmapProps) {
  const [roadmap, setRoadmap] = useState<AiddRoadmapReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const loadRoadmap = async () => {
    if (!activeProject) {
      setRoadmap(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRoadmap(await window.aidd.readRoadmap(activeProject.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRoadmap();
  }, [activeProject?.path]);

  const groupedCapabilities = useMemo(() => {
    const groups: Record<'now' | 'next' | 'later' | 'parking-lot' | 'unset', AiddRoadmapCapability[]> = {
      now: [],
      next: [],
      later: [],
      'parking-lot': [],
      unset: [],
    };
    for (const capability of roadmap?.capabilities || []) {
      groups[capability.roadmapHorizon || 'unset'].push(capability);
    }
    return groups;
  }, [roadmap]);

  const saveCapabilityField = async (capability: AiddRoadmapCapability, field: EditableRoadmapField, value: string | boolean) => {
    if (!activeProject) return;
    setSavingSlug(capability.slug);
    setError(null);
    try {
      const detail = await window.aidd.readCapability({ projectPath: activeProject.path, slug: capability.slug });
      await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: capability.slug,
        title: detail.title,
        status: detail.status as AiddSetupStatus,
        componentSlugs: detail.components,
        sections: detail.sections,
        roadmapHorizon: detail.roadmapHorizon || '',
        targetDate: detail.targetDate || '',
        estimatedSize: detail.estimatedSize || '',
        estimateConfidence: detail.estimateConfidence || '',
        riskLevel: detail.riskLevel || '',
        reviewBurden: detail.reviewBurden || '',
        suggestedSplit: Boolean(detail.suggestedSplit),
        estimateReason: detail.estimateReason || [],
        unknowns: detail.unknowns || [],
        [field]: value,
      });
      await loadRoadmap();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSlug(null);
    }
  };

  const copyAssessmentPrompt = async (capability: AiddRoadmapCapability) => {
    await navigator.clipboard.writeText(roadmapReviewPrompt(capability));
    setCopiedSlug(capability.slug);
    window.setTimeout(() => setCopiedSlug((current) => current === capability.slug ? null : current), 1800);
  };

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Roadmap</CardTitle>
            <CardDescription>Select a project before opening the roadmap.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Route className="h-4 w-4" />
              <span>Roadmap</span>
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Are we on course?</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              A date is useful when it is paired with believable scope. This view avoids story points and owners: it shows target dates, plain-language size, confidence, risk, delivery progress, and Git-derived last changed dates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {roadmap && <Badge variant={COURSE_VARIANTS[roadmap.overallStatus]}>{COURSE_LABELS[roadmap.overallStatus]}</Badge>}
            <Button type="button" variant="outline" onClick={() => loadRoadmap()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {!roadmap && !loading && !error && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">No roadmap data yet.</CardContent>
          </Card>
        )}

        {roadmap && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Course status" value={COURSE_LABELS[roadmap.overallStatus]} icon={<Map className="h-4 w-4" />} />
              <MetricCard label="Targeted capabilities" value={`${roadmap.summary.targetedCapabilityCount}/${roadmap.summary.capabilityCount}`} icon={<CalendarDays className="h-4 w-4" />} />
              <MetricCard label="Large / too large" value={roadmap.summary.largeOrTooLargeCount} icon={<Scissors className="h-4 w-4" />} />
              <MetricCard label="Low confidence" value={roadmap.summary.lowConfidenceCount} icon={<HelpCircle className="h-4 w-4" />} />
              <MetricCard label="No linked Changes" value={roadmap.summary.noLinkedChangeCount} icon={<AlertTriangle className="h-4 w-4" />} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Course signals</CardTitle>
                  <CardDescription>Why AIDD thinks the roadmap is on course, tight, at risk, off course, or unknown.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reasons</div>
                    {roadmap.summaryReasons.length ? (
                      <ul className="space-y-2 text-sm">
                        {roadmap.summaryReasons.map((reason) => <li key={reason} className="rounded-md border bg-muted/30 p-3">{reason}</li>)}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No obvious pressure detected.</p>
                    )}
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested actions</div>
                    {roadmap.suggestedActions.length ? (
                      <ul className="space-y-2 text-sm">
                        {roadmap.suggestedActions.map((action) => <li key={action} className="flex gap-2 rounded-md border bg-background p-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{action}</li>)}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No suggested actions right now.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Capability size</CardTitle>
                  <CardDescription>Plain-language scale only. No story points.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={roadmap.sizeBuckets} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="count" name="Capabilities" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Target month pressure</CardTitle>
                <CardDescription>Counts capabilities by target month and highlights large/too-large, at-risk, and low-confidence work.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={roadmap.pressureByTargetMonth} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="capabilityCount" name="Capabilities" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="largeOrTooLargeCount" name="Large / too large" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="atRiskCount" name="At risk / off course" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="lowConfidenceCount" name="Low confidence" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-4">
              <RoadmapLane title="Now" capabilities={groupedCapabilities.now} onSaveField={saveCapabilityField} onCopyPrompt={copyAssessmentPrompt} savingSlug={savingSlug} copiedSlug={copiedSlug} />
              <RoadmapLane title="Next" capabilities={groupedCapabilities.next} onSaveField={saveCapabilityField} onCopyPrompt={copyAssessmentPrompt} savingSlug={savingSlug} copiedSlug={copiedSlug} />
              <RoadmapLane title="Later" capabilities={groupedCapabilities.later} onSaveField={saveCapabilityField} onCopyPrompt={copyAssessmentPrompt} savingSlug={savingSlug} copiedSlug={copiedSlug} />
              <RoadmapLane title="Parking lot" capabilities={groupedCapabilities['parking-lot']} onSaveField={saveCapabilityField} onCopyPrompt={copyAssessmentPrompt} savingSlug={savingSlug} copiedSlug={copiedSlug} />
            </div>

            {groupedCapabilities.unset.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Unplaced capabilities</CardTitle>
                  <CardDescription>Set a horizon to place these on the roadmap.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {groupedCapabilities.unset.map((capability) => (
                    <RoadmapCapabilityCard key={capability.slug} capability={capability} onSaveField={saveCapabilityField} onCopyPrompt={copyAssessmentPrompt} saving={savingSlug === capability.slug} copied={copiedSlug === capability.slug} />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-6">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-lg border bg-muted/40 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function RoadmapLane({
  title,
  capabilities,
  onSaveField,
  onCopyPrompt,
  savingSlug,
  copiedSlug,
}: {
  title: string;
  capabilities: AiddRoadmapCapability[];
  onSaveField: (capability: AiddRoadmapCapability, field: EditableRoadmapField, value: string | boolean) => Promise<void>;
  onCopyPrompt: (capability: AiddRoadmapCapability) => Promise<void>;
  savingSlug: string | null;
  copiedSlug: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <Badge variant="outline">{capabilities.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {capabilities.length ? capabilities.map((capability) => (
          <RoadmapCapabilityCard
            key={capability.slug}
            capability={capability}
            onSaveField={onSaveField}
            onCopyPrompt={onCopyPrompt}
            saving={savingSlug === capability.slug}
            copied={copiedSlug === capability.slug}
          />
        )) : <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      </CardContent>
    </Card>
  );
}

function RoadmapCapabilityCard({
  capability,
  onSaveField,
  onCopyPrompt,
  saving,
  copied,
}: {
  capability: AiddRoadmapCapability;
  onSaveField: (capability: AiddRoadmapCapability, field: EditableRoadmapField, value: string | boolean) => Promise<void>;
  onCopyPrompt: (capability: AiddRoadmapCapability) => Promise<void>;
  saving: boolean;
  copied: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{capability.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={COURSE_VARIANTS[capability.course.status]}>{COURSE_LABELS[capability.course.status]}</Badge>
            {capability.suggestedSplit && <Badge variant="outline">Split suggested</Badge>}
          </div>
        </div>
        {saving && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <Field label="Horizon">
          <Select value={fieldValue(capability.roadmapHorizon)} onChange={(event) => onSaveField(capability, 'roadmapHorizon', event.target.value)}>
            <option value="">Not set</option>
            <option value="now">Now</option>
            <option value="next">Next</option>
            <option value="later">Later</option>
            <option value="parking-lot">Parking lot</option>
          </Select>
        </Field>
        <Field label="Target date">
          <Input type="date" value={fieldValue(capability.targetDate)} onChange={(event) => onSaveField(capability, 'targetDate', event.target.value)} />
        </Field>
        <Field label="Size">
          <Select value={fieldValue(capability.estimatedSize)} onChange={(event) => onSaveField(capability, 'estimatedSize', event.target.value)}>
            <option value="">Not set</option>
            <option value="tiny">Tiny</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="too-large">Too large</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Confidence">
            <Select value={fieldValue(capability.estimateConfidence)} onChange={(event) => onSaveField(capability, 'estimateConfidence', event.target.value)}>
              <option value="">Unset</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Risk">
            <Select value={fieldValue(capability.riskLevel)} onChange={(event) => onSaveField(capability, 'riskLevel', event.target.value)}>
              <option value="">Unset</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <Field label="Review burden">
          <Select value={fieldValue(capability.reviewBurden)} onChange={(event) => onSaveField(capability, 'reviewBurden', event.target.value)}>
            <option value="">Unset</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
      </div>

      <div className="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <GitCommit className="h-3.5 w-3.5" />
          <span>
            {capability.provenance.lastChangedBy ? `Last changed by ${capability.provenance.lastChangedBy}` : 'Last changed by unknown'} · {formatDateTime(capability.provenance.lastChangedAt)}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <span>Target: {formatDate(capability.targetDate)}</span>
          <span>Changes: {capability.progress.acceptedChanges}/{capability.progress.totalChanges}</span>
          <span>Ready: {capability.progress.readyChanges}</span>
          <span>Delivery: {capability.progress.deliveryPackageCount}</span>
        </div>
      </div>

      {capability.course.reasons.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {capability.course.reasons.slice(0, 2).map((reason) => (
            <div key={reason} className="flex gap-1.5"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{reason}</div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={Boolean(capability.suggestedSplit)}
            onChange={(event) => onSaveField(capability, 'suggestedSplit', event.target.checked)}
          />
          Split?
        </label>
        <Button type="button" variant="outline" size="sm" onClick={() => onCopyPrompt(capability)}>
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? 'Copied' : 'Assess scope'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
