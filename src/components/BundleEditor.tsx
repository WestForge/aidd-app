import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  FolderOpen,
  Layers3,
  Loader2,
  PackageCheck,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { DeliveryBundle } from "../domain/types";
import { AiddMarkdownEditor } from "./editor/AiddMarkdownEditor";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";

interface BundleEditorProps {
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
  onSubmitForReview: () => void;
  activeProject?: AiddTrackedProject | null;
  onBack?: () => void;
}

type EditorTab = "snapshot" | "strategy" | "packaged" | "new-phase" | string;

const statusOptions = [
  "packaging",
  "review",
  "approved",
  "in-progress",
  "done",
];

function statusLabel(value?: string) {
  return (value || "packaging").replace(/-/g, " ");
}

const deliveryStatusVisuals: Record<
  string,
  { icon: LucideIcon; className: string }
> = {
  packaging: { icon: ClipboardList, className: "text-sky-400" },
  review: { icon: Eye, className: "text-amber-400" },
  approved: { icon: CheckCircle2, className: "text-emerald-400" },
  "in-progress": { icon: PlayCircle, className: "text-blue-400" },
  done: { icon: PackageCheck, className: "text-green-400" },
};

function getDeliveryStatusVisual(status?: string) {
  return (
    deliveryStatusVisuals[status || "packaging"] ??
    deliveryStatusVisuals.packaging
  );
}

