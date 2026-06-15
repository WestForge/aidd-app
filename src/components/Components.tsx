import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDashed,
  Database,
  Eye,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  Pencil,
  PlayCircle,
  Plug,
  Plus,
  Puzzle,
  Save,
  Search,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { MarkdownEditor } from "./MarkdownEditor";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { cn } from "../lib/utils";

const statusOptions: AiddSetupStatus[] = [
  "not-started",
  "draft",
  "in-review",
  "active",
  "deprecated",
  "complete",
  "skipped",
];

const componentSectionStatusOptions: AiddSetupStatus[] = ["draft", "complete", "skipped"];

const componentSourceTypeOptions = [
  { value: "webapp", label: "Web app" },
  { value: "desktop-app", label: "Desktop app" },
  { value: "plugin", label: "Plugin" },
  { value: "library", label: "Library" },
  { value: "service", label: "Service" },
  { value: "api", label: "API" },
  { value: "cli", label: "CLI" },
  { value: "game-module", label: "Game module" },
  { value: "shared-module", label: "Shared module" },
  { value: "test-suite", label: "Test suite" },
  { value: "other", label: "Other" },
];

type ComponentView = "list" | "new" | "edit";
type ComponentSection = {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  skipReason?: string;
  prompt?: string;
};

const icons = [
  Sparkles,
  Layers,
  Plug,
  Database,
  GitBranch,
  Workflow,
  Zap,
  ShieldAlert,
];

const componentTemplateSections: ComponentSection[] = [
  {
    key: "purpose",
    fileName: "01-purpose.md",
    title: "Purpose",
    body: `## Purpose
TODO: Define why this component exists.

## Responsibilities

- TODO

## Outcomes Supported

- TODO

## Capabilities Supported

List capabilities this component helps deliver. Do not copy capability behaviour into this file.

- TODO`,
    prompt: "Define why this component exists and which outcomes it supports.",
  },
  {
    key: "boundaries",
    fileName: "02-boundaries.md",
    title: "Boundaries",
    body: `## Owns

- TODO: List responsibilities, state, assets, or services this component owns.

## Does Not Own

- TODO: List responsibilities owned by other components or systems.

## May Depend On

- TODO: List allowed component or platform dependencies.

## May Be Used By

- TODO: List expected consumers.

## Exposes

- TODO: List public interfaces, events, data contracts, services, tools, or extension points.

## Forbidden Coupling

- TODO: List things implementations must not do across this boundary.

## Boundary Change Rules

Changing this component boundary requires a decision record when:

- a new component dependency is introduced
- ownership of runtime state moves between components
- another component starts writing component-owned state
- this component starts directly controlling another component's responsibilities
- a capability requires behaviour that does not fit the existing boundary`,
    prompt: "Define ownership, consumers, exposed contracts, and forbidden coupling.",
  },
  {
    key: "interfaces",
    fileName: "03-interfaces.md",
    title: "Interfaces",
    body: `## Purpose

Define the public and consumed technical contracts for this component.

## Public Interfaces

- TODO: APIs, services, events, extension points, asset contracts, messages, commands, or UI/tooling entry points exposed by this component.

## Consumed Interfaces

- TODO: Interfaces this component consumes from other components or platform systems.

## Contract Rules

- TODO: Versioning, compatibility, validation, error behaviour, and ownership rules.

## Capability Relationship

Capabilities may require new or changed interfaces, but the interface definition belongs here when this component owns it.`,
    prompt: "Capture public and consumed contracts owned by this component.",
  },
  {
    key: "data-and-state",
    fileName: "04-data-and-state.md",
    title: "Data & State",
    body: `## Purpose

Define data, state, persistence, and invariants owned by this component.

## Owned State

- TODO: Runtime state this component owns.

## Owned Data Assets / Documents

- TODO: Assets, files, records, schemas, tables, or documents this component owns.

## External Data Consumed

- TODO: Data read from other components or services.

## Data Not Owned

- TODO: Data this component must not write or treat as authoritative.

## Validation and Invariants

- TODO: Required validation, consistency rules, failure modes, and integrity checks.

## Persistence and Migration

- TODO: Persistence rules, migration rules, compatibility concerns, or versioning constraints.

## Capability Relationship

Capabilities can say what data is needed for behaviour. Ownership, schema shape, persistence, and invariants belong in this component file.`,
    prompt: "Define owned data, state, validation rules, and persistence boundaries.",
  },
  {
    key: "dependencies",
    fileName: "05-dependencies.md",
    title: "Dependencies",
    body: `## Purpose

Define allowed and forbidden dependencies for this component.

## Allowed Dependencies

- TODO

## Forbidden Dependencies

- TODO

## Required Dependency Direction

\`\`\`text
TODO: ComponentA -> ComponentB
\`\`\`

## Dependency Change Rule

Any new dependency that crosses component, runtime/editor, product/platform, or generic/project-specific boundaries requires a decision record before implementation.`,
    prompt: "Define allowed dependencies and dependency direction rules.",
  },
  {
    key: "architecture",
    fileName: "06-architecture.md",
    title: "Architecture",
    body: `## Purpose

Define the technical shape of this component.

## Architectural Role

TODO: Explain this component's role in the system.

## Main Areas

### Area 1

TODO

### Area 2

TODO

## Internal Flow

TODO: Describe important internal flows, lifecycle, ownership handoffs, or extension points.

## Failure Model

TODO: Describe expected failure handling, fallback behaviour, diagnostics, and recovery rules.

## Architecture Change Rule

Architecture changes that affect ownership, dependencies, state, or public interfaces require a component decision record and should be referenced by the delivery slice implementing the change.`,
    prompt: "Describe the component's technical shape, internal flows, and failure model.",
  },
  {
    key: "standards",
    fileName: "07-standards.md",
    title: "Standards",
    body: `## Implementation Standards

- TODO

## Naming Standards

- TODO

## Testing and Verification Standards

- TODO

## Documentation Standards

- TODO

## AI Agent Standards

- Stay inside the delivery slice scope.
- Respect component boundaries and dependency direction.
- Do not move architecture or data ownership into capability docs.
- Report missing component dependencies or boundary conflicts instead of silently introducing coupling.`,
    prompt: "Define implementation, naming, testing, documentation, and AI-agent standards.",
  },
  {
    key: "risks",
    fileName: "08-risks.md",
    title: "Risks",
    body: `## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns

- TODO

## Boundary / Coupling Risks

- TODO

## Operational Risks

- TODO`,
    prompt: "Capture component risks, unknowns, coupling risks, and operational concerns.",
  },
];

