import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, FileText, PackagePlus, Plus, Save, Sparkles } from 'lucide-react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';

const statusOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];

type CapabilityView = 'list' | 'new' | 'edit';

type CapabilitySection = {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  prompt?: string;
};

const capabilityTemplateSections: CapabilitySection[] = [
  { key: 'outcomes', fileName: '01-outcomes.md', title: 'Outcomes', body: '', prompt: 'Describe what this capability should make possible.' },
  { key: 'scope', fileName: '02-scope.md', title: 'Scope', body: '', prompt: 'Define what is in scope and out of scope.' },
  { key: 'user-journeys', fileName: '03-user-journeys.md', title: 'User Journeys', body: '', prompt: 'Describe the journeys or workflows this capability supports.' },
  { key: 'functional-requirements', fileName: '04-functional-requirements.md', title: 'Functional Requirements', body: '', prompt: 'List the required behaviours and functions.' },
  { key: 'non-functional-requirements', fileName: '05-non-functional-requirements.md', title: 'Non-Functional Requirements', body: '', prompt: 'List quality attributes, constraints, performance, reliability, security, or accessibility needs.' },
  { key: 'data-model', fileName: '06-data-model.md', title: 'Data Model', body: '', prompt: 'Describe important data, records, state, and identifiers.' },
  { key: 'integrations', fileName: '07-integrations.md', title: 'Integrations', body: '', prompt: 'Describe systems, services, components, or workflows this capability integrates with.' },
  { key: 'architecture', fileName: '08-architecture.md', title: 'Architecture', body: '', prompt: 'Describe the expected architectural shape or constraints.' },
  { key: 'ux-ui', fileName: '09-ux-ui.md', title: 'UX/UI', body: '', prompt: 'Describe user-facing screens, feedback, inspection tools, or UX expectations.' },
  { key: 'risks', fileName: '10-risks.md', title: 'Risks', body: '', prompt: 'Capture risks, unknowns, edge cases, and failure modes.' },
  { key: 'validation', fileName: '11-validation.md', title: 'Validation', body: '', prompt: 'Describe how this capability should be verified.' }
];

function statusLabel(status?: string) {
  return (status ?? 'draft').replace(/-/g, ' ');
}

function statusClass(status?: string) {
  return `softPill status-${status ?? 'draft'}`;
}

function newSections() {
  return capabilityTemplateSections.map((section) => ({ ...section, body: '', status: 'not-started' as AiddSetupStatus }));
}

function sectionProgress(sections: CapabilitySection[]) {
  const completed = sections.filter((section) => section.body.trim() || section.status === 'complete').length;
  return { completed, total: sections.length };
}

