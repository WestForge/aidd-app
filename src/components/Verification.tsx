import type { DeliveryBundle } from '../domain/types';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';

interface VerificationProps {
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
}

export function Verification({ bundle, onChange }: VerificationProps) {
  const updateNotes = (verificationNotes: string) => {
    onChange({ ...bundle, verificationNotes, lastUpdated: new Date().toISOString().slice(0, 10) });
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Verification</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{bundle.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Record whether the AI result satisfied the approved package.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onChange({ ...bundle, status: 'changes-requested' })}>Request Rework</Button>
          <Button disabled={!bundle.verificationNotes.trim()} onClick={() => onChange({ ...bundle, status: 'accepted' })}>Accept Package</Button>
        </div>
      </header>

      {bundle.status !== 'in-ai-execution' && bundle.status !== 'needs-verification' && bundle.status !== 'accepted' && (
        <Alert variant="warning">This package has not been marked as in AI execution yet. You can draft notes, but acceptance should happen after implementation review.</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Verification evidence</CardTitle>
          <CardDescription>Check each acceptance criterion and capture what was tested.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            {bundle.acceptanceCriteria.length === 0 && <p className="text-sm text-muted-foreground">No acceptance criteria have been defined.</p>}
            {bundle.acceptanceCriteria.map((criterion, index) => (
              <label key={criterion} className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                <input type="checkbox" className="mt-1" />
                <span>AC{index + 1}: {criterion}</span>
              </label>
            ))}
          </div>
          <Textarea className="min-h-48" value={bundle.verificationNotes} onChange={(event) => updateNotes(event.target.value)} placeholder="What changed? What was tested? Any out-of-scope changes?" />
        </CardContent>
      </Card>
    </main>
  );
}
