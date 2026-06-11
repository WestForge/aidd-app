import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface ProjectValidationProps {
  activeProject?: AiddTrackedProject | null;
}

const severityIcon = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: CircleAlert
} as const;

function severityLabel(severity: AiddProjectValidationItem['severity']) {
  return severity === 'success' ? 'Passed' : severity === 'info' ? 'Info' : severity === 'warning' ? 'Warning' : 'Error';
}

function badgeVariant(status: AiddProjectValidationReport['status']) {
  if (status === 'pass') return 'success' as const;
  if (status === 'warning') return 'warning' as const;
  return 'destructive' as const;
}

function sectionBadge(errorCount: number, warningCount: number) {
  if (errorCount > 0) return <Badge variant="destructive">{errorCount} error{errorCount === 1 ? '' : 's'}</Badge>;
  if (warningCount > 0) return <Badge variant="warning">{warningCount} warning{warningCount === 1 ? '' : 's'}</Badge>;
  return <Badge variant="success">OK</Badge>;
}

function itemSeverityClasses(severity: AiddProjectValidationItem['severity']) {
  if (severity === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  if (severity === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200';
  return 'border-border bg-card text-card-foreground';
}

export function ProjectValidation({ activeProject }: ProjectValidationProps) {
  const [report, setReport] = useState<AiddProjectValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<AiddProjectRepairReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const runValidation = async () => {
    if (!activeProject?.path) return;
    setLoading(true);
    setError(null);
    try {
      const next = await window.aidd.validateProject(activeProject.path);
      setReport(next);
      setOpenSections(Object.fromEntries(next.sections.map((section) => [section.id, true])));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const repairProject = async () => {
    if (!activeProject?.path) return;
    setRepairing(true);
    setError(null);
    try {
      const result = await window.aidd.repairProject(activeProject.path);
      setRepairResult(result);
      setReport(result.validation);
      setOpenSections(Object.fromEntries(result.validation.sections.map((section) => [section.id, true])));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  useEffect(() => {
    if (activeProject?.path) void runValidation();
  }, [activeProject?.path]);

  const statusCopy = useMemo(() => {
    if (!report) return { title: 'Validation not run', detail: 'Run validation to check the current AIDD project.' };
    if (report.status === 'pass') return { title: 'Project validation passed', detail: 'No blocking issues were found.' };
    if (report.status === 'warning') return { title: 'Project has warnings', detail: 'The project can continue, but some areas need attention.' };
    return { title: 'Project has blocking issues', detail: 'Fix errors before creating or approving delivery packages.' };
  }, [report]);

  if (!activeProject) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8 text-foreground">
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Validation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Project validation</h1>
          <p className="mt-2 text-sm text-muted-foreground">Open or create a project before running validation.</p>
        </header>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8 text-foreground">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Validation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Project validation</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Check the current project structure, Foundation, Standards, capabilities, components, source mappings, and delivery packages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={repairProject} disabled={repairing || loading} title="Fix safe project structure issues without deleting project content.">
            <Wrench size={16} />
            {repairing ? 'Fixing...' : 'Fix safe issues'}
          </Button>
          <Button onClick={runValidation} disabled={loading || repairing}>
            <RefreshCw size={16} />
            {loading ? 'Running...' : 'Run validation'}
          </Button>
        </div>
      </header>

      <Card className={report?.status === 'error' ? 'border-destructive/30 bg-destructive/5' : report?.status === 'warning' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}>
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_180px] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <h2 className="text-2xl font-semibold">{statusCopy.title}</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{statusCopy.detail}</p>
            {report && <p className="mt-2 text-xs text-muted-foreground">Last checked: {new Date(report.generatedAt).toLocaleString()}</p>}
            {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
          </div>
          {report && (
            <div className="rounded-lg border bg-background/70 p-4 text-center">
              <strong className="block text-3xl">{report.score}%</strong>
              <span className="text-xs text-muted-foreground">project health</span>
              <div className="mt-3 flex justify-center"><Badge variant={badgeVariant(report.status)}>{report.status}</Badge></div>
            </div>
          )}
        </CardContent>
      </Card>

      {repairResult && (
        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <Wrench className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <CardTitle>Repair completed</CardTitle>
              <CardDescription>{repairResult.changed ? 'Safe project fixes were applied.' : 'No project changes were required.'}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {repairResult.changes.length > 0 && (
              <div>
                <strong className="text-sm">Changes</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{repairResult.changes.map((change) => <li key={change}>{change}</li>)}</ul>
              </div>
            )}
            {repairResult.warnings.length > 0 && (
              <div>
                <strong className="text-sm">Warnings</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{repairResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <Card><CardContent className="p-4"><strong className="block text-xl">{report.summary.errors}</strong><span className="text-xs text-muted-foreground">errors</span></CardContent></Card>
            <Card><CardContent className="p-4"><strong className="block text-xl">{report.summary.warnings}</strong><span className="text-xs text-muted-foreground">warnings</span></CardContent></Card>
            <Card><CardContent className="p-4"><strong className="block text-xl">{report.summary.success}</strong><span className="text-xs text-muted-foreground">passed</span></CardContent></Card>
            <Card><CardContent className="p-4"><strong className="block text-xl">{report.canCreateDeliveryPackage ? 'Yes' : 'No'}</strong><span className="text-xs text-muted-foreground">delivery packages allowed</span></CardContent></Card>
          </section>

          {report.nextActions.length > 0 && (
            <Alert variant={report.status === 'error' ? 'destructive' : 'warning'}>
              <strong className="block text-sm">Recommended next actions</strong>
              <ol className="mt-2 list-decimal space-y-1 pl-5">{report.nextActions.map((action) => <li key={action}>{action}</li>)}</ol>
            </Alert>
          )}

          <section className="space-y-3">
            {report.sections.map((section) => {
              const open = openSections[section.id] ?? true;
              const errorCount = section.items.filter((item) => item.severity === 'error').length;
              const warningCount = section.items.filter((item) => item.severity === 'warning').length;
              return (
                <Card key={section.id}>
                  <button className="flex w-full items-center justify-between gap-4 p-5 text-left" onClick={() => setOpenSections((current) => ({ ...current, [section.id]: !open }))}>
                    <div>
                      <h2 className="text-lg font-semibold">{section.title}</h2>
                      <span className="text-sm text-muted-foreground">{section.items.length} check{section.items.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex items-center gap-2">{sectionBadge(errorCount, warningCount)}</div>
                  </button>

                  {open && (
                    <CardContent className="space-y-2 pt-0">
                      {section.items.map((item) => {
                        const Icon = severityIcon[item.severity];
                        return (
                          <div key={item.id} className={`flex gap-3 rounded-lg border p-3 ${itemSeverityClasses(item.severity)}`}>
                            <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-sm text-foreground">{item.title}</strong>
                                <Badge variant={item.severity === 'error' ? 'destructive' : item.severity === 'warning' ? 'warning' : item.severity === 'success' ? 'success' : 'secondary'}>{severityLabel(item.severity)}</Badge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                              {item.path && <code className="mt-2 block rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">{item.path}</code>}
                              {item.action && <small className="mt-2 block text-xs font-medium text-primary">{item.action}</small>}
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
