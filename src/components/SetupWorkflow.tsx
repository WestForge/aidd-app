import { CheckCircle2, FileText, FolderOpen, RefreshCcw, ShieldCheck, Sparkles, Upload, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { Separator } from './ui/separator';
import { TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import { cn } from '../lib/utils';

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

function statusLabel(status?: string) {
  return (status ?? 'not-started').split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function badgeVariant(status?: string): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'complete' || status === 'active') return 'success';
  if (status === 'in-review') return 'outline';
  if (status === 'skipped') return 'secondary';
  if (status === 'draft' || status === 'not-started') return 'warning';
  return 'secondary';
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
  if (notes) sections.push('## Project-Specific Notes', '', notes, '');
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
  return match[1].split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()).filter(Boolean);
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
  const [foundationReviewFile, setFoundationReviewFile] = useState<{ filePath: string; fileName: string } | null>(null);
  const [preparingReviewFile, setPreparingReviewFile] = useState(false);

  const notify = (body: string, title = 'Foundation saved') => {
    setSaveMessage(null);
    void window.aidd.notify({ title, body });
  };

  const prepareFoundationReviewFile = async () => {
    if (!activeProject?.path) return;
    setPreparingReviewFile(true);
    try {
      setFoundationReviewFile(await window.aidd.prepareFoundationReviewPackage(activeProject.path));
    } catch (err) {
      setFoundationReviewFile(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparingReviewFile(false);
    }
  };

  const selectedDoc = useMemo(() => setup?.foundation.find((doc) => doc.fileName === selectedFile), [setup, selectedFile]);
  const generatedStandardsBody = useMemo(() => buildStandardsBody(softwareTypes, designStandards, qualityStandards, projectSpecificNotes), [softwareTypes, designStandards, qualityStandards, projectSpecificNotes]);
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
    await prepareFoundationReviewFile();
  };

  useEffect(() => { load().catch((err) => setError(err instanceof Error ? err.message : String(err))); }, [activeProject?.path]);
  useEffect(() => {
    if (!selectedDoc) return;
    setDraftBody(selectedDoc.body);
    setDraftStatus(selectedDoc.status);
  }, [selectedDoc?.fileName]);
  useEffect(() => {
    if (modelStarted && step === 'starting-point') setStep(stepComplete('standards', setup ?? undefined) ? 'standards' : 'foundation');
  }, [modelStarted, setup, step]);

  const saveFoundation = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path || !selectedDoc) return;
    const nextStatus = statusOverride ?? draftStatus;
    setSaving(true); setError(null); setSaveMessage(null);
    try {
      const nextSetup = await window.aidd.saveFoundationDocument({ projectPath: activeProject.path, fileName: selectedDoc.fileName, status: nextStatus, body: draftBody });
      setSetup(nextSetup); setDraftStatus(nextStatus);
      const savedDoc = nextSetup.foundation.find((doc) => doc.fileName === selectedDoc.fileName);
      if (savedDoc) setDraftBody(savedDoc.body);
      notify(statusOverride === 'complete' ? 'Foundation section saved and marked complete.' : 'Foundation section saved.');
      await prepareFoundationReviewFile();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  const saveStandards = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path) return;
    const nextStatus = statusOverride ?? standardsStatus;
    setSaving(true); setError(null); setSaveMessage(null);
    try {
      setSetup(await window.aidd.defineStandards({ projectPath: activeProject.path, body: generatedStandardsBody, status: nextStatus }));
      setStandardsStatus(nextStatus);
      notify(statusOverride === 'complete' ? 'Standards saved and marked complete.' : 'Standards saved.', 'Standards saved');
      await prepareFoundationReviewFile();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  if (!activeProject) {
    return <main className="p-6"><Card><CardHeader><CardTitle>No project selected</CardTitle><CardDescription>Create or open an AIDD project first.</CardDescription></CardHeader></Card></main>;
  }

  const steps: Array<{ id: SetupStep; title: string; icon: LucideIcon }> = [
    { id: 'foundation', title: 'Foundation', icon: FileText },
    { id: 'standards', title: 'Standards', icon: ShieldCheck },
    ...(modelStarted ? [] : [{ id: 'starting-point' as SetupStep, title: 'Start', icon: Sparkles }])
  ];

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Foundation</h1>
          <p className="text-sm text-muted-foreground">Define the product context, audience, and standards every delivery package will use.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} title="Refresh Foundation state">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
        {steps.map((item) => {
          const Icon = item.icon;
          const complete = stepComplete(item.id, setup ?? undefined);
          return (
            <Button key={item.id} variant={step === item.id ? 'default' : 'outline'} size="sm" onClick={() => setStep(item.id)} title={item.title}>
              {complete ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> : <Icon className="mr-2 h-4 w-4" />}
              {item.title}
            </Button>
          );
        })}
        {step === 'foundation' && <Separator orientation="vertical" className="mx-1 h-6" />}
        {step === 'foundation' && (setup?.foundation ?? []).map((doc) => (
          <Button key={doc.fileName} variant={selectedFile === doc.fileName ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedFile(doc.fileName)} title={doc.title}>
            {doc.status === 'complete' ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> : <FileText className="mr-2 h-4 w-4" />}
            {doc.title}
          </Button>
        ))}
      </div>

      {error && (
        <div className="shrink-0 border-b bg-background px-4 py-2">
          <Alert variant="destructive"><strong>Foundation error:</strong> {error}</Alert>
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden p-4">
        {step === 'foundation' && selectedDoc && (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_96px] gap-3">
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader className="shrink-0 border-b py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{selectedDoc.title}</CardTitle>
                    <CardDescription>{selectedDoc.fileName}</CardDescription>
                  </div>
                  <Badge variant={badgeVariant(draftStatus)}>{statusLabel(draftStatus)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <AiddMarkdownEditor className="min-h-0 flex-1" height="100%" value={draftBody} onChange={setDraftBody} defaultMode="wysiwyg" />
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Label>Status</Label>
                    <Select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as AiddSetupStatus)}>
                      {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={saving} onClick={() => saveFoundation()}>{saving ? 'Saving...' : 'Save'}</Button>
                    <Button disabled={saving} onClick={() => saveFoundation('complete')}>Save and mark complete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <aside className="flex min-h-0 flex-col items-stretch gap-2">
              <div
                title="Open this generated review file in Explorer, then drag it from there into ChatGPT, Claude, Codex, or another reviewer."
                className={cn(
                  'flex min-h-[120px] shrink-0 select-none flex-col items-center justify-center gap-2 rounded-md border bg-card p-2 text-center shadow-sm',
                  !foundationReviewFile?.filePath && 'opacity-60'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-medium leading-tight">Review file</p>
                  <p className="break-all text-[10px] leading-tight text-muted-foreground">
                    {preparingReviewFile ? 'Preparing...' : foundationReviewFile?.fileName ?? 'Not ready'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="icon" variant="outline" onClick={prepareFoundationReviewFile} title="Refresh review file" disabled={preparingReviewFile}>
                  <Upload className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => foundationReviewFile?.filePath && window.aidd.showItemInFolder(foundationReviewFile.filePath)}
                  title="Open file location"
                  disabled={!foundationReviewFile?.filePath}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="px-1 text-center text-[10px] leading-tight text-muted-foreground">Drag into a browser review chat, or open its folder and drag from Explorer.</p>
            </aside>
          </div>
        )}

        {step === 'standards' && (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
            <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
              <Card className="shrink-0">
                <CardHeader className="pb-3">
                  <CardTitle>Standards options</CardTitle>
                  <CardDescription>Select the software, design, and quality expectations used by delivery packages.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <StandardsPicker title="Software Types" options={softwareTypeOptions} values={softwareTypes} onToggle={(value) => toggleValue(value, softwareTypes, setSoftwareTypes)} />
                  <Separator />
                  <StandardsPicker title="Software Design Standards" options={designStandardOptions} values={designStandards} onToggle={(value) => toggleValue(value, designStandards, setDesignStandards)} />
                  <Separator />
                  <StandardsPicker title="Coding, Testing, and Quality Rules" options={qualityOptions} values={qualityStandards} onToggle={(value) => toggleValue(value, qualityStandards, setQualityStandards)} />
                </CardContent>
              </Card>
              <Card className="flex min-h-[420px] flex-1 flex-col">
                <CardHeader className="shrink-0 pb-3">
                  <CardTitle>Project-specific additions</CardTitle>
                  <CardDescription>Optional guidance that is not covered by the selectable standards.</CardDescription>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 p-3 pt-0">
                  <AiddMarkdownEditor className="h-full" height="100%" value={projectSpecificNotes} onChange={setProjectSpecificNotes} defaultMode="wysiwyg" />
                </CardContent>
              </Card>
            </div>

            <Card className="flex min-h-0 flex-col">
              <CardHeader className="shrink-0 border-b py-3">
                <CardTitle className="text-base">Generated standards Markdown</CardTitle>
                <CardDescription>This is what will be saved to standards/index.md.</CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <Textarea className="min-h-0 flex-1 resize-none font-mono text-xs" readOnly value={generatedStandardsBody} />
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Label>Status</Label>
                    <Select value={standardsStatus} onChange={(event) => setStandardsStatus(event.target.value as AiddSetupStatus)}>
                      {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={saving} onClick={() => saveStandards()}>{saving ? 'Saving...' : 'Save Standards'}</Button>
                    <Button disabled={saving} onClick={() => saveStandards('complete')}>Save and mark complete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'starting-point' && (
          <div className="grid h-full content-start gap-4 md:grid-cols-2">
            <Card className="cursor-pointer transition-colors hover:bg-accent" onClick={onOpenCapabilities}>
              <CardHeader>
                <CardTitle>I know what I want it to do</CardTitle>
                <CardDescription>Create a capability first and link components later.</CardDescription>
              </CardHeader>
            </Card>
            <Card className="cursor-pointer transition-colors hover:bg-accent" onClick={onOpenComponents}>
              <CardHeader>
                <CardTitle>I know the software architecture shape</CardTitle>
                <CardDescription>Map components first and add capabilities later.</CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}
      </section>
    </main>
  );
}

function StandardsPicker({ title, options, values, onToggle }: { title: string; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
        {options.map((option) => <TabsTrigger key={option} active={values.includes(option)} onClick={() => onToggle(option)}>{option}</TabsTrigger>)}
      </TabsList>
    </section>
  );
}
