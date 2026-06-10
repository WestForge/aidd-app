import { CheckCircle2, Circle, FileText, Puzzle, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';

type SetupStep = 'foundation' | 'standards' | 'starting-point';

interface SetupWorkflowProps {
  activeProject?: AiddTrackedProject | null;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
}

const statusOptions: AiddSetupStatus[] = ['not-started', 'draft', 'in-review', 'complete', 'skipped'];
const softwareTypeOptions = ['JavaScript / TypeScript', 'Java', 'C# / .NET', 'Python', 'C++', 'Unreal Engine', 'Web app', 'Desktop app', 'Mobile app', 'Service / API'];
const designStandardOptions = ['SOLID', 'Clean Architecture', 'Hexagonal Architecture', 'Domain-Driven Design', 'Event-driven design', 'CQRS', 'Repository pattern'];
const qualityOptions = ['Unit tests', 'Integration tests', 'End-to-end tests', 'UI testing', 'Accessibility checks', 'Static analysis', 'Linting', 'Formatting', 'Test scripts required in delivery packages'];

function statusLabel(status: string) {
  return status.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function stepComplete(step: SetupStep, setup?: AiddProjectSetupState) {
  if (!setup) return false;
  if (step === 'foundation') return setup.foundation.every((doc) => doc.status === 'complete' || (!doc.required && doc.status === 'skipped'));
  if (step === 'standards') return setup.standards.status === 'complete';
  return setup.capabilities.length > 0 || setup.components.length > 0;
}

function toggleValue(value: string, values: string[], setter: (next: string[]) => void) {
  setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
}

function buildStandardsBody(softwareTypes: string[], designStandards: string[], qualityStandards: string[], projectSpecificNotes: string) {
  const notes = projectSpecificNotes.trim();
  const sections = [
    '# Project Standards',
    '',
    'These standards define the technical expectations used when creating components, capabilities, delivery packages, and AI reviews.',
    '',
    '## Software Types',
    '',
    softwareTypes.length ? softwareTypes.map((item) => `- ${item}`).join('\n') : 'TODO: Select software types.',
    '',
    '## Software Design Standards',
    '',
    designStandards.length ? designStandards.map((item) => `- ${item}`).join('\n') : 'TODO: Select design standards.',
    '',
    '## Coding, Testing, and Quality Rules',
    '',
    qualityStandards.length ? qualityStandards.map((item) => `- ${item}`).join('\n') : 'TODO: Select coding and testing expectations.',
    ''
  ];

  if (notes) {
    sections.push('## Project-Specific Notes', '', notes, '');
  }

  return sections.join('\n');
}

function readMarkdownSection(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i'));
  return match ? match[1].trim() : '';
}

function readMarkdownListSection(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i'));
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function SetupWorkflow({ activeProject, onOpenCapabilities, onOpenComponents }: SetupWorkflowProps) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [step, setStep] = useState<SetupStep>('foundation');
  const [selectedFile, setSelectedFile] = useState<string>('02-product-definition.md');
  const [draftBody, setDraftBody] = useState('');
  const [draftStatus, setDraftStatus] = useState<AiddSetupStatus>('not-started');
  const [standardsStatus, setStandardsStatus] = useState<AiddSetupStatus>('not-started');
  const [softwareTypes, setSoftwareTypes] = useState<string[]>([]);
  const [designStandards, setDesignStandards] = useState<string[]>([]);
  const [qualityStandards, setQualityStandards] = useState<string[]>([]);
  const [projectSpecificNotes, setProjectSpecificNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedDoc = useMemo(() => setup?.foundation.find((doc) => doc.fileName === selectedFile), [setup, selectedFile]);
  const generatedStandardsBody = useMemo(
    () => buildStandardsBody(softwareTypes, designStandards, qualityStandards, projectSpecificNotes),
    [softwareTypes, designStandards, qualityStandards, projectSpecificNotes]
  );
  const modelStarted = Boolean(setup && (setup.capabilities.length > 0 || setup.components.length > 0));

  const load = async () => {
    if (!activeProject?.path) return;
    const next = await window.aidd.readProjectSetup(activeProject.path);
    setSetup(next);
    const doc = next.foundation.find((item) => item.fileName === selectedFile) || next.foundation[0];
    if (doc) {
      setSelectedFile(doc.fileName);
      setDraftBody(doc.body);
      setDraftStatus(doc.status);
    }
    setStandardsStatus(next.standards.status);
    setSoftwareTypes(readMarkdownListSection(next.standards.body, 'Software Types'));
    setDesignStandards(readMarkdownListSection(next.standards.body, 'Software Design Standards'));
    setQualityStandards([
      ...readMarkdownListSection(next.standards.body, 'Coding, Testing, and Quality Rules'),
      ...readMarkdownListSection(next.standards.body, 'Coding Style, Testing, and Verification')
    ].filter((value, index, values) => values.indexOf(value) === index));
    setProjectSpecificNotes(readMarkdownSection(next.standards.body, 'Project-Specific Notes'));
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.path]);

  useEffect(() => {
    if (!selectedDoc) return;
    setDraftBody(selectedDoc.body);
    setDraftStatus(selectedDoc.status);
  }, [selectedDoc?.fileName]);

  useEffect(() => {
    if (modelStarted && step === 'starting-point') {
      setStep(stepComplete('standards', setup ?? undefined) ? 'standards' : 'foundation');
    }
  }, [modelStarted, setup, step]);

  const saveFoundation = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path || !selectedDoc) return;
    const nextStatus = statusOverride ?? draftStatus;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const nextSetup = await window.aidd.saveFoundationDocument({
        projectPath: activeProject.path,
        fileName: selectedDoc.fileName,
        status: nextStatus,
        body: draftBody
      });
      setSetup(nextSetup);
      setDraftStatus(nextStatus);
      const savedDoc = nextSetup.foundation.find((doc) => doc.fileName === selectedDoc.fileName);
      if (savedDoc) {
        setDraftBody(savedDoc.body);
      }
      setSaveMessage(statusOverride === 'complete' ? 'Foundation section saved and marked complete.' : 'Foundation section saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveStandards = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path) return;
    const nextStatus = statusOverride ?? standardsStatus;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      setSetup(await window.aidd.defineStandards({ projectPath: activeProject.path, body: generatedStandardsBody, status: nextStatus }));
      setStandardsStatus(nextStatus);
      setSaveMessage(statusOverride === 'complete' ? 'Standards saved and marked complete.' : 'Standards saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return <main className="screen"><section className="panel"><h1>No project selected</h1><p className="muted">Create or open an AIDD project first.</p></section></main>;
  }

  const steps: Array<{ id: SetupStep; title: string; subtitle: string; icon: LucideIcon }> = [
    { id: 'foundation', title: 'Create the Foundation', subtitle: 'Complete the product definition and audience context.', icon: FileText },
    { id: 'standards', title: 'Define Standards', subtitle: 'Choose software, design, style, and testing expectations.', icon: ShieldCheck },
    ...(modelStarted ? [] : [{ id: 'starting-point' as SetupStep, title: 'Choose a Starting Point', subtitle: 'Start from capability value or architecture shape.', icon: Sparkles }])
  ];

  return (
    <main className="screenStack setupScreen">
      <section className="flatPageHeader foundationHeader">
        <div>
          <p className="eyebrow">Foundation workflow</p>
          <h1>{activeProject.name}</h1>
          <p className="muted largeText">Define the product context, audience, and standards that every delivery package will use.</p>
        </div>
        <button className="secondaryButton" onClick={load}>Refresh</button>
      </section>

      {error && <section className="noticeCard dangerNotice"><strong>Foundation error:</strong> {error}</section>}
      {saveMessage && <section className="noticeCard successNotice"><strong>Saved:</strong> {saveMessage}</section>}

      <section className="setupWorkflowGrid">
        <aside className="panel setupStepsPanel">
          {steps.map((item) => {
            const Icon = item.icon;
            const complete = stepComplete(item.id, setup ?? undefined);
            return (
              <button key={item.id} className={step === item.id ? 'setupStep active' : 'setupStep'} onClick={() => setStep(item.id)}>
                {complete ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                <div><strong>{item.title}</strong><span>{item.subtitle}</span></div>
              </button>
            );
          })}
          {modelStarted && setup && (
            <div className="setupStepNote">
              Product model started: {setup.capabilities.length} capabilities, {setup.components.length} components.
            </div>
          )}
        </aside>

        <section className="panel setupEditorPanel">
          {step === 'foundation' && setup && (
            <div>
              <div className="panelTitleRow"><div><h2>Project Foundation</h2><p className="muted">Complete the Product Definition and Audience context, then mark each section complete.</p></div></div>
              <div className="foundationEditorGrid">
                <div className="foundationFileList">
                  {setup.foundation.map((doc) => (
                    <button key={doc.fileName} className={selectedFile === doc.fileName ? 'foundationFile active' : 'foundationFile'} onClick={() => setSelectedFile(doc.fileName)}>
                      {doc.status === 'complete' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      <span>{doc.title}</span>
                      <small>{statusLabel(doc.status)}</small>
                    </button>
                  ))}
                </div>
                <div>
                  <label className="fieldLabel">Status</label>
                  <select className="textInput" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as AiddSetupStatus)}>{statusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
                  <AiddMarkdownEditor
                    label="Foundation content"
                    hint="Use the visual editor by default. Switch to Markdown when you need direct control."
                    value={draftBody}
                    onChange={setDraftBody}
                    minHeight={360}
                  />
                  <div className="buttonGroup left">
                    <button className="primaryButton" onClick={() => saveFoundation()} disabled={saving}>{saving ? 'Saving...' : 'Save Foundation file'}</button>
                    <button className="secondaryButton" onClick={() => saveFoundation('complete')} disabled={saving}>Save and mark complete</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'standards' && setup && (
            <div className="standardsBuilder">
              <h2>Define Standards</h2>
              <p className="muted">Delivery rules are workflow guardrails. Standards are the technical choices: software type, design standards, coding style, test scripts, UI testing, and verification expectations.</p>
              <label className="fieldLabel">Status</label>
              <select className="textInput" value={standardsStatus} onChange={(event) => setStandardsStatus(event.target.value as AiddSetupStatus)}>{statusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>

              <div className="optionsGrid">
                <section className="embeddedPanel"><h3>Software types</h3>{softwareTypeOptions.map((item) => <button key={item} className={softwareTypes.includes(item) ? 'softPill selectedPill' : 'softPill'} onClick={() => toggleValue(item, softwareTypes, setSoftwareTypes)}>{item}</button>)}</section>
                <section className="embeddedPanel"><h3>Software design standards</h3>{designStandardOptions.map((item) => <button key={item} className={designStandards.includes(item) ? 'softPill selectedPill' : 'softPill'} onClick={() => toggleValue(item, designStandards, setDesignStandards)}>{item}</button>)}</section>
                <section className="embeddedPanel"><h3>Coding, test, and quality rules</h3>{qualityOptions.map((item) => <button key={item} className={qualityStandards.includes(item) ? 'softPill selectedPill' : 'softPill'} onClick={() => toggleValue(item, qualityStandards, setQualityStandards)}>{item}</button>)}</section>
              </div>

              <AiddMarkdownEditor
                label="Project-specific additions"
                hint="Optional. Add only the standards guidance that is specific to this project. This section is included in the generated Markdown only when it has content."
                value={projectSpecificNotes}
                onChange={setProjectSpecificNotes}
                minHeight={220}
              />

              <label className="fieldLabel">Generated standards Markdown</label>
              <textarea className="textArea setupTextArea generatedMarkdownPreview" value={generatedStandardsBody} readOnly />

              <div className="buttonGroup left">
                <button className="primaryButton" onClick={() => saveStandards()} disabled={saving}>{saving ? 'Saving...' : 'Save Standards Markdown'}</button>
                <button className="secondaryButton" onClick={() => saveStandards('complete')} disabled={saving}>Save and mark complete</button>
              </div>
            </div>
          )}

          {step === 'starting-point' && setup && (
            <div>
              <h2>Choose how to start describing the system</h2>
              <p className="muted">Do not force an order. Pick the path that matches what the person knows right now.</p>
              <div className="choiceGrid">
                <button className="choiceCard primaryChoice" onClick={onOpenCapabilities}>
                  <Sparkles size={24} />
                  <strong>I know what I want it to do</strong>
                  <span>Start with capabilities: outcomes, behaviours, and user-value focused features.</span>
                </button>
                <button className="choiceCard" onClick={onOpenComponents}>
                  <Puzzle size={24} />
                  <strong>I know the software architecture shape</strong>
                  <span>Start with components: apps, services, plugins, modules, libraries, workflows, or integrations.</span>
                </button>
              </div>
              <section className="embeddedPanel existingModelPanel">
                <h3>Current model status</h3>
                <div className="modelSummaryGrid">
                  <div><strong>{setup.capabilities.length}</strong><span>capabilities</span></div>
                  <div><strong>{setup.components.length}</strong><span>components</span></div>
                </div>
              </section>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
