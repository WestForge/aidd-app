import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  FolderOpen,
  ListChecks,
  PackageCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

interface HomeProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string) => void;
  onCreatePackage: () => void;
  activeProject: AiddTrackedProject | null;
  onProjectUpdated: (project: AiddTrackedProject) => void;
  onOpenSetup: () => void;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
  onOpenDelivery: () => void;
}

function formatStatus(status?: string) {
  return (status || 'draft').replace(/-/g, ' ');
}

function agentsTargetPath(workspacePath?: string) {
  if (!workspacePath) return '';
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}AGENTS.md`;
}

function docsTargetPath(workspacePath?: string) {
  if (!workspacePath) return '';
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const separator = workspacePath.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}docs`;
}

function publishStateVariant(state?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'up-to-date') return 'secondary';
  if (state === 'blocked') return 'destructive';
  return 'outline';
}

function formatPublishedAt(value?: string) {
  if (!value) return 'Never published';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function comparablePath(directoryPath?: string) {
  const cleaned = (directoryPath || '').replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return /^[a-z]:\//i.test(cleaned) ? cleaned.toLowerCase() : cleaned;
}

function isSameOrInsidePath(candidatePath?: string, rootPath?: string) {
  const candidate = comparablePath(candidatePath);
  const root = comparablePath(rootPath);
  if (!candidate || !root) return false;
  return candidate === root || candidate.startsWith(`${root}/`);
}

function ActionRow({
  title,
  detail,
  status,
  onClick,
}: {
  title: string;
  detail: string;
  status?: string;
  onClick: () => void;
}) {
  return (
    <button className="flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left hover:bg-accent" onClick={onClick}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <Badge variant="secondary" className="shrink-0 capitalize">{formatStatus(status)}</Badge>
    </button>
  );
}

export function Home({ packages, onSelectPackage, activeProject, onProjectUpdated, onOpenSetup, onOpenCapabilities, onOpenComponents, onOpenDelivery }: HomeProps) {
  const [status, setStatus] = useState<AiddProjectStatus | null>(null);
  const [work, setWork] = useState<AiddHomeWork | null>(null);
  const [publishStatus, setPublishStatus] = useState<AiddWorkspacePublishStatus | null>(null);
  const [publishResult, setPublishResult] = useState<AiddWorkspacePublishResult | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  useEffect(() => {
    if (!activeProject?.path) return;
    let cancelled = false;
    Promise.all([
      window.aidd.readProjectStatus(activeProject.path),
      window.aidd.readHomeWork(activeProject.path),
      window.aidd.readWorkspacePublishStatus(activeProject.path),
    ]).then(([projectStatus, homeWork, workspacePublishStatus]) => {
      if (cancelled) return;
      setStatus(projectStatus);
      setWork(homeWork);
      setPublishStatus(workspacePublishStatus);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [activeProject?.path, activeProject?.workspacePath]);

  const blockers = status?.setup.filter((item) => !item.complete) ?? [];
  const activeDelivery = work?.delivery ?? [];
  const capabilityWork = work?.capabilities ?? [];
  const componentWork = work?.components ?? [];
  const totalNeedsDoing = (work?.total ?? 0) + blockers.length;
  const fallbackActivePackages = useMemo(() => packages.filter((item) => item.status !== 'accepted' && item.status !== 'superseded'), [packages]);
  const configuredWorkspacePath = activeProject?.workspacePath;
  const workspaceContainsAiddProject = isSameOrInsidePath(activeProject?.path, configuredWorkspacePath);
  const workspaceInsideAiddProject = isSameOrInsidePath(configuredWorkspacePath, activeProject?.path);
  const workspaceHasAiddBoundaryIssue = Boolean(configuredWorkspacePath && (workspaceContainsAiddProject || workspaceInsideAiddProject));
  const agentsPath = agentsTargetPath(configuredWorkspacePath);
  const docsPath = publishStatus?.docsPath || docsTargetPath(configuredWorkspacePath);

  const refreshPublishStatus = async () => {
    if (!activeProject?.path) return;
    setPublishStatus(await window.aidd.readWorkspacePublishStatus(activeProject.path));
  };

  const selectWorkspaceDirectory = async () => {
    if (!activeProject) return;
    setWorkspaceBusy(true);
    try {
      const updated = await window.aidd.selectWorkspaceDirectory(activeProject.id);
      if (updated) {
        onProjectUpdated(updated);
        setPublishResult(null);
        setPublishStatus(await window.aidd.readWorkspacePublishStatus(updated.path));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setWorkspaceBusy(false);
    }
  };


  const clearWorkspaceDirectory = async () => {
    if (!activeProject) return;
    setWorkspaceBusy(true);
    try {
      const updated = await window.aidd.clearWorkspaceDirectory(activeProject.id);
      onProjectUpdated(updated);
      setPublishResult(null);
      setPublishStatus(await window.aidd.readWorkspacePublishStatus(updated.path));
    } catch (error) {
      console.error(error);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const publishWorkspaceDocs = async () => {
    if (!activeProject?.path) return;
    setPublishBusy(true);
    try {
      const result = await window.aidd.publishWorkspaceDocs(activeProject.path);
      setPublishResult(result);
      setPublishStatus(result);
    } catch (error) {
      console.error(error);
    } finally {
      setPublishBusy(false);
    }
  };

  if (!activeProject) {
    return <div className="flex h-full items-center justify-center p-6"><Card className="max-w-md"><CardHeader><CardTitle>No project selected</CardTitle><CardDescription>Open or create a project to start the AIDD workflow.</CardDescription></CardHeader></Card></div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Home</h1>
          <p className="text-sm text-muted-foreground">Active project work that still needs doing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{totalNeedsDoing} to do</Badge>
          {status && <Badge variant="outline">{status.label}</Badge>}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            {blockers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Setup blockers</CardTitle>
                  <CardDescription>These need to be resolved before delivery planning is reliable.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {blockers.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{item.label}</div>
                          <div className="text-sm text-muted-foreground">{item.detail}</div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={onOpenSetup}>Fix</Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Active delivery work</CardTitle>
                <CardDescription>Real delivery packages from this project that are not finished or archived.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeDelivery.length > 0 ? activeDelivery.slice(0, 8).map((item) => (
                  <ActionRow
                    key={item.id}
                    title={`${item.id} · ${item.title}`}
                    detail={item.reason || item.sourceCapability || 'Delivery package needs attention.'}
                    status={item.status}
                    onClick={onOpenDelivery}
                  />
                )) : fallbackActivePackages.length > 0 ? fallbackActivePackages.slice(0, 8).map((item) => (
                  <ActionRow
                    key={item.id}
                    title={`${item.id} · ${item.title}`}
                    detail={item.capability}
                    status={item.status}
                    onClick={() => onSelectPackage(item.id)}
                  />
                )) : (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>No active delivery work</AlertTitle>
                    <AlertDescription>No delivery packages currently need action.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><Sparkles className="h-5 w-5" /><CardTitle>Capabilities</CardTitle></div>
                    <Badge variant="outline">{capabilityWork.length}</Badge>
                  </div>
                  <CardDescription>Capabilities with lifecycle, section, or component mapping work remaining.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {capabilityWork.length ? capabilityWork.slice(0, 6).map((item) => (
                    <ActionRow
                      key={item.slug}
                      title={item.title}
                      detail={item.reason}
                      status={item.status}
                      onClick={onOpenCapabilities}
                    />
                  )) : <p className="text-sm text-muted-foreground">No capabilities need action.</p>}
                  <Button variant="outline" size="sm" onClick={onOpenCapabilities}>Open capabilities <ArrowRight className="h-4 w-4" /></Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><Boxes className="h-5 w-5" /><CardTitle>Components</CardTitle></div>
                    <Badge variant="outline">{componentWork.length}</Badge>
                  </div>
                  <CardDescription>Components that are still draft, unmapped, or not ready.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {componentWork.length ? componentWork.slice(0, 6).map((item) => (
                    <ActionRow
                      key={item.slug}
                      title={item.title}
                      detail={item.reason}
                      status={item.status}
                      onClick={onOpenComponents}
                    />
                  )) : <p className="text-sm text-muted-foreground">No components need action.</p>}
                  <Button variant="outline" size="sm" onClick={onOpenComponents}>Open components <ArrowRight className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            </div>
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <FolderOpen className="h-5 w-5" />
                <CardTitle>Source workspace</CardTitle>
                <CardDescription>Choose the implementation workspace that contains the source code. AGENTS.md and published AIDD docs will be generated there.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">Active AIDD project</div>
                  <div className="break-all text-muted-foreground">{activeProject.path}</div>
                </div>

                {activeProject.workspacePath ? (
                  <>
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                      <div className="mb-1 font-medium text-foreground">Configured source workspace</div>
                      <div className="break-all text-muted-foreground">{activeProject.workspacePath}</div>
                    </div>
                    {workspaceHasAiddBoundaryIssue && (
                      <Alert>
                        <CircleAlert className="h-4 w-4" />
                        <AlertTitle>{workspaceContainsAiddProject ? 'Workspace contains the active AIDD project' : 'Workspace is inside the active AIDD project'}</AlertTitle>
                        <AlertDescription>Choose the source-code workspace only. The active AIDD project must stay outside the workspace that agents will read.</AlertDescription>
                      </Alert>
                    )}
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                      <div className="mb-1 flex items-center gap-1 font-medium text-foreground"><FileText className="h-3.5 w-3.5" /> AGENTS.md target</div>
                      <div className="break-all text-muted-foreground">{agentsPath}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={selectWorkspaceDirectory} disabled={workspaceBusy}>Choose</Button>
                      <Button variant="outline" size="sm" onClick={() => window.aidd.showItemInFolder(activeProject.workspacePath!)}>Open</Button>
                      <Button variant="ghost" size="sm" onClick={clearWorkspaceDirectory} disabled={workspaceBusy}>Clear</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Alert>
                      <CircleAlert className="h-4 w-4" />
                      <AlertTitle>Source workspace not set</AlertTitle>
                      <AlertDescription>Health Check will warn until you choose the implementation directory that contains the source code.</AlertDescription>
                    </Alert>
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                      <div className="mb-1 flex items-center gap-1 font-medium text-foreground"><FileText className="h-3.5 w-3.5" /> AGENTS.md target</div>
                      <div className="break-all text-muted-foreground">Set a source workspace first.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={selectWorkspaceDirectory} disabled={workspaceBusy}>Choose source workspace</Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><UploadCloud className="h-5 w-5" /><CardTitle>Workspace publishing</CardTitle></div>
                  {publishStatus && <Badge variant={publishStateVariant(publishStatus.state)}>{publishStatus.label}</Badge>}
                </div>
                <CardDescription>Publish approved AIDD context into the source workspace docs directory for agents to read.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">Published docs target</div>
                  <div className="break-all text-muted-foreground">{docsPath || 'Set a source workspace first.'}</div>
                </div>

                {publishStatus ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md border p-2"><div className="font-medium">Missing</div><div>{publishStatus.summary.missing}</div></div>
                      <div className="rounded-md border p-2"><div className="font-medium">Stale</div><div>{publishStatus.summary.stale}</div></div>
                      <div className="rounded-md border p-2"><div className="font-medium">Edited</div><div>{publishStatus.summary.modified}</div></div>
                    </div>

                    {publishStatus.blockers.length > 0 && (
                      <Alert>
                        <CircleAlert className="h-4 w-4" />
                        <AlertTitle>Publishing blocked</AlertTitle>
                        <AlertDescription>{publishStatus.blockers[0]}</AlertDescription>
                      </Alert>
                    )}

                    {publishStatus.blockers.length === 0 && publishStatus.state !== 'up-to-date' && (
                      <Alert>
                        <CircleAlert className="h-4 w-4" />
                        <AlertTitle>{publishStatus.label}</AlertTitle>
                        <AlertDescription>{publishStatus.message}</AlertDescription>
                      </Alert>
                    )}

                    {publishStatus.warnings.length > 0 && (
                      <div className="rounded-lg border p-3 text-xs text-muted-foreground">{publishStatus.warnings[0]}</div>
                    )}

                    {publishResult && (
                      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                        Published: {publishResult.writtenFiles.length} generated file{publishResult.writtenFiles.length === 1 ? '' : 's'} updated, {publishResult.createdWritableFiles.length} writable file{publishResult.createdWritableFiles.length === 1 ? '' : 's'} created, {publishResult.skippedFiles.length} skipped.
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">Last published: {formatPublishedAt(publishStatus.publishedAt)}</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Publish status has not loaded yet.</div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={publishWorkspaceDocs} disabled={publishBusy || !publishStatus?.canPublish}>Publish workspace docs</Button>
                  <Button variant="outline" size="sm" onClick={refreshPublishStatus} disabled={publishBusy}>Refresh</Button>
                  {publishStatus?.docsPath && <Button variant="outline" size="sm" onClick={() => window.aidd.showItemInFolder(publishStatus.docsPath!)}>Open docs</Button>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Clock3 className="h-5 w-5" />
                <CardTitle>Needs doing</CardTitle>
                <CardDescription>Only unfinished or actionable items are counted here.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Setup blockers</span><strong>{blockers.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span><strong>{capabilityWork.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Components</span><strong>{componentWork.length}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Deliveries</span><strong>{activeDelivery.length}</strong></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><ListChecks className="h-5 w-5" /><CardTitle>Project setup</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {status?.setup.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{item.label}</span>
                    {item.complete ? <CheckCircle2 className="h-4 w-4" /> : <Badge variant="outline">Required</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><PackageCheck className="h-5 w-5" /><CardTitle>Project totals</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span><strong>{status?.capabilityCount ?? 0}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Components</span><strong>{status?.componentCount ?? 0}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery packages</span><strong>{status?.bundleCount ?? activeDelivery.length}</strong></div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
