import { FolderGit2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

interface ProjectsProps {
  projects: AiddTrackedProject[];
  activeProject?: AiddTrackedProject | null;
  onCreateProject: () => void;
  onOpenProject: (project: AiddTrackedProject) => void;
  onOpenExistingProject: () => void;
  onForgetProject: (project: AiddTrackedProject) => void;
}

export function Projects({ projects, activeProject, onCreateProject, onOpenProject, onOpenExistingProject, onForgetProject }: ProjectsProps) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">AIDD workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Projects</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Create and track text-only AIDD projects. Each project uses a versioned template and can initialise Git without the user installing Git.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onOpenExistingProject}><FolderGit2 className="h-4 w-4" /> Add existing</Button>
          <Button onClick={onCreateProject}><Plus className="h-4 w-4" /> New project</Button>
        </div>
      </section>

      {activeProject && (
        <Alert variant="success" className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-semibold">
            <FolderGit2 className="h-4 w-4" /> Current project: {activeProject.name}
          </div>
          <span className="text-xs opacity-80">{activeProject.path}</span>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Tracked projects</CardTitle>
            <CardDescription>The app tracks projects locally so product owners can return to them without browsing folders.</CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 whitespace-nowrap"><RefreshCw className="h-3.5 w-3.5" /> {projects.length} tracked</Badge>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center">
              <div className="mx-auto grid max-w-md gap-3">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-primary/10 text-primary">
                  <FolderGit2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold">No projects yet</h3>
                <p className="text-sm text-muted-foreground">Create your first AIDD project from the current template, then model capabilities and the components they touch.</p>
                <div><Button onClick={onCreateProject}>Create your first project</Button></div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => {
                const selected = activeProject?.id === project.id;
                return (
                  <Card
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenProject(project)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onOpenProject(project);
                    }}
                    className={cn(
                      'cursor-pointer transition hover:border-primary/50 hover:shadow-md',
                      selected && 'border-primary shadow-sm ring-1 ring-primary/25'
                    )}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                          <FolderGit2 className="h-5 w-5" />
                        </div>
                        {selected && <Badge>Current</Badge>}
                      </div>
                      <CardTitle className="line-clamp-1">{project.name}</CardTitle>
                      <CardDescription className="line-clamp-2">{project.description || 'No description yet.'}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>{project.templateId}@{project.templateVersion}</div>
                        <div className="break-all">{project.path}</div>
                      </div>
                      <Separator />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title="Remove from tracked projects only. Files on disk will not be deleted."
                        aria-label={`Forget ${project.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onForgetProject(project);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Forget project
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
