import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  Circle,
  CircleDashed,
  Copy,
  Database,
  Eye,
  FileText,
  Filter,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  Pencil,
  PlayCircle,
  Plug,
  PackagePlus,
  Plus,
  Puzzle,
  Save,
  Search,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  Zap,
  X,
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
import { statusBarClass, statusPillClass, statusSurfaceClass, statusTextClass } from "../lib/statusTheme";

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

type ComponentView = "list" | "new" | "edit" | "technical-change";
type ComponentSection = {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  skipReason?: string;
  prompt?: string;
};

type TechnicalChangeSection = AiddComponentTechnicalChangeSection;

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

const technicalChangeStatusOptions: AiddComponentTechnicalChangeStatus[] = [
  "draft",
  "needs-review",
  "approved",
  "rejected",
  "packaged",
  "delivered",
];

const technicalChangeRiskOptions: AiddComponentTechnicalChangeRisk[] = [
  "unknown",
  "low",
  "medium",
  "high",
];

const technicalChangeSectionIcons = [
  FileText,
  GitBranch,
  ShieldAlert,
  CheckCircle2,
  Eye,
  Zap,
  Pencil,
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
    className: statusTextClass("not-started"),
    surfaceClassName: statusSurfaceClass("not-started"),
    badgeClassName: statusPillClass("not-started"),
    barClassName: statusBarClass("not-started"),
  },
  draft: {
    icon: Pencil,
    className: statusTextClass("draft"),
    surfaceClassName: statusSurfaceClass("draft"),
    badgeClassName: statusPillClass("draft"),
    barClassName: statusBarClass("draft"),
  },
  "in-review": {
    icon: Eye,
    className: statusTextClass("in-review"),
    surfaceClassName: statusSurfaceClass("in-review"),
    badgeClassName: statusPillClass("in-review"),
    barClassName: statusBarClass("in-review"),
  },
  active: {
    icon: PlayCircle,
    className: statusTextClass("active"),
    surfaceClassName: statusSurfaceClass("active"),
    badgeClassName: statusPillClass("active"),
    barClassName: statusBarClass("active"),
  },
  deprecated: {
    icon: Archive,
    className: statusTextClass("deprecated"),
    surfaceClassName: statusSurfaceClass("deprecated"),
    badgeClassName: statusPillClass("deprecated"),
    barClassName: statusBarClass("deprecated"),
  },
  complete: {
    icon: CheckCircle2,
    className: statusTextClass("complete"),
    surfaceClassName: statusSurfaceClass("complete"),
    badgeClassName: statusPillClass("complete"),
    barClassName: statusBarClass("complete"),
  },
  skipped: {
    icon: SkipForward,
    className: statusTextClass("skipped"),
    surfaceClassName: statusSurfaceClass("skipped"),
    badgeClassName: statusPillClass("skipped"),
    barClassName: statusBarClass("skipped"),
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
    <span className={cn("inline-flex items-center gap-1.5 capitalize", statusTextClass(status))}>
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
        "capitalize",
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

function technicalReviewDateLabel(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function technicalChangeStatusLabel(status?: string) {
  return (status || "draft").replace(/-/g, " ");
}

function joinDiskPath(base: string, relativePath: string) {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/[\\/]+/g, separator).replace(/^[\\/]+/, "")}`;
}

export function Components({
  activeProject,
  onOpenCapability,
  onChangeCreated,
}: {
  activeProject?: AiddTrackedProject | null;
  onOpenCapability?: (slug: string) => void;
  onChangeCreated?: (id: string) => void;
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
  const [technicalReviewPackage, setTechnicalReviewPackage] = useState<AiddComponentTechnicalReviewPackageResult | null>(null);
  const [technicalReviewPackageDragFilePath, setTechnicalReviewPackageDragFilePath] = useState<string | null>(null);
  const [technicalReviews, setTechnicalReviews] = useState<AiddComponentTechnicalReviewRecord[]>([]);
  const [technicalChanges, setTechnicalChanges] = useState<AiddComponentTechnicalChangeRecord[]>([]);
  const [editingTechnicalChange, setEditingTechnicalChange] = useState<AiddComponentTechnicalChangeDetail | null>(null);
  const [technicalChangeSections, setTechnicalChangeSections] = useState<TechnicalChangeSection[]>([]);
  const [activeTechnicalChangeSectionKey, setActiveTechnicalChangeSectionKey] = useState("overview");
  const [technicalChangeReviewPackage, setTechnicalChangeReviewPackage] = useState<AiddComponentTechnicalChangeReviewPackageResult | null>(null);
  const [technicalChangeReviewPackageDragFilePath, setTechnicalChangeReviewPackageDragFilePath] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiddComponentSummary | null>(null);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<AiddComponentSummary[] | null>(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [componentStatusFilter, setComponentStatusFilter] = useState<string>("all");
  const [componentCapabilityFilter, setComponentCapabilityFilter] = useState<string>("all");
  const [componentLinkFilter, setComponentLinkFilter] = useState<string>("all");
  const [componentSourceFilter, setComponentSourceFilter] = useState<string>("all");
  const [componentContractFilter, setComponentContractFilter] = useState<string>("all");
  const [selectedComponentSlugs, setSelectedComponentSlugs] = useState<string[]>([]);
  const [componentZipDropActive, setComponentZipDropActive] = useState(false);

  const load = async () => {
    if (!activeProject?.path) return;
    const nextSetup = await window.aidd.readProjectSetup(activeProject.path);
    setSetup(nextSetup);
  };

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [activeProject?.path]);

  useEffect(() => {
    if (!showSourceConfig) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSourceConfig(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showSourceConfig]);

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

  const filteredComponents = useMemo(() => {
    const components = setup?.components ?? [];
    const capabilities = setup?.capabilities ?? [];
    const search = componentSearch.trim().toLowerCase();

    return components.filter((component) => {
      const linkedCapabilities = capabilities.filter((capability) =>
        capability.components?.includes(component.slug),
      );
      const sourceDirectory = component.source?.directory ?? "";
      const contractStatus = component.contract?.status ?? "missing";
      const searchable = [
        component.title,
        component.slug,
        component.status ?? "draft",
        sourceDirectory,
        sourceTypeLabel(component.source?.type),
        contractStatus,
        ...linkedCapabilities.flatMap((capability) => [capability.title, capability.slug]),
      ]
        .join(" ")
        .toLowerCase();

      if (search && !searchable.includes(search)) return false;
      if (componentStatusFilter !== "all" && (component.status ?? "draft") !== componentStatusFilter) return false;
      if (componentCapabilityFilter !== "all" && !linkedCapabilities.some((capability) => capability.slug === componentCapabilityFilter)) return false;
      if (componentLinkFilter === "linked" && linkedCapabilities.length === 0) return false;
      if (componentLinkFilter === "unlinked" && linkedCapabilities.length > 0) return false;
      if (componentSourceFilter === "mapped" && !sourceDirectory) return false;
      if (componentSourceFilter === "unmapped" && sourceDirectory) return false;
      if (componentSourceFilter === "workspace" && (!sourceDirectory || component.source?.isInsideWorkspace === false)) return false;
      if (componentSourceFilter === "external" && component.source?.isInsideWorkspace !== false) return false;
      if (componentContractFilter !== "all" && contractStatus !== componentContractFilter) return false;

      return true;
    });
  }, [
    setup?.components,
    setup?.capabilities,
    componentSearch,
    componentStatusFilter,
    componentCapabilityFilter,
    componentLinkFilter,
    componentSourceFilter,
    componentContractFilter,
  ]);

  const selectedComponentsForBulk = useMemo(() => {
    const bySlug = new Map((setup?.components ?? []).map((component) => [component.slug, component]));
    return selectedComponentSlugs
      .map((slug) => bySlug.get(slug))
      .filter((component): component is AiddComponentSummary => Boolean(component));
  }, [setup?.components, selectedComponentSlugs]);

  const visibleComponentSlugs = filteredComponents.map((component) => component.slug);
  const allVisibleComponentsSelected =
    visibleComponentSlugs.length > 0 &&
    visibleComponentSlugs.every((slug) => selectedComponentSlugs.includes(slug));

  useEffect(() => {
    const validSlugs = new Set((setup?.components ?? []).map((component) => component.slug));
    setSelectedComponentSlugs((current) => current.filter((slug) => validSlugs.has(slug)));
  }, [setup?.components]);

  const clearComponentFilters = () => {
    setComponentSearch("");
    setComponentStatusFilter("all");
    setComponentCapabilityFilter("all");
    setComponentLinkFilter("all");
    setComponentSourceFilter("all");
    setComponentContractFilter("all");
  };

  const toggleComponentSelection = (slug: string) => {
    setSelectedComponentSlugs((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  };

  const selectVisibleComponents = () => {
    setSelectedComponentSlugs((current) => {
      const next = new Set(current);
      for (const slug of visibleComponentSlugs) next.add(slug);
      return Array.from(next);
    });
  };

  const clearSelectedComponentsForBulk = () => setSelectedComponentSlugs([]);

  const linkedCapabilitiesForComponent = (componentSlug: string) =>
    (setup?.capabilities ?? []).filter((capability) => capability.components?.includes(componentSlug));

  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ?? sections[0];
  const activeTechnicalChangeSection =
    technicalChangeSections.find((section) => section.key === activeTechnicalChangeSectionKey) ?? technicalChangeSections[0];
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
    setTechnicalReviewPackage(null);
    setTechnicalReviewPackageDragFilePath(null);
    setTechnicalReviews([]);
    setTechnicalChanges([]);
    setEditingTechnicalChange(null);
    setTechnicalChangeSections([]);
    setActiveTechnicalChangeSectionKey("overview");
    setTechnicalChangeReviewPackage(null);
    setTechnicalChangeReviewPackageDragFilePath(null);
    setDragError(null);
    setMessage(null);
    setDeleteTarget(null);
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
      setTechnicalReviewPackage(null);
      setTechnicalReviewPackageDragFilePath(null);
      setTechnicalReviews(component.technicalReviews || []);
      setTechnicalChanges(component.technicalChanges || []);
      setEditingTechnicalChange(null);
      setTechnicalChangeSections([]);
      setActiveTechnicalChangeSectionKey("overview");
      setTechnicalChangeReviewPackage(null);
      setTechnicalChangeReviewPackageDragFilePath(null);
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

  const updateAllSectionStatuses = (nextStatus: AiddSetupStatus) =>
    setSections((current) =>
      current.map((section) => {
        if (nextStatus === "skipped") {
          return { ...section, status: nextStatus };
        }
        const { skipReason: _skipReason, ...rest } = section;
        return { ...rest, status: nextStatus };
      }),
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

  const createChangeFromComponent = async () => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    setMessage(null);
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
      const change = await window.aidd.createChangeFromComponent({
        projectPath: activeProject.path,
        componentSlug: editingSlug,
        type: "component-change",
      });
      setMessage(`Created Change ${change.id}.`);
      void window.aidd.notify({ title: "Change created", body: change.id });
      onChangeCreated?.(change.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestComponentDelete = (component: AiddComponentSummary) => {
    setError(null);
    setDragError(null);
    setMessage(null);
    setDeleteTarget(component);
  };

  const deleteSelectedComponent = async () => {
    if (!activeProject?.path || !deleteTarget) return;

    const target = deleteTarget;
    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const next = await window.aidd.deleteComponent({
        projectPath: activeProject.path,
        slug: target.slug,
      });
      setSetup(next);
      setDeleteTarget(null);
      setSelectedComponentSlugs((current) => current.filter((slug) => slug !== target.slug));

      if (editingSlug === target.slug) {
        resetForm();
        setView("list");
      }

      setMessage(`Deleted component "${target.title}".`);
      void window.aidd.notify({
        title: "Component deleted",
        body: target.title,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestBulkComponentDelete = () => {
    if (!selectedComponentsForBulk.length) return;
    setError(null);
    setDragError(null);
    setMessage(null);
    setBulkDeleteTargets(selectedComponentsForBulk);
  };

  const deleteBulkComponents = async () => {
    if (!activeProject?.path || !bulkDeleteTargets?.length) return;

    const targets = bulkDeleteTargets;
    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      let nextSetup = setup;
      for (const target of targets) {
        nextSetup = await window.aidd.deleteComponent({
          projectPath: activeProject.path,
          slug: target.slug,
        });
      }
      if (nextSetup) setSetup(nextSetup);
      setBulkDeleteTargets(null);
      setSelectedComponentSlugs((current) =>
        current.filter((slug) => !targets.some((target) => target.slug === slug)),
      );

      if (editingSlug && targets.some((target) => target.slug === editingSlug)) {
        resetForm();
        setView("list");
      }

      setMessage(`Deleted ${targets.length} component(s).`);
      void window.aidd.notify({
        title: "Components deleted",
        body: `${targets.length} item(s) removed.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const copySelectedComponentsForAi = async () => {
    if (!selectedComponentsForBulk.length) return;

    const payload = [
      "# Selected components",
      "",
      ...selectedComponentsForBulk.flatMap((component) => {
        const capabilities = linkedCapabilitiesForComponent(component.slug);
        return [
          `## ${component.title}`,
          `- Slug: ${component.slug}`,
          `- Status: ${statusLabel(component.status)}`,
          `- Source: ${component.source?.directory || "Not mapped"}`,
          `- Source type: ${sourceTypeLabel(component.source?.type)}`,
          `- Contract: ${contractLabel(component.contract?.status)}`,
          `- Linked capabilities: ${capabilities.map((capability) => capability.title).join(", ") || "None"}`,
          "",
        ];
      }),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(payload);
      setMessage(`Copied ${selectedComponentsForBulk.length} selected component(s) for AI context.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createChangeFromSelectedComponents = async () => {
    if (!activeProject?.path || !selectedComponentsForBulk.length) return;

    const targets = selectedComponentsForBulk;
    const linkedCapabilities = Array.from(
      new Set(
        targets.flatMap((component) =>
          linkedCapabilitiesForComponent(component.slug).map((capability) => capability.slug),
        ),
      ),
    );
    const changeTitle =
      targets.length === 1
        ? `Change ${targets[0].title}`
        : `Change ${targets.length} selected components`;

    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const result = await window.aidd.createChange({
        projectPath: activeProject.path,
        title: changeTitle,
        type: "component-change",
        status: "draft",
        priority: "normal",
        risk: "unknown",
        linkedComponents: targets.map((component) => component.slug),
        linkedCapabilities,
      });
      setMessage(`Created Change ${result.id} from ${targets.length} selected component(s).`);
      void window.aidd.notify({ title: "Change created", body: result.id });
      onChangeCreated?.(result.id);
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
    setComponentZipDropActive(false);
    if (!activeProject?.path) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setDragError("Drop a component .zip file.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setDragError("Component import rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    setMessage(null);
    try {
      const result = await window.aidd.importComponentReviewPackage({
        projectPath: activeProject.path,
        zipPath,
      });
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      await load();
      const importedSlug = result.importedComponents?.length === 1 ? result.importedComponents[0] : editingSlug;
      setMessage(
        result.componentCount
          ? `Imported ${result.componentCount} component(s) from zip.`
          : "No component files were imported from that zip.",
      );
      if (importedSlug) await openEdit(importedSlug);
      void window.aidd.notify({
        title: "Component zip imported",
        body: `${result.importedFiles.length} file(s) imported from ${result.componentCount} component(s).`,
      });
    } catch (err) {
      setDragError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createComponentTechnicalReviewPackage = async () => {
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
      const bundle = await window.aidd.packageComponentTechnicalReview({
        projectPath: activeProject.path,
        slug: editingSlug,
        sourceScope: "component-source",
      });
      setTechnicalReviewPackage(bundle);
      setTechnicalReviewPackageDragFilePath(bundle.filePath);
      void window.aidd.notify({
        title: "Technical review package ready",
        body: `${bundle.sourceFileCount} source file(s) packaged as read-only context. Drag the technical review zip tile out when ready.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const startComponentTechnicalReviewPackageDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!technicalReviewPackageDragFilePath) {
      event.preventDefault();
      setDragError("Click the technical review tile before dragging it.");
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", technicalReviewPackageDragFilePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(technicalReviewPackageDragFilePath);
  };

  const importComponentTechnicalReviewPackage = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeProject?.path || !editingSlug) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setDragError("Drop a returned component technical review .zip onto this tile.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setDragError("Technical review response rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const result = await window.aidd.importComponentTechnicalReviewPackage({
        projectPath: activeProject.path,
        slug: editingSlug,
        zipPath,
      });
      setTechnicalReviewPackage(null);
      setTechnicalReviewPackageDragFilePath(null);
      await load();
      await openEdit(result.componentSlug || editingSlug);
      void window.aidd.notify({
        title: "Technical review imported",
        body: `${result.findingCount} finding(s), ${result.technicalChangeCount} managed technical change(s), ${result.patchCount} patch artefact(s).`,
      });
    } catch (err) {
      setDragError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createTechnicalChange = async () => {
    if (!activeProject?.path || !editingSlug) return;

    setSaving(true);
    setError(null);
    try {
      const created = await window.aidd.createComponentTechnicalChange({
        projectPath: activeProject.path,
        slug: editingSlug,
        title: "New technical change",
        status: "draft",
      });
      setTechnicalChanges((current) => [...current, created].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })));
      await openTechnicalChangeEditor(created.id);
      void window.aidd.notify({
        title: "Technical change created",
        body: created.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const openTechnicalChangeEditor = async (id: string) => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const detail = await window.aidd.readComponentTechnicalChange({
        projectPath: activeProject.path,
        slug: editingSlug,
        id,
      });
      setEditingTechnicalChange(detail);
      setTechnicalChangeSections(detail.sections || []);
      setActiveTechnicalChangeSectionKey(detail.sections?.[0]?.key || "overview");
      setTechnicalChangeReviewPackage(null);
      setTechnicalChangeReviewPackageDragFilePath(null);
      setView("technical-change");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const backToComponentEditor = async () => {
    const slug = editingSlug;
    setEditingTechnicalChange(null);
    setTechnicalChangeSections([]);
    setActiveTechnicalChangeSectionKey("overview");
    setTechnicalChangeReviewPackage(null);
    setTechnicalChangeReviewPackageDragFilePath(null);
    if (slug) await openEdit(slug);
    else setView("edit");
  };

  const updateActiveTechnicalChangeSectionBody = (body: string) => {
    setTechnicalChangeSections((current) =>
      current.map((section) =>
        section.key === activeTechnicalChangeSectionKey ? { ...section, body } : section,
      ),
    );
  };

  const updateEditingTechnicalChange = (patch: Partial<AiddComponentTechnicalChangeDetail>) => {
    setEditingTechnicalChange((current) => current ? { ...current, ...patch } : current);
  };

  const persistTechnicalChange = async () => {
    if (!activeProject?.path || !editingSlug || !editingTechnicalChange) return null;
    const next = await window.aidd.saveComponentTechnicalChange({
      projectPath: activeProject.path,
      slug: editingSlug,
      id: editingTechnicalChange.id,
      title: editingTechnicalChange.title,
      status: editingTechnicalChange.status,
      risk: editingTechnicalChange.risk,
      sections: technicalChangeSections,
    });
    setEditingTechnicalChange(next);
    setTechnicalChangeSections(next.sections || []);
    const component = await window.aidd.readComponent({
      projectPath: activeProject.path,
      slug: editingSlug,
    });
    setTechnicalChanges(component.technicalChanges || []);
    return next;
  };

  const saveTechnicalChange = async () => {
    if (!activeProject?.path || !editingSlug || !editingTechnicalChange) return;
    setSaving(true);
    setError(null);
    try {
      const next = await persistTechnicalChange();
      void window.aidd.notify({
        title: "Technical change saved",
        body: next?.id || editingTechnicalChange.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateTechnicalChangeStatus = async (change: AiddComponentTechnicalChangeRecord, nextStatus: AiddComponentTechnicalChangeStatus) => {
    if (!activeProject?.path || !editingSlug) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.updateComponentTechnicalChangeStatus({
        projectPath: activeProject.path,
        slug: editingSlug,
        id: change.id,
        status: nextStatus,
      });
      setTechnicalChanges(next);
      void window.aidd.notify({
        title: "Technical change updated",
        body: `${change.id} is now ${technicalChangeStatusLabel(nextStatus)}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const openTechnicalChange = async (change: AiddComponentTechnicalChangeRecord) => {
    await openTechnicalChangeEditor(change.id);
  };

  const revealTechnicalChange = async (change: AiddComponentTechnicalChangeRecord) => {
    if (!activeProject?.path) return;
    await window.aidd.showItemInFolder(joinDiskPath(activeProject.path, change.relativePath));
  };

  const createTechnicalChangeReviewPackage = async () => {
    if (!activeProject?.path || !editingSlug || !editingTechnicalChange) return;
    setSaving(true);
    setError(null);
    try {
      await persistTechnicalChange();
      const bundle = await window.aidd.packageComponentTechnicalChangeReview({
        projectPath: activeProject.path,
        slug: editingSlug,
        id: editingTechnicalChange.id,
      });
      setTechnicalChangeReviewPackage(bundle);
      setTechnicalChangeReviewPackageDragFilePath(bundle.filePath);
      void window.aidd.notify({
        title: "Technical change review package ready",
        body: `${bundle.sectionFileCount} section file(s), ${bundle.sourceFileCount} source file(s). Drag the review zip tile out when ready.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createChangeFromTechnicalChange = async (
    changeOverride?: AiddComponentTechnicalChangeRecord | AiddComponentTechnicalChangeDetail,
  ) => {
    if (!activeProject?.path || !editingSlug) return;
    const targetChange = changeOverride ?? editingTechnicalChange;
    if (!targetChange) return;
    setSaving(true);
    setError(null);
    try {
      let changeId = targetChange.id;
      if (editingTechnicalChange && targetChange.id === editingTechnicalChange.id) {
        const saved = await persistTechnicalChange();
        changeId = saved?.id || targetChange.id;
      }
      const result = await window.aidd.createChangeFromTechnicalChange({
        projectPath: activeProject.path,
        componentSlug: editingSlug,
        technicalChangeId: changeId,
      });
      const component = await window.aidd.readComponent({
        projectPath: activeProject.path,
        slug: editingSlug,
      });
      setTechnicalChanges(component.technicalChanges || []);
      if (editingTechnicalChange && targetChange.id === editingTechnicalChange.id) {
        const refreshed = await window.aidd.readComponentTechnicalChange({
          projectPath: activeProject.path,
          slug: editingSlug,
          id: changeId,
        });
        setEditingTechnicalChange(refreshed);
        setTechnicalChangeSections(refreshed.sections || []);
      }
      void window.aidd.notify({
        title: "Change created",
        body: result.id,
      });
      onChangeCreated?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const startTechnicalChangeReviewPackageDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (!technicalChangeReviewPackageDragFilePath) {
      event.preventDefault();
      setDragError("Click the technical change review tile before dragging it.");
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", technicalChangeReviewPackageDragFilePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(technicalChangeReviewPackageDragFilePath);
  };

  const importTechnicalChangeReviewPackage = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeProject?.path || !editingSlug || !editingTechnicalChange) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setDragError("Drop a returned technical change review .zip onto this tile.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setDragError("Technical change review response rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      const result = await window.aidd.importComponentTechnicalChangeReviewPackage({
        projectPath: activeProject.path,
        slug: editingSlug,
        id: editingTechnicalChange.id,
        zipPath,
      });
      setTechnicalChangeReviewPackage(null);
      setTechnicalChangeReviewPackageDragFilePath(null);
      await openTechnicalChangeEditor(result.technicalChangeId);
      void window.aidd.notify({
        title: "Technical change review imported",
        body: `${result.importedFiles.length} file(s) imported. ${result.patchCount} patch file(s) now attached.`,
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

  const deleteDialog = deleteTarget ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!saving) setDeleteTarget(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-component-title"
        className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-2">
            <h2 id="delete-component-title" className="text-lg font-semibold">
              Delete component?
            </h2>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the files for{" "}
              <span className="font-medium text-foreground">{deleteTarget.title}</span> only.
              Other components will not be touched.
            </p>
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-medium text-foreground">Files to remove</div>
              <code className="mt-1 block break-all text-muted-foreground">
                components/{deleteTarget.slug}/
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              AIDD will also remove this component from any capability links, refresh the indexes, and create a git checkpoint commit after the delete.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={deleteSelectedComponent}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            {saving ? "Deleting..." : "Delete component"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const bulkDeleteDialog = bulkDeleteTargets?.length ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!saving) setBulkDeleteTargets(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-component-title"
        className="w-full max-w-xl rounded-lg border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-3">
            <div>
              <h2 id="bulk-delete-component-title" className="text-lg font-semibold">
                Delete selected components?
              </h2>
              <p className="text-sm text-muted-foreground">
                This will remove {bulkDeleteTargets.length} component folder(s) and unlink them from capabilities. Git history can recover committed files, but AIDD will delete them from the current project state.
              </p>
            </div>
            <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-medium text-foreground">Selected components</div>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {bulkDeleteTargets.map((component) => {
                  const capabilities = linkedCapabilitiesForComponent(component.slug);
                  return (
                    <li key={component.slug}>
                      <span className="font-medium text-foreground">{component.title}</span>
                      <span> - components/{component.slug}/</span>
                      {capabilities.length ? <span> - unlinks {capabilities.length} capability item(s)</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Linked Changes and Delivery packages are not deleted. Run Health Check afterwards if you want to review stale references.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setBulkDeleteTargets(null)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={deleteBulkComponents}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            {saving ? "Deleting..." : `Delete ${bulkDeleteTargets.length} components`}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

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
        {deleteDialog}
        {bulkDeleteDialog}
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
          <div>
            <h1 className="text-xl font-semibold">Components</h1>
            <p className="text-sm text-muted-foreground">
              Define the parts that own architecture, state, interfaces, and standards.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              className={cn("border-dashed", componentZipDropActive && "border-primary bg-primary/10")}
              onDragEnter={(event) => {
                event.preventDefault();
                setComponentZipDropActive(true);
              }}
              onDragLeave={() => setComponentZipDropActive(false)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setComponentZipDropActive(true);
              }}
              onDrop={importComponentReviewPackage}
              title="Drop a zip containing components/<slug>/ files"
            >
              <Upload className="h-4 w-4" /> Import ZIP
            </Button>
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
          {message && (
            <Alert className="mb-4">
              <AlertTitle>Updated</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {dragError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription>{dragError}</AlertDescription>
            </Alert>
          )}
          <div className="mb-6 grid gap-3 md:grid-cols-4">
            <Metric label="Total" value={setup?.components.length ?? 0} />
            <Metric label="Draft" value={statusCounts.get("draft") ?? 0} />
            <Metric label="Active" value={statusCounts.get("active") ?? 0} />
            <Metric label="Deprecated" value={statusCounts.get("deprecated") ?? 0} />
          </div>

          <Card className="mb-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Filter className="h-4 w-4" /> Filter components
                  </CardTitle>
                  <CardDescription>
                    Find components by status, linked capability, source mapping, or contract state before selecting bulk actions.
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  {filteredComponents.length} / {setup?.components.length ?? 0} shown
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={componentSearch}
                  onChange={(event) => setComponentSearch(event.target.value)}
                  placeholder="Search title, slug, source, contract, or capability..."
                />
              </div>
              <Select
                value={componentStatusFilter}
                onChange={(event) => setComponentStatusFilter(event.target.value)}
                aria-label="Filter components by status"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>{statusLabel(option)}</option>
                ))}
              </Select>
              <Select
                value={componentLinkFilter}
                onChange={(event) => setComponentLinkFilter(event.target.value)}
                aria-label="Filter components by capability link state"
              >
                <option value="all">All link states</option>
                <option value="linked">Has capabilities</option>
                <option value="unlinked">No capabilities</option>
              </Select>
              <Select
                value={componentCapabilityFilter}
                onChange={(event) => setComponentCapabilityFilter(event.target.value)}
                aria-label="Filter components by capability"
              >
                <option value="all">Any capability</option>
                {(setup?.capabilities ?? []).map((capability) => (
                  <option key={capability.slug} value={capability.slug}>{capability.title}</option>
                ))}
              </Select>
              <Select
                value={componentSourceFilter}
                onChange={(event) => setComponentSourceFilter(event.target.value)}
                aria-label="Filter components by source mapping"
              >
                <option value="all">Any source state</option>
                <option value="mapped">Has source mapping</option>
                <option value="unmapped">No source mapping</option>
                <option value="workspace">Workspace source</option>
                <option value="external">External source</option>
              </Select>
              <Select
                value={componentContractFilter}
                onChange={(event) => setComponentContractFilter(event.target.value)}
                aria-label="Filter components by contract status"
              >
                <option value="all">Any contract</option>
                <option value="current">Contract current</option>
                <option value="stale">Contract stale</option>
                <option value="blocked">Contract blocked</option>
                <option value="missing">Contract missing</option>
              </Select>
              <div className="flex flex-wrap gap-2 xl:col-span-3">
                <Button type="button" variant="outline" size="sm" onClick={clearComponentFilters}>
                  <X className="h-4 w-4" /> Clear filters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={allVisibleComponentsSelected ? clearSelectedComponentsForBulk : selectVisibleComponents}
                  disabled={!filteredComponents.length}
                >
                  <CheckSquare className="h-4 w-4" />
                  {allVisibleComponentsSelected ? "Clear selection" : "Select visible"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {selectedComponentsForBulk.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm">
                <span className="font-medium">{selectedComponentsForBulk.length} component(s) selected</span>
                <span className="ml-2 text-muted-foreground">Use selection to shape component Changes or remove stale items.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copySelectedComponentsForAi} disabled={saving}>
                  <Copy className="h-4 w-4" /> Copy for AI
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={createChangeFromSelectedComponents} disabled={saving}>
                  <PackagePlus className="h-4 w-4" /> Create Change
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={clearSelectedComponentsForBulk} disabled={saving}>
                  <X className="h-4 w-4" /> Clear
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={requestBulkComponentDelete} disabled={saving}>
                  <Trash2 className="h-4 w-4" /> Delete selected
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredComponents.map((component) => {
              const capabilities = linkedCapabilitiesForComponent(component.slug);
              const isSelected = selectedComponentSlugs.includes(component.slug);
              return (
                <Card
                  key={component.slug}
                  className={cn(
                    "cursor-pointer hover:bg-accent",
                    isSelected && "border-primary bg-primary/5",
                  )}
                  onClick={() => openEdit(component.slug)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-primary"
                          aria-label={`Select ${component.title}`}
                          checked={isSelected}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleComponentSelection(component.slug)}
                        />
                        <div className="min-w-0">
                          <CardTitle className="text-base">{component.title}</CardTitle>
                          <CardDescription>
                            {capabilities.length
                              ? `${capabilities.length} linked capability item(s)`
                              : "No capabilities linked yet"}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className={statusPillClass(component.status)}>
                            <StatusPill status={component.status} />
                          </Badge>
                          <Badge variant="outline" className={statusPillClass(component.contract?.status === "current" ? "current" : "not-started")}>
                            Contract: {contractLabel(component.contract?.status)}
                          </Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label={`Delete ${component.title}`}
                          disabled={saving}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestComponentDelete(component);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
            {setup && setup.components.length > 0 && filteredComponents.length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardHeader>
                  <Search className="h-6 w-6" />
                  <CardTitle>No components match these filters</CardTitle>
                  <CardDescription>
                    Clear the filters or adjust the search to show more components.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={clearComponentFilters}>
                    <X className="h-4 w-4" /> Clear filters
                  </Button>
                </CardContent>
              </Card>
            )}
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

  if (view === "technical-change" && editingTechnicalChange)
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {deleteDialog}
        {bulkDeleteDialog}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => void backToComponentEditor()} title="Back to component">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{editingTechnicalChange.id}</Badge>
                <Badge variant="outline" className={statusPillClass(editingTechnicalChange.status, "capitalize")}>
                  {technicalChangeStatusLabel(editingTechnicalChange.status)}
                </Badge>
              </div>
              <Input
                className="mt-1 max-w-xl text-base font-semibold"
                value={editingTechnicalChange.title}
                onChange={(event) => updateEditingTechnicalChange({ title: event.target.value })}
                placeholder="Technical change title"
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              className="w-36"
              value={editingTechnicalChange.risk}
              onChange={(event) => updateEditingTechnicalChange({ risk: event.target.value as AiddComponentTechnicalChangeRisk })}
            >
              {technicalChangeRiskOptions.map((risk) => (
                <option key={risk} value={risk}>
                  {risk === "unknown" ? "Unknown risk" : `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`}
                </option>
              ))}
            </Select>
            <Select
              className="w-40"
              value={editingTechnicalChange.status}
              onChange={(event) => updateEditingTechnicalChange({ status: event.target.value as AiddComponentTechnicalChangeStatus })}
            >
              {technicalChangeStatusOptions.map((item) => (
                <option key={item} value={item}>
                  {technicalChangeStatusLabel(item)}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={() => void revealTechnicalChange(editingTechnicalChange)}
              title="Open the technical change folder"
            >
              <FolderOpen className="h-4 w-4" />
              Folder
            </Button>
            <Button
              variant="outline"
              onClick={() => void createChangeFromTechnicalChange(editingTechnicalChange)}
              disabled={saving}
              title="Create a global Change from this managed technical change."
            >
              <FileText className="h-4 w-4" />
              Create Change
            </Button>
            <Button onClick={() => void saveTechnicalChange()} disabled={saving || !editingTechnicalChange.title.trim()}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 px-6 pt-4">
            <Alert variant="destructive">
              <AlertTitle>Technical change problem</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b bg-muted/30 px-6 py-2">
          {technicalChangeSections.map((section, index) => {
            const Icon = technicalChangeSectionIcons[index] ?? FileText;
            const filePath = activeProject?.path
              ? joinDiskPath(activeProject.path, `${editingTechnicalChange.relativePath}/${section.fileName}`)
              : "";
            return (
              <button
                key={section.key}
                draggable={Boolean(filePath)}
                className={cn(
                  "relative flex h-16 w-36 shrink-0 cursor-grab flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent active:cursor-grabbing",
                  activeTechnicalChangeSectionKey === section.key && "border-ring bg-accent ring-1 ring-ring",
                )}
                onClick={() => setActiveTechnicalChangeSectionKey(section.key)}
                onDragStart={(event) => {
                  if (!filePath) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("text/plain", filePath);
                  event.preventDefault();
                  window.aidd.startNativeFileDrag(filePath);
                }}
                title={`${section.title}: ${section.fileName}`}
              >
                <FileText className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <Icon className="h-4 w-4 text-muted-foreground" />
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
            draggable={Boolean(technicalChangeReviewPackageDragFilePath)}
            className={cn(
              "relative flex h-16 w-40 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
              technicalChangeReviewPackageDragFilePath && "cursor-grab active:cursor-grabbing",
              !technicalChangeReviewPackageDragFilePath && "cursor-pointer",
            )}
            onClick={() => void createTechnicalChangeReviewPackage()}
            onDragStart={startTechnicalChangeReviewPackageDrag}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={importTechnicalChangeReviewPackage}
            title={technicalChangeReviewPackageDragFilePath ? "Review package is ready. Drag this zip out, or drop a returned technical change review zip here." : "Create a technical change review package zip, or drop a returned review zip here."}
          >
            <StatusIcon
              status={technicalChangeReviewPackageDragFilePath ? "complete" : "not-started"}
              className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
            />
            <Archive className={cn("h-4 w-4 text-muted-foreground", technicalChangeReviewPackageDragFilePath && statusTextClass("ready"))} />
            <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
              Review package
            </span>
            <span className="line-clamp-1 text-[10px] text-muted-foreground">
              {saving ? "Working..." : technicalChangeReviewPackage ? "Ready to drag/drop" : "Create/drop zip"}
            </span>
          </button>
        </div>

        {dragError && (
          <div className="shrink-0 px-6 pt-2 text-xs text-destructive">
            {dragError}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto p-6">
          <div className="grid min-h-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="flex min-h-[32rem] flex-col overflow-hidden">
              <CardHeader className="shrink-0">
                <CardTitle>{activeTechnicalChangeSection?.title || "Technical change"}</CardTitle>
                <CardDescription>{activeTechnicalChangeSection?.fileName}</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden p-4">
                <MarkdownEditor
                  editorKey={`technical-change-${editingTechnicalChange.id}-${activeTechnicalChangeSection?.fileName ?? "section"}`}
                  className="h-full min-h-[28rem]"
                  value={activeTechnicalChangeSection?.body || ""}
                  initialValue={activeTechnicalChangeSection?.body || ""}
                  onChange={updateActiveTechnicalChangeSectionBody}
                />
              </CardContent>
            </Card>

            <aside className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Review state</CardTitle>
                  <CardDescription>{editingTechnicalChange.relativePath}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Source</span>
                    <Badge variant="outline" className="capitalize">
                      {editingTechnicalChange.source.replace(/-/g, " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Patches</span>
                    <Badge variant={editingTechnicalChange.patchCount ? "secondary" : "outline"}>
                      {editingTechnicalChange.patchCount}
                    </Badge>
                  </div>
                  {editingTechnicalChange.linkedReviewPath && (
                    <div className="break-all text-xs text-muted-foreground">
                      Review import: {editingTechnicalChange.linkedReviewPath}
                    </div>
                  )}
                  {editingTechnicalChange.deliveryPackageIds.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Delivery packages: {editingTechnicalChange.deliveryPackageIds.join(", ")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        </main>
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {deleteDialog}
      {bulkDeleteDialog}
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
            onClick={() => setShowSourceConfig(true)}
            title="Configure the source directory owned by this component"
          >
            <GitBranch className="h-4 w-4" />
            Configure source
          </Button>
          {view === "edit" && editingSlug && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void createChangeFromComponent()}
              disabled={saving}
            >
              <FileText className="h-4 w-4" />
              Plan Change
            </Button>
          )}
          {view === "edit" && editingSlug && (
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                requestComponentDelete({
                  slug: editingSlug,
                  title: title.trim() || editingSlug,
                  status,
                  sourceProjects: selectedSourceProjects,
                  source: sourceConfig,
                  contract: contract || undefined,
                })
              }
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
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
      {message && (
        <div className="shrink-0 px-6 pt-4">
          <Alert>
            <AlertTitle>Updated</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        </div>
      )}
      {showSourceConfig && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setShowSourceConfig(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="component-source-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b p-5">
              <div className="min-w-0 space-y-2">
                <Badge variant="outline" className="w-fit">Component source</Badge>
                <div>
                  <h2 id="component-source-title" className="text-2xl font-semibold">Source mapping</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Reference the implementation directory this component owns. This is stored with the
                    component and included in the generated component contract.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowSourceConfig(false)}
                aria-label="Close component source"
              >
                <X className="h-5 w-5" />
              </Button>
            </header>

            <div className="max-h-[calc(100vh-11rem)] overflow-auto p-5">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Source directory</span>
                    <div className="flex flex-col gap-2 lg:flex-row">
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
                        placeholder="src/components/example-component or Source/ExampleRuntime"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={browseSourceDirectory}
                        disabled={detectingSource}
                        className="shrink-0"
                      >
                        <FolderOpen className="h-4 w-4" />
                        Browse
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={detectSourceDirectory}
                        disabled={detectingSource || !sourceDirectory.trim()}
                        className="shrink-0"
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
              </div>
            </div>
          </section>
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
            <Archive className={cn("h-4 w-4", reviewPackageDragFilePath && statusTextClass("ready"))} />
          </div>
          <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
            Review package
          </span>
          <span className="line-clamp-1 text-[10px] text-muted-foreground">
            {saving ? "Working..." : reviewPackage ? "Ready to drag/drop" : "Create/drop zip"}
          </span>
        </button>
        <button
          type="button"
          draggable={Boolean(technicalReviewPackageDragFilePath)}
          className={cn(
            "relative flex h-16 w-36 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
            technicalReviewPackageDragFilePath && "cursor-grab active:cursor-grabbing",
            !technicalReviewPackageDragFilePath && canGenerateContract && "cursor-pointer",
            !canGenerateContract && !technicalReviewPackageDragFilePath && "opacity-70",
          )}
          onClick={() => {
            if (canGenerateContract) void createComponentTechnicalReviewPackage();
            else setDragError("Save the component before creating a technical review package. You can still drop a returned technical review zip here.");
          }}
          onDragStart={startComponentTechnicalReviewPackageDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={importComponentTechnicalReviewPackage}
          title={technicalReviewPackageDragFilePath ? "Technical review package is ready. Drag this zip out, or drop a returned technical review zip here." : "Create a component technical review package zip, or drop a returned technical review zip here."}
        >
          <StatusIcon
            status={technicalReviewPackageDragFilePath ? "complete" : "not-started"}
            className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
          />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldAlert className={cn("h-4 w-4", technicalReviewPackageDragFilePath && statusTextClass("ready"))} />
          </div>
          <span className="line-clamp-1 px-1 text-center font-medium leading-tight">
            Technical review
          </span>
          <span className="line-clamp-1 text-[10px] text-muted-foreground">
            {saving ? "Working..." : technicalReviewPackage ? "Ready to drag/drop" : "Create/drop zip"}
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
          <Card className="flex h-4/5 min-h-[26rem] shrink-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0">
              <div>
                <CardTitle>{activeSection?.title}</CardTitle>
                <CardDescription>{activeSection?.prompt}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden p-4">
              <MarkdownEditor
                editorKey={`component-${editingSlug}-${activeSection?.fileName ?? "section"}`}
                className="h-full min-h-[22rem]"
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
            <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
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
              <div className="space-y-1">
                <span className="text-muted-foreground">All sections</span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  <span>Bulk update</span>
                </div>
                <Select
                  className="w-full"
                  value=""
                  aria-label="Set all component section statuses"
                  onChange={(event) => {
                    const nextStatus = event.target.value as AiddSetupStatus;
                    if (nextStatus) updateAllSectionStatuses(nextStatus);
                  }}
                >
                  <option value="">Set all to...</option>
                  {componentSectionStatusOptions.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item)}
                    </option>
                  ))}
                </Select>
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Technical Reviews & Changes</CardTitle>
                  <CardDescription>
                    Imported technical reviews feed managed technical changes. Promote them into global Changes before delivery.
                  </CardDescription>
                </div>
                <Button type="button" size="sm" onClick={() => void createTechnicalChange()} disabled={!editingSlug || saving}>
                  <Plus className="h-4 w-4" />
                  New technical change
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {technicalReviews.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Imported technical reviews</div>
                      <div className="text-xs text-muted-foreground">Review imports stay attached to the component and can seed managed changes.</div>
                    </div>
                    <Badge variant="outline">{technicalReviews.length}</Badge>
                  </div>
                  {technicalReviews.slice(0, 3).map((review) => (
                    <div
                      key={`${review.reviewDirectory}-${review.importedAt}`}
                      className="rounded-md border bg-muted/30 p-3 text-sm"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {technicalReviewDateLabel(review.importedAt)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {review.reviewDirectory}
                          </div>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {review.status.replace(/-/g, " ")}
                        </Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="rounded-md border bg-background/60 px-3 py-2">
                          <div className="text-lg font-semibold">{review.findingCount}</div>
                          <div className="text-xs text-muted-foreground">Findings</div>
                        </div>
                        <div className="rounded-md border bg-background/60 px-3 py-2">
                          <div className="text-lg font-semibold">{review.changeCount}</div>
                          <div className="text-xs text-muted-foreground">Proposed changes</div>
                        </div>
                        <div className="rounded-md border bg-background/60 px-3 py-2">
                          <div className="text-lg font-semibold">{review.patchCount}</div>
                          <div className="text-xs text-muted-foreground">Patch artefacts</div>
                        </div>
                      </div>
                      {review.changes.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {review.changes.slice(0, 4).map((change) => (
                            <div
                              key={change.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-medium">{change.id}</div>
                                {change.overviewPath && (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {change.overviewPath}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <Badge variant={change.patches.length ? "secondary" : "outline"}>
                                  {change.patches.length ? "Patch supplied" : "No patch"}
                                </Badge>
                                <Badge variant="outline">Not applied</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className={cn("space-y-3", technicalReviews.length > 0 && "border-t pt-3")}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Managed technical changes</div>
                    <div className="text-xs text-muted-foreground">Promote managed technical changes into global Changes before delivery.</div>
                  </div>
                  <Badge variant="outline">{technicalChanges.length}</Badge>
                </div>
                {technicalChanges.length ? (
                  technicalChanges.map((change) => (
                    <div
                      key={change.id}
                      className="rounded-md border bg-muted/25 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{change.id}</span>
                            <Badge variant="outline" className={statusPillClass(change.status, "capitalize")}>
                              {technicalChangeStatusLabel(change.status)}
                            </Badge>
                            <Badge variant="outline" className={statusPillClass(change.risk, "capitalize")}>
                              {change.risk} risk
                            </Badge>
                          </div>
                          <div className="mt-1 truncate font-medium">{change.title}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{change.patchCount} patch{change.patchCount === 1 ? "" : "es"}</span>
                            <span>Source: {change.source.replace(/-/g, " ")}</span>
                            {change.linkedReviewPath && <span className="truncate">Review: {change.linkedReviewPath}</span>}
                            {change.deliveryPackageIds.length > 0 && (
                              <span>Packaged: {change.deliveryPackageIds.join(", ")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => void openTechnicalChange(change)}>
                            <Pencil className="h-4 w-4" />
                            Open
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => void revealTechnicalChange(change)}>
                            <FolderOpen className="h-4 w-4" />
                            Folder
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void createChangeFromTechnicalChange(change)}>
                            <FileText className="h-4 w-4" />
                            Create Change
                          </Button>
                          {(change.status === "draft" || change.status === "rejected") && (
                            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void updateTechnicalChangeStatus(change, "needs-review")}>
                              <Eye className="h-4 w-4" />
                              Mark ready
                            </Button>
                          )}
                          {(change.status === "needs-review" || change.status === "proposed") && (
                            <>
                              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void updateTechnicalChangeStatus(change, "rejected")}>
                                <X className="h-4 w-4" />
                                Reject
                              </Button>
                              <Button type="button" size="sm" disabled={saving} onClick={() => void updateTechnicalChangeStatus(change, "approved")}>
                                <CheckCircle2 className="h-4 w-4" />
                                Approve
                              </Button>
                            </>
                          )}
                          {change.status === "approved" && (
                            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void updateTechnicalChangeStatus(change, "rejected")}>
                              <X className="h-4 w-4" />
                              Reject
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
                  >
                    {technicalReviews.length
                      ? "No managed technical changes yet."
                      : "No technical reviews or technical changes yet."}
                  </div>
                )}
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
