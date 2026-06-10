import { useEffect, useMemo, useState } from 'react';
import { Code2, FolderOpen, Link2, RefreshCw } from 'lucide-react';

export function SourceCode({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [sourceProjects, setSourceProjects] = useState<AiddSourceCodeProject[]>([]);
  const [components, setComponents] = useState<AiddComponentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!activeProject?.path) return;
    const [projects, setup] = await Promise.all([
      window.aidd.readSourceProjects(activeProject.path),
      window.aidd.readProjectSetup(activeProject.path)
    ]);
    setSourceProjects(projects);
    setComponents(setup.components);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.path]);

  const addSourceProject = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const created = await window.aidd.addSourceProject(activeProject.path);
      if (created) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const projectUsage = useMemo(() => {
    const usage = new Map<string, AiddComponentSummary[]>();
    for (const component of components) {
      for (const projectId of component.sourceProjects ?? []) {
        const list = usage.get(projectId) ?? [];
        list.push(component);
        usage.set(projectId, list);
      }
    }
    return usage;
  }, [components]);

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open a project first.</p></section></main>;
  }

  return (
    <main className="screenStack">
      <section className="flatPageHeader">
        <div>
          <p className="eyebrow">Source code projects</p>
          <h1>Reference implementation code</h1>
          <p className="muted largeText">Add one or more local source projects, then map them to components. AIDD stores references only; it does not copy source code into the AIDD project.</p>
        </div>
        <div className="heroActions">
          <button className="secondaryButton" onClick={load}><RefreshCw size={16} /> Refresh</button>
          <button className="primaryButton" onClick={addSourceProject} disabled={saving}><FolderOpen size={16} /> {saving ? 'Selecting...' : 'Add Source Project'}</button>
        </div>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Source project error:</strong> {error}</section>}

      <section className="statsGrid compactMetrics">
        <div className="statCard"><strong>{sourceProjects.length}</strong><span>Source projects</span></div>
        <div className="statCard"><strong>{components.filter((component) => (component.sourceProjects ?? []).length > 0).length}</strong><span>Mapped components</span></div>
        <div className="statCard"><strong>{components.filter((component) => (component.sourceProjects ?? []).length === 0).length}</strong><span>Unmapped components</span></div>
      </section>

      <section className="panel desktopPanel">
        <div className="sectionTitleIcon"><Code2 size={18} /><h2>Source project catalogue</h2></div>
        {sourceProjects.length ? (
          <div className="sourceProjectList">
            {sourceProjects.map((project) => {
              const mappedComponents = projectUsage.get(project.id) ?? [];
              return (
                <article className="sourceProjectCard" key={project.id}>
                  <div className="sourceProjectHeader">
                    <div>
                      <h3>{project.name}</h3>
                      <p className="muted">{project.path}</p>
                    </div>
                    <span className="softPill">{project.detectedType}</span>
                  </div>
                  <div className="sourceReferenceGrid compactSourceGrid">
                    <div><span className="muted">Indicators</span><strong>{project.indicators.length ? project.indicators.join(', ') : 'No strong indicators found'}</strong></div>
                    <div><span className="muted">Last checked</span><strong>{new Date(project.updatedAt).toLocaleString()}</strong></div>
                  </div>
                  <div className="mappedComponentsBlock">
                    <p className="muted"><Link2 size={14} /> Components mapped to this source project</p>
                    {mappedComponents.length ? (
                      <div className="componentPicker compact">
                        {mappedComponents.map((component) => <span key={component.slug} className="softPill">{component.title}</span>)}
                      </div>
                    ) : <p className="muted">No components mapped yet. Open a component and select this source project.</p>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="emptyState compactEmpty">
            <Code2 size={36} />
            <h2>No source projects yet</h2>
            <p>Add source directories such as an app, plugin, library, service, Unreal project, package, or tool. Components can then be mapped to one or more source projects.</p>
            <button className="primaryButton" onClick={addSourceProject}><FolderOpen size={16} /> Add Source Project</button>
          </div>
        )}
      </section>
    </main>
  );
}
