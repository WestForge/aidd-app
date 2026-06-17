import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { MarkdownEditor } from "./MarkdownEditor";
import { cn } from "../lib/utils";

interface ChangesProps {
  activeProject?: AiddTrackedProject | null;
  initialChangeId?: string | null;
  onInitialChangeOpened?: () => void;
  onDeliveryPackageCreated?: (id: string) => void;
}

const changeStatuses: AiddChangeStatus[] = [
  "draft",
  "ready",
  "in-delivery",
  "in-review",
  "accepted",
  "rejected",
  "superseded",
];

const listStatuses: AiddChangeStatus[] = [
  "draft",
  "ready",
  "in-delivery",
  "in-review",
  "accepted",
];

const changeTypes: Array<{ value: AiddChangeType; label: string }> = [
  { value: "implement-capability", label: "Implement capability" },
  { value: "update-capability", label: "Update capability" },
  { value: "component-change", label: "Component change" },
  { value: "technical-refactor", label: "Technical refactor" },
  { value: "bug-fix", label: "Bug fix" },
  { value: "ux-improvement", label: "UX improvement" },
  { value: "documentation-standards-change", label: "Docs/standards" },
  { value: "spike-investigation", label: "Spike investigation" },
];

const priorities: AiddChangePriority[] = ["low", "normal", "high", "urgent"];
const risks: AiddChangeRisk[] = ["unknown", "low", "medium", "high"];

function label(value: string) {
  return value.replace(/-/g, " ");
}

function typeLabel(type: AiddChangeType) {
  return changeTypes.find((item) => item.value === type)?.label ?? label(type);
}

function statusBadgeVariant(status: AiddChangeStatus) {
  if (status === "ready" || status === "accepted") return "secondary";
  if (status === "rejected" || status === "superseded") return "outline";
  return "outline";
}