function statusLabel(status?: string) {
  return status === "complete" ? "ready" : (status ?? "draft").replace(/-/g, " ");
}

const statusVisuals: Record<
  AiddSetupStatus,
  {
    icon: typeof Circle;
    className: string;
    surfaceClassName: string;
    badgeClassName: string;
    barClassName: string;
  }
> = {
  "not-started": {
    icon: CircleDashed,
    className: "text-muted-foreground",
    surfaceClassName: "border-muted-foreground/30 bg-muted/20",
    badgeClassName:
      "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
    barClassName: "bg-muted-foreground/45",
  },
  draft: {
    icon: Pencil,
    className: "text-sky-400",
    surfaceClassName: "border-sky-400/45 bg-sky-400/10",
    badgeClassName: "border-sky-400/45 bg-sky-400/15 text-sky-100",
    barClassName: "bg-sky-400",
  },
  "in-review": {
    icon: Eye,
    className: "text-amber-400",
    surfaceClassName: "border-amber-400/50 bg-amber-400/10",
    badgeClassName: "border-amber-400/50 bg-amber-400/15 text-amber-100",
    barClassName: "bg-amber-400",
  },
  active: {
    icon: PlayCircle,
    className: "text-emerald-400",
    surfaceClassName: "border-emerald-400/55 bg-emerald-400/10",
    badgeClassName: "border-emerald-400/55 bg-emerald-400/15 text-emerald-100",
    barClassName: "bg-emerald-400",
  },
  deprecated: {
    icon: Archive,
    className: "text-orange-400",
    surfaceClassName: "border-orange-400/50 bg-orange-400/10",
    badgeClassName: "border-orange-400/50 bg-orange-400/15 text-orange-100",
    barClassName: "bg-orange-400",
  },
  complete: {
    icon: CheckCircle2,
    className: "text-green-400",
    surfaceClassName: "border-green-400/55 bg-green-400/10",
    badgeClassName: "border-green-400/55 bg-green-400/15 text-green-100",
    barClassName: "bg-green-400",
  },
  skipped: {
    icon: SkipForward,
    className: "text-zinc-400",
    surfaceClassName: "border-zinc-400/40 bg-zinc-400/10",
    badgeClassName: "border-zinc-400/40 bg-zinc-400/15 text-zinc-100",
    barClassName: "bg-zinc-400",
  },
};

function getStatusVisual(status?: string) {
  return (
    statusVisuals[(status as AiddSetupStatus) || "draft"] ?? statusVisuals.draft
  );
}

