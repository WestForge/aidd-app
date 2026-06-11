import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, Edit3, Plus, Puzzle, Save } from 'lucide-react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';

const lifecycleOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'active', 'deprecated', 'complete', 'skipped'];

type ComponentView = 'list' | 'new' | 'edit';

function statusLabel(status?: string) {
  return (status ?? 'draft').replace(/-/g, ' ');
}

function statusVariant(status?: string): 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' {
  if (status === 'active' || status === 'complete') return 'success';
  if (status === 'deprecated') return 'warning';
  if (status === 'in-review') return 'default';
  if (status === 'skipped') return 'outline';
  return 'secondary';
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
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
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
    setSelectedCapabilities([]);
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
      setSelectedCapabilities(component.capabilities || []);
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
      const next = await window.aidd.createComponent({ projectPath: activeProject.path, title, description, status, sourceProjects: selectedSourceProjects, capabilities: selectedCapabilities });
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
      const next = await window.aidd.updateComponent({ projectPath: activeProject.path, slug: editingSlug, title, description, status, sourceProjects: selectedSourceProjects, capabilities: selectedCapabilities });
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

  const toggleCapability = (capabilitySlug: string) => {
    setSelectedCapabilities((current) => current.includes(capabilitySlug)
      ? current.filter((item) => item !== capabilitySlug)
      : [...current, capabilitySlug]);
  };

  if (!activeProject) {
    return (
      <main className="flex h-full min-h-0 w-full flex-col overflow-hidden p-4">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
            <CardDescription>Create or open a project first.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const editorTitle = view === 'edit' ? title || 'Edit Component' : 'New Component';
  const editorCta = view === 'edit' ? 'Save Component' : 'Create Component';
  const editorAction = view === 'edit' ? updateComponent : createComponent;
  const mappedSources = sourceProjects.filter((project) => selectedSourceProjects.includes(project.id));
  const mappedCapabilities = (setup?.capabilities ?? []).filter((capability) => selectedCapabilities.includes(capability.slug));

  if (view === 'new' || view === 'edit') {
    return (
      <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-card px-4 py-3 text-card-foreground">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Components</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">{editorTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={backToList}><ArrowLeft size={16} /> Back</Button>
            <Button onClick={editorAction} disabled={saving || !title.trim()}>{view === 'edit' ? <Save size={16} /> : <Plus size={16} />}{saving ? 'Saving…' : editorCta}</Button>
          </div>
        </header>

        {error && <Alert variant="destructive" className="m-4 shrink-0"><strong>Error:</strong> {error}</Alert>}
        {loadingComponent && <Alert className="m-4 shrink-0"><strong>Loading component…</strong></Alert>}

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
          <div className="flex min-h-0 flex-col gap-4 overflow-hidden p-4">
            <Card className="shrink-0">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Puzzle size={18} /> Component details</CardTitle>
                <CardDescription>Define the system part and keep the Markdown clean underneath.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[minmax(260px,420px)_1fr]">
                <div className="space-y-2">
                  <Label htmlFor="component-name">Component name</Label>
                  <Input id="component-name" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Authentication Service" />
                </div>
                <div className="space-y-2">
                  <Label>Mapped capabilities</Label>
                  <p className="text-sm text-muted-foreground">{mappedCapabilities.length ? mappedCapabilities.map((capability) => capability.title).join(', ') : 'No capabilities mapped yet.'}</p>
                </div>
              </CardContent>
            </Card>

            <div className="min-h-0 flex-1 overflow-hidden">
              <AiddMarkdownEditor
                label="Description"
                hint="Describe what this component is responsible for. The app stores this as clean Markdown in the component template file."
                value={description}
                onChange={setDescription}
                fill
              />
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l bg-muted/30 p-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Component lifecycle</CardTitle>
                <CardDescription>Manage whether this part of the system is current, in progress, or deprecated.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="component-status">Lifecycle status</Label>
                  <Select id="component-status" value={status} onChange={(event) => setStatus(event.target.value as AiddSetupStatus)}>
                    {lifecycleOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
                  </Select>
                </div>
                <Badge variant={statusVariant(status)} className="capitalize">{statusLabel(status)}</Badge>
                {status === 'deprecated' && (
                  <Alert variant="warning">
                    <strong>Deprecated component.</strong> Keep this in project history, but avoid linking it to new capabilities unless there is a migration reason.
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Capability mapping</CardTitle>
                <CardDescription>Link this component to the capabilities it supports.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {setup?.capabilities.length ? (
                  <div className="space-y-2">
                    {setup.capabilities.map((capability) => (
                      <label key={capability.slug} className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 text-sm hover:bg-accent/40">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedCapabilities.includes(capability.slug)}
                          onChange={() => toggleCapability(capability.slug)}
                        />
                        <span className="min-w-0">
                          <strong className="block truncate text-foreground">{capability.title}</strong>
                          <small className="block truncate text-muted-foreground">{statusLabel(capability.status)} capability</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Alert>No capabilities have been created yet. Create capabilities first, then return here to map this component.</Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source code mapping</CardTitle>
                <CardDescription>Map this component to one or more source projects.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sourceProjects.length ? (
                  <div className="space-y-2">
                    {sourceProjects.map((project) => (
                      <label key={project.id} className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 text-sm hover:bg-accent/40">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedSourceProjects.includes(project.id)}
                          onChange={() => toggleSourceProject(project.id)}
                        />
                        <span className="min-w-0">
                          <strong className="block truncate text-foreground">{project.name}</strong>
                          <small className="block truncate text-muted-foreground">{project.detectedType} · {project.path}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Alert>No source projects have been added yet. Use Source Code to add implementation directories.</Alert>
                )}
              </CardContent>
            </Card>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background p-4">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Components</p>
          <h1 className="text-2xl font-semibold tracking-tight">Map the parts of your system</h1>
          <p className="mt-1 max-w-4xl text-sm text-muted-foreground">Components are apps, services, plugins, modules, libraries, data stores, workflows, integrations, tools, or subsystems that help deliver capabilities.</p>
        </div>
        <Button onClick={openNew}><Plus size={16} /> New Component</Button>
      </div>

      {error && <Alert variant="destructive" className="mb-4 shrink-0"><strong>Error:</strong> {error}</Alert>}
      {loadingComponent && <Alert className="mb-4 shrink-0"><strong>Loading component…</strong></Alert>}

      <div className="mb-4 grid shrink-0 gap-3 md:grid-cols-5">
        <Card><CardContent className="pt-5"><strong className="text-2xl">{setup?.components.length ?? 0}</strong><p className="text-sm text-muted-foreground">Total components</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{statusCounts.get('draft') ?? 0}</strong><p className="text-sm text-muted-foreground">Draft</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{statusCounts.get('in-review') ?? 0}</strong><p className="text-sm text-muted-foreground">In review</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{statusCounts.get('active') ?? 0}</strong><p className="text-sm text-muted-foreground">Active</p></CardContent></Card>
        <Card><CardContent className="pt-5"><strong className="text-2xl">{statusCounts.get('deprecated') ?? 0}</strong><p className="text-sm text-muted-foreground">Deprecated</p></CardContent></Card>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden">
        <CardHeader className="shrink-0 flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Component catalogue</CardTitle>
            <CardDescription>Click a component to edit it, change its lifecycle status, or mark it as deprecated.</CardDescription>
          </div>
          <Button onClick={openNew}><Plus size={16} /> New Component</Button>
        </CardHeader>
        <CardContent className="min-h-0 overflow-auto">
          {setup && setup.components.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {setup.components.map((component) => {
                const healthy = component.status === 'complete' || component.status === 'active';
                const Icon = healthy ? CheckCircle2 : Circle;
                const linkedCapabilities = setup.capabilities.filter((capability) => capability.components?.includes(component.slug));
                return (
                  <button key={component.slug} className="group rounded-md border bg-background p-4 text-left shadow-sm transition hover:border-primary/50 hover:bg-accent/40" onClick={() => openEdit(component.slug)}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Icon size={20} className={healthy ? 'text-emerald-600' : 'text-muted-foreground'} />
                      <Badge variant={statusVariant(component.status)}>{statusLabel(component.status)}</Badge>
                    </div>
                    <h3 className="text-base font-semibold text-foreground">{component.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{linkedCapabilities.length ? `${linkedCapabilities.length} linked capability/capabilities` : 'No capabilities linked yet'}</p>
                    {linkedCapabilities.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {linkedCapabilities.map((capability) => <Badge key={capability.slug} variant="outline">{capability.title}</Badge>)}
                      </div>
                    ) : null}
                    <span className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground"><Edit3 size={14} /> Edit component</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-10 text-center">
              <Puzzle size={36} className="text-muted-foreground" />
              <h2 className="text-lg font-semibold">No components yet</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">Create components to represent the apps, plugins, modules, services, libraries, workflows, integrations, or subsystems that make capabilities possible.</p>
              <Button onClick={openNew}><Plus size={16} /> New Component</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
