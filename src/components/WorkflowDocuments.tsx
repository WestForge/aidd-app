import { CheckCircle2, Circle, FileText, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface WorkflowDocumentsProps {
  activeProject?: AiddTrackedProject | null;
}

const statusOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'complete', 'skipped'];

function statusLabel(status: string) {
  return status.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function typeLabel(type: string) {
  return type.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function documentHasUsefulBody(doc: AiddWorkflowDocument) {
  const useful = doc.body
    .replace(/^#.*$/gm, '')
    .replace(/TODO:?/gi, '')
    .trim();
  return useful.length > 32;
}

export function WorkflowDocuments({ activeProject }: WorkflowDocumentsProps) {
  const [documents, setDocuments] = useState<AiddWorkflowDocument[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<AiddSetupStatus>('not-started');
  const [body, setBody] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => documents.find((doc) => doc.relativePath === selectedPath) ?? documents[0],
    [documents, selectedPath]
  );

  const groups = useMemo(() => {
    const types = Array.from(new Set(documents.map((doc) => doc.type))).sort();
    return ['all', ...types];
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    if (filter === 'all') return documents;
    return documents.filter((doc) => doc.type === filter);
  }, [documents, filter]);

  const stats = useMemo(() => {
    const total = documents.length;
    const complete = documents.filter((doc) => doc.status === 'complete').length;
    const draft = documents.filter((doc) => doc.status === 'draft').length;
    const needsContent = documents.filter((doc) => doc.required && doc.status !== 'complete' && !documentHasUsefulBody(doc)).length;
    return { total, complete, draft, needsContent };
  }, [documents]);

  const load = async () => {
    if (!activeProject?.path) return;
    setError(null);
    const next = await window.aidd.readWorkflowDocuments(activeProject.path);
    setDocuments(next);
    const preferred = next.find((doc) => doc.relativePath === selectedPath) ?? next.find((doc) => doc.status !== 'complete') ?? next[0];
    if (preferred) {
      setSelectedPath(preferred.relativePath);
      setTitle(preferred.title);
      setStatus(preferred.status);
      setBody(preferred.body);
    }
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.path]);

  useEffect(() => {
    if (!selected) return;
    setTitle(selected.title);
    setStatus(selected.status);
    setBody(selected.body);
  }, [selected?.relativePath]);

  const save = async () => {
    if (!activeProject?.path || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.saveWorkflowDocument({
        projectPath: activeProject.path,
        relativePath: selected.relativePath,
        title,
        status,
        body
      });
      setDocuments(next);
      void window.aidd.notify({ title: 'Saved', body: 'Workflow document saved.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open an AIDD project first.</p></section></main>;
  }

  return (
    <main className="screenStack documentWorkflowScreen">
      <section className="heroCard">
        <div>
          <p className="eyebrow">Markdown workflow</p>
          <h1>Workflow Documents</h1>
          <p className="muted largeText">Edit AIDD Markdown files through workflow fields. Status, title, type, and update time are stored in frontmatter so the app can track progress.</p>
        </div>
        <button className="secondaryButton" onClick={load}><RefreshCw size={16} /> Refresh</button>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Document error:</strong> {error}</section>}

      <section className="metricsGrid compactMetrics">
        <div className="metricCard"><span>Total documents</span><strong>{stats.total}</strong></div>
        <div className="metricCard"><span>Complete</span><strong>{stats.complete}</strong></div>
        <div className="metricCard"><span>Draft</span><strong>{stats.draft}</strong></div>
        <div className="metricCard"><span>Needs content</span><strong>{stats.needsContent}</strong></div>
      </section>

      <section className="workflowDocumentGrid">
        <aside className="panel documentListPanel">
          <div className="filterBar">
            {groups.map((group) => <button key={group} className={filter === group ? 'filterChip active' : 'filterChip'} onClick={() => setFilter(group)}>{group === 'all' ? 'All' : typeLabel(group)}</button>)}
          </div>
          <div className="documentList">
            {filteredDocuments.map((doc) => (
              <button key={doc.relativePath} className={selected?.relativePath === doc.relativePath ? 'documentItem active' : 'documentItem'} onClick={() => setSelectedPath(doc.relativePath)}>
                {doc.status === 'complete' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                <div>
                  <strong>{doc.title}</strong>
                  <span>{doc.relativePath}</span>
                </div>
                <small>{statusLabel(doc.status)}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel documentEditorPanel">
          {selected ? (
            <>
              <div className="panelTitleRow">
                <div>
                  <p className="eyebrow">{typeLabel(selected.type)} · {selected.required ? 'required' : 'optional'}</p>
                  <h2>{selected.relativePath}</h2>
                </div>
                <button className="primaryButton" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save document'}</button>
              </div>

              <div className="formGrid twoColumns">
                <label><span>Title</span><input className="textInput" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label><span>Status</span><select className="textInput" value={status} onChange={(event) => setStatus(event.target.value as AiddSetupStatus)}>{statusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
              </div>

              <div className="workflowHint">
                <FileText size={18} />
                <span>Saving updates the Markdown file and writes workflow metadata into its frontmatter. The body remains plain Markdown.</span>
              </div>

              <label className="fieldLabel">Markdown body</label>
              <textarea className="textArea markdownWorkflowEditor" value={body} onChange={(event) => setBody(event.target.value)} />
            </>
          ) : (
            <div className="emptyState"><h2>No Markdown documents found</h2><p className="muted">Create or open an AIDD project with Markdown workflow files.</p></div>
          )}
        </section>
      </section>
    </main>
  );
}