function StatusIcon({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const visual = getStatusVisual(status);
  const Icon = visual.icon;
  return (
    <Icon className={cn("h-4 w-4 shrink-0", visual.className, className)} />
  );
}

function StatusPill({ status }: { status?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <StatusIcon status={status} />
      {statusLabel(status)}
    </span>
  );
}

function StatusBadge({ status, label }: { status?: string; label?: string }) {
  const visual = getStatusVisual(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium capitalize",
        visual.badgeClassName,
      )}
    >
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {label ? `${label}: ` : null}
      {statusLabel(status)}
    </span>
  );
}

function newSections() {
  return componentTemplateSections.map((section) => ({
    ...section,
    body: section.body,
    status: "draft" as AiddSetupStatus,
  }));
}

function contractLabel(status?: string) {
  if (!status) return "missing";
  return status.replace(/-/g, " ");
}

function sourceTypeLabel(type?: string) {
  return (
    componentSourceTypeOptions.find((option) => option.value === type)?.label ??
    (type || "other").replace(/-/g, " ")
  );
}

function looksLikeAbsoluteSourcePath(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed.match(/^[a-zA-Z]:[\\/]/) || trimmed.startsWith("/") || trimmed.startsWith("\\\\"));
}

function sourcePathModeLabel(pathMode?: string) {
  return pathMode === "absolute" ? "Absolute path" : "Workspace-relative";
}

