import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, GitBranch, PackageCheck, Puzzle, ShieldCheck, Sparkles } from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';
import type { Screen } from '../main';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface HomeProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string, target?: Screen) => void;
  onCreatePackage: () => void;
  activeProject?: AiddTrackedProject | null;
  onOpenSetup: () => void;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
}

function fallbackStatus(activeProject?: AiddTrackedProject | null): AiddProjectStatus {
  return {
    status: 'setting-up',
    label: 'Setting up',
    completed: activeProject ? 1 : 0,
    total: 6,
    templateVersion: activeProject?.templateVersion ?? 'unknown',
    gitInitialized: false,
    componentCount: 0,
    capabilityCount: 0,
    bundleCount: 0,
    nextAction: 'Open or create an AIDD project.',
    foundation: [
      { id: 'product', label: 'Product definition', complete: false, detail: 'Defines what the system is, who it serves, and what future delivery packages inherit.' },
      { id: 'audience', label: 'Audience & users', complete: false, detail: 'Identifies who the product is for and what outcomes matter.' }
    ],
    setup: [
      { id: 'foundation-complete', label: 'Foundation complete', complete: false, detail: 'Product definition and audience context are complete.' },
      { id: 'standards', label: 'Standards defined', complete: false, detail: 'Project standards are complete.' },
      { id: 'capability', label: 'First capability created', complete: false, detail: 'Create a capability that describes what the system can do.' },
      { id: 'component', label: 'First component created', complete: false, detail: 'Create a component that supports one or more capabilities.' }
    ]
  };
}

function setupActionLabel(id: string) {
  if (id === 'foundation-complete' || id === 'standards') return 'Fix in Foundation';
  if (id === 'capability') return 'Open Capabilities';
  if (id === 'component') return 'Open Components';
  return 'Open';
}

