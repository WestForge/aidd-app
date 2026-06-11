import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface ProjectsProps {
  projects: AiddTrackedProject[];
  activeProject: AiddTrackedProject | null;
  onCreateProject: () => void;
  onOpenProject: (project: AiddTrackedProject) => void;
  onOpenExistingProject: () => void;
  onForgetProject: (project: AiddTrackedProject) => void;
}

export function Projects({ projects, activeProject, onCreateProject, onOpenProject, onOpenExistingProject, onForgetProject }: ProjectsProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">Open, create, or forget tracked AIDD projects.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onOpenExistingProject}><FolderOpen className="h-4 w-4" /> Add existing</Button>
          <Button onClick={onCreateProject}><Plus className="h-4 w-4" /> New project</Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        {activeProject && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div><CardTitle>Current project</CardTitle><CardDescription>{activeProject.path}</CardDescription></div>
                <Badge>Current</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-medium">{activeProject.name}</div>
              <p className="mt-1 text-sm text-muted-foreground">{activeProject.description || 'No description provided.'}</p>
            </CardContent>
          </Card>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Tracked projects</h2>
          <Badge variant="outline">{projects.length}</Badge>
        </div>

        {projects.length === 0 ? (
          <Card><CardHeader><CardTitle>No projects tracked</CardTitle><CardDescription>Create a new AIDD project or add an existing one from disk.</CardDescription></CardHeader><CardContent><Button onClick={onCreateProject}>Create your first project</Button></CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.id} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><CardTitle className="truncate text-base">{project.name}</CardTitle><CardDescription className="truncate">{project.path}</CardDescription></div>
                    {activeProject?.id === project.id && <Badge variant="secondary">Current</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="min-h-[3.75rem] overflow-hidden text-sm text-muted-foreground">{project.description || 'No description provided.'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenProject(project)}>Open</Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => onForgetProject(project)} title="Remove from tracked projects only"><Trash2 className="h-4 w-4" /> Forget</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
