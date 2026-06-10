import { FolderGit2, Plus, RefreshCw, Trash2 } from 'lucide-react';

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
    <main className="screenStack">
      <section className="projectPageHeader">
        <div>
          <p className="eyebrow">AIDD workspace</p>
          <h1>Projects</h1>
          <p className="muted largeText">Create and track text-only AIDD projects. Each project uses a versioned template and can initialise Git without the user installing Git.</p>
        </div>
        <div className="projectHeaderActions">
          <button className="secondaryButton" onClick={onOpenExistingProject}><FolderGit2 size={18} /> Add existing</button>
          <button className="primaryButton" onClick={onCreateProject}><Plus size={18} /> New project</button>
        </div>
      </section>

      {activeProject && (
        <section className="noticeCard successNotice">
          <strong>Current project:</strong> {activeProject.name}
          <span>{activeProject.path}</span>
        </section>
      )}

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Tracked projects</h2>
            <p className="muted">The app tracks projects locally so product owners can return to them without browsing folders.</p>
          </div>
          <span className="panelHeaderMeta"><RefreshCw size={14} /> {projects.length} tracked</span>
        </div>

        <div className="projectGrid">
          {projects.length === 0 && (
            <div className="emptyState">
              <h3>No projects yet</h3>
              <p>Create your first AIDD project from the current template, then model capabilities and the components they touch.</p>
              <button className="primaryButton" onClick={onCreateProject}>Create your first project</button>
            </div>
          )}
          {projects.map((project) => (
            <article
              className={activeProject?.id === project.id ? 'projectCard selectedProjectCard' : 'projectCard'}
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenProject(project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenProject(project);
              }}
            >
              <div className="projectIcon"><FolderGit2 size={22} /></div>
              <div className="projectCardBody">
                <div className="projectCardTitleRow">
                  <h3>{project.name}</h3>
                  {activeProject?.id === project.id && <span className="currentProjectBadge">Current</span>}
                </div>
                <p>{project.description || 'No description yet.'}</p>
                <span>{project.templateId}@{project.templateVersion}</span>
                <small>{project.path}</small>
                <div className="projectCardActions">
                  <button
                    className="forgetProjectButton"
                    title="Remove from tracked projects only. Files on disk will not be deleted."
                    aria-label={`Forget ${project.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onForgetProject(project);
                    }}
                  >
                    <Trash2 size={14} /> Forget project
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
