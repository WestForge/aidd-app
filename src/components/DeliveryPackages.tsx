import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  FolderOpen,
  UploadCloud,
  RefreshCw,
  Undo2,
  Trash2,
} from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { cn } from '../lib/utils';
import { statusPillClass, statusToneClass } from '../lib/statusTheme';

interface DeliveryPackagesProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string) => void;
  activeProject?: AiddTrackedProject | null;
}

type DeliveryColumnId = 'accepted' | 'in-progress' | 'done';

type DeliveryWorkItem = {
  id: string;
  title: string;
  packageType?: 'capability' | 'technical' | 'change';
  status: string;
  changeIds?: string[];
  sourceCapabilities?: string[];
  sourceCapability?: string;
  sourceTechnicalChange?: {
    componentSlug: string;
    technicalChangeId: string;
    title: string;
  };
  components: string[];
  technicalChanges?: AiddDeliveryPackageTechnicalChange[];
  excludedTechnicalChanges?: AiddDeliveryPackageTechnicalChange[];
  createdAt?: string;
  packaged?: boolean;
  phaseCount?: number;
  priority?: number;
  workspacePackagePath?: string;
  workspacePublished?: boolean;
  workspacePublishedAt?: string;
  workspacePublishStatus?: 'not-configured' | 'missing' | 'published' | 'stale';
  workspaceStatus?: string;
  workspacePhaseCount?: number;
  workspaceDeliveryFiles?: string[];
};

const columns: Array<{
  id: DeliveryColumnId;
  title: string;
  description: string;
  icon: typeof CheckCircle2;
}> = [
  { id: 'accepted', title: 'Accepted', description: 'Prepared packages ready to publish into the workspace.', icon: CheckCircle2 },
  { id: 'in-progress', title: 'In Progress', description: 'Implementation is underway.', icon: Loader2 },
  { id: 'done', title: 'Done', description: 'Delivered and accepted.', icon: CheckCircle2 },
];

const statusLabels: Record<string, string> = {
  draft: 'Accepted',
  'not-started': 'Accepted',
  packaging: 'Accepted',
  'changes-requested': 'Accepted',
  'needs-review': 'Accepted',
  review: 'Accepted',
  'in-review': 'Accepted',
  'needs-verification': 'Accepted',
  approved: 'Accepted',
  'approved-for-ai': 'Accepted',
  accepted: 'Accepted',
  'in-progress': 'In Progress',
  'in-ai-execution': 'In Progress',
  active: 'In Progress',
  done: 'Done',
  complete: 'Done',
};

function normaliseStatus(status?: string): DeliveryColumnId {
  switch ((status || 'draft').toLowerCase()) {
    case 'approved':
    case 'approved-for-ai':
    case 'accepted':
    case 'needs-review':
    case 'review':
    case 'in-review':
    case 'needs-verification':
    case 'draft':
    case 'not-started':
    case 'packaging':
    case 'changes-requested':
      return 'accepted';
    case 'in-progress':
    case 'in-ai-execution':
    case 'active':
      return 'in-progress';
    case 'done':
    case 'complete':
      return 'done';
    default:
      return 'accepted';
  }
}

function fromBundle(bundle: DeliveryBundle): DeliveryWorkItem {
  return {
    id: bundle.id,
    title: bundle.title,
    packageType: 'capability',
    status: bundle.status,
    sourceCapability: bundle.capability,
    components: [],
    createdAt: bundle.lastUpdated,
    packaged: false,
    phaseCount: 0,
    workspacePublished: false,
    workspacePublishStatus: 'not-configured',
  };
}

function formatDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}


function workspacePublishLabel(item: DeliveryWorkItem) {
  if (item.workspacePublishStatus === 'published') return 'Workspace current';
  if (item.workspacePublishStatus === 'stale') return 'Workspace stale';
  if (item.workspacePublishStatus === 'missing') return 'Not in workspace';
  if (item.workspacePublishStatus === 'not-configured') return 'No workspace';
  return 'Not published';
}

function statusValueLabel(status?: string) {
  return (status || 'draft').replace(/-/g, ' ');
}

