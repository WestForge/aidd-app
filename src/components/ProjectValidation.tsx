import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';

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
      <main className="screen">
        <header className="screenHeader compactHeader">
          <div>
            <p className="eyebrow">Validation</p>
            <h1>Project validation</h1>
            <p className="muted">Open or create a project before running validation.</p>
          </div>
        </header>
      </main>
    );
  }

  return (
    <main className="screen">
      <header className="screenHeader compactHeader">
        <div>
          <p className="eyebrow">Validation</p>
          <h1>Project validation</h1>
          <p className="muted">Check the current project structure, Foundation, Standards, capabilities, components, source mappings, and delivery packages.</p>
        </div>
        <div className="headerActions">
          <button className="secondaryButton" onClick={repairProject} disabled={repairing || loading} title="Fix safe project structure issues without deleting project content.">
            <Wrench size={16} />
            {repairing ? 'Fixing...' : 'Fix safe issues'}
          </button>
          <button className="primaryButton" onClick={runValidation} disabled={loading || repairing}>
            <RefreshCw size={16} />
            {loading ? 'Running...' : 'Run validation'}
          </button>
        </div>
      </header>

      <section className={report ? `validationHero ${report.status}` : 'validationHero'}>
        <div>
          <div className="validationHeroTitle"><ShieldCheck size={22} /><h2>{statusCopy.title}</h2></div>
          <p>{statusCopy.detail}</p>
          {report && <span className="muted">Last checked: {new Date(report.generatedAt).toLocaleString()}</span>}
          {error && <p className="dangerText">{error}</p>}
        </div>
        {report && (
          <div className="validationScore">
            <strong>{report.score}%</strong>
            <span>project health</span>
          </div>
        )}
      </section>

      {repairResult && (
        <section className="panel validationRepairResult">
          <div className="validationRepairHeader">
            <Wrench size={18} />
            <div>
              <h2>Repair completed</h2>
              <p>{repairResult.changed ? 'Safe project fixes were applied.' : 'No project changes were required.'}</p>
            </div>
          </div>
          {repairResult.changes.length > 0 && (
            <div>
              <strong>Changes</strong>
              <ul>{repairResult.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            </div>
          )}
          {repairResult.warnings.length > 0 && (
            <div>
              <strong>Warnings</strong>
              <ul>{repairResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {report && (
        <>
          <section className="validationSummaryGrid">
            <div className="statCard"><strong>{report.summary.errors}</strong><span>errors</span></div>
            <div className="statCard"><strong>{report.summary.warnings}</strong><span>warnings</span></div>
            <div className="statCard"><strong>{report.summary.success}</strong><span>passed</span></div>
            <div className="statCard"><strong>{report.canCreateDeliveryPackage ? 'Yes' : 'No'}</strong><span>delivery packages allowed</span></div>
          </section>

          {report.nextActions.length > 0 && (
            <section className="panel validationNextActions">
              <h2>Recommended next actions</h2>
              <ol>
                {report.nextActions.map((action) => <li key={action}>{action}</li>)}
              </ol>
            </section>
          )}

          <section className="validationSections">
            {report.sections.map((section) => {
              const open = openSections[section.id] ?? true;
              const errorCount = section.items.filter((item) => item.severity === 'error').length;
              const warningCount = section.items.filter((item) => item.severity === 'warning').length;
              return (
                <article key={section.id} className="validationSection panel">
                  <button className="validationSectionHeader" onClick={() => setOpenSections((current) => ({ ...current, [section.id]: !open }))}>
                    <div>
                      <h2>{section.title}</h2>
                      <span>{section.items.length} check{section.items.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="validationSectionMeta">
                      {errorCount > 0 && <span className="validationChip error">{errorCount} error{errorCount === 1 ? '' : 's'}</span>}
                      {warningCount > 0 && <span className="validationChip warning">{warningCount} warning{warningCount === 1 ? '' : 's'}</span>}
                      {!errorCount && !warningCount && <span className="validationChip success">OK</span>}
                    </div>
                  </button>

                  {open && (
                    <div className="validationItemList">
                      {section.items.map((item) => {
                        const Icon = severityIcon[item.severity];
                        return (
                          <div key={item.id} className={`validationItem ${item.severity}`}>
                            <Icon size={18} />
                            <div>
                              <div className="validationItemTitle">
                                <strong>{item.title}</strong>
                                <span>{severityLabel(item.severity)}</span>
                              </div>
                              <p>{item.message}</p>
                              {item.path && <code>{item.path}</code>}
                              {item.action && <small>{item.action}</small>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