export function Home({ packages, selectedId, onSelectPackage, onCreatePackage, activeProject, onOpenSetup, onOpenCapabilities, onOpenComponents }: HomeProps) {
  const [projectStatus, setProjectStatus] = useState<AiddProjectStatus>(() => fallbackStatus(activeProject));
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeProject?.path) {
      setProjectStatus(fallbackStatus(activeProject));
      return;
    }
    window.aidd.readProjectStatus(activeProject.path)
      .then((status) => {
        if (!cancelled) {
          setProjectStatus(status);
          setStatusError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProjectStatus(fallbackStatus(activeProject));
          setStatusError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { cancelled = true; };
  }, [activeProject]);

  const needsReview = packages.filter((item) => item.status === 'needs-review').length;
  const approved = packages.filter((item) => item.status === 'approved-for-ai').length;
  const needsVerification = packages.filter((item) => item.status === 'in-ai-execution' || item.status === 'needs-verification').length;
  const blocked = packages.filter((item) => !checkReadiness(item).readyForReview).length;

  const visibleSetup = useMemo(
    () => projectStatus.setup.filter((item) => item.id !== 'foundation' && item.id !== 'git' && item.id !== 'package'),
    [projectStatus.setup]
  );
  const blockers = visibleSetup.filter((item) => !item.complete && (item.id === 'foundation-complete' || item.id === 'standards'));
  const nextSteps = visibleSetup.filter((item) => !item.complete && item.id !== 'foundation-complete' && item.id !== 'standards');
  const completeItems = visibleSetup.filter((item) => item.complete).length;
  const readinessProgress = visibleSetup.length ? Math.round((completeItems / visibleSetup.length) * 100) : 0;
  const canCreateDeliveryPackage = blockers.length === 0;

  const openSetupItem = (id: string) => {
    if (id === 'foundation-complete' || id === 'standards') onOpenSetup();
    else if (id === 'capability') onOpenCapabilities();
    else if (id === 'component') onOpenComponents();
  };

  const createDeliveryPackage = () => {
    if (!canCreateDeliveryPackage) return;
    onCreatePackage();
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8 text-foreground">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Project Home</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{activeProject?.name ?? 'AIDD Project'}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Track project readiness, define capabilities and components, then create delivery packages when Product Definition, Audience, and Standards are complete.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onOpenSetup}>Open Foundation</Button>
          <Button onClick={createDeliveryPackage} disabled={!canCreateDeliveryPackage} title={canCreateDeliveryPackage ? 'Create a delivery package' : 'Complete Foundation and Standards first'}>
            New Delivery Package
          </Button>
        </div>
      </header>

      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card to-primary/5">
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_220px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Project readiness</p>
            <h2 className="mt-2 text-2xl font-semibold">{blockers.length === 0 ? 'Ready for delivery planning' : 'Foundation needs attention'}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {blockers.length === 0 ? 'Foundation and Standards are complete. You can now create delivery packages from capabilities.' : 'Complete the blocker items before creating delivery packages.'}
            </p>
            {statusError && <p className="mt-3 text-sm font-medium text-destructive">Could not read full project status: {statusError}</p>}
          </div>
          <div className="rounded-lg border bg-background/70 p-4 text-center">
            <strong className="block text-2xl">{completeItems}/{visibleSetup.length}</strong>
            <span className="text-xs text-muted-foreground">readiness checks complete</span>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${readinessProgress}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Foundation checklist</CardTitle>
            <CardDescription>Only incomplete blockers are highlighted. Use the action button to jump straight to the screen that fixes the issue.</CardDescription>
          </div>
          <Badge variant={blockers.length === 0 ? 'success' : 'warning'}>{blockers.length === 0 ? 'Ready' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {blockers.map((item) => (
            <button key={item.id} className="flex w-full items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-left transition hover:bg-amber-500/15" onClick={() => openSetupItem(item.id)}>
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <strong className="block text-sm">{item.label}</strong>
                <span className="text-sm text-muted-foreground">{item.detail}</span>
              </div>
              <em className="text-xs font-semibold not-italic text-amber-700 dark:text-amber-200">{setupActionLabel(item.id)}</em>
            </button>
          ))}

          {blockers.length === 0 && visibleSetup.filter((item) => item.complete).map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
              <div>
                <strong className="block text-sm">{item.label}</strong>
                <span className="text-sm text-muted-foreground">{item.detail}</span>
              </div>
            </div>
          ))}

          {blockers.length === 0 && nextSteps.map((item) => (
            <button key={item.id} className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:bg-accent" onClick={() => openSetupItem(item.id)}>
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <strong className="block text-sm">{item.label}</strong>
                <span className="text-sm text-muted-foreground">{item.detail}</span>
              </div>
              <em className="text-xs font-semibold not-italic text-primary">{setupActionLabel(item.id)}</em>
            </button>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles size={22} /></div>
            <CardTitle>Define what your system can do</CardTitle>
            <CardDescription>Create capabilities to describe outcomes, behaviours, or features your system needs to support.</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={onOpenCapabilities}>New Capability</Button></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><Puzzle size={22} /></div>
            <CardTitle>Map the parts of your system</CardTitle>
            <CardDescription>Create components for apps, services, plugins, modules, libraries, workflows, integrations, or subsystems.</CardDescription>
          </CardHeader>
          <CardContent><Button variant="outline" onClick={onOpenComponents}>New Component</Button></CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><strong className="block text-xl">{projectStatus.templateVersion}</strong><span className="text-xs text-muted-foreground">template version</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{projectStatus.gitInitialized ? 'Enabled' : 'Missing'}</strong><span className="text-xs text-muted-foreground">Git versioning</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{projectStatus.capabilityCount}</strong><span className="text-xs text-muted-foreground">capabilities</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{projectStatus.componentCount}</strong><span className="text-xs text-muted-foreground">components</span></CardContent></Card>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="flex items-start gap-3 p-4"><Sparkles className="h-5 w-5 text-primary" /><div><strong className="block text-sm">Describe</strong><span className="text-xs text-muted-foreground">Capabilities and components</span></div></CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 p-4"><ShieldCheck className="h-5 w-5 text-primary" /><div><strong className="block text-sm">Review</strong><span className="text-xs text-muted-foreground">Human gates and AI review</span></div></CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 p-4"><PackageCheck className="h-5 w-5 text-primary" /><div><strong className="block text-sm">Package</strong><span className="text-xs text-muted-foreground">Delivery packages for AI execution</span></div></CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 p-4"><GitBranch className="h-5 w-5 text-primary" /><div><strong className="block text-sm">Verify</strong><span className="text-xs text-muted-foreground">Review AI output and accept changes</span></div></CardContent></Card>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><strong className="block text-xl">{packages.length}</strong><span className="text-xs text-muted-foreground">delivery packages</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{needsReview}</strong><span className="text-xs text-muted-foreground">need review</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{approved}</strong><span className="text-xs text-muted-foreground">approved for AI</span></CardContent></Card>
        <Card><CardContent className="p-4"><strong className="block text-xl">{needsVerification}</strong><span className="text-xs text-muted-foreground">need verification</span></CardContent></Card>
      </section>

      {blocked > 0 && <Alert variant="warning">{blocked} delivery package{blocked === 1 ? '' : 's'} need readiness work before review.</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Active delivery packages</CardTitle>
          <CardDescription>Open an existing delivery package to review readiness and progress.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {packages.map((item) => {
            const readiness = checkReadiness(item);
            return (
              <button key={item.id} className={`flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left transition hover:bg-accent ${item.id === selectedId ? 'border-primary bg-primary/5' : 'bg-card'}`} onClick={() => onSelectPackage(item.id)}>
                <div>
                  <strong className="block text-sm">{item.id} · {item.title}</strong>
                  <span className="text-xs text-muted-foreground">{item.workstream} / {item.capability}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{item.status.replace(/-/g, ' ')}</Badge>
                  <span className="text-xs text-muted-foreground">{readiness.score}% ready</span>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
