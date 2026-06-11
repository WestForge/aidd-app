import type { DeliveryBundle } from '../domain/types';
import { bundleToMarkdown } from '../domain/markdown';
import { checkReadiness } from '../domain/readiness';
import { ReadinessPanel } from './ReadinessPanel';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

interface BundleEditorProps {
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
  onSubmitForReview: () => void;
}

function updateList(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function listValue(items: string[]) {
  return items.join('\n');
}

export function BundleEditor({ bundle, onChange, onSubmitForReview }: BundleEditorProps) {
  const readiness = checkReadiness(bundle);
  const update = <K extends keyof DeliveryBundle>(key: K, value: DeliveryBundle[K]) => onChange({ ...bundle, [key]: value, lastUpdated: new Date().toISOString().slice(0, 10) });

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Package Editor</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{bundle.id} · {bundle.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Guided editing for non-technical users. Clean Markdown is generated underneath.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => update('status', 'draft')}>Save Draft</Button>
            <Button disabled={!readiness.readyForReview} onClick={onSubmitForReview}>Submit for Review</Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
            <CardDescription>Define what this delivery package is trying to change.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label>Title</Label><Input value={bundle.title} onChange={(event) => update('title', event.target.value)} /></div>
              <div className="space-y-2"><Label>Workstream</Label><Input value={bundle.workstream} onChange={(event) => update('workstream', event.target.value)} /></div>
              <div className="space-y-2"><Label>Capability</Label><Input value={bundle.capability} onChange={(event) => update('capability', event.target.value)} /></div>
              <div className="space-y-2"><Label>Owner</Label><Input value={bundle.owner} onChange={(event) => update('owner', event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>What are we trying to change?</Label><Textarea value={bundle.goal} onChange={(event) => update('goal', event.target.value)} /></div>
            <div className="space-y-2"><Label>Why does this matter?</Label><Textarea value={bundle.rationale} onChange={(event) => update('rationale', event.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scope and context</CardTitle>
            <CardDescription>One item per line. Keep scope narrow and explicit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>In scope</Label><Textarea value={listValue(bundle.inScope)} onChange={(event) => update('inScope', updateList(event.target.value))} /></div>
            <div className="space-y-2"><Label>Out of scope</Label><Textarea value={listValue(bundle.outOfScope)} onChange={(event) => update('outOfScope', updateList(event.target.value))} /></div>
            <div className="space-y-2"><Label>Linked context</Label><Textarea value={listValue(bundle.linkedContext)} onChange={(event) => update('linkedContext', updateList(event.target.value))} placeholder="Markdown paths or document names" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approval criteria</CardTitle>
            <CardDescription>Define how the package will be accepted and verified.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Acceptance criteria</Label><Textarea value={listValue(bundle.acceptanceCriteria)} onChange={(event) => update('acceptanceCriteria', updateList(event.target.value))} /></div>
            <div className="space-y-2"><Label>Verification plan</Label><Textarea value={listValue(bundle.verificationPlan)} onChange={(event) => update('verificationPlan', updateList(event.target.value))} /></div>
            <div className="space-y-2"><Label>Risks / constraints</Label><Textarea value={listValue(bundle.risks)} onChange={(event) => update('risks', updateList(event.target.value))} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Generated Markdown preview</CardTitle></CardHeader>
          <CardContent><pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-4 text-xs">{bundleToMarkdown(bundle)}</pre></CardContent>
        </Card>
      </section>
      <ReadinessPanel bundle={bundle} />
    </main>
  );
}
