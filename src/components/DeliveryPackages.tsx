import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, CheckCircle2, FileArchive, FileText, Layers3, PackagePlus, Plus, Save, ScrollText } from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';
import { AiddMarkdownEditor } from './editor/AiddMarkdownEditor';
import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

interface DeliveryPackagesProps {
  activeProject?: AiddTrackedProject | null;
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string) => void;
  onCreatePackage: () => void;
}

type EditorTab = 'snapshot' | 'strategy' | 'phases' | 'packaged';

const statusOptions = ['draft', 'in-review', 'active', 'complete', 'ready-for-processing', 'accepted'];

const statusCopy: Record<string, string> = {
  draft: 'Draft',
  'needs-review': 'Needs review',
  'changes-requested': 'Changes requested',
  'approved-for-ai': 'Approved for AI',
  'in-ai-execution': 'In AI execution',
  'needs-verification': 'Needs verification',
  accepted: 'Accepted',
  'in-review': 'In review',
  active: 'Active',
  complete: 'Complete',
  'ready-for-processing': 'Ready for processing',
  superseded: 'Superseded'
};

function statusVariant(status: string): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'accepted' || status === 'complete' || status === 'ready-for-processing') return 'success';
  if (status === 'changes-requested') return 'destructive';
  if (status === 'needs-review' || status === 'needs-verification' || status === 'in-review') return 'warning';
  if (status === 'in-ai-execution' || status === 'active') return 'outline';
  return 'secondary';
}

function phaseReady(phase: AiddDeliveryPackagePhase) {
  return phase.status === 'active' || phase.status === 'complete';
}

