import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, GitBranch, PackageCheck, Puzzle, ShieldCheck, Sparkles } from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';
import type { Screen } from '../main';

interface HomeProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string, target?: Screen) => void;
  onCreatePackage: () => void;
  activeProject?: AiddTrackedProject | null;
  onOpenSetup: () => void;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
}

function fallbackStatus(activeProject?: AiddTrackedProject | null): AiddProjectStatus {
  return {
    status: 'setting-up',
    label: 'Setting up',
    completed: activeProject ? 1 : 0,
    total: 6,
    templateVersion: activeProject?.templateVersion ?? 'unknown',
    gitInitialized: false,
    componentCount: 0,
    capabilityCount: 0,
    bundleCount: 0,
    nextAction: 'Open or create an AIDD project.',
    foundation: [
      { id: 'product', label: 'Product definition', complete: false, detail: 'Defines what the system is, who it serves, and what future delivery packages inherit.' },
      { id: 'audience', label: 'Audience & users', complete: false, detail: 'Identifies who the product is for and what outcomes matter.' }
    ],
    setup: [
      { id: 'foundation-complete', label: 'Foundation complete', complete: false, detail: 'Product definition and audience context are complete.' },
      { id: 'standards', label: 'Standards defined', complete: false, detail: 'Project standards are complete.' },
      { id: 'capability', label: 'First capability created', complete: false, detail: 'Create a capability that describes what the system can do.' },
      { id: 'component', label: 'First component created', complete: false, detail: 'Create a component that supports one or more capabilities.' }
    ]
  };
}

function setupActionLabel(id: string) {
  if (id === 'foundation-complete' || id === 'standards') return 'Fix in Foundation';
  if (id === 'capability') return 'Open Capabilities';
  if (id === 'component') return 'Open Components';
  return 'Open';
}

