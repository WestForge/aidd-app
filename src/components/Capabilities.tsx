import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  Circle,
  CircleDashed,
  Copy,
  Eye,
  FileText,
  Filter,
  ListChecks,
  PackagePlus,
  Pencil,
  PlayCircle,
  Plus,
  Save,
  Search,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Workflow,
  X,
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
const roadmapHorizonOptions: Array<{ value: "" | AiddRoadmapHorizon; label: string }> = [
  { value: "", label: "No horizon" },
  { value: "now", label: "Now" },
  { value: "next", label: "Next" },
  { value: "later", label: "Later" },
  { value: "parking-lot", label: "Parking lot" },
];
const roadmapRiskOptions: Array<{ value: "" | AiddRoadmapRiskLevel; label: string }> = [
  { value: "", label: "No risk" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const roadmapReviewBurdenOptions: Array<{ value: "" | AiddRoadmapReviewBurden; label: string }> = [
  { value: "", label: "No review burden" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const roadmapSizeOptions: Array<{ value: "" | AiddRoadmapSize; label: string }> = [
  { value: "", label: "No estimate" },
  { value: "tiny", label: "Tiny" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "too-large", label: "Too large" },
];
const roadmapConfidenceOptions: AiddRoadmapConfidence[] = ["low", "medium", "high"];
type CapabilityView = "list" | "new" | "edit";
type CapabilitySection = {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  prompt?: string;
};
const icons = [
  Sparkles,
  ListChecks,
  Users,
  Zap,
  ShieldAlert,
  Workflow,
  ShieldAlert,
  CheckCircle2,
];
const capabilityTemplateSections: CapabilitySection[] = [
  {
    key: "outcomes",
    fileName: "01-outcomes.md",
    title: "Outcomes",
    body: `## Purpose
Describe the user or business outcome this capability must enable.

## Success Criteria
- [ ] The capability has a clear reason to exist.
- [ ] Success can be observed or measured.
- [ ] The expected behaviour is specific enough for delivery work.

## Notes
- Primary users:
- Main problem solved:
- Expected result:`,
    prompt: "Describe what this capability should make possible.",
  },
  {
    key: "scope",
    fileName: "02-scope.md",
    title: "Scope",
    body: `## In Scope
- 

## Out of Scope
- 

## Assumptions
- 

## Boundaries
Describe where this capability starts and stops, especially where another capability or component takes over.`,
    prompt: "Define what is in scope and out of scope.",
  },
  {
    key: "user-journeys",
    fileName: "03-user-journeys.md",
    title: "User Journeys",
    body: `## Primary Journey
1. The user starts by...
2. The system responds by...
3. The user completes the task when...

## Alternate Journeys
- 

## Error / Recovery Journeys
- `,
    prompt: "Describe the journeys or workflows this capability supports.",
  },
  {
    key: "functional-requirements",
    fileName: "04-functional-requirements.md",
    title: "Functional Requirements",
    body: `## Required Behaviours
- [ ] The system shall...
- [ ] The user can...
- [ ] The capability prevents...

## Rules
- 

## Acceptance Notes
Describe the minimum behaviour required before implementation can be accepted.`,
    prompt: "List the required behaviours and functions.",
  },
  {
    key: "non-functional-requirements",
    fileName: "05-non-functional-requirements.md",
    title: "Quality Requirements",
    body: `## Quality Attributes
- Performance:
- Reliability:
- Security:
- Accessibility:
- Observability:

## Constraints
- 

## Service Expectations
Describe any limits, response times, scale, offline behaviour, or compatibility needs.`,
    prompt:
      "List quality, performance, reliability, security, or accessibility needs.",
  },
  {
    key: "ux-ui",
    fileName: "06-ux-ui.md",
    title: "UX/UI",
    body: `## User Interface
Describe screens, panels, controls, messages, empty states, and error states.

## User Feedback
- Success feedback:
- Failure feedback:
- Progress / loading feedback:

## Accessibility Notes
- `,
    prompt:
      "Describe user-facing screens, feedback, inspection tools, or UX expectations.",
  },
  {
    key: "risks",
    fileName: "07-risks.md",
    title: "Risks",
    body: `## Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
|  |  |  |

## Unknowns
- 

## Edge Cases
- `,
    prompt: "Capture risks, unknowns, edge cases, and failure modes.",
  },
  {
    key: "validation",
    fileName: "08-validation.md",
    title: "Validation",
    body: `## Verification Approach
Describe how this capability will be checked before it is considered ready.

## Acceptance Checks
- [ ] 
- [ ] 
- [ ] 

## Test Notes
- Unit checks:
- Integration checks:
- Manual checks:
- Regression risks:`,
    prompt: "Describe how this capability should be verified.",
  },
];
function statusLabel(status?: string) {
  return (status ?? "draft").replace(/-/g, " ");
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
    <span className="inline-flex items-center gap-1.5">
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
  return capabilityTemplateSections.map((section) => ({
    ...section,
    body: section.body,
    status: "draft" as AiddSetupStatus,
  }));
}
function sectionReady(section: CapabilitySection) {
  return section.status === "active" || section.status === "complete";
}

export function Capabilities({
  activeProject,
  onChangeCreated,
  initialCapabilitySlug,
  onInitialCapabilityOpened,
}: {
  activeProject?: AiddTrackedProject | null;
  onChangeCreated?: (id: string) => void;
  initialCapabilitySlug?: string | null;
  onInitialCapabilityOpened?: () => void;
}) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [view, setView] = useState<CapabilityView>("list");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<AiddSetupStatus>("draft");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [roadmapHorizon, setRoadmapHorizon] = useState<"" | AiddRoadmapHorizon>("");
  const [roadmapTargetDate, setRoadmapTargetDate] = useState("");
  const [roadmapRisk, setRoadmapRisk] = useState<"" | AiddRoadmapRiskLevel>("");
  const [roadmapReviewBurden, setRoadmapReviewBurden] = useState<"" | AiddRoadmapReviewBurden>("");
  const [roadmapEstimateSize, setRoadmapEstimateSize] = useState<"" | AiddRoadmapSize>("");
  const [roadmapEstimateConfidence, setRoadmapEstimateConfidence] = useState<"" | AiddRoadmapConfidence>("");
  const [roadmapSuggestedSplit, setRoadmapSuggestedSplit] = useState(false);
  const [sections, setSections] = useState<CapabilitySection[]>(newSections());
  const [activeSectionKey, setActiveSectionKey] = useState("outcomes");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionDragFiles, setSectionDragFiles] = useState<Record<string, string>>({});
  const [reviewPackage, setReviewPackage] = useState<AiddCapabilityReviewPackageResult | null>(null);
  const [reviewPackageDragFilePath, setReviewPackageDragFilePath] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiddCapabilitySummary | null>(null);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<AiddCapabilitySummary[] | null>(null);
  const [capabilitySearch, setCapabilitySearch] = useState("");
  const [capabilityStatusFilter, setCapabilityStatusFilter] = useState<string>("all");
  const [capabilityHorizonFilter, setCapabilityHorizonFilter] = useState<string>("all");
  const [capabilityLinkFilter, setCapabilityLinkFilter] = useState<string>("all");
  const [capabilityComponentFilter, setCapabilityComponentFilter] = useState<string>("all");
  const [selectedCapabilitySlugs, setSelectedCapabilitySlugs] = useState<string[]>([]);
  const [capabilityZipDropActive, setCapabilityZipDropActive] = useState(false);
  const load = async () => {
    if (!activeProject?.path) return;
    setSetup(await window.aidd.readProjectSetup(activeProject.path));
  };
  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [activeProject?.path]);
  const foundationBlockers = useMemo(() => {
    if (!setup)
      return ["Load the project foundation before planning Changes."];
    const blockers = setup.foundation
      .filter((doc) => doc.required !== false && doc.status !== "complete")
      .map((doc) => `${doc.title} is ${statusLabel(doc.status)}`);
    if (setup.standards.status !== "complete")
      blockers.push(
        `Project Standards are ${statusLabel(setup.standards.status)}`,
      );
    return blockers;
  }, [setup]);
  const foundationReady = foundationBlockers.length === 0;
  const progress = {
    completed: sections.filter(sectionReady).length,
    total: sections.length,
  };
  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ?? sections[0];
  const allSectionsReady = sections.every(sectionReady);
  const canCreateReviewPackage = Boolean(activeProject?.path && selectedSlug && title.trim());

  const filteredCapabilities = useMemo(() => {
    const capabilities = setup?.capabilities ?? [];
    const search = capabilitySearch.trim().toLowerCase();

    return capabilities.filter((capability) => {
      const linkedComponents = capability.components ?? [];
      const horizon = capability.roadmapHorizon ?? "";
      const searchable = [
        capability.title,
        capability.slug,
        capability.status ?? "draft",
        horizon ? statusLabel(horizon) : "no horizon",
        ...linkedComponents,
      ]
        .join(" ")
        .toLowerCase();

      if (search && !searchable.includes(search)) return false;
      if (capabilityStatusFilter !== "all" && (capability.status ?? "draft") !== capabilityStatusFilter) return false;
      if (capabilityHorizonFilter === "none" && horizon) return false;
      if (capabilityHorizonFilter !== "all" && capabilityHorizonFilter !== "none" && horizon !== capabilityHorizonFilter) return false;
      if (capabilityLinkFilter === "linked" && linkedComponents.length === 0) return false;
      if (capabilityLinkFilter === "unlinked" && linkedComponents.length > 0) return false;
      if (capabilityComponentFilter !== "all" && !linkedComponents.includes(capabilityComponentFilter)) return false;

      return true;
    });
  }, [setup?.capabilities, capabilitySearch, capabilityStatusFilter, capabilityHorizonFilter, capabilityLinkFilter, capabilityComponentFilter]);

  const selectedCapabilities = useMemo(() => {
    const bySlug = new Map((setup?.capabilities ?? []).map((capability) => [capability.slug, capability]));
    return selectedCapabilitySlugs
      .map((slug) => bySlug.get(slug))
      .filter((capability): capability is AiddCapabilitySummary => Boolean(capability));
  }, [setup?.capabilities, selectedCapabilitySlugs]);

  const visibleCapabilitySlugs = filteredCapabilities.map((capability) => capability.slug);
  const allVisibleCapabilitiesSelected =
    visibleCapabilitySlugs.length > 0 &&
    visibleCapabilitySlugs.every((slug) => selectedCapabilitySlugs.includes(slug));

  useEffect(() => {
    const validSlugs = new Set((setup?.capabilities ?? []).map((capability) => capability.slug));
    setSelectedCapabilitySlugs((current) => current.filter((slug) => validSlugs.has(slug)));
  }, [setup?.capabilities]);

  const clearCapabilityFilters = () => {
    setCapabilitySearch("");
    setCapabilityStatusFilter("all");
    setCapabilityHorizonFilter("all");
    setCapabilityLinkFilter("all");
    setCapabilityComponentFilter("all");
  };

  const toggleCapabilitySelection = (slug: string) => {
    setSelectedCapabilitySlugs((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  };

  const selectVisibleCapabilities = () => {
    setSelectedCapabilitySlugs((current) => {
      const next = new Set(current);
      for (const slug of visibleCapabilitySlugs) next.add(slug);
      return Array.from(next);
    });
  };

  const clearSelectedCapabilities = () => setSelectedCapabilitySlugs([]);

  const prepareCapabilitySectionDragFile = async (section: CapabilitySection) => {
    if (!activeProject?.path) return null;

    const capabilityName = title.trim() || "New capability";
    const filePath = await window.aidd.prepareMarkdownDragFile({
      projectPath: activeProject.path,
      directory: selectedSlug
        ? `capabilities/${selectedSlug}`
        : "capabilities/draft",
      fileName: section.fileName,
      title: `${capabilityName} - ${section.title}`,
      status: section.status || "draft",
      body: section.body || "",
      metadata: {
        capability: selectedSlug || "draft",
        section: section.key,
      },
    });

    setSectionDragFiles((current) => ({ ...current, [section.key]: filePath }));
    setDragError(null);
    return filePath;
  };

  useEffect(() => {
    if (!activeProject?.path) {
      setSectionDragFiles({});
      return;
    }

    const timer = window.setTimeout(() => {
      Promise.all(sections.map((section) => prepareCapabilitySectionDragFile(section))).catch(
        (err) => {
          setSectionDragFiles({});
          setDragError(err instanceof Error ? err.message : String(err));
        },
      );
    }, 350);

    return () => window.clearTimeout(timer);
  }, [activeProject?.path, selectedSlug, title, sections]);

  const startCapabilitySectionDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    section: CapabilitySection,
  ) => {
    const filePath = sectionDragFiles[section.key];

    if (!filePath) {
      event.preventDefault();
      setDragError(
        `${section.title} is still being prepared for drag-out. Try again in a moment.`,
      );
      prepareCapabilitySectionDragFile(section).catch((err) =>
        setDragError(err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", filePath);
    event.preventDefault();
    window.aidd.startNativeFileDrag(filePath);
  };

  const resetForm = () => {
    setTitle("");
    setStatus("draft");
    setSelectedComponents([]);
    setRoadmapHorizon("");
    setRoadmapTargetDate("");
    setRoadmapRisk("");
    setRoadmapReviewBurden("");
    setRoadmapEstimateSize("");
    setRoadmapEstimateConfidence("");
    setRoadmapSuggestedSplit(false);
    setSelectedSlug(null);
    setSections(newSections());
    setActiveSectionKey("outcomes");
    setMessage(null);
    setDragError(null);
    setReviewPackage(null);
    setReviewPackageDragFilePath(null);
    setDeleteTarget(null);
  };
  const openCapability = async (slug: string) => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await window.aidd.readCapability({
        projectPath: activeProject.path,
        slug,
      });
      setSelectedSlug(detail.slug);
      setTitle(detail.title);
      setStatus((detail.status as AiddSetupStatus) || "draft");
      setSelectedComponents(detail.components || []);
      setRoadmapHorizon(detail.roadmapHorizon || "");
      setRoadmapTargetDate(detail.targetDate || "");
      setRoadmapRisk(detail.riskLevel || "");
      setRoadmapReviewBurden(detail.reviewBurden || "");
      setRoadmapEstimateSize(detail.estimatedSize || "");
      setRoadmapEstimateConfidence(detail.estimateConfidence || "");
      setRoadmapSuggestedSplit(Boolean(detail.suggestedSplit));
      setSections(detail.sections?.length ? detail.sections : newSections());
      setActiveSectionKey(detail.sections?.[0]?.key || "outcomes");
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      setView("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!initialCapabilitySlug || !activeProject?.path) return;
    openCapability(initialCapabilitySlug).finally(() => onInitialCapabilityOpened?.());
  }, [initialCapabilitySlug, activeProject?.path]);
  const toggleComponent = (slug: string) =>
    setSelectedComponents((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
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
      current.map((section) => ({ ...section, status: nextStatus })),
    );
  const roadmapFields = () => {
    return {
      roadmapHorizon,
      targetDate: roadmapTargetDate,
      estimatedSize: roadmapEstimateSize,
      estimateConfidence: roadmapEstimateConfidence,
      riskLevel: roadmapRisk,
      reviewBurden: roadmapReviewBurden,
      suggestedSplit: roadmapSuggestedSplit,
    };
  };
  const createCapability = async () => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.createCapability({
        projectPath: activeProject.path,
        title,
        componentSlugs: selectedComponents,
        status,
        sections,
        ...roadmapFields(),
      });
      setSetup(next);
      resetForm();
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const saveCapability = async () => {
    if (!activeProject?.path || !selectedSlug) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: selectedSlug,
        title,
        componentSlugs: selectedComponents,
        status,
        sections,
        ...roadmapFields(),
      });
      setSetup(next);
      setMessage("Capability saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestCapabilityDelete = (capability: AiddCapabilitySummary) => {
    setError(null);
    setMessage(null);
    setDeleteTarget(capability);
  };

  const deleteSelectedCapability = async () => {
    if (!activeProject?.path || !deleteTarget) return;

    const target = deleteTarget;
    setSaving(true);
    setError(null);
    try {
      const next = await window.aidd.deleteCapability({
        projectPath: activeProject.path,
        slug: target.slug,
      });
      setSetup(next);
      setDeleteTarget(null);
      setSelectedCapabilitySlugs((current) => current.filter((slug) => slug !== target.slug));

      if (selectedSlug === target.slug) {
        resetForm();
        setView("list");
      }

      setMessage(`Deleted capability "${target.title}".`);
      void window.aidd.notify({
        title: "Capability deleted",
        body: target.title,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestBulkCapabilityDelete = () => {
    if (!selectedCapabilities.length) return;
    setError(null);
    setMessage(null);
    setBulkDeleteTargets(selectedCapabilities);
  };

  const deleteBulkCapabilities = async () => {
    if (!activeProject?.path || !bulkDeleteTargets?.length) return;

    const targets = bulkDeleteTargets;
    setSaving(true);
    setError(null);
    try {
      let nextSetup = setup;
      for (const target of targets) {
        nextSetup = await window.aidd.deleteCapability({
          projectPath: activeProject.path,
          slug: target.slug,
        });
      }
      if (nextSetup) setSetup(nextSetup);
      setBulkDeleteTargets(null);
      setSelectedCapabilitySlugs((current) =>
        current.filter((slug) => !targets.some((target) => target.slug === slug)),
      );

      if (selectedSlug && targets.some((target) => target.slug === selectedSlug)) {
        resetForm();
        setView("list");
      }

      setMessage(`Deleted ${targets.length} capability item(s).`);
      void window.aidd.notify({
        title: "Capabilities deleted",
        body: `${targets.length} item(s) removed.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const copySelectedCapabilitiesForAi = async () => {
    if (!selectedCapabilities.length) return;

    const payload = [
      "# Selected capabilities",
      "",
      ...selectedCapabilities.flatMap((capability) => [
        `## ${capability.title}`,
        `- Slug: ${capability.slug}`,
        `- Status: ${statusLabel(capability.status)}`,
        `- Linked components: ${(capability.components ?? []).join(", ") || "None"}`,
        "",
      ]),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(payload);
      setMessage(`Copied ${selectedCapabilities.length} selected capability item(s) for AI context.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createChangeFromSelectedCapabilities = async () => {
    if (!activeProject?.path || !selectedCapabilities.length) return;

    const targets = selectedCapabilities;
    const linkedComponents = Array.from(
      new Set(targets.flatMap((capability) => capability.components ?? [])),
    );
    const changeTitle =
      targets.length === 1
        ? `Implement ${targets[0].title}`
        : `Implement ${targets.length} selected capabilities`;

    setSaving(true);
    setError(null);
    try {
      const result = await window.aidd.createChange({
        projectPath: activeProject.path,
        title: changeTitle,
        type: "implement-capability",
        status: "draft",
        priority: "normal",
        risk: "unknown",
        linkedCapabilities: targets.map((capability) => capability.slug),
        linkedComponents,
      });
      await load();
      setMessage(`Created Change ${result.id} from ${targets.length} selected capability item(s).`);
      void window.aidd.notify({ title: "Change created", body: result.id });
      onChangeCreated?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createChangeFromCapability = async () => {
    if (!activeProject?.path || !selectedSlug) return;
    setSaving(true);
    setError(null);
    try {
      await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: selectedSlug,
        title,
        componentSlugs: selectedComponents,
        status,
        sections,
        ...roadmapFields(),
      });
      const result = await window.aidd.createChangeFromCapability({
        projectPath: activeProject.path,
        capabilitySlug: selectedSlug,
      });
      await load();
      setMessage(`Created Change ${result.id}.`);
      await window.aidd.notify?.({ title: 'Change created', body: result.id });
      onChangeCreated?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };


  const droppedZipPathFromEvent = (event: React.DragEvent<HTMLButtonElement>) => {
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const nativePath = window.aidd.getDroppedFilePath(file);
      if (nativePath) return nativePath;
      const fallbackPath = (file as File & { path?: string }).path;
      if (fallbackPath) return fallbackPath;
    }
    return event.dataTransfer.getData("text/plain");
  };

  const createCapabilityReviewPackage = async () => {
    if (!activeProject?.path || !selectedSlug) {
      setDragError("Save the capability before creating a review package.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    try {
      await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: selectedSlug,
        title,
        componentSlugs: selectedComponents,
        status,
        sections,
        ...roadmapFields(),
      });
      const bundle = await window.aidd.packageCapabilityForReview({
        projectPath: activeProject.path,
        slug: selectedSlug,
      });
      setReviewPackage(bundle);
      setReviewPackageDragFilePath(bundle.filePath);
      void window.aidd.notify({
        title: "Capability review package ready",
        body: `${bundle.capabilityFileCount} capability file(s) packaged. Drag the review package tile out when ready.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const startCapabilityReviewPackageDrag = (event: React.DragEvent<HTMLButtonElement>) => {
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

  const importCapabilityReviewPackage = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCapabilityZipDropActive(false);
    if (!activeProject?.path) return;

    const zipPath = droppedZipPathFromEvent(event);
    if (!zipPath) {
      setDragError("Drop a capability .zip file.");
      return;
    }
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setDragError("Capability import rejected: drop a .zip file.");
      return;
    }

    setSaving(true);
    setError(null);
    setDragError(null);
    setMessage(null);
    try {
      const result = await window.aidd.importCapabilityReviewPackage({
        projectPath: activeProject.path,
        zipPath,
      });
      setReviewPackage(null);
      setReviewPackageDragFilePath(null);
      await load();
      const importedSlug = result.importedCapabilities?.length === 1 ? result.importedCapabilities[0] : selectedSlug;
      setMessage(
        result.capabilityCount
          ? `Imported ${result.capabilityCount} capability item(s) from zip.`
          : "No capability files were imported from that zip.",
      );
      if (importedSlug) await openCapability(importedSlug);
      void window.aidd.notify({
        title: "Capability zip imported",
        body: `${result.importedFiles.length} file(s) imported from ${result.capabilityCount} capability/capabilities.`,
      });
    } catch (err) {
      setDragError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
        aria-labelledby="delete-capability-title"
        className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-2">
            <h2 id="delete-capability-title" className="text-lg font-semibold">
              Delete capability?
            </h2>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the files for
              {" "}
              <span className="font-medium text-foreground">{deleteTarget.title}</span> only.
              Other capabilities will not be touched.
            </p>
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-medium text-foreground">Files to remove</div>
              <code className="mt-1 block break-all text-muted-foreground">
                capabilities/{deleteTarget.slug}/
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              AIDD will refresh the capability/component indexes and create a git checkpoint commit after the delete.
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
            onClick={deleteSelectedCapability}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            {saving ? "Deleting..." : "Delete capability"}
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
        aria-labelledby="bulk-delete-capability-title"
        className="w-full max-w-xl rounded-lg border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-3">
            <div>
              <h2 id="bulk-delete-capability-title" className="text-lg font-semibold">
                Delete selected capabilities?
              </h2>
              <p className="text-sm text-muted-foreground">
                This will remove {bulkDeleteTargets.length} capability folder(s) from the workspace. Git history can recover committed files, but AIDD will delete them from the current project state.
              </p>
            </div>
            <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-medium text-foreground">Selected capabilities</div>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {bulkDeleteTargets.map((capability) => (
                  <li key={capability.slug}>
                    <span className="font-medium text-foreground">{capability.title}</span>
                    <span> - capabilities/{capability.slug}/</span>
                  </li>
                ))}
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
            onClick={deleteBulkCapabilities}
            disabled={saving}
          >
            <Trash2 className="h-4 w-4" />
            {saving ? "Deleting..." : `Delete ${bulkDeleteTargets.length} capabilities`}
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
            <h1 className="text-xl font-semibold">Capabilities</h1>
            <p className="text-sm text-muted-foreground">
              Define what your system can do.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              className={cn("border-dashed", capabilityZipDropActive && "border-primary bg-primary/10")}
              onDragEnter={(event) => {
                event.preventDefault();
                setCapabilityZipDropActive(true);
              }}
              onDragLeave={() => setCapabilityZipDropActive(false)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setCapabilityZipDropActive(true);
              }}
              onDrop={importCapabilityReviewPackage}
              title="Drop a zip containing capabilities/<slug>/ files"
            >
              <Upload className="h-4 w-4" /> Import ZIP
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setView("new");
              }}
            >
              <Plus className="h-4 w-4" /> New Capability
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
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Filter className="h-4 w-4" /> Filter capabilities
                  </CardTitle>
                  <CardDescription>
                    Find capabilities by horizon, status, linked component, or missing context before selecting bulk actions.
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  {filteredCapabilities.length} / {setup?.capabilities.length ?? 0} shown
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={capabilitySearch}
                  onChange={(event) => setCapabilitySearch(event.target.value)}
                  placeholder="Search title, slug, status, or component..."
                />
              </div>
              <Select
                value={capabilityStatusFilter}
                onChange={(event) => setCapabilityStatusFilter(event.target.value)}
                aria-label="Filter capabilities by status"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>{statusLabel(option)}</option>
                ))}
              </Select>
              <Select
                value={capabilityHorizonFilter}
                onChange={(event) => setCapabilityHorizonFilter(event.target.value)}
                aria-label="Filter capabilities by roadmap horizon"
              >
                <option value="all">Any horizon</option>
                <option value="none">No horizon</option>
                {roadmapHorizonOptions
                  .filter((option) => option.value)
                  .map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
              </Select>
              <Select
                value={capabilityLinkFilter}
                onChange={(event) => setCapabilityLinkFilter(event.target.value)}
                aria-label="Filter capabilities by component link state"
              >
                <option value="all">All link states</option>
                <option value="linked">Has components</option>
                <option value="unlinked">No components</option>
              </Select>
              <Select
                value={capabilityComponentFilter}
                onChange={(event) => setCapabilityComponentFilter(event.target.value)}
                aria-label="Filter capabilities by component"
                className="md:col-span-2"
              >
                <option value="all">Any component</option>
                {(setup?.components ?? []).map((component) => (
                  <option key={component.slug} value={component.slug}>{component.title}</option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button type="button" variant="outline" size="sm" onClick={clearCapabilityFilters}>
                  <X className="h-4 w-4" /> Clear filters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={allVisibleCapabilitiesSelected ? clearSelectedCapabilities : selectVisibleCapabilities}
                  disabled={!filteredCapabilities.length}
                >
                  <CheckSquare className="h-4 w-4" />
                  {allVisibleCapabilitiesSelected ? "Clear selection" : "Select visible"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {selectedCapabilities.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm">
                <span className="font-medium">{selectedCapabilities.length} capability item(s) selected</span>
                <span className="ml-2 text-muted-foreground">Use selection to shape Changes or remove stale items.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copySelectedCapabilitiesForAi} disabled={saving}>
                  <Copy className="h-4 w-4" /> Copy for AI
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={createChangeFromSelectedCapabilities} disabled={saving}>
                  <PackagePlus className="h-4 w-4" /> Create Change
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={clearSelectedCapabilities} disabled={saving}>
                  <X className="h-4 w-4" /> Clear
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={requestBulkCapabilityDelete} disabled={saving}>
                  <Trash2 className="h-4 w-4" /> Delete selected
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCapabilities.map((capability) => {
              const isSelected = selectedCapabilitySlugs.includes(capability.slug);
              return (
                <Card
                  key={capability.slug}
                  className={cn(
                    "cursor-pointer hover:bg-accent",
                    isSelected && "border-primary bg-primary/5",
                  )}
                  onClick={() => openCapability(capability.slug)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-primary"
                          aria-label={`Select ${capability.title}`}
                          checked={isSelected}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleCapabilitySelection(capability.slug)}
                        />
                        <div className="min-w-0">
                          <CardTitle className="text-base">
                            {capability.title}
                          </CardTitle>
                          <CardDescription>
                            {capability.components?.length
                              ? `${capability.components.length} component(s) linked`
                              : "No components linked yet"}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline">
                          <StatusPill status={capability.status} />
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          aria-label={`Delete ${capability.title}`}
                          disabled={saving}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestCapabilityDelete(capability);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {capability.components?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {capability.components.map((component) => (
                          <Badge key={component} variant="secondary">
                            {component}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Open the editor to define sections and component links.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {setup && setup.capabilities.length > 0 && filteredCapabilities.length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardHeader>
                  <Search className="h-6 w-6" />
                  <CardTitle>No capabilities match these filters</CardTitle>
                  <CardDescription>
                    Clear the filters or adjust the search to show more capabilities.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={clearCapabilityFilters}>
                    <X className="h-4 w-4" /> Clear filters
                  </Button>
                </CardContent>
              </Card>
            )}
            {setup && setup.capabilities.length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardHeader>
                  <CardTitle>No capabilities yet</CardTitle>
                  <CardDescription>
                    Create the first capability by describing what the system
                    should make possible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => {
                      resetForm();
                      setView("new");
                    }}
                  >
                    New Capability
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
      {deleteDialog}
      {bulkDeleteDialog}
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                resetForm();
                setView("list");
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              className="max-w-lg text-base font-semibold"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Capability name"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} label="Lifecycle" />
          <StatusBadge status={activeSection?.status} label="Section" />
          {view === "edit" && (
            <Button
              variant="outline"
              onClick={createChangeFromCapability}
              disabled={saving || !selectedSlug}
            >
              <PackagePlus className="h-4 w-4" /> Plan Change
            </Button>
          )}
          {view === "edit" && selectedSlug && (
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                requestCapabilityDelete({
                  slug: selectedSlug,
                  title: title.trim() || selectedSlug,
                  status,
                  components: selectedComponents,
                })
              }
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button
            onClick={view === "edit" ? saveCapability : createCapability}
            disabled={saving || !title.trim()}
          >
            <Save className="h-4 w-4" />
            {view === "edit" ? "Save" : "Save capability"}
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
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
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
              onDragStart={(event) => startCapabilitySectionDrag(event, section)}
              onFocus={() => prepareCapabilitySectionDragFile(section).catch(() => undefined)}
              onMouseEnter={() => prepareCapabilitySectionDragFile(section).catch(() => undefined)}
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
            !reviewPackageDragFilePath && canCreateReviewPackage && "cursor-pointer",
            !canCreateReviewPackage && !reviewPackageDragFilePath && "opacity-70",
          )}
          onClick={() => {
            if (canCreateReviewPackage) void createCapabilityReviewPackage();
            else setDragError("Save the capability before creating a review package. You can still drop a returned capability review zip here.");
          }}
          onDragStart={startCapabilityReviewPackageDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={importCapabilityReviewPackage}
          title={reviewPackageDragFilePath ? "Review package is ready. Drag this zip out, or drop a returned review zip here." : "Create a capability review package zip, or drop a returned review zip here."}
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
        <div className="grid min-h-full min-w-0 gap-4 xl:h-full xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <Card className="flex min-h-[28rem] flex-1 flex-col overflow-hidden">
              <CardHeader className="shrink-0">
                <div>
                  <CardTitle>{activeSection?.title}</CardTitle>
                  <CardDescription>{activeSection?.prompt}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden p-4">
                <MarkdownEditor
                  editorKey={`capability-${selectedSlug}-${activeSection?.fileName ?? "section"}`}
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
                  Delivery package creation requires complete foundation, active
                  capability, and active/complete sections.
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
                    value={
                      (activeSection?.status as AiddSetupStatus) || "not-started"
                    }
                    onChange={(event) =>
                      updateActiveSectionStatus(
                        event.target.value as AiddSetupStatus,
                      )
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
                  <span className="text-muted-foreground">All sections</span>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    <span>Bulk update</span>
                  </div>
                  <Select
                    className="w-full"
                    value=""
                    aria-label="Set all capability section statuses"
                    onChange={(event) => {
                      const nextStatus = event.target.value as AiddSetupStatus;
                      if (nextStatus) updateAllSectionStatuses(nextStatus);
                    }}
                  >
                    <option value="">Set all to...</option>
                    {statusOptions.map((item) => (
                      <option key={item} value={item}>
                        {statusLabel(item)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:justify-center">
                  <div>
                    <span className="text-muted-foreground">
                      Template progress
                    </span>
                    <div className="font-semibold">
                      {progress.completed}/{progress.total}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Foundation</span>
                    <Badge
                      variant={foundationReady ? "secondary" : "destructive"}
                    >
                      {foundationReady ? "Ready" : "Blocked"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <aside className="flex min-h-0 min-w-0 flex-col gap-4 xl:overflow-auto xl:pr-1">
            <Card className="shrink-0">
              <CardHeader>
                <CardTitle>Roadmap planning</CardTitle>
                <CardDescription>
                  Add target date, size, confidence, risk, and review burden signals used by the Roadmap page.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1">
                  <span className="text-muted-foreground">Horizon</span>
                  <Select value={roadmapHorizon} onChange={(event) => setRoadmapHorizon(event.target.value as "" | AiddRoadmapHorizon)}>
                    {roadmapHorizonOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Target date</span>
                  <Input type="date" value={roadmapTargetDate} onChange={(event) => setRoadmapTargetDate(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Risk</span>
                  <Select value={roadmapRisk} onChange={(event) => setRoadmapRisk(event.target.value as "" | AiddRoadmapRiskLevel)}>
                    {roadmapRiskOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Size</span>
                  <Select value={roadmapEstimateSize} onChange={(event) => setRoadmapEstimateSize(event.target.value as "" | AiddRoadmapSize)}>
                    {roadmapSizeOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Confidence</span>
                  <Select value={roadmapEstimateConfidence} onChange={(event) => setRoadmapEstimateConfidence(event.target.value as "" | AiddRoadmapConfidence)}>
                    <option value="">No confidence</option>
                    {roadmapConfidenceOptions.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Review burden</span>
                  <Select value={roadmapReviewBurden} onChange={(event) => setRoadmapReviewBurden(event.target.value as "" | AiddRoadmapReviewBurden)}>
                    {roadmapReviewBurdenOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
                  </Select>
                </div>
                <label className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={roadmapSuggestedSplit}
                    onChange={(event) => setRoadmapSuggestedSplit(event.target.checked)}
                  />
                  <span>Suggested split</span>
                </label>
              </CardContent>
            </Card>
            <Card className="shrink-0">
              <CardHeader>
                <CardTitle>Components</CardTitle>
                <CardDescription>
                  Mark the system components this capability touches.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {setup?.components.map((component) => {
                    const selected = selectedComponents.includes(component.slug);
                    return (
                      <Button
                        key={component.slug}
                        variant={selected ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => toggleComponent(component.slug)}
                        className={cn("gap-2", selected && "ring-1 ring-ring")}
                        aria-pressed={selected}
                      >
                        {selected ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                        {component.title}
                      </Button>
                    );
                  })}
                  {setup?.components.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No components yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