export function Components({
  activeProject,
  onOpenCapability,
}: {
  activeProject?: AiddTrackedProject | null;
  onOpenCapability?: (slug: string) => void;
}) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [view, setView] = useState<ComponentView>("list");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<AiddSetupStatus>("draft");
  const [sections, setSections] = useState<ComponentSection[]>(newSections());
  const [activeSectionKey, setActiveSectionKey] = useState("purpose");
  const [selectedSourceProjects, setSelectedSourceProjects] = useState<string[]>([]);
  const [sourceDirectory, setSourceDirectory] = useState("");
  const [sourceType, setSourceType] = useState("webapp");
  const [sourcePathMode, setSourcePathMode] = useState<AiddComponentSourcePathMode>("workspace-relative");
  const [sourceIsInsideWorkspace, setSourceIsInsideWorkspace] = useState(true);
  const [sourceWarning, setSourceWarning] = useState("");
  const [sourceDetection, setSourceDetection] = useState<AiddComponentSourceDetection | null>(null);
  const [detectingSource, setDetectingSource] = useState(false);
  const [showSourceConfig, setShowSourceConfig] = useState(false);
  const [linkedCapabilities, setLinkedCapabilities] = useState<string[]>([]);
  const [contract, setContract] = useState<AiddComponentContractInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionDragFiles, setSectionDragFiles] = useState<Record<string, string>>({});
  const [contractDragFilePath, setContractDragFilePath] = useState<string | null>(null);
  const [reviewPackage, setReviewPackage] = useState<AiddComponentReviewPackageResult | null>(null);
  const [reviewPackageDragFilePath, setReviewPackageDragFilePath] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const load = async () => {
    if (!activeProject?.path) return;
    const nextSetup = await window.aidd.readProjectSetup(activeProject.path);
    setSetup(nextSetup);
  };

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [activeProject?.path]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const component of setup?.components ?? []) {
      counts.set(
        component.status ?? "draft",
        (counts.get(component.status ?? "draft") ?? 0) + 1,
      );
    }
    return counts;
  }, [setup?.components]);

  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ?? sections[0];
  const canGenerateContract = view === "edit" && Boolean(editingSlug);
  const contractReady = view === "edit" && contract?.status === "current";
  const sourceConfig: AiddComponentSourceConfig = {
    directory: sourceDirectory.trim(),
    type: sourceType || "other",
    pathMode: sourcePathMode,
    isInsideWorkspace: sourceIsInsideWorkspace,
    ...(sourcePathMode === "absolute" && sourceDirectory.trim()
      ? { absolutePath: sourceDirectory.trim() }
      : {}),
    ...(sourceWarning.trim() ? { warning: sourceWarning.trim() } : {}),
    detection: sourceDetection,
  };

  const resetForm = () => {
    setEditingSlug(null);
    setTitle("");
    setStatus("draft");
    setSections(newSections());
    setActiveSectionKey("purpose");
    setSelectedSourceProjects([]);
    setSourceDirectory("");
    setSourceType("webapp");
    setSourcePathMode("workspace-relative");
    setSourceIsInsideWorkspace(true);
    setSourceWarning("");
    setSourceDetection(null);
    setDetectingSource(false);
    setShowSourceConfig(false);
    setLinkedCapabilities([]);
    setContract(null);
    setReviewPackage(null);
    setReviewPackageDragFilePath(null);
    setDragError(null);
    setSectionDragFiles({});
    setContractDragFilePath(null);
  };

  const backToList = () => {
    resetForm();
    setView("list");
  };

  const openEdit = async (slug: string) => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const component = await window.aidd.readComponent({
        projectPath: activeProject.path,
        slug,
      });
      setEditingSlug(component.slug);
      setTitle(component.title);
      setStatus((component.status as AiddSetupStatus) || "draft");
      setSelectedSourceProjects(component.sourceProjects || []);
      const nextSourcePathMode = component.source?.pathMode || (looksLikeAbsoluteSourcePath(component.source?.directory || "") ? "absolute" : "workspace-relative");
      setSourceDirectory(component.source?.directory || "");
      setSourceType(component.source?.type || "webapp");
      setSourcePathMode(nextSourcePathMode);
      setSourceIsInsideWorkspace(component.source?.isInsideWorkspace ?? nextSourcePathMode === "workspace-relative");
      setSourceWarning(component.source?.warning || "");
      setSourceDetection(component.source?.detection || null);
      setDetectingSource(false);
      setShowSourceConfig(false);
      setLinkedCapabilities(component.capabilities || []);
      setContract(component.contract || null);
      setContractDragFilePath(null);
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      setSections(component.sections?.length ? component.sections : newSections());
      setActiveSectionKey(component.sections?.[0]?.key || "purpose");
      setView("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateActiveSectionBody = (body: string) =>
    setSections((current) =>
      current.map((section) =>
        section.key === activeSectionKey
          ? {
              ...section,
              body,
              status:
                body.trim() && section.status === "not-started"
                  ? "draft"
                  : section.status,
            }
          : section,
      ),
    );

  const updateActiveSectionStatus = (nextStatus: AiddSetupStatus) =>
    setSections((current) =>
      current.map((section) =>
        section.key === activeSectionKey
          ? { ...section, status: nextStatus }
          : section,
      ),
    );

  const updateActiveSectionSkipReason = (skipReason: string) =>
    setSections((current) =>
      current.map((section) =>
        section.key === activeSectionKey
          ? { ...section, skipReason }
          : section,
      ),
    );

  const createComponent = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createComponent({
        projectPath: activeProject.path,
        title,
        status,
        sourceProjects: selectedSourceProjects,
        source: sourceConfig,
        sections,
      });
      setSetup(next);
      void window.aidd.notify({ title: "Saved", body: "Component created." });
      backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateComponent = async () => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.updateComponent({
        projectPath: activeProject.path,
        slug: editingSlug,
        title,
        status,
        sourceProjects: selectedSourceProjects,
        source: sourceConfig,
        sections,
      });
      setSetup(next);
      void window.aidd.notify({ title: "Saved", body: "Component saved." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const generateComponentContract = async () => {
    if (!activeProject?.path || !editingSlug) return;

    setSaving(true);
    setError(null);
    try {
      await window.aidd.updateComponent({
        projectPath: activeProject.path,
        slug: editingSlug,
        title,
        status,
        sourceProjects: selectedSourceProjects,
        source: sourceConfig,
        sections,
      });
      const component = await window.aidd.generateComponentContract({
        projectPath: activeProject.path,
        slug: editingSlug,
      });
      setContract(component.contract || null);
      setSections(component.sections?.length ? component.sections : sections);
      setSelectedSourceProjects(component.sourceProjects || selectedSourceProjects);
      const nextSourcePathMode = component.source?.pathMode || sourcePathMode;
      setSourceDirectory(component.source?.directory || sourceDirectory);
      setSourceType(component.source?.type || sourceType);
      setSourcePathMode(nextSourcePathMode);
      setSourceIsInsideWorkspace(component.source?.isInsideWorkspace ?? sourceIsInsideWorkspace);
      setSourceWarning(component.source?.warning || sourceWarning);
      setSourceDetection(component.source?.detection || sourceDetection);
      setLinkedCapabilities(component.capabilities || linkedCapabilities);
      const nextSetup = await window.aidd.readProjectSetup(activeProject.path);
      setSetup(nextSetup);
      const filePath = await window.aidd.prepareComponentContractDragFile({
        projectPath: activeProject.path,
        slug: editingSlug,
      });
      setContractDragFilePath(filePath);
      void window.aidd.notify({
        title: "component.md ready",
        body: "The component contract is ready to drag out from the component file bar.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const applySourceDetection = (selection: AiddComponentSourceDirectorySelection) => {
    setSourceDirectory(selection.directory);
    setSourcePathMode(selection.pathMode);
    setSourceIsInsideWorkspace(selection.isInsideWorkspace);
    setSourceWarning(selection.warning || "");
    setSourceDetection(selection.detection);
    setSourceType(selection.detection.suggestedType || "other");
    void window.aidd.notify({
      title: selection.isInsideWorkspace ? "Source detected" : "External source detected",
      body: `${sourceTypeLabel(selection.detection.suggestedType)} (${selection.detection.confidence} confidence).`,
    });
  };

  const browseSourceDirectory = async () => {
    if (!activeProject?.path) return;
    setDetectingSource(true);
    setError(null);
    try {
      const selection = await window.aidd.selectComponentSourceDirectory({
        projectPath: activeProject.path,
        currentDirectory: sourceDirectory,
      });
      if (selection) applySourceDetection(selection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetectingSource(false);
    }
  };

  const detectSourceDirectory = async () => {
    if (!activeProject?.path || !sourceDirectory.trim()) return;
    setDetectingSource(true);
    setError(null);
    try {
      const selection = await window.aidd.detectComponentSourceDirectory({
        projectPath: activeProject.path,
        directory: sourceDirectory,
      });
      applySourceDetection(selection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetectingSource(false);
    }
  };

  const createComponentReviewPackage = async () => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    try {
      await window.aidd.updateComponent({
        projectPath: activeProject.path,
        slug: editingSlug,
        title,
        status,
        sourceProjects: selectedSourceProjects,
        source: sourceConfig,
        sections,
      });
      const bundle = await window.aidd.packageComponentForReview({
        projectPath: activeProject.path,
        slug: editingSlug,
      });
      setReviewPackage(bundle);
      setReviewPackageDragFilePath(bundle.filePath);
      void window.aidd.notify({
        title: "Component review package ready",
        body: `${bundle.componentFileCount} component file(s) packaged. Drag the review zip tile out when ready.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const startComponentReviewPackageDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!reviewPackageDragFilePath) {
      event.preventDefault();
      setDragError("Click the review package tile before dragging it.");
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", reviewPackageDragFilePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(reviewPackageDragFilePath);
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

  const importComponentReviewPackage = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeProject?.path) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setDragError("Drop a returned component review .zip onto this tile.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setDragError("Review response rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const result = await window.aidd.importComponentReviewPackage({
        projectPath: activeProject.path,
        zipPath,
      });
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      await load();
      const importedSlug = result.importedComponents?.length === 1 ? result.importedComponents[0] : editingSlug;
      if (importedSlug) await openEdit(importedSlug);
      void window.aidd.notify({
        title: "Component review imported",
        body: `${result.importedFiles.length} file(s) imported from ${result.componentCount} component(s).`,
      });
    } catch (err) {
      setDragError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const prepareComponentContractDragFile = async () => {
    if (!activeProject?.path || !editingSlug || contract?.status !== "current") {
      setContractDragFilePath(null);
      return null;
    }

    const filePath = await window.aidd.prepareComponentContractDragFile({
      projectPath: activeProject.path,
      slug: editingSlug,
    });
    setContractDragFilePath(filePath);
    setDragError(null);
    return filePath;
  };

  const startComponentContractDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!contractReady) {
      event.preventDefault();
      setDragError("Generate component.md before dragging it.");
      return;
    }

    if (!contractDragFilePath) {
      event.preventDefault();
      setDragError("component.md is still being prepared for drag-out. Try again in a moment.");
      prepareComponentContractDragFile().catch((err) =>
        setDragError(err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", contractDragFilePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(contractDragFilePath);
  };

  const prepareComponentSectionDragFile = async (section: ComponentSection) => {
    if (!activeProject?.path) return null;

    const componentName = title.trim() || "New component";
    const filePath = await window.aidd.prepareMarkdownDragFile({
      projectPath: activeProject.path,
      directory: editingSlug ? `components/${editingSlug}` : "components/draft",
      fileName: section.fileName,
      title: `${componentName} - ${section.title}`,
      status: section.status || "draft",
      body: section.body || "",
      metadata: {
        component: editingSlug || "draft",
        section: section.key,
        skipReason: section.skipReason || "",
      },
    });

    setSectionDragFiles((current) => ({ ...current, [section.key]: filePath }));
    setDragError(null);
    return filePath;
  };

  useEffect(() => {
    if (!activeProject?.path || view === "list") {
      setSectionDragFiles({});
      return;
    }

    const timer = window.setTimeout(() => {
      Promise.all(sections.map((section) => prepareComponentSectionDragFile(section))).catch(
        (err) => {
          setSectionDragFiles({});
          setDragError(err instanceof Error ? err.message : String(err));
        },
      );
    }, 350);

    return () => window.clearTimeout(timer);
  }, [activeProject?.path, editingSlug, title, sections, view]);

  useEffect(() => {
    if (!activeProject?.path || view !== "edit" || !editingSlug || contract?.status !== "current") {
      setContractDragFilePath(null);
      return;
    }

    let cancelled = false;
    window.aidd
      .prepareComponentContractDragFile({ projectPath: activeProject.path, slug: editingSlug })
      .then((filePath) => {
        if (!cancelled) setContractDragFilePath(filePath);
      })
      .catch(() => {
        if (!cancelled) setContractDragFilePath(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject?.path, view, editingSlug, contract?.status, contract?.sourceHash, contract?.version]);

  const startComponentSectionDrag = (
    event: DragEvent<HTMLButtonElement>,
    section: ComponentSection,
  ) => {
    const filePath = sectionDragFiles[section.key];

    if (!filePath) {
      event.preventDefault();
      setDragError(
        `${section.title} is still being prepared for drag-out. Try again in a moment.`,
      );
      prepareComponentSectionDragFile(section).catch((err) =>
        setDragError(err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", filePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(filePath);
  };

  if (!activeProject)
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );

  if (view === "list")
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
          <div>
            <h1 className="text-xl font-semibold">Components</h1>
            <p className="text-sm text-muted-foreground">
              Define the parts that own architecture, state, interfaces, and standards.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                resetForm();
                setView("new");
              }}
            >
              <Plus className="h-4 w-4" /> New Component
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="mb-6 grid gap-3 md:grid-cols-4">
            <Metric label="Total" value={setup?.components.length ?? 0} />
            <Metric label="Draft" value={statusCounts.get("draft") ?? 0} />
            <Metric label="Active" value={statusCounts.get("active") ?? 0} />
            <Metric label="Deprecated" value={statusCounts.get("deprecated") ?? 0} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {setup?.components.map((component) => {
              const capabilities = setup.capabilities.filter((capability) =>
                capability.components?.includes(component.slug),
              );
              return (
                <Card
                  key={component.slug}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => openEdit(component.slug)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{component.title}</CardTitle>
                        <CardDescription>
                          {capabilities.length
                            ? `${capabilities.length} linked capability/capabilities`
                            : "No capabilities linked yet"}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline">
                          <StatusPill status={component.status} />
                        </Badge>
                        <Badge variant={component.contract?.status === "current" ? "secondary" : "outline"}>
                          Contract: {contractLabel(component.contract?.status)}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {component.source?.directory ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={component.source.isInsideWorkspace ? "outline" : "secondary"}>
                          {sourceTypeLabel(component.source.type)} · {component.source.directory}
                        </Badge>
                        {component.source.pathMode === "absolute" && (
                          <Badge variant="outline">Absolute source path</Badge>
                        )}
                      </div>
                    ) : null}
                    {capabilities.length ? (
                      <div className="flex flex-wrap gap-2">
                        {capabilities.map((capability) => (
                          <Badge key={capability.slug} variant="secondary">
                            {capability.title}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Open the editor to define section files and source mappings.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {setup && setup.components.length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardHeader>
                  <Puzzle className="h-6 w-6" />
                  <CardTitle>No components yet</CardTitle>
                  <CardDescription>
                    Create components to represent the parts that make capabilities possible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => {
                      resetForm();
                      setView("new");
                    }}
                  >
                    New Component
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={backToList}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              className="max-w-lg text-base font-semibold"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Component name"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} label="Lifecycle" />
          <StatusBadge status={activeSection?.status} label="Section" />
          <Button
            variant="outline"
            onClick={() => setShowSourceConfig((current) => !current)}
            title="Configure the source directory owned by this component"
          >
            <GitBranch className="h-4 w-4" />
            Configure source
          </Button>
          <Button
            onClick={view === "edit" ? updateComponent : createComponent}
            disabled={saving || !title.trim()}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : view === "edit" ? "Save" : "Save component"}
          </Button>
        </div>
      </header>
      {error && (
        <div className="shrink-0 px-6 pt-4">
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      {showSourceConfig && (
        <div className="shrink-0 border-b bg-muted/20 px-6 py-4">
          <Card>
            <CardHeader>
              <CardTitle>Component source</CardTitle>
              <CardDescription>
                Reference the implementation directory this component owns. This is stored with
                the component and included in the generated component contract.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Source directory</span>
                  <div className="flex gap-2">
                    <Input
                      value={sourceDirectory}
                      onChange={(event) => {
                        const nextDirectory = event.target.value;
                        const absolute = looksLikeAbsoluteSourcePath(nextDirectory);
                        setSourceDirectory(nextDirectory);
                        setSourcePathMode(absolute ? "absolute" : "workspace-relative");
                        setSourceIsInsideWorkspace(!absolute);
                        setSourceWarning(absolute ? "This absolute source path may break for other users. Prefer a directory inside the configured workspace when possible." : "");
                        setSourceDetection(null);
                      }}
                      placeholder="Source/StormRuntime or src/components/editor-shell"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={browseSourceDirectory}
                      disabled={detectingSource}
                    >
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={detectSourceDirectory}
                      disabled={detectingSource || !sourceDirectory.trim()}
                    >
                      <Search className="h-4 w-4" />
                      {detectingSource ? "Detecting..." : "Detect"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select or enter the directory owned by this component. Paths inside the configured workspace
                    are stored as workspace-relative; paths outside the workspace are allowed but not portable.
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Source type</span>
                  <Select
                    className="w-full"
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value)}
                  >
                    {componentSourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  {sourceDetection && sourceDetection.suggestedType !== sourceType && (
                    <p className="text-xs text-muted-foreground">
                      Auto-detected as {sourceTypeLabel(sourceDetection.suggestedType)}.
                    </p>
                  )}
                </div>
              </div>
              {sourceDirectory.trim() && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={sourceIsInsideWorkspace ? "secondary" : "outline"}>
                    {sourcePathModeLabel(sourcePathMode)}
                  </Badge>
                  <Badge variant={sourceIsInsideWorkspace ? "secondary" : "outline"}>
                    {sourceIsInsideWorkspace ? "Inside workspace" : "Outside workspace"}
                  </Badge>
                  {sourcePathMode === "absolute" && (
                    <Badge variant="outline">Not portable</Badge>
                  )}
                </div>
              )}
              {sourceWarning && (
                <Alert>
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Source path warning</AlertTitle>
                  <AlertDescription>{sourceWarning}</AlertDescription>
                </Alert>
              )}
              {sourceDetection && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium">Detected source</span>
                    <Badge variant="secondary">{sourceTypeLabel(sourceDetection.suggestedType)}</Badge>
                    <Badge variant="outline">{sourceDetection.confidence} confidence</Badge>
                    {sourceDetection.packageManager && (
                      <Badge variant="outline">{sourceDetection.packageManager}</Badge>
                    )}
                  </div>
                  {(((sourceDetection.detectedMarkers?.length ?? 0) > 0) || sourceDetection.detectedFrameworks.length > 0 || sourceDetection.detectedLanguages.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {(sourceDetection.detectedMarkers ?? []).map((marker) => (
                        <Badge key={`marker-${marker}`} variant="outline">
                          {marker}
                        </Badge>
                      ))}
                      {sourceDetection.detectedFrameworks.map((framework) => (
                        <Badge key={`framework-${framework}`} variant="secondary">
                          {framework}
                        </Badge>
                      ))}
                      {sourceDetection.detectedLanguages.map((language) => (
                        <Badge key={`language-${language}`} variant="outline">
                          {language}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {sourceDetection.reasons.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {sourceDetection.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b bg-muted/30 px-6 py-2">
        {sections.map((section, index) => {
          const Icon = icons[index] ?? FileText;
          return (
            <button
              key={section.key}
              draggable={Boolean(sectionDragFiles[section.key])}
              className={cn(
                "relative flex h-16 w-32 shrink-0 cursor-grab flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent active:cursor-grabbing",
                activeSectionKey === section.key &&
                  "border-ring bg-accent ring-1 ring-ring",
                !sectionDragFiles[section.key] && "cursor-default opacity-80",
              )}
              onClick={() => setActiveSectionKey(section.key)}
              onDragStart={(event) => startComponentSectionDrag(event, section)}
              onFocus={() => prepareComponentSectionDragFile(section).catch(() => undefined)}
              onMouseEnter={() => prepareComponentSectionDragFile(section).catch(() => undefined)}
              title={`${section.title}: ${statusLabel(section.status)}. Drag this file out.`}
            >
              <StatusIcon
                status={section.status}
                className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
              />
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <Icon className="h-4 w-4" />
              </div>
              <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
                {section.title}
              </span>
              <span className="line-clamp-1 text-[10px] text-muted-foreground">
                {section.fileName}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          draggable={Boolean(reviewPackageDragFilePath)}
          className={cn(
            "relative flex h-16 w-36 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
            reviewPackageDragFilePath && "cursor-grab active:cursor-grabbing",
            !reviewPackageDragFilePath && canGenerateContract && "cursor-pointer",
            !canGenerateContract && !reviewPackageDragFilePath && "opacity-70",
          )}
          onClick={() => {
            if (canGenerateContract) void createComponentReviewPackage();
            else setDragError("Generate the component contract before creating a review package. You can still drop a returned component review zip here.");
          }}
          onDragStart={startComponentReviewPackageDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={importComponentReviewPackage}
          title={reviewPackageDragFilePath ? "Review package is ready. Drag this zip out, or drop a returned review zip here." : "Create a component review package zip, or drop a returned review zip here."}
        >
          <StatusIcon
            status={reviewPackageDragFilePath ? "complete" : "not-started"}
            className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
          />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Archive className={cn("h-4 w-4", reviewPackageDragFilePath && "text-green-400")} />
          </div>
          <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
            Review package
          </span>
          <span className="line-clamp-1 text-[10px] text-muted-foreground">
            {saving ? "Working..." : reviewPackage ? "Ready to drag/drop" : "Create/drop zip"}
          </span>
        </button>
      </div>
      {dragError && (
        <div className="shrink-0 px-6 pt-2 text-xs text-destructive">
          {dragError}
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CardHeader className="shrink-0">
              <div>
                <CardTitle>{activeSection?.title}</CardTitle>
                <CardDescription>{activeSection?.prompt}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden p-4">
              <MarkdownEditor
                editorKey={`component-${editingSlug}-${activeSection?.fileName ?? "section"}`}
                className="h-full"
                value={activeSection?.body || ""}
                initialValue={activeSection?.body || ""}
                onChange={updateActiveSectionBody}
              />
            </CardContent>
          </Card>
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Components own technical detail. Capabilities should reference components
                instead of copying architecture, data, or dependency rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-4">
              <div className="space-y-1">
                <span className="text-muted-foreground">Lifecycle</span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
                  <StatusIcon status={status} />
                  <span>{statusLabel(status)}</span>
                </div>
                <Select
                  className="w-full"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as AiddSetupStatus)
                  }
                >
                  {statusOptions.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">Section status</span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
                  <StatusIcon status={activeSection?.status} />
                  <span>{statusLabel(activeSection?.status)}</span>
                </div>
                <Select
                  className="w-full"
                  value={(activeSection?.status as AiddSetupStatus) || "not-started"}
                  onChange={(event) =>
                    updateActiveSectionStatus(event.target.value as AiddSetupStatus)
                  }
                >
                  {componentSectionStatusOptions.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item)}
                    </option>
                  ))}
                </Select>
                {activeSection?.status === "skipped" && (
                  <Input
                    className="w-full"
                    value={activeSection.skipReason || ""}
                    onChange={(event) => updateActiveSectionSkipReason(event.target.value)}
                    placeholder="Why is this section skipped?"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:justify-center">
                <div>
                  <span className="text-muted-foreground">Component contract</span>
                  <div className="font-semibold capitalize">
                    {contractLabel(contract?.status)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Version</span>
                  <Badge variant={contract?.status === "current" ? "secondary" : "outline"}>
                    {contract?.version || "None"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:justify-center">
                <div>
                  <span className="text-muted-foreground">Sections</span>
                  <div className="font-semibold">
                    {sections.length} files
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Source</span>
                  <Badge variant={sourceDirectory.trim() ? "secondary" : "outline"}>
                    {sourceDirectory.trim() ? sourceTypeLabel(sourceType) : "Not configured"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Capabilities supported</CardTitle>
              <CardDescription>
                Capability behaviour stays in capability files. This component records the
                technical ownership needed to support those capabilities.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {linkedCapabilities.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {linkedCapabilities.map((capabilitySlug) => {
                    const capability = setup?.capabilities.find(
                      (item) => item.slug === capabilitySlug,
                    );
                    return (
                      <button
                        key={capabilitySlug}
                        type="button"
                        className="rounded-md border bg-card p-3 text-left transition hover:border-ring hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={() => onOpenCapability?.(capabilitySlug)}
                        title={onOpenCapability ? "Open linked capability" : `capabilities/${capabilitySlug}/index.md`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {capability?.title || capabilitySlug}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              capabilities/{capabilitySlug}/index.md
                            </div>
                          </div>
                          <Badge variant="outline" className="shrink-0 capitalize">
                            {statusLabel(capability?.status)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>Linked component: {title.trim() || editingSlug}</span>
                          <span>•</span>
                          <span>{capability?.components?.length ?? 0} component link(s)</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No capabilities currently link to this component. Link components from the
                  capability editor.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
