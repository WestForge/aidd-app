import { Bot, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';

interface ReviewsProps {
  bundles: DeliveryBundle[];
  selectedId: string;
  onSelectBundle: (id: string) => void;
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
}

export function Reviews({ bundles, selectedId, onSelectBundle, bundle, onChange }: ReviewsProps) {
  const aiReviewItems = bundles.filter((item) => item.status === 'in-ai-execution' || item.status === 'needs-verification' || item.status === 'approved-for-ai');
  const queue = aiReviewItems.length ? aiReviewItems : bundles;

  const markAiReview = (notes: string) => {
    onChange({ ...bundle, verificationNotes: notes, status: 'needs-verification', lastUpdated: new Date().toISOString().slice(0, 10) });
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI Reviews</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Review what the AI changed</h1>
        <p className="mt-2 max-w-4xl text-sm text-muted-foreground">Review AI output for scope drift, acceptance criteria, verification evidence, and required updates to capabilities, components, standards, or source references.</p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>AI review queue</CardTitle>
            <CardDescription>{queue.length} packages available for review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.map((item) => (
              <button key={item.id} className={`w-full rounded-md border bg-card p-3 text-left transition hover:bg-accent ${item.id === selectedId ? 'ring-2 ring-ring' : ''}`} onClick={() => onSelectBundle(item.id)}>
                <strong className="block text-sm">{item.id} · {item.title}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">{item.status.replace(/-/g, ' ')}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> {bundle.title}</CardTitle>
                <CardDescription>Use this once an AI agent has produced work for a delivery package.</CardDescription>
              </div>
              <Badge variant="outline">{bundle.status.replace(/-/g, ' ')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Alert>
              Review AI output against package scope, capability intent, mapped components, project standards, and source-code references.
            </Alert>
            <div className="grid gap-2 text-sm">
              {[
                'Changed files are within the delivery package scope.',
                'No unapproved capability or component behaviour was added.',
                'Acceptance criteria have evidence.',
                'Required standards or documentation updates have been captured.',
                'Verification is ready for final human acceptance.'
              ].map((item) => <div key={item} className="rounded-md border bg-muted/40 p-3">{item}</div>)}
            </div>
            <Textarea className="min-h-40" value={bundle.verificationNotes} onChange={(event) => onChange({ ...bundle, verificationNotes: event.target.value })} placeholder="Summarise the AI output, drift, issues, and evidence." />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onChange({ ...bundle, status: 'changes-requested' })}><ShieldCheck className="h-4 w-4" /> Request AI rework</Button>
              <Button onClick={() => markAiReview(bundle.verificationNotes || 'AI output reviewed. Ready for verification.')}><CheckCircle2 className="h-4 w-4" /> AI review complete</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
