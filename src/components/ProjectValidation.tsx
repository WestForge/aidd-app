import { useEffect, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, CircleAlert, GitCommitHorizontal, RefreshCw, Wrench } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

function severityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'error') return 'destructive';
  if (severity === 'success') return 'secondary';
  if (severity === 'warning') return 'outline';
  return 'outline';
}

function statusLabel(status: string) {
  return status.replace(/-/g, ' ');
}

export function ProjectValidation({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [report, setReport] = useState<AiddProjectValidationReport | null>(null);
  const [repair, setRepair] = useState<AiddProjectRepairReport | null>(null);
  const [upgrade, setUpgrade] = useState<AiddProjectTemplateUpgradeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!activeProject?.path) return;
    setBusy(true);
    setError(null);

    try {
      setReport(await window.aidd.validateProject(activeProject.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fix() {
    if (!activeProject?.path) return;
    setBusy(true);
    setError(null);
    setRepair(null);
    setUpgrade(null);

    try {
      const result = await window.aidd.repairProject(activeProject.path);
      setRepair(result);
      setReport(result.validation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function upgradeTemplates() {
    if (!activeProject?.path) return;
    setBusy(true);
    setError(null);
    setRepair(null);
    setUpgrade(null);

    try {
      const result = await window.aidd.upgradeProjectTemplates(activeProject.path);
      setUpgrade(result);
      setReport(result.validation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    run();
  }, [activeProject?.path]);

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
            <CardDescription>Select a project before running the health check.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Project health check</h1>
          <p className="text-sm text-muted-foreground">Validate project structure, template files, front matter versions, and safe repair actions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={run} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            Run check
          </Button>
          <Button variant="outline" onClick={fix} disabled={busy}>
            <Wrench className="h-4 w-4" />
            Fix safe issues
          </Button>
          <Button onClick={upgradeTemplates} disabled={busy}>
            <ArrowUpCircle className="h-4 w-4" />
            Upgrade templates
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Health check error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {repair && (
          <Alert className="mb-4">
            <AlertTitle>{repair.changed ? 'Repair applied' : 'No repair needed'}</AlertTitle>
            <AlertDescription>
              {repair.changes.length ? repair.changes.join(', ') : 'Project already matched safe repair expectations.'}
              {repair.warnings.length ? ` Warnings: ${repair.warnings.join(', ')}` : ''}
            </AlertDescription>
          </Alert>
        )}

        {upgrade && (
          <Alert className="mb-4">
            <AlertTitle>{upgrade.changed ? 'Template upgrade complete' : 'Templates already current'}</AlertTitle>
            <AlertDescription className="space-y-3">
              <div className="space-y-1">
                {upgrade.preUpgradeCommit ? <CommitLine label="Pre-upgrade checkpoint" oid={upgrade.preUpgradeCommit} /> : null}
                {upgrade.upgradeCommit ? <CommitLine label="Template upgrade commit" oid={upgrade.upgradeCommit} /> : null}
                {!upgrade.preUpgradeCommit && !upgrade.upgradeCommit ? <div>No Git commit was created.</div> : null}
              </div>
              {upgrade.changes.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {upgrade.changes.slice(0, 8).map((change) => <li key={change}>{change}</li>)}
                  {upgrade.changes.length > 8 ? <li>{upgrade.changes.length - 8} more change(s).</li> : null}
                </ul>
              ) : <div>No file changes were needed.</div>}
              {upgrade.warnings.length ? <div className="text-yellow-700 dark:text-yellow-300">Warnings: {upgrade.warnings.join(', ')}</div> : null}
            </AlertDescription>
          </Alert>
        )}

        {report && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-5">
              <Metric label="Score" value={`${report.score}%`} />
              <Metric label="Errors" value={report.summary.errors} />
              <Metric label="Warnings" value={report.summary.warnings} />
              <Metric label="Template status" value={statusLabel(report.status)} />
              <Metric label="Delivery ready" value={report.canCreateDeliveryPackage ? 'Yes' : 'No'} />
            </div>

            {report.nextActions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Next actions</CardTitle>
                  <CardDescription>Highest priority fixes from the current health report.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.nextActions.map((action) => (
                    <div key={action} className="flex items-center gap-2 text-sm">
                      <CircleAlert className="h-4 w-4" />
                      {action}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {report.sections.map((section) => (
              <Card key={section.id}>
                <CardHeader>
                  <CardTitle>{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {section.items.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {item.severity === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{item.message}</div>
                          {item.path && <code className="mt-1 block break-all text-xs text-muted-foreground">{item.path}</code>}
                          {item.action && <div className="mt-2 text-xs font-medium text-muted-foreground">Action: {item.action}</div>}
                        </div>
                      </div>
                      <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CommitLine({ label, oid }: { label: string; oid: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <GitCommitHorizontal className="h-4 w-4" />
      <span>{label}: </span>
      <code>{oid.slice(0, 10)}</code>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold capitalize">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
