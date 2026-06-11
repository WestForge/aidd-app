import { useEffect, useState } from 'react';
import { ArrowRight, Boxes, CheckCircle2, CircleAlert, ListChecks, PackageCheck, Sparkles } from 'lucide-react';
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
}

export function Home({ packages, onSelectPackage, activeProject, onOpenSetup, onOpenCapabilities, onOpenComponents }: HomeProps) {
  const [status, setStatus] = useState<AiddProjectStatus | null>(null);

  useEffect(() => {
    if (!activeProject?.path) return;
    window.aidd.readProjectStatus(activeProject.path).then(setStatus).catch(console.error);
  }, [activeProject?.path]);

  const blockers = status?.setup.filter((item) => !item.complete) ?? [];
  const activePackages = packages.filter((item) => item.status !== 'accepted' && item.status !== 'superseded');

  if (!activeProject) {
    return <div className="flex h-full items-center justify-center p-6"><Card className="max-w-md"><CardHeader><CardTitle>No project selected</CardTitle><CardDescription>Open or create a project to start the AIDD workflow.</CardDescription></CardHeader></Card></div>;
  }

  return <div className="flex h-full flex-col overflow-hidden"><header className="flex h-16 shrink-0 items-center justify-between border-b px-6"><div><h1 className="text-xl font-semibold">Home</h1><p className="text-sm text-muted-foreground">Project readiness and delivery pipeline.</p></div>{status && <Badge variant="outline">{status.label}</Badge>}</header><main className="min-h-0 flex-1 overflow-auto p-6"><div className="grid gap-6 xl:grid-cols-[1fr_360px]"><section className="space-y-6"><Card><CardHeader><CardTitle>Readiness</CardTitle><CardDescription>Complete the required setup before creating delivery packages.</CardDescription></CardHeader><CardContent className="space-y-3">{blockers.length === 0 ? <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Ready for delivery planning</AlertTitle><AlertDescription>Foundation and standards are complete.</AlertDescription></Alert> : blockers.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><div className="text-sm font-medium">{item.label}</div><div className="text-sm text-muted-foreground">{item.detail}</div></div></div><Button variant="outline" size="sm" onClick={onOpenSetup}>Fix</Button></div>)}</CardContent></Card><div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><Sparkles className="h-5 w-5" /><CardTitle>Capabilities</CardTitle><CardDescription>Define what the system can do.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onOpenCapabilities}>Open capabilities <ArrowRight className="h-4 w-4" /></Button></CardContent></Card><Card><CardHeader><Boxes className="h-5 w-5" /><CardTitle>Components</CardTitle><CardDescription>Map the system parts that support capabilities.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={onOpenComponents}>Open components <ArrowRight className="h-4 w-4" /></Button></CardContent></Card></div><Card><CardHeader><CardTitle>Active delivery</CardTitle><CardDescription>Priority work currently moving through the pipeline.</CardDescription></CardHeader><CardContent className="space-y-2">{activePackages.length === 0 ? <p className="text-sm text-muted-foreground">No active delivery packages yet.</p> : activePackages.slice(0, 8).map((item) => <button key={item.id} className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-accent" onClick={() => onSelectPackage(item.id)}><div><div className="font-medium">{item.id} · {item.title}</div><div className="text-sm text-muted-foreground">{item.capability}</div></div><Badge variant="secondary">{item.status.replace(/-/g, ' ')}</Badge></button>)}</CardContent></Card></section><aside className="space-y-4"><Card><CardHeader><ListChecks className="h-5 w-5" /><CardTitle>Project setup</CardTitle></CardHeader><CardContent className="space-y-3">{status?.setup.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 text-sm"><span>{item.label}</span>{item.complete ? <CheckCircle2 className="h-4 w-4" /> : <Badge variant="outline">Required</Badge>}</div>)}</CardContent></Card><Card><CardHeader><PackageCheck className="h-5 w-5" /><CardTitle>Counts</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span><strong>{status?.capabilityCount ?? 0}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Components</span><strong>{status?.componentCount ?? 0}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Delivery packages</span><strong>{status?.bundleCount ?? packages.length}</strong></div></CardContent></Card></aside></div></main></div>;
}