function fallbackList(packages: DeliveryBundle[], selectedId: string, onSelectPackage: (id: string) => void, onCreatePackage: () => void) {
  const grouped = Object.entries(statusCopy).filter(([status]) => packages.some((item) => item.status === status));
  return (
    <main className="flex h-screen min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Delivery</h1>
          <p className="text-sm text-muted-foreground">Open a tracked AIDD project to edit filesystem-backed delivery packages.</p>
        </div>
        <Button onClick={onCreatePackage}><PackagePlus className="h-4 w-4" /> New sample package</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid gap-4 xl:grid-cols-3">
          {grouped.map(([status, label]) => {
            const items = packages.filter((item) => item.status === status);
            return (
              <Card key={status}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{label}</CardTitle>
                    <Badge variant="secondary">{items.length}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.map((item) => {
                    const readiness = checkReadiness(item);
                    return (
                      <button key={item.id} className={cn('w-full rounded-md border bg-card p-4 text-left transition hover:bg-accent', item.id === selectedId && 'ring-2 ring-ring')} onClick={() => onSelectPackage(item.id)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <strong className="block text-sm">{item.id} · {item.title}</strong>
                            <span className="mt-1 block text-xs text-muted-foreground">{item.capability}</span>
                          </div>
                          <Badge variant={statusVariant(item.status)}>{readiness.score}%</Badge>
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export function DeliveryPackages({ activeProject, packages, selectedId, onSelectPackage, onCreatePackage }: DeliveryPackagesProps) {
  const [items, setItems] = useState<AiddDeliveryPackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiddDeliveryPackageDetail | null>(null);
  const [tab, setTab] = useState<EditorTab>('snapshot');
  const [selectedPhaseFile, setSelectedPhaseFile] = useState<string | null>(null);
  const [strategyDraft, setStrategyDraft] = useState('');
  const [phasesDraft, setPhasesDraft] = useState<AiddDeliveryPackagePhase[]>([]);
  const [newPhaseTitle, setNewPhaseTitle] = useState('');
  const [statusDraft, setStatusDraft] = useState('draft');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const activePhase = useMemo(
    () => phasesDraft.find((phase) => phase.fileName === selectedPhaseFile) ?? phasesDraft[0] ?? null,
    [phasesDraft, selectedPhaseFile]
  );

  const loadList = async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const next = await window.aidd.readDeliveryPackages(activeProject.path);
      setItems(next);
      if (!selectedPackageId && next[0]) setSelectedPackageId(next[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.aidd.readDeliveryPackage({ projectPath: activeProject.path, id });
      setDetail(loaded);
      setStrategyDraft(loaded.strategyBody);
      setPhasesDraft(loaded.phases);
      setStatusDraft(String(loaded.status || 'draft'));
      setSelectedPhaseFile(loaded.phases[0]?.fileName ?? null);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeProject) return;
    setSelectedPackageId(null);
    setDetail(null);
    loadList();
  }, [activeProject?.path]);

  useEffect(() => {
    if (!selectedPackageId) return;
    loadDetail(selectedPackageId);
  }, [selectedPackageId]);

  const movePackage = async (id: string, direction: 'up' | 'down') => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const next = await window.aidd.reorderDeliveryPackage({ projectPath: activeProject.path, id, direction });
      setItems(next);
      setSelectedPackageId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!activeProject) {
    return fallbackList(packages, selectedId, onSelectPackage, onCreatePackage);
  }

  const savePackage = async () => {
    if (!activeProject || !detail) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await window.aidd.saveDeliveryPackage({
        projectPath: activeProject.path,
        id: detail.id,
        status: statusDraft,
        strategyBody: strategyDraft,
        phases: phasesDraft
      });
      setDetail(saved);
      setStrategyDraft(saved.strategyBody);
      setPhasesDraft(saved.phases);
      setStatusDraft(String(saved.status || 'draft'));
      setDirty(false);
      await loadList();
      await window.aidd.notify({ title: 'Delivery package saved', body: saved.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createPhase = async () => {
    if (!activeProject || !detail || !newPhaseTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createDeliveryPackagePhase({ projectPath: activeProject.path, packageId: detail.id, title: newPhaseTitle.trim() });
      setDetail(next);
      setStrategyDraft(next.strategyBody);
      setPhasesDraft(next.phases);
      setSelectedPhaseFile(next.phases[next.phases.length - 1]?.fileName ?? null);
      setNewPhaseTitle('');
      setTab('phases');
      setDirty(false);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const assemblePackage = async () => {
    if (!activeProject || !detail) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.assembleDeliveryPackage({ projectPath: activeProject.path, packageId: detail.id });
      setDetail(next);
      setStrategyDraft(next.strategyBody);
      setPhasesDraft(next.phases);
      setStatusDraft(String(next.status || 'ready-for-processing'));
      setTab('packaged');
      setDirty(false);
      await loadList();
      await window.aidd.notify({ title: 'Processing package created', body: `${next.id}/processing-package.md` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateActivePhase = (body: string) => {
    if (!activePhase) return;
    setPhasesDraft((current) => current.map((phase) => phase.fileName === activePhase.fileName ? { ...phase, body } : phase));
    setDirty(true);
  };

  const updateActivePhaseStatus = (status: string) => {
    if (!activePhase) return;
    setPhasesDraft((current) => current.map((phase) => phase.fileName === activePhase.fileName ? { ...phase, status } : phase));
    setDirty(true);
  };

  const readyPhaseCount = phasesDraft.filter(phaseReady).length;
  const canPackage = !!detail && phasesDraft.length > 0 && readyPhaseCount === phasesDraft.length && !dirty;

  return (
    <main className="flex h-screen min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FileArchive className="h-4 w-4" /> Delivery
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight">{detail?.title ?? 'Edit delivery packages'}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {detail && <Badge variant={statusVariant(String(detail.status))}>{statusCopy[String(detail.status)] ?? detail.status}</Badge>}
          <Button variant="outline" onClick={savePackage} disabled={!detail || saving || !dirty}><Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'Saved'}</Button>
          <Button onClick={assemblePackage} disabled={!canPackage || saving}><FileArchive className="h-4 w-4" /> Package for processing</Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="m-4 mb-0 shrink-0">
          <div className="font-medium">Delivery package problem</div>
          <div className="mt-1 text-sm opacity-90">{error}</div>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r bg-muted/20">
          <div className="shrink-0 border-b p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Delivery priority</p>
                <p className="text-xs text-muted-foreground">Move packages up or down to set priority.</p>
              </div>
              <Button size="icon" variant="outline" onClick={loadList} disabled={loading} title="Refresh delivery packages"><Boxes className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {items.length === 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">No delivery packages yet</CardTitle>
                  <CardDescription>Create one from an active capability.</CardDescription>
                </CardHeader>
              </Card>
            )}
            {items.map((item, index) => (
              <div key={item.id} className={cn('rounded-md border bg-card transition', selectedPackageId === item.id && 'ring-2 ring-ring')}>
                <button type="button" onClick={() => setSelectedPackageId(item.id)} className="w-full p-3 text-left transition hover:bg-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="shrink-0">#{item.priority ?? index + 1}</Badge>
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.id}</p>
                    </div>
                    <Badge variant={statusVariant(String(item.status))}>{statusCopy[String(item.status)] ?? item.status}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{item.phaseCount} phase{item.phaseCount === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{item.components.length} component{item.components.length === 1 ? '' : 's'}</span>
                    {item.packaged && <><span>·</span><span className="text-emerald-600 dark:text-emerald-400">packaged</span></>}
                  </div>
                </button>
                <div className="flex items-center justify-end gap-1 border-t bg-muted/20 px-2 py-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void movePackage(item.id, 'up')} disabled={index === 0 || loading} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void movePackage(item.id, 'down')} disabled={index === items.length - 1 || loading} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden">
          {!detail && (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-semibold">Select a delivery package</h2>
                <p className="mt-1 text-sm text-muted-foreground">Create delivery packages from capabilities, then refine them here.</p>
              </div>
            </div>
          )}

          {detail && (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-2">
                {([
                  ['snapshot', ScrollText, 'Snapshot'],
                  ['strategy', FileText, 'Strategy'],
                  ['phases', Layers3, 'Phases'],
                  ['packaged', FileArchive, 'Packaged file']
                ] as const).map(([key, Icon, label]) => (
                  <Button key={key} variant={tab === key ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(key)}>
                    <Icon className="h-4 w-4" /> {label}
                  </Button>
                ))}
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Select value={statusDraft} onChange={(event) => { setStatusDraft(event.target.value); setDirty(true); }} className="h-8 w-48">
                  {statusOptions.map((status) => <option key={status} value={status}>{statusCopy[status] ?? status}</option>)}
                </Select>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-3">
                {tab === 'snapshot' && (
                  <AiddMarkdownEditor readOnly label="Snapshot" hint="Frozen foundation, standards, capability, and component context captured when the package was created." value={detail.snapshotBody} onChange={() => undefined} height="100%" className="h-full" />
                )}

                {tab === 'strategy' && (
                  <AiddMarkdownEditor label="Implementation strategy" hint="Refine this before creating delivery phases or sending work into processing." value={strategyDraft} onChange={(value) => { setStrategyDraft(value); setDirty(true); }} height="100%" className="h-full" />
                )}

                {tab === 'phases' && (
                  <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3">
                    <Card className="flex min-h-0 flex-col">
                      <CardHeader className="shrink-0 pb-3">
                        <CardTitle className="text-base">Phases</CardTitle>
                        <CardDescription>Break the package into implementation/refinement phases.</CardDescription>
                      </CardHeader>
                      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="flex gap-2">
                          <Input placeholder="New phase name" value={newPhaseTitle} onChange={(event) => setNewPhaseTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createPhase(); }} />
                          <Button size="icon" onClick={createPhase} disabled={!newPhaseTitle.trim() || saving}><Plus className="h-4 w-4" /></Button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
                          {phasesDraft.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No phases yet. Add one to start planning.</p>}
                          {phasesDraft.map((phase) => (
                            <button key={phase.fileName} type="button" onClick={() => setSelectedPhaseFile(phase.fileName)} className={cn('w-full rounded-md border bg-card p-3 text-left transition hover:bg-accent', activePhase?.fileName === phase.fileName && 'ring-2 ring-ring')}>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-medium">{phase.title}</span>
                                {phaseReady(phase) ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Badge variant="secondary">{String(phase.status).replace(/-/g, ' ')}</Badge>}
                              </div>
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="flex min-h-0 flex-col gap-3">
                      {activePhase ? (
                        <>
                          <div className="flex shrink-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                            <div>
                              <p className="text-sm font-medium">{activePhase.title}</p>
                              <p className="text-xs text-muted-foreground">{activePhase.fileName}</p>
                            </div>
                            <Select value={String(activePhase.status)} onChange={(event) => updateActivePhaseStatus(event.target.value)} className="w-44">
                              {statusOptions.map((status) => <option key={status} value={status}>{statusCopy[status] ?? status}</option>)}
                            </Select>
                          </div>
                          <AiddMarkdownEditor value={activePhase.body} onChange={updateActivePhase} height="100%" className="min-h-0 flex-1" />
                        </>
                      ) : (
                        <div className="grid h-full place-items-center rounded-md border border-dashed text-sm text-muted-foreground">Create or select a phase.</div>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'packaged' && (
                  <AiddMarkdownEditor readOnly label="Processing package" hint="Single file generated from snapshot, strategy, and phases." value={detail.packagedBody || 'Package the delivery package to generate processing-package.md.'} onChange={() => undefined} height="100%" className="h-full" />
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <span>{readyPhaseCount}/{phasesDraft.length} phases ready</span>
                  <span>Strategy {strategyDraft.trim() ? 'has content' : 'is empty'}</span>
                  <span>{dirty ? 'Unsaved changes' : 'Saved'}</span>
                </div>
                <div>{canPackage ? 'Ready to package for processing' : 'Save changes and mark every phase active/complete before packaging.'}</div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
