import { CheckCircle2, FolderOpen, GitBranch, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

interface ProjectCreateProps {
  onCreated: (project: AiddTrackedProject) => void;
  onCancel: () => void;
}

function slugPreview(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'aidd-project';
}

export function ProjectCreate({ onCreated, onCancel }: ProjectCreateProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentLocation, setParentLocation] = useState('');
  const [initializeGit, setInitializeGit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const targetPath = useMemo(() => parentLocation ? `${parentLocation} / ${slugPreview(name)}` : 'Choose a parent folder', [parentLocation, name]);

  const chooseFolder = async () => {
    const folder = await window.aidd.selectProjectFolder();
    if (folder) setParentLocation(folder);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Project name is required.');
    if (!parentLocation) return setError('Choose where the project should be created.');
    try {
      setCreating(true);
      const project = await window.aidd.createProject({ name, description, parentLocation, initializeGit });
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">New AIDD project</p>
          <CardTitle className="text-3xl">Create from versioned template</CardTitle>
          <CardDescription className="max-w-4xl">The app copies the current AIDD template, records the template version, creates the Foundation, and initialises Git using embedded app logic.</CardDescription>
        </CardHeader>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Project basics</CardTitle>
            <CardDescription>Name the project and choose where it should live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Project name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Stormbane" /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this product/project?" /></div>
            <div className="space-y-2">
              <Label>Location</Label>
              <div className="flex gap-2"><Input value={parentLocation} readOnly placeholder="Choose parent folder" /><Button variant="outline" onClick={chooseFolder}><FolderOpen className="h-4 w-4" /> Browse</Button></div>
              <p className="text-xs text-muted-foreground">Project folder: {targetPath}</p>
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
              <input type="checkbox" checked={initializeGit} onChange={(event) => setInitializeGit(event.target.checked)} className="mt-1" />
              <div className="flex-1"><strong>Initialise Git versioning</strong><p className="mt-1 text-muted-foreground">The app creates a local Git repository and first commit. Product owners do not need Git installed.</p></div>
              <GitBranch className="h-5 w-5 text-muted-foreground" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Template</CardTitle>
            <CardDescription>Versioned project structure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm font-medium"><Sparkles className="h-4 w-4" /> aidd-default</div>
            <p className="text-sm text-muted-foreground">Every project receives an <code>aidd.template.json</code> manifest so future app versions can offer safe upgrades.</p>
            <ul className="space-y-2 text-sm">
              {['Text-only Foundation', 'Guided Foundation workflow', 'Standards before delivery', 'Capabilities and components', 'Delivery packages', 'Git-ready history'].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {item}</li>)}
            </ul>
          </CardContent>
        </Card>
      </section>

      {error && <Alert variant="destructive"><strong>Could not create project:</strong> {error}</Alert>}

      <footer className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={creating}>{creating ? 'Creating...' : 'Create project'}</Button>
      </footer>
    </main>
  );
}
