import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
export function ReadinessPanel({ bundle }: { bundle: DeliveryBundle }) { const readiness = checkReadiness(bundle); return <Card className="h-fit"><CardHeader><CardTitle>Readiness</CardTitle><CardDescription>Checks before review.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="text-4xl font-semibold">{readiness.score}%</div>{readiness.issues.map((issue) => <div key={`${issue.level}-${issue.message}`} className="rounded-lg border p-3 text-sm"><Badge variant={issue.level === 'blocker' ? 'destructive' : issue.level === 'warning' ? 'outline' : 'secondary'}>{issue.level}</Badge><div className="mt-2 text-muted-foreground">{issue.message}</div></div>)}</CardContent></Card>; }