export function Capabilities({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [view, setView] = useState<CapabilityView>('list');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<AiddSetupStatus>('draft');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [inlineComponentTitle, setInlineComponentTitle] = useState('');
  const [inlineComponentDescription, setInlineComponentDescription] = useState('');
  const [sections, setSections] = useState<CapabilitySection[]>(newSections());
  const [activeSectionKey, setActiveSectionKey] = useState('outcomes');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeProject?.path) return;
    setSetup(await window.aidd.readProjectSetup(activeProject.path));
  };

  useEffect(() => { load().catch((err) => setError(String(err))); }, [activeProject?.path]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capability of setup?.capabilities ?? []) counts.set(capability.status ?? 'draft', (counts.get(capability.status ?? 'draft') ?? 0) + 1);
    return counts;
  }, [setup?.capabilities]);

  const foundationBlockers = useMemo(() => {
    if (!setup) return ['Load the project foundation before creating delivery packages.'];
    const blockers = setup.foundation
      .filter((doc) => doc.required !== false && doc.status !== 'complete')
      .map((doc) => `${doc.title} is ${statusLabel(doc.status)}`);
    if (setup.standards.status !== 'complete') blockers.push(`Project Standards are ${statusLabel(setup.standards.status)}`);
    return blockers;
  }, [setup]);

  const foundationReady = foundationBlockers.length === 0;
  const progress = sectionProgress(sections);
  const activeSection = sections.find((section) => section.key === activeSectionKey) ?? sections[0];

  const resetForm = () => {
    setTitle('');
    setStatus('draft');
    setSelectedComponents([]);
    setInlineComponentTitle('');
    setInlineComponentDescription('');
    setSelectedSlug(null);
    setSections(newSections());
    setActiveSectionKey('outcomes');
    setMessage(null);
  };

  const openNew = () => {
    resetForm();
    setView('new');
  };

  const openCapability = async (slug: string) => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await window.aidd.readCapability({ projectPath: activeProject.path, slug });
      setSelectedSlug(detail.slug);
      setTitle(detail.title);
      setStatus((detail.status as AiddSetupStatus) || 'draft');
      setSelectedComponents(detail.components || []);
      setInlineComponentTitle('');
      setInlineComponentDescription('');
      setSections(detail.sections?.length ? detail.sections : newSections());
      setActiveSectionKey(detail.sections?.[0]?.key || 'outcomes');
      setView('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleComponent = (slug: string) => {
    setSelectedComponents((current) => current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]);
  };

  const updateActiveSectionBody = (body: string) => {
    setSections((current) => current.map((section) => section.key === activeSectionKey ? { ...section, body, status: body.trim() ? section.status === 'not-started' ? 'draft' : section.status : section.status } : section));
  };

  const updateActiveSectionStatus = (nextStatus: AiddSetupStatus) => {
    setSections((current) => current.map((section) => section.key === activeSectionKey ? { ...section, status: nextStatus } : section));
  };

  const createCapability = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createCapability({
        projectPath: activeProject.path,
        title,
        componentSlugs: selectedComponents,
        inlineComponent: inlineComponentTitle.trim() ? { title: inlineComponentTitle, description: inlineComponentDescription } : undefined,
        status,
        sections
      });
      setSetup(next);
      resetForm();
      setView('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveCapability = async () => {
    if (!activeProject?.path || !selectedSlug) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: selectedSlug,
        title,
        componentSlugs: selectedComponents,
        status,
        sections
      });
      setSetup(next);
      setMessage('Capability saved. Template section files were updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createDeliveryPackage = async () => {
    if (!activeProject?.path || !selectedSlug) return;
    if (!foundationReady) {
      setError(`Project Foundation must be complete before creating a delivery package. Missing: ${foundationBlockers.join('; ')}`);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.aidd.createDeliveryPackageFromCapability({ projectPath: activeProject.path, capabilitySlug: selectedSlug });
      await load();
      setMessage(`Created delivery package ${result.id}. Snapshot and implementation strategy files are ready for refinement.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open a project first.</p></section></main>;
  }

  const isEditing = view === 'edit';

  return (
    <main className="screenStack">
      <section className="flatPageHeader">
        <div>
          <p className="eyebrow">Capabilities</p>
          <h1>Define what your system can do</h1>
          <p className="muted largeText">Capabilities are managed through a template-backed editor. Each ribbon tab writes to a separate Markdown file.</p>
        </div>
        <div className="heroActions">
          <button className="secondaryButton" onClick={load}>Refresh</button>
          {view === 'list'
            ? <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Capability</button>
            : <button className="secondaryButton" onClick={() => { resetForm(); setView('list'); }}><ArrowLeft size={16} /> Back to list</button>}
        </div>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Error:</strong> {error}</section>}
      {message && <section className="noticeCard successNotice"><strong>Done:</strong> {message}</section>}

      {view === 'list' && (
        <>
          <section className="statsGrid compactMetrics">
            <div className="statCard"><strong>{setup?.capabilities.length ?? 0}</strong><span>Total capabilities</span></div>
            <div className="statCard"><strong>{statusCounts.get('draft') ?? 0}</strong><span>Draft</span></div>
            <div className="statCard"><strong>{statusCounts.get('in-review') ?? 0}</strong><span>In review</span></div>
            <div className="statCard"><strong>{statusCounts.get('active') ?? 0}</strong><span>Active</span></div>
          </section>

          <section className="panel desktopPanel">
            <div className="panelTitleRow">
              <div>
                <h2>Capability catalogue</h2>
                <p className="muted">Click a capability to open the ribbon editor.</p>
              </div>
              <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Capability</button>
            </div>

            <div className="capabilityGrid">
              {setup?.capabilities.map((capability) => {
                const complete = capability.status === 'complete' || capability.status === 'active';
                const Icon = complete ? CheckCircle2 : Circle;
                return (
                  <button key={capability.slug} className="capabilityCard clickableCapability" onClick={() => openCapability(capability.slug)}>
                    <div className="capabilityCardHeader">
                      <Icon size={20} />
                      <span className={statusClass(capability.status)}>{statusLabel(capability.status)}</span>
                    </div>
                    <h3>{capability.title}</h3>
                    <p className="muted">{capability.components?.length ? `${capability.components.length} component(s) linked` : 'No components linked yet'}</p>
                    {capability.components?.length ? <div className="componentPicker compact">{capability.components.map((component) => <span key={component} className="softPill">{component}</span>)}</div> : null}
                    <span className="cardActionHint"><FileText size={14} /> Open ribbon editor</span>
                  </button>
                );
              })}
              {setup && setup.capabilities.length === 0 && (
                <div className="emptyState compactEmpty">
                  <Sparkles size={36} />
                  <h2>No capabilities yet</h2>
                  <p>Create the first capability by describing what the system should make possible. You can link components now or create them inline.</p>
                  <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Capability</button>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {view !== 'list' && (
        <section className="capabilityRibbonShell">
          <div className="capabilityRibbonTop">
            <div className="ribbonMetaBlock">
              <label className="fieldLabel">Capability name</label>
              <input className="textInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Runtime save system" />
            </div>
            <div className="ribbonMetaBlock compactMeta">
              <label className="fieldLabel">Lifecycle</label>
              <select className="textInput" value={status} onChange={(event) => setStatus(event.target.value as AiddSetupStatus)}>{statusOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select>
            </div>
            <div className="ribbonMetaBlock progressMeta">
              <span className="eyebrow">Template progress</span>
              <strong>{progress.completed}/{progress.total}</strong>
              <span className="muted">sections started</span>
            </div>
            <div className="ribbonActionBlock">
              {isEditing && <button className="secondaryButton" onClick={createDeliveryPackage} disabled={saving || !foundationReady}><PackagePlus size={16} /> Create Delivery Package</button>}
              {isEditing
                ? <button className="primaryButton" onClick={saveCapability} disabled={saving || !title.trim()}><Save size={16} />{saving ? 'Saving...' : 'Save Capability'}</button>
                : <button className="primaryButton" onClick={createCapability} disabled={saving || !title.trim()}><Plus size={16} />{saving ? 'Creating...' : 'Create Capability'}</button>}
            </div>
          </div>

          <div className="capabilityRibbonTabs" role="tablist" aria-label="Capability sections">
            {sections.map((section) => (
              <button key={section.key} className={section.key === activeSectionKey ? 'active' : ''} onClick={() => setActiveSectionKey(section.key)}>
                <span>{section.title}</span>
                <small>{section.fileName}</small>
              </button>
            ))}
          </div>

          <section className="panel desktopPanel capabilitySectionEditor">
            <div className="panelTitleRow">
              <div>
                <p className="eyebrow">{activeSection?.fileName}</p>
                <h2>{activeSection?.title}</h2>
                <p className="muted">{activeSection?.prompt}</p>
              </div>
              <div className="sectionStatusControl">
                <label className="fieldLabel">Section status</label>
                <select className="textInput" value={(activeSection?.status as AiddSetupStatus) || 'not-started'} onChange={(event) => updateActiveSectionStatus(event.target.value as AiddSetupStatus)}>
                  {statusOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
                </select>
              </div>
            </div>
            <AiddMarkdownEditor value={activeSection?.body || ''} onChange={updateActiveSectionBody} minHeight={360} />
          </section>

          <section className="panel desktopPanel capabilitySidePanel">
            <div>
              <h2>Components touched</h2>
              <p className="muted">Link the system parts involved in this capability.</p>
            </div>
            <div className="componentPicker">
              {setup?.components.map((component) => (
                <button key={component.slug} className={selectedComponents.includes(component.slug) ? 'softPill selectedPill' : 'softPill'} onClick={() => toggleComponent(component.slug)}>{component.title}</button>
              ))}
              {setup && setup.components.length === 0 && <span className="muted">No components yet. Create one inline below.</span>}
            </div>
            {!isEditing && <div className="inlineCreateBox">
              <strong>Create new component inline</strong>
              <p className="muted">Use this when the capability touches a part of the system that has not been mapped yet.</p>
              <label className="fieldLabel">Component name</label>
              <input className="textInput" value={inlineComponentTitle} onChange={(event) => setInlineComponentTitle(event.target.value)} placeholder="Music Engine" />
              <label className="fieldLabel">Component description</label>
              <textarea className="textArea" value={inlineComponentDescription} onChange={(event) => setInlineComponentDescription(event.target.value)} />
            </div>}
            {status === 'deprecated' && <div className="noticeCard warningNotice"><strong>Deprecated:</strong> This capability should not be used for new delivery packages unless the package is specifically about migration or removal.</div>}
            {isEditing && !foundationReady && (
              <div className="noticeCard warningNotice compactNotice">
                <strong>Delivery package locked</strong>
                <p>Complete Foundation and Standards before creating a delivery package. These documents are included in every package snapshot.</p>
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}
