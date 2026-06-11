import { useEffect, useMemo, useState } from 'react';
import { Code2, FolderOpen, Link2, RefreshCw } from 'lucide-react';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

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
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
            <CardDescription>Create or open a project first.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 text-card-foreground shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Source code projects</p>
          <h1 className="text-2xl font-semibold tracking-tight">Reference implementation code</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Add one or more local source projects, then map them to components. AIDD stores references only; it does not copy source code into the AIDD project.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={load}><RefreshCw size={16} /> Refresh</Button>
          <Button onClick={addSourceProject} disabled={saving}><FolderOpen size={16} /> {saving ? 'Selecting...' : 'Add Source Project'}</Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><strong>Source project error:</strong> {error}</Alert>}

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-5"><strong className="text-2xl">{sourceProjects.length}</strong><p className="text-sm text-muted-foreground">Source projects</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{components.filter((component) => (component.sourceProjects ?? []).length > 0).length}</strong><p className="text-sm text-muted-foreground">Mapped components</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{components.filter((component) => (component.sourceProjects ?? []).length === 0).length}</strong><p className="text-sm text-muted-foreground">Unmapped components</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Code2 size={18} /><CardTitle>Source project catalogue</CardTitle></div>
          <CardDescription>These are local source directories that components can reference during delivery planning and AI review.</CardDescription>
        </CardHeader>
        <CardContent>
          {sourceProjects.length ? (
            <div className="grid gap-4">
              {sourceProjects.map((project) => {
                const mappedComponents = projectUsage.get(project.id) ?? [];
                return (
                  <Card key={project.id} className="bg-background">
                    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{project.name}</CardTitle>
                        <CardDescription className="break-all">{project.path}</CardDescription>
                      </div>
                      <Badge variant="outline" className="shrink-0">{project.detectedType}</Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border bg-card p-3">
                          <p className="text-xs font-medium text-muted-foreground">Indicators</p>
                          <p className="mt-1 text-sm font-semibold">{project.indicators.length ? project.indicators.join(', ') : 'No strong indicators found'}</p>
                        </div>
                        <div className="rounded-lg border bg-card p-3">
                          <p className="text-xs font-medium text-muted-foreground">Last checked</p>
                          <p className="mt-1 text-sm font-semibold">{new Date(project.updatedAt).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border bg-card p-3">
                        <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Link2 size={14} /> Components mapped to this source project</p>
                        {mappedComponents.length ? (
                          <div className="flex flex-wrap gap-2">
                            {mappedComponents.map((component) => <Badge key={component.slug} variant="secondary">{component.title}</Badge>)}
                          </div>
                        ) : <p className="text-sm text-muted-foreground">No components mapped yet. Open a component and select this source project.</p>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
              <Code2 size={36} className="text-muted-foreground" />
              <h2 className="text-lg font-semibold">No source projects yet</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">Add source directories such as an app, plugin, library, service, Unreal project, package, or tool. Components can then be mapped to one or more source projects.</p>
              <Button onClick={addSourceProject}><FolderOpen size={16} /> Add Source Project</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
