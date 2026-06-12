import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, GitCommitHorizontal, RefreshCw, Wrench } from 'lucide-react';
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

export function ProjectValidation({ activeProject, onProjectChanged }: { activeProject?: AiddTrackedProject | null; onProjectChanged?: () => Promise<void> | void }) {
  const [report, setReport] = useState<AiddProjectValidationReport | null>(null);
  const [repair, setRepair] = useState<AiddProjectRepairReport | null>(null);
  const [upgrade, setUpgrade] = useState<AiddProjectTemplateUpgradeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repairLogs = [...(repair?.logs ?? []), ...(upgrade?.logs ?? [])];
  const repairLogPaths = [repair?.logPath, upgrade?.logPath].filter((value): value is string => Boolean(value));

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

  async function repairIssues() {
    if (!activeProject?.path) return;
    setBusy(true);
    setError(null);
    setRepair(null);
    setUpgrade(null);

    try {
      const repairResult = await window.aidd.repairProject(activeProject.path);
      setRepair(repairResult);

      const upgradeResult = await window.aidd.upgradeProjectTemplates(activeProject.path);
      setUpgrade(upgradeResult);
      setReport(upgradeResult.validation);
      await onProjectChanged?.();
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
            <CardDescription>Select a project before running the AIDD integrity check.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">AIDD integrity check</h1>
          <p className="text-sm text-muted-foreground">Checks templates, front matter versions, missing files, corrupt JSON, and broken AIDD links. It does not score delivery readiness.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={run} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            Run check
          </Button>
          <Button onClick={repairIssues} disabled={busy}>
            <Wrench className="h-4 w-4" />
            Repair issues
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Integrity check error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {repair && (
          <Alert className="mb-4">
            <AlertTitle>{repair.changed ? 'Data repair applied' : 'No data repair needed'}</AlertTitle>
            <AlertDescription className="space-y-2">
              <div>{repair.changes.length ? repair.changes.join(', ') : 'Required project data already matched safe repair expectations.'}</div>
              {repair.logPath ? <div>Data repair log: <code>{repair.logPath}</code></div> : null}
              {repair.warnings.length ? <div className="text-yellow-700 dark:text-yellow-300">Warnings: {repair.warnings.join(', ')}</div> : null}
            </AlertDescription>
          </Alert>
        )}

        {upgrade && (
          <Alert className="mb-4">
            <AlertTitle>{upgrade.changed ? 'Template repair complete' : 'Templates already current'}</AlertTitle>
            <AlertDescription className="space-y-3">
              <div className="space-y-1">
                {upgrade.preUpgradeCommit ? <CommitLine label="Pre-repair checkpoint" oid={upgrade.preUpgradeCommit} /> : null}
                {upgrade.upgradeCommit ? <CommitLine label="Template repair commit" oid={upgrade.upgradeCommit} /> : null}
                {!upgrade.preUpgradeCommit && !upgrade.upgradeCommit ? <div>No Git commit was created.</div> : null}
              </div>
              {upgrade.changes.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {upgrade.changes.slice(0, 8).map((change) => <li key={change}>{change}</li>)}
                  {upgrade.changes.length > 8 ? <li>{upgrade.changes.length - 8} more change(s).</li> : null}
                </ul>
              ) : <div>No template or front matter changes were needed.</div>}
              {upgrade.logPath ? <div>Template repair log: <code>{upgrade.logPath}</code></div> : null}
              {upgrade.warnings.length ? <div className="text-yellow-700 dark:text-yellow-300">Warnings: {upgrade.warnings.join(', ')}</div> : null}
            </AlertDescription>
          </Alert>
        )}

        {repairLogs.length > 0 && (
          <RepairLogPanel logs={repairLogs} logPaths={repairLogPaths} />
        )}

        {report && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Metric label="Status" value={statusLabel(report.status)} />
              <Metric label="Checked" value={report.summary.total} />
              <Metric label="Errors" value={report.summary.errors} />
              <Metric label="Warnings" value={report.summary.warnings} />
            </div>

            {report.nextActions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Repair actions</CardTitle>
                  <CardDescription>Highest priority integrity fixes from the current report.</CardDescription>
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

function logVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (level === 'error') return 'destructive';
  if (level === 'success') return 'secondary';
  return 'outline';
}

function RepairLogPanel({ logs, logPaths }: { logs: AiddProjectRepairLogEntry[]; logPaths: string[] }) {
  const latest = logs.slice(-25).reverse();

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Repair process log</CardTitle>
        <CardDescription>Shows the exact repair stages run by the app, including template path resolution, file copy attempts, validation, and any write errors.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {logPaths.length ? (
          <div className="text-sm text-muted-foreground">
            Full log file{logPaths.length === 1 ? '' : 's'}: {logPaths.map((logPath) => <code key={logPath} className="mx-1">{logPath}</code>)}
          </div>
        ) : null}
        <div className="space-y-2">
          {latest.map((entry, index) => (
            <div key={`${entry.timestamp}-${entry.stage}-${index}`} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={logVariant(entry.level)}>{entry.level}</Badge>
                <span className="font-medium">{entry.stage}</span>
                <span className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</span>
              </div>
              <div className="mt-2">{entry.message}</div>
              {entry.path ? <code className="mt-1 block break-all text-xs text-muted-foreground">{entry.path}</code> : null}
              {entry.detail ? <div className="mt-1 break-words text-xs text-muted-foreground">{entry.detail}</div> : null}
            </div>
          ))}
        </div>
        {logs.length > latest.length ? <div className="text-xs text-muted-foreground">Showing the latest {latest.length} of {logs.length} log entries. Open the log file for the full trail.</div> : null}
      </CardContent>
    </Card>
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
