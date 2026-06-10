import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, FileText, PackagePlus, Plus, Save, Sparkles } from 'lucide-react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';

const statusOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];

type CapabilityView = 'list' | 'new' | 'edit';

function statusLabel(status?: string) {
  return (status ?? 'draft').replace(/-/g, ' ');
}

function statusClass(status?: string) {
  return `softPill status-${status ?? 'draft'}`;
}

export function Capabilities({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [view, setView] = useState<CapabilityView>('list');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<AiddSetupStatus>('draft');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [inlineComponentTitle, setInlineComponentTitle] = useState('');
  const [inlineComponentDescription, setInlineComponentDescription] = useState('');
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

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setOutcome('');
    setNotes('');
    setStatus('draft');
    setSelectedComponents([]);
    setInlineComponentTitle('');
    setInlineComponentDescription('');
    setSelectedSlug(null);
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
      setDescription(detail.description || '');
      setOutcome(detail.outcome || '');
      setNotes(detail.notes || '');
      setStatus((detail.status as AiddSetupStatus) || 'draft');
      setSelectedComponents(detail.components || []);
      setInlineComponentTitle('');
      setInlineComponentDescription('');
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

  const createCapability = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createCapability({
        projectPath: activeProject.path,
        title,
        description,
        outcome,
        notes,
        componentSlugs: selectedComponents,
        inlineComponent: inlineComponentTitle.trim() ? { title: inlineComponentTitle, description: inlineComponentDescription } : undefined,
        status
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
        description,
        outcome,
        notes,
        componentSlugs: selectedComponents,
        status
      });
      setSetup(next);
      setMessage('Capability saved.');
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
          <p className="muted largeText">Capabilities describe outcomes, behaviours, or features. Click a capability to edit it, or turn it into a delivery package when it is ready.</p>
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
                <p className="muted">Each capability is stored as Markdown with workflow status in frontmatter.</p>
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
                    <span className="cardActionHint"><FileText size={14} /> Open and edit</span>
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
        <section className="guidedEditorGrid">
          <div className="panel guidedStepsPanel">
            <p className="eyebrow">{isEditing ? 'Capability lifecycle' : 'Guided definition'}</p>
            <h2>{isEditing ? 'Edit Capability' : 'New Capability'}</h2>
            <ol className="setupGuideList">
              <li className={title.trim() ? 'complete' : ''}><strong>Name it</strong><span>Use a clear outcome or behaviour name.</span></li>
              <li className={description.trim() ? 'complete' : ''}><strong>Describe it</strong><span>Explain the user or system value.</span></li>
              <li className={outcome.trim() ? 'complete' : ''}><strong>Define the outcome</strong><span>Say what this makes possible.</span></li>
              <li className={selectedComponents.length || inlineComponentTitle.trim() ? 'complete' : ''}><strong>Link components</strong><span>Select existing parts or create one inline.</span></li>
            </ol>
            {isEditing && !foundationReady && (
              <div className="noticeCard warningNotice compactNotice">
                <strong>Delivery package locked</strong>
                <p>Complete Foundation and Standards before creating a delivery package. These documents are included in every package snapshot.</p>
              </div>
            )}
            {isEditing && <button className="primaryButton fullWidthAction" onClick={createDeliveryPackage} disabled={saving || !foundationReady}><PackagePlus size={16} /> Create Delivery Package</button>}
          </div>

          <div className="panel desktopPanel">
            <div className="sectionTitleIcon"><Sparkles size={18} /><h2>Capability details</h2></div>
            <label className="fieldLabel">Capability name</label>
            <input className="textInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Runtime save system" />
            <AiddMarkdownEditor label="Description" hint="Describe the behaviour, outcome, or feature in product language." value={description} onChange={setDescription} minHeight={220} />
            <AiddMarkdownEditor label="Outcome" hint="What should this capability make possible?" value={outcome} onChange={setOutcome} minHeight={200} />
            <label className="fieldLabel">Components touched</label>
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
            <AiddMarkdownEditor label="Notes" hint="Optional notes, constraints, open questions, or review context." value={notes} onChange={setNotes} minHeight={180} />
            <label className="fieldLabel">Status</label>
            <select className="textInput" value={status} onChange={(event) => setStatus(event.target.value as AiddSetupStatus)}>{statusOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select>
            {status === 'deprecated' && <div className="noticeCard warningNotice"><strong>Deprecated:</strong> This capability should not be used for new delivery packages unless the package is specifically about migration or removal.</div>}
            <div className="buttonGroup left">
              {isEditing
                ? <button className="primaryButton" onClick={saveCapability} disabled={saving || !title.trim()}><Save size={16} />{saving ? 'Saving...' : 'Save Capability'}</button>
                : <button className="primaryButton" onClick={createCapability} disabled={saving || !title.trim()}><Plus size={16} />{saving ? 'Creating...' : 'Create Capability'}</button>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
