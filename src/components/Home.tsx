import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListChecks,
  PackageCheck,
  Sparkles,
} from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

interface HomeProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string) => void;
  onCreatePackage: () => void;
  activeProject: AiddTrackedProject | null;
  onOpenSetup: () => void;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
  onOpenDelivery: () => void;
}

function formatStatus(status?: string) {
  return (status || 'draft').replace(/-/g, ' ');
}

function ActionRow({
  title,
  detail,
  status,
  onClick,
}: {
  title: string;
  detail: string;
  status?: string;
  onClick: () => void;
}) {
  return (
    <button className="flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left hover:bg-accent" onClick={onClick}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <Badge variant="secondary" className="shrink-0 capitalize">{formatStatus(status)}</Badge>
    </button>
  );
}

export function Home({ packages, onSelectPackage, activeProject, onOpenSetup, onOpenCapabilities, onOpenComponents, onOpenDelivery }: HomeProps) {
  const [status, setStatus] = useState<AiddProjectStatus | null>(null);
  const [work, setWork] = useState<AiddHomeWork | null>(null);

  useEffect(() => {
    if (!activeProject?.path) return;
    let cancelled = false;
    Promise.all([
      window.aidd.readProjectStatus(activeProject.path),
      window.aidd.readHomeWork(activeProject.path),
    ]).then(([projectStatus, homeWork]) => {
      if (cancelled) return;
      setStatus(projectStatus);
      setWork(homeWork);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [activeProject?.path]);

  const blockers = status?.setup.filter((item) => !item.complete) ?? [];
  const activeDelivery = work?.delivery ?? [];
  const capabilityWork = work?.capabilities ?? [];
  const componentWork = work?.components ?? [];
  const totalNeedsDoing = (work?.total ?? 0) + blockers.length;
  const fallbackActivePackages = useMemo(() => packages.filter((item) => item.status !== 'accepted' && item.status !== 'superseded'), [packages]);

  if (!activeProject) {
    return <div className="flex h-full items-center justify-center p-6"><Card className="max-w-md"><CardHeader><CardTitle>No project selected</CardTitle><CardDescription>Open or create a project to start the AIDD workflow.</CardDescription></CardHeader></Card></div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Home</h1>
          <p className="text-sm text-muted-foreground">Active project work that still needs doing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{totalNeedsDoing} to do</Badge>
          {status && <Badge variant="outline">{status.label}</Badge>}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            {blockers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Setup blockers</CardTitle>
                  <CardDescription>These need to be resolved before delivery planning is reliable.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {blockers.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{item.label}</div>
                          <div className="text-sm text-muted-foreground">{item.detail}</div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={onOpenSetup}>Fix</Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Active delivery work</CardTitle>
                <CardDescription>Real delivery packages from this project that are not finished or archived.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeDelivery.length > 0 ? activeDelivery.slice(0, 8).map((item) => (
                  <ActionRow
                    key={item.id}
                    title={`${item.id} · ${item.title}`}
                    detail={item.reason || item.sourceCapability || 'Delivery package needs attention.'}
                    status={item.status}
                    onClick={onOpenDelivery}
                  />
                )) : fallbackActivePackages.length > 0 ? fallbackActivePackages.slice(0, 8).map((item) => (
                  <ActionRow
                    key={item.id}
                    title={`${item.id} · ${item.title}`}
                    detail={item.capability}
                    status={item.status}
                    onClick={() => onSelectPackage(item.id)}
                  />
                )) : (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>No active delivery work</AlertTitle>
                    <AlertDescription>No delivery packages currently need action.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><Sparkles className="h-5 w-5" /><CardTitle>Capabilities</CardTitle></div>
                    <Badge variant="outline">{capabilityWork.length}</Badge>
                  </div>
                  <CardDescription>Capabilities with lifecycle, section, or component mapping work remaining.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {capabilityWork.length ? capabilityWork.slice(0, 6).map((item) => (
                    <ActionRow
                      key={item.slug}
                      title={item.title}
                      detail={item.reason}
                      status={item.status}
                      onClick={onOpenCapabilities}
                    />
                  )) : <p className="text-sm text-muted-foreground">No capabilities need action.</p>}
                  <Button variant="outline" size="sm" onClick={onOpenCapabilities}>Open capabilities <ArrowRight className="h-4 w-4" /></Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><Boxes className="h-5 w-5" /><CardTitle>Components</CardTitle></div>
                    <Badge variant="outline">{componentWork.length}</Badge>
                  </div>
                  <CardDescription>Components that are still draft, unmapped, or not ready.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {componentWork.length ? componentWork.slice(0, 6).map((item) => (
                    <ActionRow
                      key={item.slug}
                      title={item.title}
                      detail={item.reason}
                      status={item.status}
                      onClick={onOpenComponents}
                    />
                  )) : <p className="text-sm text-muted-foreground">No components need action.</p>}
                  <Button variant="outline" size="sm" onClick={onOpenComponents}>Open components <ArrowRight className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            </div>
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <Clock3 className="h-5 w-5" />
                <CardTitle>Needs doing</CardTitle>
                <CardDescription>Only unfinished or actionable items are counted here.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Setup blockers</span><strong>{blockers.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span><strong>{capabilityWork.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Components</span><strong>{componentWork.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Deliveries</span><strong>{activeDelivery.length}</strong></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><ListChecks className="h-5 w-5" /><CardTitle>Project setup</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {status?.setup.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{item.label}</span>
                    {item.complete ? <CheckCircle2 className="h-4 w-4" /> : <Badge variant="outline">Required</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><PackageCheck className="h-5 w-5" /><CardTitle>Project totals</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span><strong>{status?.capabilityCount ?? 0}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Components</span><strong>{status?.componentCount ?? 0}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery packages</span><strong>{status?.bundleCount ?? activeDelivery.length}</strong></div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
