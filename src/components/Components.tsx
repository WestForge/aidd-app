import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, Edit3, Plus, Puzzle, RefreshCw, Save } from 'lucide-react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';

const lifecycleOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];

type ComponentView = 'list' | 'new' | 'edit';

function statusLabel(status?: string) {
  return (status ?? 'draft').replace(/-/g, ' ');
}

function statusClass(status?: string) {
  return `softPill status-${status ?? 'draft'}`;
}

export function Components({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [sourceProjects, setSourceProjects] = useState<AiddSourceCodeProject[]>([]);
  const [view, setView] = useState<ComponentView>('list');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<AiddSetupStatus>('draft');
  const [selectedSourceProjects, setSelectedSourceProjects] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingComponent, setLoadingComponent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeProject?.path) return;
    const [nextSetup, nextSourceProjects] = await Promise.all([
      window.aidd.readProjectSetup(activeProject.path),
      window.aidd.readSourceProjects(activeProject.path)
    ]);
    setSetup(nextSetup);
    setSourceProjects(nextSourceProjects);
  };

  useEffect(() => { load().catch((err) => setError(String(err))); }, [activeProject?.path]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const component of setup?.components ?? []) counts.set(component.status ?? 'draft', (counts.get(component.status ?? 'draft') ?? 0) + 1);
    return counts;
  }, [setup?.components]);

  const resetForm = () => {
    setEditingSlug(null);
    setTitle('');
    setDescription('');
    setStatus('draft');
    setSelectedSourceProjects([]);
  };

  const openNew = () => {
    resetForm();
    setView('new');
  };

  const backToList = () => {
    resetForm();
    setView('list');
  };

  const openEdit = async (slug: string) => {
    if (!activeProject?.path) return;
    setLoadingComponent(true);
    setError(null);
    try {
      const component = await window.aidd.readComponent({ projectPath: activeProject.path, slug });
      setEditingSlug(component.slug);
      setTitle(component.title);
      setDescription(component.description || '');
      setStatus((component.status as AiddSetupStatus) || 'draft');
      setSelectedSourceProjects(component.sourceProjects || []);
      setView('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingComponent(false);
    }
  };

  const createComponent = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createComponent({ projectPath: activeProject.path, title, description, status, sourceProjects: selectedSourceProjects });
      setSetup(next);
      backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateComponent = async () => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.updateComponent({ projectPath: activeProject.path, slug: editingSlug, title, description, status, sourceProjects: selectedSourceProjects });
      setSetup(next);
      backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleSourceProject = (projectId: string) => {
    setSelectedSourceProjects((current) => current.includes(projectId)
      ? current.filter((item) => item !== projectId)
      : [...current, projectId]);
  };

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open a project first.</p></section></main>;
  }

  const editorTitle = view === 'edit' ? 'Edit Component' : 'New Component';
  const editorCta = view === 'edit' ? 'Save Component' : 'Create Component';
  const editorAction = view === 'edit' ? updateComponent : createComponent;

  return (
    <main className="screenStack">
      <section className="heroCard">
        <div>
          <p className="eyebrow">Components</p>
          <h1>Map the parts of your system</h1>
          <p className="muted largeText">Components are apps, services, plugins, modules, libraries, data stores, workflows, integrations, tools, or subsystems that help deliver capabilities.</p>
        </div>
        <div className="heroActions">
          <button className="secondaryButton" onClick={load}><RefreshCw size={16} /> Refresh</button>
          {view === 'list'
            ? <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Component</button>
            : <button className="secondaryButton" onClick={backToList}><ArrowLeft size={16} /> Back to components</button>}
        </div>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Error:</strong> {error}</section>}
      {loadingComponent && <section className="noticeCard"><strong>Loading component…</strong></section>}

      {view === 'list' && (
        <>
          <section className="statsGrid compactMetrics">
            <div className="statCard"><strong>{setup?.components.length ?? 0}</strong><span>Total components</span></div>
            <div className="statCard"><strong>{statusCounts.get('draft') ?? 0}</strong><span>Draft</span></div>
            <div className="statCard"><strong>{statusCounts.get('in-review') ?? 0}</strong><span>In review</span></div>
            <div className="statCard"><strong>{statusCounts.get('active') ?? 0}</strong><span>Active</span></div>
            <div className="statCard"><strong>{statusCounts.get('deprecated') ?? 0}</strong><span>Deprecated</span></div>
          </section>

          <section className="panel">
            <div className="panelTitleRow">
              <div>
                <h2>Component catalogue</h2>
                <p className="muted">Click a component to edit it, change its lifecycle status, or mark it as deprecated.</p>
              </div>
              <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Component</button>
            </div>

            <div className="capabilityGrid">
              {setup?.components.map((component) => {
                const healthy = component.status === 'complete' || component.status === 'active';
                const Icon = healthy ? CheckCircle2 : Circle;
                const linkedCapabilities = setup.capabilities.filter((capability) => capability.components?.includes(component.slug));
                return (
                  <button key={component.slug} className="capabilityCard clickableCard" onClick={() => openEdit(component.slug)}>
                    <div className="capabilityCardHeader">
                      <Icon size={20} />
                      <span className={statusClass(component.status)}>{statusLabel(component.status)}</span>
                    </div>
                    <h3>{component.title}</h3>
                    <p className="muted">{linkedCapabilities.length ? `${linkedCapabilities.length} linked capability/capabilities` : 'No capabilities linked yet'}</p>
                    {linkedCapabilities.length ? (
                      <div className="componentPicker compact">
                        {linkedCapabilities.map((capability) => <span key={capability.slug} className="softPill">{capability.title}</span>)}
                      </div>
                    ) : null}
                    <span className="cardActionHint"><Edit3 size={14} /> Edit component</span>
                  </button>
                );
              })}
              {setup && setup.components.length === 0 && (
                <div className="emptyState compactEmpty">
                  <Puzzle size={36} />
                  <h2>No components yet</h2>
                  <p>Create components to represent the apps, plugins, modules, services, libraries, workflows, integrations, or subsystems that make capabilities possible.</p>
                  <button className="primaryButton" onClick={openNew}><Plus size={16} /> New Component</button>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {(view === 'new' || view === 'edit') && (
        <section className="guidedEditorGrid">
          <div className="panel guidedStepsPanel">
            <p className="eyebrow">Component lifecycle</p>
            <h2>{editorTitle}</h2>
            <ol className="setupGuideList">
              <li className={title.trim() ? 'complete' : ''}><strong>Name it</strong><span>Use the name people use when talking about this part of the system.</span></li>
              <li className={description.trim() ? 'complete' : ''}><strong>Describe it</strong><span>Explain what this component is responsible for.</span></li>
              <li className={status !== 'not-started' ? 'complete' : ''}><strong>Manage lifecycle</strong><span>Use Active when this component is current. Use Deprecated when it should no longer be used for new work.</span></li>
            </ol>
          </div>

          <div className="panel">
            <div className="sectionTitleIcon"><Puzzle size={18} /><h2>Component details</h2></div>
            <label className="fieldLabel">Component name</label>
            <input className="textInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Authentication Service" />
            <AiddMarkdownEditor
              label="Description"
              hint="Describe what part of the system this is and what it is responsible for. Visual editing is the default; Markdown is available when needed."
              value={description}
              onChange={setDescription}
              minHeight={260}
            />
            <label className="fieldLabel">Lifecycle status</label>
            <select className="textInput" value={status} onChange={(event) => setStatus(event.target.value as AiddSetupStatus)}>{lifecycleOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select>
            {status === 'deprecated' && (
              <div className="noticeCard warningNotice">
                <strong>Deprecated component.</strong> Keep this component in the project history, but avoid linking it to new capabilities unless there is a clear migration reason.
              </div>
            )}

            <div className="fieldGroup">
              <label className="fieldLabel">Source code projects</label>
              <p className="muted smallText">Map this component to one or more source projects. Add source projects from the Source Code section.</p>
              {sourceProjects.length ? (
                <div className="sourceMappingList">
                  {sourceProjects.map((project) => (
                    <label key={project.id} className="sourceMappingOption">
                      <input
                        type="checkbox"
                        checked={selectedSourceProjects.includes(project.id)}
                        onChange={() => toggleSourceProject(project.id)}
                      />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.detectedType} · {project.path}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="noticeCard">No source projects have been added yet. Use the Source Code section to add implementation directories, then return here to map them to components.</div>
              )}
            </div>

            <div className="buttonGroup left">
              <button className="primaryButton" onClick={editorAction} disabled={saving || !title.trim()}>{view === 'edit' ? <Save size={16} /> : <Plus size={16} />}{saving ? 'Saving...' : editorCta}</button>
              <button className="secondaryButton" onClick={backToList}><ArrowLeft size={16} /> Cancel</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
