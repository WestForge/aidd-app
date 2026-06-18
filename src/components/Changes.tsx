import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  CheckCircle2,
  ClipboardList,
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
const roadmapSizes: Array<"" | AiddRoadmapSize> = ["", "tiny", "small", "medium", "large", "too-large"];
const changePhaseStatuses = ["draft", "ready"];

function defaultNewPhaseBody() {
  return [
    "## Goal",
    "",
    "Describe the outcome this phase should deliver.",
    "",
    "## Implementation Steps",
    "",
    "- [ ] Add implementation steps.",
    "",
    "## Source Areas",
    "",
    "- List files, components, or areas likely to change.",
    "",
    "## Verification",
    "",
    "- [ ] Define how this phase will be checked.",
    "",
  ].join("\n");
}

function phaseTabId(phase: AiddChangePlanPhase) {
  return `phase:${phase.id}`;
}

function nextPhaseId(phases: AiddChangePlanPhase[]) {
  let index = phases.length + 1;
  let id = `phase-${String(index).padStart(2, "0")}`;
  const existing = new Set(phases.map((phase) => phase.id));
  while (existing.has(id)) {
    index += 1;
    id = `phase-${String(index).padStart(2, "0")}`;
  }
  return id;
}

function editorKeyExists(change: AiddChangeDetail, key: string) {
  return (
    key === "strategy" ||
    key === "new-phase" ||
    change.sections.some((section) => section.key === key) ||
    change.phases.some((phase) => phaseTabId(phase) === key)
  );
}

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
  const [activeEditorKey, setActiveEditorKey] = useState("intent");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<AiddChangeType>("implement-capability");
  const [newPhaseTitle, setNewPhaseTitle] = useState("");
  const [newPhaseBody, setNewPhaseBody] = useState(defaultNewPhaseBody);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewPackage, setReviewPackage] = useState<AiddChangeReviewPackageResult | null>(null);
  const [reviewPackageDragFilePath, setReviewPackageDragFilePath] = useState<string | null>(null);

  const activeSection = detail?.sections.find((section) => section.key === activeEditorKey) ?? null;
  const currentPhase = useMemo(() => {
    if (!detail || !activeEditorKey.startsWith("phase:")) return null;
    const phaseId = activeEditorKey.slice("phase:".length);
    return detail.phases.find((phase) => phase.id === phaseId) ?? null;
  }, [activeEditorKey, detail]);

  const load = async () => {
    if (!activeProject?.path) {
      setChanges([]);
      setSetup(null);
      setDetail(null);
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
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
      setActiveEditorKey(next.sections[0]?.key || "intent");
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
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
            section.key === activeEditorKey ? { ...section, body } : section,
          ),
        }
      : current);
  };

  const updateStrategyBody = (body: string) => {
    setDetail((current) => current ? { ...current, strategyBody: body } : current);
  };

  const updatePhase = (phaseId: string, patch: Partial<AiddChangePlanPhase>) => {
    setDetail((current) => current
      ? {
          ...current,
          phases: current.phases.map((phase) => phase.id === phaseId ? { ...phase, ...patch } : phase),
        }
      : current);
  };

  const createPhase = () => {
    if (!detail) return;
    const title = newPhaseTitle.trim();
    if (!title) {
      setError("Add a phase name before creating the phase.");
      return;
    }
    const id = nextPhaseId(detail.phases);
    const phase: AiddChangePlanPhase = {
      id,
      title,
      status: "draft",
      fileName: `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "phase"}.md`,
      body: newPhaseBody,
    };
    setDetail((current) => current ? { ...current, phases: [...current.phases, phase] } : current);
    setActiveEditorKey(phaseTabId(phase));
    setNewPhaseTitle("");
    setNewPhaseBody(defaultNewPhaseBody());
    setMessage("Phase added. Save the Change to write it to disk.");
    setError(null);
  };

  const movePhase = (phaseId: string, direction: "up" | "down") => {
    setDetail((current) => {
      if (!current) return current;
      const index = current.phases.findIndex((phase) => phase.id === phaseId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.phases.length) return current;
      const phases = [...current.phases];
      const [phase] = phases.splice(index, 1);
      phases.splice(targetIndex, 0, phase);
      return { ...current, phases };
    });
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

  const changeSaveInput = (change: AiddChangeDetail, statusOverride?: AiddChangeStatus): AiddSaveChangeInput => ({
    projectPath: activeProject?.path || "",
    id: change.id,
    title: change.title,
    type: change.type,
    status: statusOverride ?? change.status,
    priority: change.priority,
    risk: change.risk,
    linkedCapabilities: change.linkedCapabilities,
    linkedComponents: change.linkedComponents,
    targetDate: change.targetDate,
    size: change.size,
    blocked: change.blocked,
    blockedReason: change.blockedReason,
    dependsOnChangeIds: change.dependsOnChangeIds,
    sections: change.sections,
    strategyBody: change.strategyBody,
    phases: change.phases,
  });

  const saveCurrentChange = async (statusOverride?: AiddChangeStatus) => {
    if (!activeProject?.path || !detail) return null;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await window.aidd.saveChange(changeSaveInput(detail, statusOverride));
      setDetail(saved);
      setActiveEditorKey((current) => editorKeyExists(saved, current) ? current : saved.sections[0]?.key || "intent");
      setChanges((current) => current.map((change) => change.id === saved.id ? saved : change).sort(byStatusAndId));
      void window.aidd.notify({
        title: statusOverride === "ready" ? "Change marked ready" : "Change saved",
        body: statusOverride === "ready" ? `${saved.id} is ready to package.` : `${saved.id} saved.`,
      });
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
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
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
      const saved = await window.aidd.saveChange(changeSaveInput(detail, "ready"));
      if (!saved.readiness.ready) {
        setDetail(saved);
        setError(`Change is not ready: ${saved.readiness.blockers.join("; ")}`);
        return;
      }
      const result = await window.aidd.createDeliveryPackageFromChanges({
        projectPath: activeProject.path,
        changeIds: [saved.id],
        publishToWorkspace: true,
      });
      await load();
      const refreshed = await window.aidd.readChange({ projectPath: activeProject.path, id: saved.id });
      setDetail(refreshed);
      setMessage(`Accepted into Delivery as ${result.id}${result.workspacePublish ? ` and materialized at ${result.workspacePublish.targetPath}` : ""}.`);
      void window.aidd.notify({
        title: "Accepted into Delivery",
        body: result.workspacePublish ? `Materialized ${result.id} in the workspace.` : result.id,
      });
      onDeliveryPackageCreated?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createChangeReviewPackage = async () => {
    if (!activeProject?.path || !detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await window.aidd.saveChange(changeSaveInput(detail));
      setDetail(saved);
      setActiveEditorKey((current) => editorKeyExists(saved, current) ? current : saved.sections[0]?.key || "intent");
      setChanges((current) => current.map((change) => change.id === saved.id ? saved : change).sort(byStatusAndId));
      const bundle = await window.aidd.packageChangeForReview({
        projectPath: activeProject.path,
        id: saved.id,
      });
      setReviewPackage(bundle);
      setReviewPackageDragFilePath(bundle.filePath);
      setMessage(
        `Created ${bundle.fileName} with ${bundle.changeFileCount} change file(s), ${bundle.componentFileCount} component file(s), and ${bundle.sourceFileCount} source file(s).`,
      );
      void window.aidd.notify({
        title: "Change review package ready",
        body: `${bundle.sourceFileCount} source file(s) packaged. Drag the Review bundle tile out when ready.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const droppedZipPathFromEvent = (event: DragEvent<HTMLButtonElement>) => {
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const nativePath = window.aidd.getDroppedFilePath(file);
      if (nativePath) return nativePath;
      const fallbackPath = (file as File & { path?: string }).path;
      if (fallbackPath) return fallbackPath;
    }
    return event.dataTransfer.getData("text/plain");
  };

  const startChangeReviewPackageDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!reviewPackageDragFilePath) {
      event.preventDefault();
      setError("Click Review bundle before dragging it out.");
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", reviewPackageDragFilePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(reviewPackageDragFilePath);
  };

  const importChangeReviewPackage = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeProject?.path || !detail) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setError("Drop a returned change review .zip onto the Review bundle tile.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setError("Change review import rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.aidd.importChangeReviewPackage({
        projectPath: activeProject.path,
        id: detail.id,
        zipPath,
      });
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      await load();
      const refreshed = await window.aidd.readChange({ projectPath: activeProject.path, id: detail.id });
      setDetail(refreshed);
      setActiveEditorKey((current) => editorKeyExists(refreshed, current) ? current : refreshed.sections[0]?.key || "intent");
      setMessage(
        result.importedFiles.length
          ? `Imported ${result.importedFiles.length} change review file(s).`
          : "No change files were imported from that zip.",
      );
      void window.aidd.notify({
        title: "Change review imported",
        body: result.importedFiles.length ? `${result.importedFiles.length} file(s) updated.` : "No change files were updated.",
      });
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
          <h1 className="truncate text-xl font-semibold">{detail ? "Change editor" : "Changes"}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {detail ? "Build the implementation strategy and phase structure before packaging." : "Browse, create, and prepare Changes before packaging."}
          </p>
        </div>
        {!detail ? (
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
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">{detail.id}</Badge>
            <Button type="button" variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh changes">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        )}
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

      <main className="min-h-0 flex-1 overflow-hidden">
        {!detail && (
        <aside className="h-full min-h-0 overflow-auto bg-muted/20 p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">All Changes</div>
              <div className="text-xs text-muted-foreground">Select a Change to prepare its plan and phase files.</div>
            </div>
            <Badge variant="outline">{changes.length}</Badge>
          </div>
          <div className="overflow-hidden rounded-md border bg-card">
            <div className="grid min-w-[760px] grid-cols-[140px_minmax(0,1fr)_140px_180px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
              <div>ID</div>
              <div>Change</div>
              <div>Status</div>
              <div>Type</div>
            </div>
            <div className="divide-y">
              {changes.map((change) => (
                <button
                  key={change.id}
                  type="button"
                  className="grid w-full min-w-[760px] grid-cols-[140px_minmax(0,1fr)_140px_180px] gap-3 px-4 py-3 text-left text-sm transition hover:bg-accent"
                  onClick={() => void openChange(change.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-muted-foreground">{change.id}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{change.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {change.linkedCapabilities.slice(0, 2).map((slug) => <Badge key={slug} variant="secondary" className="text-[10px]">{slug}</Badge>)}
                      {change.linkedComponents.slice(0, 2).map((slug) => <Badge key={slug} variant="outline" className="text-[10px]">{slug}</Badge>)}
                      {change.deliveryPackageIds.slice(0, 1).map((id) => <Badge key={id} variant="outline" className="text-[10px]">{id}</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-start">
                    <Badge variant={statusBadgeVariant(change.status)} className="capitalize">{label(change.status)}</Badge>
                  </div>
                  <div className="min-w-0 truncate text-muted-foreground">{typeLabel(change.type)}</div>
                </button>
              ))}
              {!changes.length && (
                <div className="p-6 text-center text-sm text-muted-foreground">No Changes yet.</div>
              )}
            </div>
          </div>
        </aside>
        )}

        {detail && (
        <section className="h-full min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setDetail(null);
                      setReviewPackage(null);
                      setReviewPackageDragFilePath(null);
                    }}
                    title="Close Change"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{detail.id}</Badge>
                      <Badge variant={detail.readiness.ready ? "secondary" : "outline"}>
                        {detail.readiness.ready ? "Ready to package" : "Needs detail"}
                      </Badge>
                      <Badge variant="outline">{detail.phases.length} phase{detail.phases.length === 1 ? "" : "s"}</Badge>
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
                    Accept into Delivery
                  </Button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px] overflow-hidden">
                <aside className="order-1 min-h-0 overflow-auto border-r bg-muted/20 p-4">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">Plan files</div>
                      <div className="text-xs text-muted-foreground">Prepare the handoff before packaging.</div>
                    </div>
                    <Badge variant="outline">{detail.phases.length}</Badge>
                  </div>

                  <div className="space-y-4">
                    <section className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Strategy</div>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md border bg-card p-3 text-left text-sm transition hover:border-ring hover:bg-accent",
                          activeEditorKey === "strategy" && "border-ring bg-accent ring-1 ring-ring",
                        )}
                        onClick={() => setActiveEditorKey("strategy")}
                        title="Implementation strategy: implementation-strategy.md"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <ClipboardList className="h-4 w-4" />
                          Strategy
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">implementation-strategy.md</span>
                      </button>
                    </section>

                    <section className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Change docs</div>
                      {detail.sections.map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          className={cn(
                            "w-full rounded-md border bg-card p-3 text-left text-sm transition hover:border-ring hover:bg-accent",
                            activeEditorKey === section.key && "border-ring bg-accent ring-1 ring-ring",
                          )}
                          onClick={() => setActiveEditorKey(section.key)}
                          title={`${section.title}: ${section.fileName}`}
                        >
                          <span className="block truncate font-medium">{section.title}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">{section.fileName}</span>
                        </button>
                      ))}
                    </section>

                    <section className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase text-muted-foreground">
                        <span>Phase structure</span>
                        <span>{detail.phases.length}</span>
                      </div>
                      {detail.phases.map((phase, index) => (
                        <div
                          key={phase.id}
                          className={cn(
                            "overflow-hidden rounded-md border bg-card text-sm transition",
                            activeEditorKey === phaseTabId(phase) && "border-ring bg-accent ring-1 ring-ring",
                          )}
                        >
                          <button
                            type="button"
                            className="w-full p-3 text-left transition hover:bg-accent"
                            onClick={() => setActiveEditorKey(phaseTabId(phase))}
                            title={`${phase.title}: ${phase.fileName}`}
                          >
                            <span className="block truncate font-medium">{`Phase ${String(index + 1).padStart(2, "0")} - ${phase.title}`}</span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">{phase.fileName}</span>
                          </button>
                          <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-2 py-1">
                            <Badge variant={phase.status === "ready" ? "secondary" : "outline"} className="text-[10px]">
                              {label(phase.status)}
                            </Badge>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => movePhase(phase.id, "up")}
                                disabled={saving || index === 0}
                                title="Move phase up"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => movePhase(phase.id, "down")}
                                disabled={saving || index === detail.phases.length - 1}
                                title="Move phase down"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-md border border-dashed bg-card p-3 text-sm font-medium transition hover:border-ring hover:bg-accent",
                          activeEditorKey === "new-phase" && "border-ring bg-accent ring-1 ring-ring",
                        )}
                        onClick={() => setActiveEditorKey("new-phase")}
                        title="Add implementation phase"
                      >
                        <Plus className="h-4 w-4" />
                        Add phase
                      </button>
                    </section>
                  </div>
                </aside>

                <div className="order-3 min-h-0 overflow-auto border-l p-4">
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
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Planning metadata</div>
                        <Badge variant="outline">{detail.phases.length} phase{detail.phases.length === 1 ? "" : "s"}</Badge>
                      </div>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Target date
                        <Input
                          className="mt-1"
                          type="date"
                          value={detail.targetDate || ""}
                          onChange={(event) => updateDetail({ targetDate: event.target.value || undefined })}
                        />
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Size
                        <Select className="mt-1" value={detail.size || ""} onChange={(event) => updateDetail({ size: (event.target.value || undefined) as AiddRoadmapSize | undefined })}>
                          {roadmapSizes.map((size) => <option key={size || "none"} value={size}>{size ? label(size) : "No size"}</option>)}
                        </Select>
                      </label>
                      <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs font-medium text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={detail.blocked}
                          onChange={(event) => updateDetail({ blocked: event.target.checked })}
                        />
                        <span>Blocked</span>
                      </label>
                      {detail.blocked && (
                        <label className="block text-xs font-medium text-muted-foreground">
                          Blocked reason
                          <Input
                            className="mt-1"
                            value={detail.blockedReason || ""}
                            onChange={(event) => updateDetail({ blockedReason: event.target.value || undefined })}
                            placeholder="What is blocking this Change?"
                          />
                        </label>
                      )}
                      <label className="block text-xs font-medium text-muted-foreground">
                        Dependencies
                        <Input
                          className="mt-1"
                          value={detail.dependsOnChangeIds.join(", ")}
                          onChange={(event) => updateDetail({
                            dependsOnChangeIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                          })}
                          placeholder="CHG-001, CHG-002"
                        />
                      </label>
                    </section>

                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Archive className="h-4 w-4" />
                          Review bundle
                        </div>
                        {reviewPackage && <Badge variant="secondary">{reviewPackage.sourceFileCount} source</Badge>}
                      </div>
                      <button
                        type="button"
                        draggable={Boolean(reviewPackageDragFilePath)}
                        className={cn(
                          "flex h-16 w-full flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-3 text-[11px] transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                          reviewPackageDragFilePath && "cursor-grab border-emerald-500/70 bg-emerald-500/10 active:cursor-grabbing",
                        )}
                        onClick={() => void createChangeReviewPackage()}
                        onDragStart={startChangeReviewPackageDrag}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={importChangeReviewPackage}
                        disabled={saving || !detail.title.trim()}
                        title={reviewPackageDragFilePath ? "Review bundle is ready. Drag this zip out, or drop a returned change review zip here." : "Create a change review bundle zip, or drop a returned review zip here."}
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Archive className={cn("h-4 w-4 text-muted-foreground", reviewPackageDragFilePath && "text-green-400")} />
                        )}
                        <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
                          {reviewPackageDragFilePath ? "Ready to drag/drop" : "Create bundle"}
                        </span>
                        <span className="line-clamp-1 text-[10px] text-muted-foreground">
                          {saving ? "Working..." : reviewPackage ? `${reviewPackage.changeFileCount} change files` : "Source/drop zip"}
                        </span>
                      </button>
                      {reviewPackage?.warnings.length ? (
                        <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                          {reviewPackage.warnings.length} warning(s) in bundle manifest.
                        </div>
                      ) : null}
                    </section>

                    <section className="space-y-3 rounded-md border bg-card p-4">
                      <div className="text-sm font-medium">Readiness</div>
                      {detail.readiness.ready ? (
                        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          {detail.status === "accepted" ? "Accepted into Delivery." : "Ready to move into Delivery."}
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
                      <Button
                        type="button"
                        className="w-full"
                        variant="outline"
                        onClick={createDeliveryPackage}
                        disabled={saving || detail.status === "in-delivery" || detail.status === "accepted"}
                      >
                        {detail.status === "accepted" ? "Accepted in Delivery" : "Accept into Delivery"}
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

                <div className="order-2 flex min-h-0 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 p-4">
                    {activeEditorKey === "strategy" && (
                      <MarkdownEditor
                        key={`${detail.id}-strategy`}
                        editorKey={`${detail.id}-strategy`}
                        value={detail.strategyBody}
                        onChange={updateStrategyBody}
                        className="h-full"
                        contentClassName="min-h-[520px]"
                      />
                    )}
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
                    {activeEditorKey === "new-phase" && (
                      <div className="flex h-full min-h-0 flex-col rounded-md border bg-card p-4">
                        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            value={newPhaseTitle}
                            onChange={(event) => setNewPhaseTitle(event.target.value)}
                            placeholder="Phase name"
                          />
                          <Button type="button" onClick={createPhase} disabled={saving || !newPhaseTitle.trim()}>
                            <Plus className="h-4 w-4" />
                            Create phase
                          </Button>
                        </div>
                        <MarkdownEditor
                          editorKey={`${detail.id}-new-phase`}
                          value={newPhaseBody}
                          onChange={setNewPhaseBody}
                          className="min-h-0 flex-1"
                          contentClassName="min-h-[520px]"
                        />
                      </div>
                    )}
                    {currentPhase && (
                      <div className="flex h-full min-h-0 flex-col rounded-md border bg-card p-4">
                        <div className="mb-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_140px_auto]">
                          <Input
                            value={currentPhase.title}
                            onChange={(event) => updatePhase(currentPhase.id, { title: event.target.value })}
                            placeholder="Phase name"
                          />
                          <Select
                            value={currentPhase.status}
                            onChange={(event) => updatePhase(currentPhase.id, { status: event.target.value })}
                          >
                            {changePhaseStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}
                          </Select>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => movePhase(currentPhase.id, "up")}
                              disabled={saving || detail.phases.findIndex((phase) => phase.id === currentPhase.id) <= 0}
                              title="Move phase up"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => movePhase(currentPhase.id, "down")}
                              disabled={saving || detail.phases.findIndex((phase) => phase.id === currentPhase.id) >= detail.phases.length - 1}
                              title="Move phase down"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <MarkdownEditor
                          key={`${detail.id}-${currentPhase.id}`}
                          editorKey={`${detail.id}-${currentPhase.id}`}
                          value={currentPhase.body}
                          onChange={(body) => updatePhase(currentPhase.id, { body })}
                          className="min-h-0 flex-1"
                          contentClassName="min-h-[520px]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
        </section>
        )}
      </main>
    </div>
  );
}