export function Home({ packages, selectedId, onSelectPackage, onCreatePackage, activeProject, onOpenSetup, onOpenCapabilities, onOpenComponents }: HomeProps) {
  const [projectStatus, setProjectStatus] = useState<AiddProjectStatus>(() => fallbackStatus(activeProject));
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeProject?.path) {
      setProjectStatus(fallbackStatus(activeProject));
      return;
    }
    window.aidd.readProjectStatus(activeProject.path)
      .then((status) => {
        if (!cancelled) {
          setProjectStatus(status);
          setStatusError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProjectStatus(fallbackStatus(activeProject));
          setStatusError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { cancelled = true; };
  }, [activeProject]);

  const needsReview = packages.filter((item) => item.status === 'needs-review').length;
  const approved = packages.filter((item) => item.status === 'approved-for-ai').length;
  const needsVerification = packages.filter((item) => item.status === 'in-ai-execution' || item.status === 'needs-verification').length;
  const blocked = packages.filter((item) => !checkReadiness(item).readyForReview).length;

  const visibleSetup = useMemo(
    () => projectStatus.setup.filter((item) => item.id !== 'foundation' && item.id !== 'git' && item.id !== 'package'),
    [projectStatus.setup]
  );
  const blockers = visibleSetup.filter((item) => !item.complete && (item.id === 'foundation-complete' || item.id === 'standards'));
  const nextSteps = visibleSetup.filter((item) => !item.complete && item.id !== 'foundation-complete' && item.id !== 'standards');
  const completeItems = visibleSetup.filter((item) => item.complete).length;
  const readinessProgress = visibleSetup.length ? Math.round((completeItems / visibleSetup.length) * 100) : 0;
  const canCreateDeliveryPackage = blockers.length === 0;

  const openSetupItem = (id: string) => {
    if (id === 'foundation-complete' || id === 'standards') onOpenSetup();
    else if (id === 'capability') onOpenCapabilities();
    else if (id === 'component') onOpenComponents();
  };

  const createDeliveryPackage = () => {
    if (!canCreateDeliveryPackage) return;
    onCreatePackage();
  };

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Project Home</p>
          <h1>{activeProject?.name ?? 'AIDD Project'}</h1>
          <p className="muted">Track project readiness, define capabilities and components, then create delivery packages when Product Definition, Audience, and Standards are complete.</p>
        </div>
        <div className="buttonGroup">
          <button className="secondaryButton" onClick={onOpenSetup}>Open Foundation</button>
          <button className="primaryButton" onClick={createDeliveryPackage} disabled={!canCreateDeliveryPackage} title={canCreateDeliveryPackage ? 'Create a delivery package' : 'Complete Foundation and Standards first'}>New Delivery Package</button>
        </div>
      </header>

      <section className="projectStatusHero readinessHero">
        <div>
          <p className="eyebrow">Project readiness</p>
          <h2>{blockers.length === 0 ? 'Ready for delivery planning' : 'Foundation needs attention'}</h2>
          <p className="muted">{blockers.length === 0 ? 'Foundation and Standards are complete. You can now create delivery packages from capabilities.' : 'Complete the blocker items before creating delivery packages.'}</p>
          {statusError && <p className="dangerText">Could not read full project status: {statusError}</p>}
        </div>
        <div className="statusProgress">
          <strong>{completeItems}/{visibleSetup.length}</strong>
          <span>readiness checks complete</span>
          <div className="progressTrack"><div style={{ width: `${readinessProgress}%` }} /></div>
        </div>
      </section>

      <section className="panel homeReadinessPanel">
        <div className="panelTitleRow">
          <div>
            <h2>Foundation checklist</h2>
            <p className="muted">Only incomplete blockers are highlighted. Use the action button to jump straight to the screen that fixes the issue.</p>
          </div>
          <span className={`pill ${blockers.length === 0 ? 'active' : 'needs-attention'}`}>{blockers.length === 0 ? 'Ready' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}</span>
        </div>

        <div className="homeIssueList">
          {blockers.map((item) => (
            <button key={item.id} className="homeIssueRow blocker" onClick={() => openSetupItem(item.id)}>
              <AlertTriangle size={18} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <em>{setupActionLabel(item.id)}</em>
            </button>
          ))}

          {blockers.length === 0 && visibleSetup.filter((item) => item.complete).map((item) => (
            <div key={item.id} className="homeIssueRow complete">
              <CheckCircle2 size={18} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            </div>
          ))}

          {blockers.length === 0 && nextSteps.map((item) => (
            <button key={item.id} className="homeIssueRow next" onClick={() => openSetupItem(item.id)}>
              <Circle size={18} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <em>{setupActionLabel(item.id)}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="homeActionGrid">
        <article className="modelCard primaryModelCard">
          <div className="modelIcon"><Sparkles size={22} /></div>
          <div>
            <h2>Define what your system can do</h2>
            <p>Create capabilities to describe outcomes, behaviours, or features your system needs to support.</p>
            <button className="primaryButton" onClick={onOpenCapabilities}>New Capability</button>
          </div>
        </article>
        <article className="modelCard">
          <div className="modelIcon"><Puzzle size={22} /></div>
          <div>
            <h2>Map the parts of your system</h2>
            <p>Create components for apps, services, plugins, modules, libraries, workflows, integrations, or subsystems.</p>
            <button className="secondaryButton" onClick={onOpenComponents}>New Component</button>
          </div>
        </article>
      </section>

      <section className="statsGrid">
        <div className="statCard"><strong>{projectStatus.templateVersion}</strong><span>template version</span></div>
        <div className="statCard"><strong>{projectStatus.gitInitialized ? 'Enabled' : 'Missing'}</strong><span>Git versioning</span></div>
        <div className="statCard"><strong>{projectStatus.capabilityCount}</strong><span>capabilities</span></div>
        <div className="statCard"><strong>{projectStatus.componentCount}</strong><span>components</span></div>
      </section>

      <section className="workflowStrip">
        <div><Sparkles size={18} /><strong>Describe</strong><span>Capabilities and components</span></div>
        <div><ShieldCheck size={18} /><strong>Review</strong><span>Human gates and decision records</span></div>
        <div><PackageCheck size={18} /><strong>Package</strong><span>Delivery packages for AI execution</span></div>
        <div><GitBranch size={18} /><strong>Verify</strong><span>Review AI output and accept changes</span></div>
      </section>

      <section className="statsGrid">
        <div className="statCard"><strong>{packages.length}</strong><span>delivery packages</span></div>
        <div className="statCard"><strong>{needsReview}</strong><span>need review</span></div>
        <div className="statCard"><strong>{approved}</strong><span>approved for AI</span></div>
        <div className="statCard"><strong>{needsVerification}</strong><span>need verification</span></div>
      </section>

      {blocked > 0 && <div className="warningBanner">{blocked} delivery package{blocked === 1 ? '' : 's'} need readiness work before review.</div>}

      <section className="panel">
        <h2>Active delivery packages</h2>
        <div className="bundleList">
          {packages.map((item) => {
            const readiness = checkReadiness(item);
            return (
              <button key={item.id} className={item.id === selectedId ? 'bundleRow selected' : 'bundleRow'} onClick={() => onSelectPackage(item.id)}>
                <div>
                  <strong>{item.id} · {item.title}</strong>
                  <span>{item.workstream} / {item.capability}</span>
                </div>
                <div className="rowMeta">
                  <span className={`pill ${item.status}`}>{item.status.replace(/-/g, ' ')}</span>
                  <span>{readiness.score}% ready</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
