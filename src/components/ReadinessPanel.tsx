import { CheckCircle2, CircleAlert, CircleDashed } from 'lucide-react';
import { checkReadiness } from '../domain/readiness';
import type { DeliveryBundle } from '../domain/types';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

function approvalVariant(value: string): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (value === 'approved') return 'success';
  if (value === 'rejected' || value === 'changes-requested') return 'destructive';
  if (value === 'pending') return 'warning';
  return 'secondary';
}

export function ReadinessPanel({ bundle }: { bundle: DeliveryBundle }) {
  const readiness = checkReadiness(bundle);

  return (
    <Card className="sticky top-6 self-start">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Readiness</CardTitle>
            <CardDescription>Package safety and approval state.</CardDescription>
          </div>
          <div className="grid h-16 w-16 place-items-center rounded-full border bg-muted text-lg font-bold">{readiness.score}%</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <h3 className="font-semibold">{readiness.readyForAi ? 'Approved for AI' : readiness.readyForReview ? 'Ready for review' : 'Not ready yet'}</h3>
          <p className="text-sm text-muted-foreground">AIDD checks whether this package is bounded, reviewable, and safe to hand to an AI agent.</p>
        </div>

        <div className="space-y-2">
          {readiness.issues.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
              <span>No readiness blockers.</span>
            </div>
          ) : (
            readiness.issues.map((issue, index) => (
              <div key={index} className="flex items-start gap-2 rounded-md border bg-card p-3 text-sm">
                {issue.level === 'blocker' ? <CircleAlert className="mt-0.5 h-4 w-4 text-destructive" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-amber-600" />}
                <span>{issue.message}</span>
              </div>
            ))
          )}
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Product</span><Badge variant={approvalVariant(bundle.approvals.product)}>{bundle.approvals.product}</Badge></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Architecture</span><Badge variant={approvalVariant(bundle.approvals.architecture)}>{bundle.approvals.architecture}</Badge></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Delivery</span><Badge variant={approvalVariant(bundle.approvals.delivery)}>{bundle.approvals.delivery}</Badge></div>
        </div>
      </CardContent>
    </Card>
  );
}
