import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Switch } from './ui/switch';

export function ProjectCreate({ onCreated, onCancel }: { onCreated: (project: AiddTrackedProject) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentLocation, setParentLocation] = useState('');
  const [initializeGit, setInitializeGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFolder = async () => {
    const folder = await window.aidd.selectProjectFolder();
    if (folder) setParentLocation(folder);
  };

  const create = async () => {
    setBusy(true); setError(null);
    try { onCreated(await window.aidd.createProject({ name, description, parentLocation, initializeGit })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return <div className="flex h-full flex-col overflow-hidden"><header className="flex h-16 shrink-0 items-center justify-between border-b px-6"><div><h1 className="text-xl font-semibold">New project</h1><p className="text-sm text-muted-foreground">Create a Git-backed AIDD workspace from the app template.</p></div><Button variant="outline" onClick={onCancel}>Cancel</Button></header><main className="min-h-0 flex-1 overflow-auto p-6"><Card className="max-w-3xl"><CardHeader><CardTitle>Project details</CardTitle><CardDescription>Choose a name, description and parent folder. AIDD will create the project folder inside that location.</CardDescription></CardHeader><CardContent className="space-y-5">{error && <Alert variant="destructive"><AlertTitle>Could not create project</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<div className="grid gap-2"><Label>Project name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="StormUI" /></div><div className="grid gap-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project for?" /></div><div className="grid gap-2"><Label>Location</Label><div className="flex gap-2"><Input value={parentLocation} onChange={(e) => setParentLocation(e.target.value)} placeholder="C:\\src\\aidd" /><Button variant="outline" onClick={chooseFolder}><FolderOpen className="h-4 w-4" /> Browse</Button></div></div><div className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">Initialize Git versioning</div><div className="text-sm text-muted-foreground">Creates a local Git repository and first checkpoint.</div></div><Switch checked={initializeGit} onCheckedChange={setInitializeGit} /></div><div className="flex justify-end"><Button disabled={busy || !name.trim() || !parentLocation.trim()} onClick={create}>{busy ? 'Creating...' : 'Create project'}</Button></div></CardContent></Card></main></div>;
}