export function DeliveryPackages({ packages, selectedId, onSelectPackage, activeProject }: DeliveryPackagesProps) {
  const [items, setItems] = useState<DeliveryWorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPackages = async () => {
    if (!activeProject) {
      setItems(packages.map(fromBundle));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const diskItems = await window.aidd.readDeliveryPackages(activeProject.path);
      setItems(diskItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read delivery packages.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPackages();
  }, [activeProject?.path, packages]);

  const grouped = useMemo(() => {
    const next = new Map<DeliveryColumnId, DeliveryWorkItem[]>();
    for (const column of columns) next.set(column.id, []);
    for (const item of items) next.get(normaliseStatus(item.status))?.push(item);
    for (const column of columns) {
      next.get(column.id)?.sort((a, b) => {
        const priority = (a.priority ?? 999) - (b.priority ?? 999);
        if (priority !== 0) return priority;
        return a.id.localeCompare(b.id);
      });
    }
    return next;
  }, [items]);

  const publishPackage = async (item: DeliveryWorkItem) => {
    if (!activeProject) return;
    setPublishingId(item.id);
    setError(null);
    try {
      await window.aidd.publishDeliveryPackageToWorkspace({ projectPath: activeProject.path, packageId: item.id });
      await loadPackages();
      await window.aidd.notify({ title: 'Delivery package published', body: item.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish delivery package to workspace.');
    } finally {
      setPublishingId(null);
    }
  };

  const openWorkspacePackage = async (item: DeliveryWorkItem) => {
    if (!item.workspacePackagePath) return;
    await window.aidd.showItemInFolder(item.workspacePackagePath);
  };

  const deletePackage = async (item: DeliveryWorkItem) => {
    if (!activeProject) return;
    const confirmed = window.confirm(`Delete delivery bundle "${item.id}"?\n\nThis will remove the delivery package folder from disk.`);
    if (!confirmed) return;

    try {
      await window.aidd.deleteDeliveryPackage({ projectPath: activeProject.path, id: item.id });
      await loadPackages();
      await window.aidd.notify({ title: 'Delivery bundle deleted', body: item.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete delivery bundle.');
    }
  };

  const returnPackageToChanges = async (item: DeliveryWorkItem) => {
    if (!activeProject) return;
    const confirmed = window.confirm(
      `Return "${item.id}" to Changes?\n\nThis removes the accepted Delivery package and its workspace delivery folder. The linked Change will go back to Ready so it can be corrected and accepted again.`,
    );
    if (!confirmed) return;

    setReturningId(item.id);
    setError(null);
    try {
      const result = await window.aidd.returnDeliveryPackageToChanges({
        projectPath: activeProject.path,
        packageId: item.id,
        removeWorkspacePackage: true,
      });
      setItems(result.deliveryPackages);
      await window.aidd.notify({
        title: 'Returned to Changes',
        body: `${item.id} moved back to ${result.changeIds.join(', ')}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not return the package to Changes.');
    } finally {
      setReturningId(null);
    }
  };

  const total = items.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Delivery</h1>
          <p className="text-sm text-muted-foreground">Manage delivery packages through the execution flow.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadPackages} disabled={loading || !activeProject}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Delivery packages could not be loaded</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!activeProject && (
          <Alert className="mb-4">
            <AlertTitle>No active project</AlertTitle>
            <AlertDescription>Select a project to show delivery package data from disk.</AlertDescription>
          </Alert>
        )}

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Delivery flow</h2>
            <p className="text-sm text-muted-foreground">Accepted packages publish into the source workspace at <code>delivery/&lt;package-id&gt;</code>.</p>
          </div>
          <Badge variant="outline">{total} active item{total === 1 ? '' : 's'}</Badge>
        </div>

        <div className="grid min-w-[760px] gap-4 xl:grid-cols-3">
          {columns.map((column) => {
            const columnItems = grouped.get(column.id) ?? [];
            const Icon = column.icon;
            return (
              <Card key={column.id} className="flex min-h-[520px] flex-col">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-md border bg-muted/40">
                        <Icon className="h-4 w-4" />
                      </span>
                      <CardTitle className="text-base">{column.title}</CardTitle>
                    </div>
                    <Badge variant="outline">{columnItems.length}</Badge>
                  </div>
                  <CardDescription>{column.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  {columnItems.map((item) => {
                    const created = formatDate(item.createdAt);
                    const workspaceFiles = (item.workspaceDeliveryFiles || []).filter((file) => file.toLowerCase().endsWith('.md'));
                    return (
                      <article
                        key={item.id}
                        className={`group rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40 ${item.id === selectedId ? 'ring-2 ring-ring' : ''}`}
                      >
                        <button className="block w-full text-left" onClick={() => onSelectPackage(item.id)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.id}</div>
                              <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">{item.title}</h3>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge variant="outline" className={statusPillClass(item.packageType ?? 'capability', 'text-[10px]')}>
                                {item.packageType === 'technical' ? 'Technical' : item.packageType === 'change' ? 'Change' : 'Capability'}
                              </Badge>
                              <Badge variant="outline" className={statusPillClass(item.status, 'text-[10px]')}>
                                {statusValueLabel(item.status)}
                              </Badge>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                            {item.sourceCapability && <div>Capability: {item.sourceCapability}</div>}
                            {(item.sourceCapabilities?.length || 0) > 0 && (
                              <div>Capabilities: {item.sourceCapabilities?.join(', ')}</div>
                            )}
                            {(item.changeIds?.length || 0) > 0 && (
                              <div>Changes: {item.changeIds?.join(', ')}</div>
                            )}
                            {item.sourceTechnicalChange && (
                              <div>
                                Technical change: {item.sourceTechnicalChange.technicalChangeId} ({item.sourceTechnicalChange.componentSlug})
                              </div>
                            )}
                            {(item.technicalChanges?.length || 0) > 0 && (
                              <div>{item.technicalChanges?.length} approved technical change{item.technicalChanges?.length === 1 ? '' : 's'}</div>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {(item.components || []).slice(0, 3).map((component) => <Badge key={component} variant="outline" className="text-[10px]">{component}</Badge>)}
                              {(item.components || []).length > 3 && <Badge variant="outline" className="text-[10px]">+{item.components.length - 3}</Badge>}
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span>{item.workspacePhaseCount ?? item.phaseCount ?? 0} phase{(item.workspacePhaseCount ?? item.phaseCount) === 1 ? '' : 's'}</span>
                              <span className={cn("status-text", statusToneClass(item.workspacePublishStatus))}>{workspacePublishLabel(item)}</span>
                            </div>
                            {item.workspaceStatus && item.workspacePublished && (
                              <div className="text-[11px]">Workspace status: <span className={cn("status-text", statusToneClass(item.workspaceStatus))}>{statusLabels[item.workspaceStatus] ?? item.workspaceStatus.replace(/-/g, ' ')}</span></div>
                            )}
                            {workspaceFiles.length > 0 && (
                              <div className="line-clamp-2 text-[11px]">
                                Workspace files: {workspaceFiles.slice(0, 4).join(', ')}
                                {workspaceFiles.length > 4 ? ` +${workspaceFiles.length - 4}` : ''}
                              </div>
                            )}
                            {item.workspacePackagePath && (
                              <div className="break-all text-[11px]">Workspace: {item.workspacePackagePath}</div>
                            )}
                            {created && <div className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{created}</div>}
                          </div>
                        </button>

                        {activeProject && (
                          <div className="mt-3 flex flex-wrap justify-end gap-1 border-t pt-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                            {normaliseStatus(item.status) === 'accepted' && (
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => publishPackage(item)} disabled={publishingId === item.id}>
                                {publishingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                                {item.workspacePublishStatus === 'published' ? 'Republish' : 'Publish'}
                              </Button>
                            )}
                            {item.workspacePackagePath && (
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openWorkspacePackage(item)}>
                                <FolderOpen className="h-3.5 w-3.5" />
                                Workspace
                              </Button>
                            )}
                            {item.packageType === 'change' && normaliseStatus(item.status) === 'accepted' && (
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => returnPackageToChanges(item)} disabled={returningId === item.id}>
                                {returningId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                                Return
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => deletePackage(item)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {!loading && columnItems.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No delivery packages yet. Prepare a Change, then create a package from the Changes page.</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
