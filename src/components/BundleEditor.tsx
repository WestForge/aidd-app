import type { DeliveryBundle } from '../domain/types';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { ReadinessPanel } from './ReadinessPanel';

interface BundleEditorProps { bundle: DeliveryBundle; onChange: (bundle: DeliveryBundle) => void; onSubmitForReview: () => void; }
function updateList(value: string) { return value.split('\n').map((line) => line.trim()).filter(Boolean); }
export function BundleEditor({ bundle, onChange, onSubmitForReview }: BundleEditorProps) {
  const update = (patch: Partial<DeliveryBundle>) => onChange({ ...bundle, ...patch, lastUpdated: new Date().toISOString().slice(0, 10) });
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex h-16 shrink-0 items-center justify-between border-b px-6"><div><h1 className="text-xl font-semibold">{bundle.id}</h1><p className="text-sm text-muted-foreground">Edit delivery package details.</p></div><div className="flex gap-2"><Badge variant="outline">{bundle.status.replace(/-/g, ' ')}</Badge><Button onClick={onSubmitForReview}>Submit for review</Button></div></header><main className="grid min-h-0 flex-1 gap-4 overflow-auto p-6 xl:grid-cols-[1fr_320px]"><Card><CardHeader><CardTitle>Package brief</CardTitle><CardDescription>Scope, acceptance criteria and verification plan.</CardDescription></CardHeader><CardContent className="space-y-4"><Input value={bundle.title} onChange={(e) => update({ title: e.target.value })} placeholder="Title" /><Input value={bundle.capability} onChange={(e) => update({ capability: e.target.value })} placeholder="Capability" /><Textarea value={bundle.goal} onChange={(e) => update({ goal: e.target.value })} placeholder="Goal" /><Textarea value={bundle.inScope.join('\n')} onChange={(e) => update({ inScope: updateList(e.target.value) })} placeholder="In scope, one per line" /><Textarea value={bundle.outOfScope.join('\n')} onChange={(e) => update({ outOfScope: updateList(e.target.value) })} placeholder="Out of scope, one per line" /><Textarea value={bundle.acceptanceCriteria.join('\n')} onChange={(e) => update({ acceptanceCriteria: updateList(e.target.value) })} placeholder="Acceptance criteria, one per line" /><Textarea value={bundle.verificationPlan.join('\n')} onChange={(e) => update({ verificationPlan: updateList(e.target.value) })} placeholder="Verification plan, one per line" /></CardContent></Card><ReadinessPanel bundle={bundle} /></main></div>;
}
