import { CheckCircle2, FolderOpen, GitBranch, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

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
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    if (!parentLocation) {
      setError('Choose where the project should be created.');
      return;
    }
    try {
      setCreating(true);
      const project = await window.aidd.createProject({
        name,
        description,
        parentLocation,
        initializeGit,
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="screenStack">
      <section className="heroCard">
        <div>
          <p className="eyebrow">New AIDD project</p>
          <h1>Create from versioned template</h1>
          <p className="muted largeText">The app copies the current AIDD template, records the template version, creates the Project Foundation, and initialises Git using embedded app logic. The setup workflow then guides Foundation, Standards, Capabilities, and Components.</p>
        </div>
      </section>

      <section className="wizardLayout">
        <div className="wizardMain panel">
          <h2>Project basics</h2>
          <label className="fieldLabel">Project name</label>
          <input className="textInput" value={name} onChange={(event) => setName(event.target.value)} placeholder="Stormbane" />

          <label className="fieldLabel">Description</label>
          <textarea className="textArea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this product/project?" />

          <label className="fieldLabel">Location</label>
          <div className="locationRow">
            <input className="textInput" value={parentLocation} readOnly placeholder="Choose parent folder" />
            <button className="secondaryButton" onClick={chooseFolder}><FolderOpen size={16} /> Browse</button>
          </div>
          <p className="hintText">Project folder: {targetPath}</p>

          <div className="toggleCard">
            <input type="checkbox" checked={initializeGit} onChange={(event) => setInitializeGit(event.target.checked)} />
            <div>
              <strong>Initialise Git versioning</strong>
              <p>The app creates a local Git repository and first commit. Product owners do not need Git installed.</p>
            </div>
            <GitBranch size={20} />
          </div>
        </div>

        <aside className="wizardSide panel">
          <h2>Template</h2>
          <div className="templateBadge"><Sparkles size={18} /> aidd-default@0.5.0</div>
          <p className="muted">Every generated project receives an <code>aidd.template.json</code> manifest so future app versions can offer safe upgrades.</p>
          <ul className="checkList compact">
            <li><CheckCircle2 size={16} /> Text-only Project Foundation</li>
            <li><CheckCircle2 size={16} /> Guided Foundation workflow</li>
            <li><CheckCircle2 size={16} /> Standards before delivery</li>
            <li><CheckCircle2 size={16} /> Capabilities and components</li>
            <li><CheckCircle2 size={16} /> Delivery bundles</li>
            <li><CheckCircle2 size={16} /> Git-ready history</li>
          </ul>
        </aside>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Could not create project:</strong> {error}</section>}

      <section className="actionFooter">
        <button className="ghostButton" onClick={onCancel}>Cancel</button>
        <button className="primaryButton" onClick={submit} disabled={creating}>{creating ? 'Creating...' : 'Create project'}</button>
      </section>
    </main>
  );
}