function DeliveryStatusIcon({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const visual = getDeliveryStatusVisual(status);
  const Icon = visual.icon;
  return (
    <Icon className={cn("h-4 w-4 shrink-0", visual.className, className)} />
  );
}

function phaseTabId(phase: AiddDeliveryPackagePhase) {
  return `phase:${phase.id}`;
}

function tabForDeliveryFile(file: AiddDeliveryPackageFile, detail: AiddDeliveryPackageDetail): EditorTab | null {
  if (file.kind !== "file") return null;
  if (file.relativePath === "implementation-strategy.md") return "strategy";
  if (file.relativePath === "snapshot.md") return "snapshot";
  if (file.relativePath === "delivery-package.md" || file.relativePath === "package.md") return "packaged";

  const phase = detail.phases.find((item) => item.fileName === file.relativePath);
  return phase ? phaseTabId(phase) : null;
}

function statusForDeliveryFile(file: AiddDeliveryPackageFile, detail: AiddDeliveryPackageDetail) {
  if (file.relativePath === "implementation-strategy.md") return detail.status;
  if (file.relativePath === "snapshot.md") return "packaging";
  if (file.relativePath === "delivery-package.md" || file.relativePath === "package.md") {
    return detail.packaged ? "done" : "packaging";
  }

  const phase = detail.phases.find((item) => item.fileName === file.relativePath);
  return phase?.status;
}

function labelForDeliveryFile(file: AiddDeliveryPackageFile) {
  if (file.relativePath === "implementation-strategy.md") return "Implementation strategy";
  if (file.relativePath === "snapshot.md") return "Context snapshot";
  if (file.relativePath === "delivery-package.md" || file.relativePath === "package.md") return "Packaged document";
  return file.name;
}

function formatFileSize(sizeBytes?: number) {
  if (typeof sizeBytes !== "number") return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 102.4) / 10} KB`;
  return `${Math.round(sizeBytes / 1024 / 102.4) / 10} MB`;
}

export function BundleEditor({
  bundle,
  onChange,
  activeProject,
  onBack,
}: BundleEditorProps) {
  const [detail, setDetail] = useState<AiddDeliveryPackageDetail | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("strategy");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragFilePath, setDragFilePath] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [newPhaseTitle, setNewPhaseTitle] = useState("");
  const [newPhaseBody, setNewPhaseBody] = useState(() =>
    [
      "## Goal",
      "",
      "Describe the outcome this phase should deliver.",
      "",
      "## Implementation Steps",
      "",
      "- TODO: Add implementation steps.",
      "",
      "## Files / Components",
      "",
      "- TODO: List files, components, or areas touched.",
      "",
      "## Verification",
      "",
      "- TODO: Define how this phase will be checked.",
      "",
    ].join("\n"),
  );

  const loadPackage = async () => {
    if (!activeProject || !bundle?.id) return;
    setLoading(true);
    setError(null);
    try {
      const next = await window.aidd.readDeliveryPackage({
        projectPath: activeProject.path,
        id: bundle.id,
      });
      setDetail(next);
      onChange({
        ...bundle,
        title: next.title,
        status: next.status as DeliveryBundle["status"],
        lastUpdated: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load the delivery package.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPackage();
  }, [activeProject?.path, bundle?.id]);

  const currentPhase = useMemo(() => {
    if (!detail || !activeTab.startsWith("phase:")) return null;
    const phaseId = activeTab.slice("phase:".length);
    return detail.phases.find((phase) => phase.id === phaseId) ?? null;
  }, [activeTab, detail]);

  const currentDragDocument = useMemo(() => {
    if (!detail) return null;

    if (activeTab === "strategy") {
      return {
        fileName: "implementation-strategy.md",
        title: `${detail.title} - Implementation strategy`,
        status: detail.status,
        body: detail.strategyBody,
        metadata: { packageId: detail.id, document: "implementation-strategy" },
      };
    }

    if (activeTab === "snapshot") {
      return {
        fileName: "snapshot.md",
        title: `${detail.title} - Context snapshot`,
        status: "packaging",
        body: detail.snapshotBody,
        metadata: { packageId: detail.id, document: "snapshot" },
      };
    }

    if (activeTab === "packaged") {
      return {
        fileName: "delivery-package.md",
        title: `${detail.title} - Packaged implementation instructions`,
        status: detail.packaged ? "done" : "packaging",
        body:
          detail.packagedBody ||
          "Use Package document to generate delivery-package.md from the strategy and phases.",
        metadata: { packageId: detail.id, document: "delivery-package" },
      };
    }

    if (currentPhase) {
      return {
        fileName: currentPhase.fileName,
        title: `${detail.title} - ${currentPhase.title}`,
        status: currentPhase.status,
        body: currentPhase.body,
        metadata: {
          packageId: detail.id,
          document: "phase",
          phaseId: currentPhase.id,
        },
      };
    }

    return null;
  }, [activeTab, currentPhase, detail]);

  useEffect(() => {
    if (!activeProject?.path || !detail || !currentDragDocument) {
      setDragFilePath(null);
      return;
    }

    const timer = window.setTimeout(() => {
      window.aidd
        .prepareMarkdownDragFile({
          projectPath: activeProject.path,
          directory: `delivery/packages/${detail.id}`,
          fileName: currentDragDocument.fileName,
          title: currentDragDocument.title,
          status: currentDragDocument.status,
          body: currentDragDocument.body || "",
          metadata: currentDragDocument.metadata,
        })
        .then((filePath) => {
          setDragFilePath(filePath);
          setDragError(null);
        })
        .catch((err) => {
          setDragFilePath(null);
          setDragError(err instanceof Error ? err.message : String(err));
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [activeProject?.path, detail?.id, currentDragDocument]);

  const updateDetail = (patch: Partial<AiddDeliveryPackageDetail>) => {
    setDetail((current) => (current ? { ...current, ...patch } : current));
  };

  const updatePhase = (
    phaseId: string,
    patch: Partial<AiddDeliveryPackagePhase>,
  ) => {
    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        phases: current.phases.map((phase) =>
          phase.id === phaseId ? { ...phase, ...patch } : phase,
        ),
      };
    });
  };

  const savePackage = async () => {
    if (!activeProject || !detail) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.saveDeliveryPackage({
        projectPath: activeProject.path,
        id: detail.id,
        title: detail.title,
        status: detail.status,
        snapshotBody: detail.snapshotBody,
        strategyBody: detail.strategyBody,
        phases: detail.phases,
      });
      setDetail(next);
      onChange({
        ...bundle,
        title: next.title,
        status: next.status as DeliveryBundle["status"],
        lastUpdated: new Date().toISOString().slice(0, 10),
      });
      await window.aidd.notify({
        title: "Delivery package saved",
        body: next.id,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save the delivery package.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createPhase = async () => {
    if (!activeProject || !detail) return;
    const title = newPhaseTitle.trim();
    if (!title) {
      setError("Add a phase name before creating the phase.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createDeliveryPackagePhase({
        projectPath: activeProject.path,
        packageId: detail.id,
        title,
        body: newPhaseBody,
      });
      setDetail(next);
      const created = next.phases[next.phases.length - 1];
      if (created) setActiveTab(phaseTabId(created));
      setNewPhaseTitle("");
      setNewPhaseBody(
        [
          "## Goal",
          "",
          "Describe the outcome this phase should deliver.",
          "",
          "## Implementation Steps",
          "",
          "- TODO: Add implementation steps.",
          "",
          "## Files / Components",
          "",
          "- TODO: List files, components, or areas touched.",
          "",
          "## Verification",
          "",
          "- TODO: Define how this phase will be checked.",
          "",
        ].join("\n"),
      );
      await window.aidd.notify({
        title: "Implementation phase created",
        body: `${String(next.phases.length).padStart(2, "0")} - ${title}`,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the phase.",
      );
    } finally {
      setSaving(false);
    }
  };

  const movePhase = (phaseId: string, direction: "up" | "down") => {
    setDetail((current) => {
      if (!current) return current;
      const index = current.phases.findIndex((phase) => phase.id === phaseId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (
        index < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.phases.length
      ) {
        return current;
      }
      const phases = [...current.phases];
      const [phase] = phases.splice(index, 1);
      phases.splice(targetIndex, 0, phase);
      return { ...current, phases };
    });
  };

  const assemblePackage = async () => {
    if (!activeProject || !detail) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.assembleDeliveryPackage({
        projectPath: activeProject.path,
        packageId: detail.id,
      });
      setDetail(next);
      setActiveTab("packaged");
      await window.aidd.notify({
        title: "Implementation instructions assembled",
        body: `${next.id} delivery-package.md created`,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not assemble the delivery package.",
      );
    } finally {
      setSaving(false);
    }
  };

  const openFolder = async () => {
    if (detail?.packagePath)
      await window.aidd.showItemInFolder(detail.packagePath);
  };



  if (!activeProject) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center border-b px-6">
          <h1 className="text-xl font-semibold">Delivery package</h1>
        </header>
        <main className="p-6">
          <Alert>
            <AlertTitle>No active project</AlertTitle>
            <AlertDescription>
              Select a project to edit delivery package Markdown files.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const phaseTabs = detail?.phases ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onBack}
              title="Back to delivery board"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {detail?.title || bundle.title || bundle.id}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              Edit package context, refine the implementation strategy, then
              assemble the AI handoff.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadPackage}
            disabled={loading || saving}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openFolder}
            disabled={!detail?.packagePath}
          >
            Open folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={assemblePackage}
            disabled={!detail || saving}
          >
            <PackageCheck className="h-4 w-4" />
            Package document
          </Button>
          <Button size="sm" onClick={savePackage} disabled={!detail || saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </header>

      {detail && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b bg-muted/30 px-6 py-2">
          <ToolbarButton
            active={activeTab === "strategy"}
            onClick={() => setActiveTab("strategy")}
            icon={Sparkles}
            label="Strategy"
            title="Implementation strategy"
            status={detail.status}
          />
          {phaseTabs.map((phase, index) => (
            <ToolbarButton
              key={phase.id}
              active={activeTab === phaseTabId(phase)}
              onClick={() => setActiveTab(phaseTabId(phase))}
              icon={Layers3}
              label={`Phase ${index + 1}`}
              title={`${phase.title}: ${statusLabel(phase.status)}`}
              status={phase.status}
            />
          ))}
          <button
            type="button"
            className={cn(
              "relative flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/80 bg-card/70 px-2 text-[11px] transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
              activeTab === "new-phase" &&
                "border-ring bg-accent ring-1 ring-ring",
            )}
            onClick={() => setActiveTab("new-phase")}
            disabled={saving}
            title="Add implementation phase"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span className="line-clamp-2 px-1 text-center font-medium leading-tight">
              Add phase
            </span>
          </button>
          <div className="mx-1 my-2 w-px shrink-0 bg-border" />
          <ToolbarButton
            active={activeTab === "snapshot"}
            onClick={() => setActiveTab("snapshot")}
            icon={FileText}
            label="Context"
            title="Snapshot/context used to refine strategy, not included in the packaged AI instructions"
            status="packaging"
            muted
          />
          <ToolbarButton
            active={activeTab === "packaged"}
            onClick={() => setActiveTab("packaged")}
            icon={PackageCheck}
            label="Packaged"
            title="Assembled AI implementation instructions"
            status={detail.packaged ? "done" : "packaging"}
          />
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            <Badge variant="outline" className="gap-1.5 capitalize">
              <DeliveryStatusIcon
                status={detail.status}
                className="h-3.5 w-3.5"
              />
              {statusLabel(detail.status)}
            </Badge>
            <Badge variant="outline">
              {detail.phaseCount} phase{detail.phaseCount === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {detail.packaged ? "packaged" : "not packaged"}
            </Badge>
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Delivery package problem</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && !detail ? (
          <div className="grid h-64 place-items-center text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading delivery package...
            </div>
          </div>
        ) : detail ? (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-h-0 overflow-auto">
              <div className="mx-auto max-w-7xl space-y-4 pb-6">
                <Card>
                  <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px]">
                    <Input
                      value={detail.title}
                      onChange={(event) =>
                        updateDetail({ title: event.target.value })
                      }
                      placeholder="Package title"
                    />
                    <Select
                      value={detail.status}
                      onChange={(event) =>
                        updateDetail({ status: event.target.value })
                      }
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {statusLabel(status)}
                        </option>
                      ))}
                    </Select>
                  </CardContent>
                </Card>

                {activeTab === "strategy" && (
                  <EditorCard
                    title="Implementation strategy"
                    description="Use the wider package context to refine this, but keep this file focused on what the AI/dev needs to implement."
                  >
                    <AiddMarkdownEditor
                      value={detail.strategyBody}
                      onChange={(value) =>
                        updateDetail({ strategyBody: value })
                      }
                      minHeight={620}
                    />
                  </EditorCard>
                )}

                {activeTab === "snapshot" && (
                  <EditorCard
                    title="Package context snapshot"
                    description="Working context from Foundation, capability, and component documents. This is not included in the assembled AI implementation instructions."
                  >
                    <AiddMarkdownEditor
                      value={detail.snapshotBody}
                      onChange={(value) =>
                        updateDetail({ snapshotBody: value })
                      }
                      minHeight={620}
                    />
                  </EditorCard>
                )}

                {activeTab === "packaged" && (
                  <EditorCard
                    title="Packaged implementation instructions"
                    description="Generated handoff containing only the implementation strategy and implementation phases to reduce unnecessary token load."
                  >
                    <AiddMarkdownEditor
                      value={
                        detail.packagedBody ||
                        "Use Package document to generate delivery-package.md from the strategy and phases."
                      }
                      onChange={() => undefined}
                      minHeight={620}
                      readOnly
                    />
                  </EditorCard>
                )}

                {activeTab === "new-phase" && (
                  <EditorCard
                    title="New implementation phase"
                    description="Create an ordered phase. On save, phase files are renamed as phase-xx-name.md based on their order."
                  >
                    <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input
                        value={newPhaseTitle}
                        onChange={(event) =>
                          setNewPhaseTitle(event.target.value)
                        }
                        placeholder="Phase name"
                      />
                      <Button
                        onClick={createPhase}
                        disabled={saving || !newPhaseTitle.trim()}
                      >
                        <Plus className="h-4 w-4" />
                        Create phase
                      </Button>
                    </div>
                    <AiddMarkdownEditor
                      value={newPhaseBody}
                      onChange={setNewPhaseBody}
                      minHeight={560}
                    />
                  </EditorCard>
                )}

                {currentPhase && (
                  <EditorCard
                    title={currentPhase.title}
                    description={`${currentPhase.fileName} · ${statusLabel(currentPhase.status)}`}
                  >
                    <div className="mb-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                      <Input
                        value={currentPhase.title}
                        onChange={(event) =>
                          updatePhase(currentPhase.id, {
                            title: event.target.value,
                          })
                        }
                        placeholder="Phase name"
                      />
                      <Select
                        value={currentPhase.status}
                        onChange={(event) =>
                          updatePhase(currentPhase.id, {
                            status: event.target.value,
                          })
                        }
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {statusLabel(status)}
                          </option>
                        ))}
                      </Select>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => movePhase(currentPhase.id, "up")}
                          disabled={
                            saving ||
                            !detail.phases.find(
                              (phase, index) =>
                                phase.id === currentPhase.id && index > 0,
                            )
                          }
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
                          disabled={
                            saving ||
                            !detail.phases.find(
                              (phase, index) =>
                                phase.id === currentPhase.id &&
                                index < detail.phases.length - 1,
                            )
                          }
                          title="Move phase down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Saved as{" "}
                      {`phase-${String(detail.phases.findIndex((phase) => phase.id === currentPhase.id) + 1).padStart(2, "0")}-${
                        currentPhase.title
                          .trim()
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "") || "phase"
                      }.md`}
                      .
                    </p>
                    <AiddMarkdownEditor
                      value={currentPhase.body}
                      onChange={(value) =>
                        updatePhase(currentPhase.id, { body: value })
                      }
                      minHeight={560}
                    />
                  </EditorCard>
                )}
              </div>
            </div>

            <FileNavigationPanel
              detail={detail}
              activeTab={activeTab}
              onSelect={setActiveTab}
              onMovePhase={movePhase}
              saving={saving}
              dragFilePath={dragFilePath}
              activeDragFileName={currentDragDocument?.fileName}
              packagePath={detail.packagePath}
              onDragError={setDragError}
            />

            {dragError && (
              <p className="text-xs text-destructive">{dragError}</p>
            )}
          </div>
        ) : (
          <Alert>
            <AlertTitle>No package selected</AlertTitle>
            <AlertDescription>
              Select a delivery package from the board.
            </AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}

function FileNavigationPanel({
  detail,
  activeTab,
  onSelect,
  onMovePhase,
  saving,
  dragFilePath,
  activeDragFileName,
  packagePath,
  onDragError,
}: {
  detail: AiddDeliveryPackageDetail;
  activeTab: EditorTab;
  onSelect: (tab: EditorTab) => void;
  onMovePhase: (phaseId: string, direction: "up" | "down") => void;
  saving: boolean;
  dragFilePath: string | null;
  activeDragFileName?: string;
  packagePath?: string;
  onDragError: (message: string | null) => void;
}) {
  const files = (detail.files?.length
    ? detail.files
    : [
        {
          name: "implementation-strategy.md",
          relativePath: "implementation-strategy.md",
          kind: "file" as const,
          editable: true,
          extension: ".md",
        },
        ...detail.phases.map((phase) => ({
          name: phase.fileName,
          relativePath: phase.fileName,
          kind: "file" as const,
          editable: true,
          extension: ".md",
        })),
        {
          name: "snapshot.md",
          relativePath: "snapshot.md",
          kind: "file" as const,
          editable: true,
          extension: ".md",
        },
        {
          name: "delivery-package.md",
          relativePath: "delivery-package.md",
          kind: "file" as const,
          editable: true,
          extension: ".md",
        },
      ]).filter(
        (file) =>
          file.kind === "file" &&
          (file.extension === ".md" || file.relativePath.toLowerCase().endsWith(".md")),
      );

  const phaseByFileName = new Map(
    detail.phases.map((phase, index) => [phase.fileName, { phase, index }]),
  );

  const getNativeDragPath = (file: AiddDeliveryPackageFile) => {
    if (file.kind !== "file") return null;

    if (activeDragFileName && file.relativePath === activeDragFileName && dragFilePath) {
      return dragFilePath;
    }

    if (!packagePath) return null;
    const separator = packagePath.includes("\\") ? "\\" : "/";
    return `${packagePath}${separator}${file.relativePath.replace(/\//g, separator)}`;
  };

  const startPackageFileDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    file: AiddDeliveryPackageFile,
  ) => {
    const filePath = getNativeDragPath(file);
    if (!filePath) {
      event.preventDefault();
      onDragError("This bundle item cannot be dragged out as a file.");
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", filePath);
    event.preventDefault();
    onDragError(null);
    window.aidd.startNativeFileDrag(filePath);
  };

  return (
    <aside
      className="flex min-h-0 flex-col gap-3"
      aria-label="Delivery bundle files"
    >
      <Card className="min-h-0 rounded-md">
        <CardHeader className="px-3 py-3">
          <CardTitle className="text-sm">Package</CardTitle>
          <CardDescription className="text-xs">
            All files in this delivery bundle. Drag files out from here, or select Markdown package files for editing.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 space-y-3 px-3 pb-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Bundle files</span>
              <span>{files.length}</span>
            </div>
            <div className="grid max-h-[calc(100vh-23rem)] grid-cols-1 gap-2 overflow-auto pr-1">
              {files.map((file) => {
                const targetTab = tabForDeliveryFile(file, detail);
                const phaseInfo = phaseByFileName.get(file.relativePath);
                const isActive = Boolean(targetTab && activeTab === targetTab);
                const isDirectory = file.kind === "directory";
                const isSelectable = Boolean(targetTab);
                const Icon = isDirectory ? FolderOpen : FileText;

                return (
                  <div
                    key={file.relativePath}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] gap-1"
                  >
                    <FileNavButton
                      active={isActive}
                      icon={Icon}
                      label={
                        phaseInfo
                          ? `Phase ${String(phaseInfo.index + 1).padStart(2, "0")} · ${phaseInfo.phase.title}`
                          : labelForDeliveryFile(file)
                      }
                      fileName={`${file.relativePath}${file.kind === "file" && file.sizeBytes !== undefined ? ` · ${formatFileSize(file.sizeBytes)}` : ""}`}
                      status={statusForDeliveryFile(file, detail)}
                      muted={!isSelectable}
                      disabled={isDirectory}
                      draggable={file.kind === "file"}
                      onDragStart={(event) => startPackageFileDrag(event, file)}
                      onClick={() => {
                        if (targetTab) onSelect(targetTab);
                      }}
                    />
                    {phaseInfo && (
                      <div className="flex flex-col gap-1 opacity-70 transition group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onMovePhase(phaseInfo.phase.id, "up")}
                          disabled={saving || phaseInfo.index === 0}
                          title="Move phase up"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onMovePhase(phaseInfo.phase.id, "down")}
                          disabled={saving || phaseInfo.index === detail.phases.length - 1}
                          title="Move phase down"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelect("new-phase")}
            disabled={saving}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-dashed border-border/80 px-3 py-2 text-left text-xs transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
              activeTab === "new-phase" &&
                "border-ring bg-accent ring-1 ring-ring",
            )}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            Add phase file
          </button>
        </CardContent>
      </Card>
    </aside>
  );
}

function FileNavButton({
  active,
  icon: Icon,
  label,
  fileName,
  status,
  muted,
  disabled,
  draggable,
  onDragStart,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  fileName: string;
  status?: string;
  muted?: boolean;
  disabled?: boolean;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      draggable={draggable}
      onDragStart={onDragStart}
      title={draggable ? "Drag this file out, or click to edit when available" : undefined}
      className={cn(
        "flex min-h-20 w-full min-w-0 items-start gap-2 rounded-md border border-border/70 bg-card px-3 py-3 text-left transition hover:bg-accent disabled:cursor-default disabled:hover:bg-card",
        active && "border-ring bg-accent ring-1 ring-ring",
        muted && !active && "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 break-words text-xs font-medium leading-snug">{label}</span>
        <span className="mt-1 block line-clamp-2 break-all text-[11px] leading-snug text-muted-foreground">
          {fileName}
        </span>
      </span>
      {status && (
        <DeliveryStatusIcon status={status} className="mt-0.5 h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ToolbarButton({
  active,
  onClick,
  icon: Icon,
  label,
  title,
  status,
  muted,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  title: string;
  status?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "relative flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
        active && "border-ring bg-accent ring-1 ring-ring",
        muted && !active && "text-muted-foreground",
      )}
    >
      {status && (
        <DeliveryStatusIcon
          status={status}
          className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
        />
      )}
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="line-clamp-2 px-1 text-center font-medium leading-tight">
        {label}
      </span>
    </button>
  );
}

function EditorCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