function byStatusAndId(a: AiddChangeRecord, b: AiddChangeRecord) {
  const statusRank = (status: AiddChangeStatus) => changeStatuses.indexOf(status);
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function Changes({
  activeProject,
  initialChangeId,
  onInitialChangeOpened,
  onDeliveryPackageCreated,
}: ChangesProps) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [changes, setChanges] = useState<AiddChangeRecord[]>([]);
  const [detail, setDetail] = useState<AiddChangeDetail | null>(null);
  const [activeSectionKey, setActiveSectionKey] = useState("intent");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<AiddChangeType>("implement-capability");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeSection = detail?.sections.find((section) => section.key === activeSectionKey) ?? detail?.sections[0];

  const load = async () => {
    if (!activeProject?.path) {
      setChanges([]);
      setSetup(null);
      setDetail(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextSetup, nextChanges] = await Promise.all([
        window.aidd.readProjectSetup(activeProject.path),
        window.aidd.readChanges(activeProject.path),
      ]);
      setSetup(nextSetup);
      setChanges(nextChanges.sort(byStatusAndId));
      if (detail && !nextChanges.some((change) => change.id === detail.id)) {
        setDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [activeProject?.path]);

  const openChange = async (id: string) => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await window.aidd.readChange({ projectPath: activeProject.path, id });
      setDetail(next);
      setActiveSectionKey(next.sections[0]?.key || "intent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!initialChangeId || !activeProject?.path) return;
    openChange(initialChangeId).finally(() => onInitialChangeOpened?.());
  }, [initialChangeId, activeProject?.path]);

  const grouped = useMemo(() => {
    const map = new Map<AiddChangeStatus, AiddChangeRecord[]>();
    for (const status of changeStatuses) map.set(status, []);
    for (const change of changes) map.get(change.status)?.push(change);
    for (const items of map.values()) items.sort(byStatusAndId);
    return map;
  }, [changes]);

  const createManualChange = async () => {
    if (!activeProject?.path) return;
    const title = newTitle.trim();
    if (!title) {
      setError("Enter a title for the new Change.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const created = await window.aidd.createChange({
        projectPath: activeProject.path,
        title,
        type: newType,
      });
      setNewTitle("");
      await load();
      await openChange(created.id);
      setMessage(`Created ${created.id}.`);
      void window.aidd.notify({ title: "Change created", body: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateDetail = (patch: Partial<AiddChangeDetail>) => {
    setDetail((current) => current ? { ...current, ...patch } : current);
  };

  const updateSectionBody = (body: string) => {
    setDetail((current) => current
      ? {
          ...current,
          sections: current.sections.map((section) =>
            section.key === activeSectionKey ? { ...section, body } : section,
          ),
        }
      : current);
  };

  const toggleCapability = (slug: string) => {
    setDetail((current) => {
      if (!current) return current;
      const linked = current.linkedCapabilities.includes(slug)
        ? current.linkedCapabilities.filter((item) => item !== slug)
        : [...current.linkedCapabilities, slug];
      return { ...current, linkedCapabilities: linked };
    });
  };

  const toggleComponent = (slug: string) => {
    setDetail((current) => {
      if (!current) return current;
      const linked = current.linkedComponents.includes(slug)
        ? current.linkedComponents.filter((item) => item !== slug)
        : [...current.linkedComponents, slug];
      return { ...current, linkedComponents: linked };
    });
  };

  const saveCurrentChange = async (statusOverride?: AiddChangeStatus) => {
    if (!activeProject?.path || !detail) return null;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await window.aidd.saveChange({
        projectPath: activeProject.path,
        id: detail.id,
        title: detail.title,
        type: detail.type,
        status: statusOverride ?? detail.status,
        priority: detail.priority,
        risk: detail.risk,
        linkedCapabilities: detail.linkedCapabilities,
        linkedComponents: detail.linkedComponents,
        sections: detail.sections,
      });
      setDetail(saved);
      setActiveSectionKey((current) => saved.sections.some((section) => section.key === current) ? current : saved.sections[0]?.key || "intent");
      setChanges((current) => current.map((change) => change.id === saved.id ? saved : change).sort(byStatusAndId));
      setMessage(`${saved.id} saved.`);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrentChange = async () => {
    if (!activeProject?.path || !detail) return;
    const confirmed = window.confirm(`Delete ${detail.id}?\n\nThis removes the Change folder from disk.`);
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await window.aidd.deleteChange({ projectPath: activeProject.path, id: detail.id });
      setChanges(next);
      setDetail(null);
      setMessage("Change deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createDeliveryPackage = async () => {
    if (!activeProject?.path || !detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = detail.status === "ready" ? detail : await window.aidd.saveChange({
        projectPath: activeProject.path,
        id: detail.id,
        title: detail.title,
        type: detail.type,
        status: "ready",
        priority: detail.priority,
        risk: detail.risk,
        linkedCapabilities: detail.linkedCapabilities,
        linkedComponents: detail.linkedComponents,
        sections: detail.sections,
      });
      if (!saved.readiness.ready) {
        setDetail(saved);
        setError(`Change is not ready: ${saved.readiness.blockers.join("; ")}`);
        return;
      }
      const result = await window.aidd.createDeliveryPackageFromChanges({
        projectPath: activeProject.path,
        changeIds: [saved.id],
      });
      await load();
      const refreshed = await window.aidd.readChange({ projectPath: activeProject.path, id: saved.id });
      setDetail(refreshed);
      setMessage(`Created delivery package ${result.id}.`);
      void window.aidd.notify({ title: "Delivery package created", body: result.id });
      onDeliveryPackageCreated?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
            <CardDescription>Select a project to plan Changes.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Changes</h1>
          <p className="truncate text-sm text-muted-foreground">Plan intended work before creating delivery packages.</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            className="w-64"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="New Change title"
          />
          <Select
            className="w-52"
            value={newType}
            onChange={(event) => setNewType(event.target.value as AiddChangeType)}
          >
            {changeTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
          <Button type="button" onClick={createManualChange} disabled={saving || !newTitle.trim()}>
            <Plus className="h-4 w-4" />
            New Change
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh changes">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-6 pt-4">
          <Alert variant="destructive">
            <AlertTitle>Changes problem</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      {message && (
        <div className="shrink-0 px-6 pt-4">
          <Alert>
            <AlertTitle>Updated</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 overflow-auto border-r bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">All Changes</div>
            <Badge variant="outline">{changes.length}</Badge>
          </div>
          <div className="space-y-4">
            {listStatuses.map((status) => {
              const items = grouped.get(status) ?? [];
              return (
                <section key={status} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <span>{label(status)}</span>
                    <span>{items.length}</span>
                  </div>
                  {items.map((change) => (
                    <button
                      key={change.id}
                      type="button"
                      className={cn(
                        "w-full rounded-md border bg-card p-3 text-left text-sm transition hover:border-ring hover:bg-accent",
                        detail?.id === change.id && "border-ring ring-1 ring-ring",
                      )}
                      onClick={() => void openChange(change.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-muted-foreground">{change.id}</div>
                          <div className="mt-1 line-clamp-2 font-medium leading-5">{change.title}</div>
                        </div>
                        <Badge variant={statusBadgeVariant(change.status)} className="shrink-0 capitalize">{label(change.status)}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">{typeLabel(change.type)}</Badge>
                        {change.linkedCapabilities.slice(0, 2).map((slug) => <Badge key={slug} variant="secondary" className="text-[10px]">{slug}</Badge>)}
                        {change.linkedComponents.slice(0, 2).map((slug) => <Badge key={slug} variant="outline" className="text-[10px]">{slug}</Badge>)}
                      </div>
                    </button>
                  ))}
                  {!items.length && <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No {label(status)} Changes.</div>}
                </section>
              );
            })}
            {(grouped.get("rejected")?.length || grouped.get("superseded")?.length) ? (
              <section className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Closed</div>
                {[...(grouped.get("rejected") ?? []), ...(grouped.get("superseded") ?? [])].map((change) => (
                  <button
                    key={change.id}
                    type="button"
                    className={cn("w-full rounded-md border bg-card p-3 text-left text-sm transition hover:border-ring hover:bg-accent", detail?.id === change.id && "border-ring ring-1 ring-ring")}
                    onClick={() => void openChange(change.id)}
                  >
                    <div className="truncate text-xs font-medium text-muted-foreground">{change.id}</div>
                    <div className="mt-1 line-clamp-2 font-medium leading-5">{change.title}</div>
                  </button>
                ))}
              </section>
            ) : null}
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden">
          {!detail ? (
            <div className="flex h-full items-center justify-center p-6">
              <Card className="w-full max-w-lg">
                <CardHeader>
                  <CardTitle>Select or create a Change</CardTitle>
                  <CardDescription>Changes become delivery packages only after their intent, scope, acceptance criteria, and links are ready.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button type="button" variant="ghost" size="icon" onClick={() => setDetail(null)} title="Close Change">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{detail.id}</Badge>
                      <Badge variant={detail.readiness.ready ? "secondary" : "outline"}>
                        {detail.readiness.ready ? "Ready content" : "Needs detail"}
                      </Badge>
                      {detail.deliveryPackageIds.map((id) => <Badge key={id} variant="outline">{id}</Badge>)}
                    </div>
                    <Input
                      className="mt-2 max-w-2xl text-base font-semibold"
                      value={detail.title}
                      onChange={(event) => updateDetail({ title: event.target.value })}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => void saveCurrentChange("superseded")} disabled={saving || detail.status === "superseded"}>
                    Supersede
                  </Button>
                  <Button type="button" variant="destructive" onClick={deleteCurrentChange} disabled={saving}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void saveCurrentChange()} disabled={saving || !detail.title.trim()}>
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                  <Button type="button" onClick={createDeliveryPackage} disabled={saving || detail.status === "in-delivery" || detail.status === "accepted"}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                    Create Package
                  </Button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] overflow-hidden">
                <div className="min-h-0 overflow-auto border-r p-4">
                  <div className="space-y-4">
                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="h-4 w-4" />
                        Metadata
                      </div>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Type
                        <Select className="mt-1" value={detail.type} onChange={(event) => updateDetail({ type: event.target.value as AiddChangeType })}>
                          {changeTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </Select>
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Status
                        <Select className="mt-1" value={detail.status} onChange={(event) => updateDetail({ status: event.target.value as AiddChangeStatus })}>
                          {changeStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}
                        </Select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs font-medium text-muted-foreground">
                          Priority
                          <Select className="mt-1" value={detail.priority} onChange={(event) => updateDetail({ priority: event.target.value as AiddChangePriority })}>
                            {priorities.map((priority) => <option key={priority} value={priority}>{label(priority)}</option>)}
                          </Select>
                        </label>
                        <label className="block text-xs font-medium text-muted-foreground">
                          Risk
                          <Select className="mt-1" value={detail.risk} onChange={(event) => updateDetail({ risk: event.target.value as AiddChangeRisk })}>
                            {risks.map((risk) => <option key={risk} value={risk}>{label(risk)}</option>)}
                          </Select>
                        </label>
                      </div>
                    </section>

                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="text-sm font-medium">Readiness</div>
                      {detail.readiness.ready ? (
                        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          Ready to package.
                        </div>
                      ) : (
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
                          <div className="mb-2 flex items-center gap-2 font-medium">
                            <ShieldAlert className="h-4 w-4 text-amber-500" />
                            Blockers
                          </div>
                          <ul className="space-y-1 text-muted-foreground">
                            {detail.readiness.blockers.map((blocker) => <li key={blocker}>- {blocker}</li>)}
                          </ul>
                        </div>
                      )}
                      <Button type="button" className="w-full" variant="outline" onClick={() => void saveCurrentChange("ready")} disabled={saving}>
                        Mark Ready
                      </Button>
                    </section>

                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Capabilities</div>
                        <Badge variant="outline">{detail.linkedCapabilities.length}</Badge>
                      </div>
                      <div className="max-h-48 space-y-2 overflow-auto pr-1">
                        {(setup?.capabilities || []).map((capability) => (
                          <label key={capability.slug} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={detail.linkedCapabilities.includes(capability.slug)}
                              onChange={() => toggleCapability(capability.slug)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{capability.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{capability.slug}</span>
                            </span>
                          </label>
                        ))}
                        {!setup?.capabilities.length && <div className="text-sm text-muted-foreground">No capabilities yet.</div>}
                      </div>
                    </section>

                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Components</div>
                        <Badge variant="outline">{detail.linkedComponents.length}</Badge>
                      </div>
                      <div className="max-h-48 space-y-2 overflow-auto pr-1">
                        {(setup?.components || []).map((component) => (
                          <label key={component.slug} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={detail.linkedComponents.includes(component.slug)}
                              onChange={() => toggleComponent(component.slug)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{component.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{component.slug}</span>
                            </span>
                          </label>
                        ))}
                        {!setup?.components.length && <div className="text-sm text-muted-foreground">No components yet.</div>}
                      </div>
                    </section>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden">
                  <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b bg-muted/30 px-4 py-2">
                    {detail.sections.map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        className={cn(
                          "flex h-14 w-36 shrink-0 flex-col items-center justify-center rounded-md border bg-card px-2 text-center text-xs transition hover:bg-accent",
                          activeSectionKey === section.key && "border-ring bg-accent ring-1 ring-ring",
                        )}
                        onClick={() => setActiveSectionKey(section.key)}
                        title={`${section.title}: ${section.fileName}`}
                      >
                        <span className="line-clamp-1 font-medium">{section.title}</span>
                        <span className="line-clamp-1 text-[10px] text-muted-foreground">{section.fileName}</span>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 p-4">
                    {activeSection && (
                      <MarkdownEditor
                        key={`${detail.id}-${activeSection.key}`}
                        editorKey={`${detail.id}-${activeSection.key}`}
                        value={activeSection.body}
                        onChange={updateSectionBody}
                        className="h-full"
                        contentClassName="min-h-[520px]"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
