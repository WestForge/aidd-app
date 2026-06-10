import { useEffect, useState } from 'react';
import { GitPullRequestArrow, Plus } from 'lucide-react';

type DecisionRecord = {
  id: string;
  title: string;
  status: string;
  relativePath: string;
  body: string;
  createdAt?: string;
};

export function Decisions({ activeProject }: { activeProject?: AiddTrackedProject | null }) {
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [decision, setDecision] = useState('');
  const [consequences, setConsequences] = useState('');
  const [status, setStatus] = useState('proposed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeProject?.path) return;
    setDecisions(await window.aidd.readDecisions(activeProject.path));
  };

  useEffect(() => { load().catch((err) => setError(String(err))); }, [activeProject?.path]);

  const createDecision = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      setDecisions(await window.aidd.createDecision({ projectPath: activeProject.path, title, context, decision, consequences, status }));
      setTitle('');
      setContext('');
      setDecision('');
      setConsequences('');
      setStatus('proposed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open a project first.</p></section></main>;
  }

  return (
    <main className="screenStack">
      <section className="heroCard">
        <div>
          <p className="eyebrow">Decisions</p>
          <h1>Run decisions as a process</h1>
          <p className="muted largeText">Decisions are separate records, not one shared file. Each decision can move from proposed to accepted, rejected, superseded, or deferred.</p>
        </div>
        <button className="secondaryButton" onClick={load}>Refresh</button>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Error:</strong> {error}</section>}

      <section className="splitGrid">
        <div className="panel">
          <div className="sectionTitleIcon"><GitPullRequestArrow size={18} /><h2>New Decision</h2></div>
          <label className="fieldLabel">Decision title</label>
          <input className="textInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Use event sourcing for save-state changes" />
          <label className="fieldLabel">Status</label>
          <select className="textInput" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="deferred">Deferred</option>
            <option value="superseded">Superseded</option>
          </select>
          <label className="fieldLabel">Context</label>
          <textarea className="textArea" value={context} onChange={(event) => setContext(event.target.value)} />
          <label className="fieldLabel">Decision</label>
          <textarea className="textArea" value={decision} onChange={(event) => setDecision(event.target.value)} />
          <label className="fieldLabel">Consequences</label>
          <textarea className="textArea" value={consequences} onChange={(event) => setConsequences(event.target.value)} />
          <div className="buttonGroup left"><button className="primaryButton" onClick={createDecision} disabled={saving || !title.trim()}><Plus size={16} />{saving ? 'Creating...' : 'Create Decision'}</button></div>
        </div>

        <div className="panel">
          <div className="panelTitleRow"><div><h2>Decision records</h2><p className="muted">Each item is stored as its own Markdown file.</p></div><span className="softPill">{decisions.length}</span></div>
          <div className="entityList">
            {decisions.map((item) => <div className="entityRow" key={item.id}><GitPullRequestArrow size={18} /><div><strong>{item.title}</strong><span>{item.status} · {item.relativePath}</span></div></div>)}
            {decisions.length === 0 && <p className="muted">No decision records yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
