import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Boxes,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  ListChecks,
  Monitor,
  PackagePlus,
  Pencil,
  Plug,
  Plus,
  Route,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import { AiddMarkdownEditor } from "./editor/AiddMarkdownEditor";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";
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

type CapabilityView = "list" | "new" | "edit";

type CapabilitySection = {
  key: string;
  fileName: string;
  title: string;
  body: string;
  status?: AiddSetupStatus | string;
  prompt?: string;
};

const capabilityTemplateSections: CapabilitySection[] = [
  {
    key: "outcomes",
    fileName: "01-outcomes.md",
    title: "Outcomes",
    body: "",
    prompt: "Describe what this capability should make possible.",
  },
  {
    key: "scope",
    fileName: "02-scope.md",
    title: "Scope",
    body: "",
    prompt: "Define what is in scope and out of scope.",
  },
  {
    key: "user-journeys",
    fileName: "03-user-journeys.md",
    title: "User Journeys",
    body: "",
    prompt: "Describe the journeys or workflows this capability supports.",
  },
  {
    key: "functional-requirements",
    fileName: "04-functional-requirements.md",
    title: "Functional Requirements",
    body: "",
    prompt: "List the required behaviours and functions.",
  },
  {
    key: "non-functional-requirements",
    fileName: "05-non-functional-requirements.md",
    title: "Non-Functional Requirements",
    body: "",
    prompt:
      "List quality attributes, constraints, performance, reliability, security, or accessibility needs.",
  },
  {
    key: "data-model",
    fileName: "06-data-model.md",
    title: "Data Model",
    body: "",
    prompt: "Describe important data, records, state, and identifiers.",
  },
  {
    key: "integrations",
    fileName: "07-integrations.md",
    title: "Integrations",
    body: "",
    prompt:
      "Describe systems, services, components, or workflows this capability integrates with.",
  },
  {
    key: "architecture",
    fileName: "08-architecture.md",
    title: "Architecture",
    body: "",
    prompt: "Describe the expected architectural shape or constraints.",
  },
  {
    key: "ux-ui",
    fileName: "09-ux-ui.md",
    title: "UX/UI",
    body: "",
    prompt:
      "Describe user-facing screens, feedback, inspection tools, or UX expectations.",
  },
  {
    key: "risks",
    fileName: "10-risks.md",
    title: "Risks",
    body: "",
    prompt: "Capture risks, unknowns, edge cases, and failure modes.",
  },
  {
    key: "validation",
    fileName: "11-validation.md",
    title: "Validation",
    body: "",
    prompt: "Describe how this capability should be verified.",
  },
];

function statusLabel(status?: string) {
  return (status ?? "draft").replace(/-/g, " ");
}

const sectionIconMap: Record<string, typeof Target> = {
  outcomes: Target,
  scope: ListChecks,
  "user-journeys": Route,
  "functional-requirements": ClipboardCheck,
  "non-functional-requirements": ShieldCheck,
  "data-model": Database,
  integrations: Plug,
  architecture: Boxes,
  "ux-ui": Monitor,
  risks: TriangleAlert,
  validation: BadgeCheck,
};

function sectionIsReady(section: CapabilitySection) {
  return section.status === "complete" || section.status === "active";
}

function sectionStatusIcon(section: CapabilitySection) {
  if (sectionIsReady(section)) return CheckCircle2;
  if (section.status === "deprecated") return Ban;
  if (section.status === "in-review") return Clock;
  if (section.status === "draft") return Pencil;
  return Circle;
}

function sectionStatusClass(section: CapabilitySection) {
  if (sectionIsReady(section)) return "text-emerald-600 dark:text-emerald-400";
  if (section.status === "deprecated") return "text-destructive";
  if (section.status === "in-review") return "text-blue-600 dark:text-blue-400";
  if (section.status === "draft") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function badgeVariant(
  status?: string,
): "secondary" | "success" | "warning" | "destructive" | "outline" {
  if (status === "active" || status === "complete") return "success";
  if (status === "deprecated") return "destructive";
  if (status === "in-review") return "outline";
  if (status === "draft" || status === "not-started") return "warning";
  return "secondary";
}

function newSections() {
  return capabilityTemplateSections.map((section) => ({
    ...section,
    body: "",
    status: "not-started" as AiddSetupStatus,
  }));
}

function sectionProgress(sections: CapabilitySection[]) {
  const completed = sections.filter(sectionIsReady).length;
  return { completed, total: sections.length };
}

function sectionStarted(section: CapabilitySection) {
  return (
    Boolean(section.body.trim()) ||
    section.status === "complete" ||
    section.status === "active" ||
    section.status === "in-review" ||
    section.status === "draft"
  );
}

export function Capabilities({
  activeProject,
}: {
  activeProject?: AiddTrackedProject | null;
}) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [view, setView] = useState<CapabilityView>("list");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<AiddSetupStatus>("draft");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [inlineComponentTitle, setInlineComponentTitle] = useState("");
  const [inlineComponentDescription, setInlineComponentDescription] =
    useState("");
  const [sections, setSections] = useState<CapabilitySection[]>(newSections());
  const [activeSectionKey, setActiveSectionKey] = useState("outcomes");
  const [dirtySectionKeys, setDirtySectionKeys] = useState<Set<string>>(
    new Set(),
  );
  const [dirtyMeta, setDirtyMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeProject?.path) return;
    setSetup(await window.aidd.readProjectSetup(activeProject.path));
  };

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, [activeProject?.path]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capability of setup?.capabilities ?? [])
      counts.set(
        capability.status ?? "draft",
        (counts.get(capability.status ?? "draft") ?? 0) + 1,
      );
    return counts;
  }, [setup?.capabilities]);

  const foundationBlockers = useMemo(() => {
    if (!setup)
      return ["Load the project foundation before creating delivery packages."];
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
  const sectionBlockers = sections
    .filter((section) => !sectionIsReady(section))
    .map((section) => `${section.title} is ${statusLabel(section.status)}`);
  const lifecycleReady = status === "active" || status === "complete";
  const deliveryReady =
    foundationReady && lifecycleReady && sectionBlockers.length === 0;
  const progress = sectionProgress(sections);
  const activeSection =
    sections.find((section) => section.key === activeSectionKey) ?? sections[0];
  const dirtySectionCount = dirtySectionKeys.size;
  const hasUnsavedChanges = dirtyMeta || dirtySectionCount > 0;

  const markMetaDirty = () => setDirtyMeta(true);
  const markSectionDirty = (key: string) =>
    setDirtySectionKeys((current) => new Set([...current, key]));
  const clearDirty = () => {
    setDirtyMeta(false);
    setDirtySectionKeys(new Set());
  };

  const resetForm = () => {
    setTitle("");
    setStatus("draft");
    setSelectedComponents([]);
    setInlineComponentTitle("");
    setInlineComponentDescription("");
    setSelectedSlug(null);
    setSections(newSections());
    setActiveSectionKey("outcomes");
    setMessage(null);
    clearDirty();
  };

  const openNew = () => {
    resetForm();
    setView("new");
  };

  const openCapability = async (slug: string) => {
    if (!activeProject?.path) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await window.aidd.readCapability({
        projectPath: activeProject.path,
        slug,
      });
      setSelectedSlug(detail.slug);
      setTitle(detail.title);
      setStatus((detail.status as AiddSetupStatus) || "draft");
      setSelectedComponents(detail.components || []);
      setInlineComponentTitle("");
      setInlineComponentDescription("");
      setSections(detail.sections?.length ? detail.sections : newSections());
      setActiveSectionKey(detail.sections?.[0]?.key || "outcomes");
      clearDirty();
      setView("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleComponent = (slug: string) => {
    setSelectedComponents((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
    markMetaDirty();
  };

  const updateActiveSectionBody = (body: string) => {
    setSections((current) =>
      current.map((section) =>
        section.key === activeSectionKey
          ? {
              ...section,
              body,
              status: body.trim()
                ? section.status === "not-started"
                  ? "draft"
                  : section.status
                : section.status,
            }
          : section,
      ),
    );
    markSectionDirty(activeSectionKey);
  };

  const updateActiveSectionStatus = (nextStatus: AiddSetupStatus) => {
    setSections((current) =>
      current.map((section) =>
        section.key === activeSectionKey
          ? { ...section, status: nextStatus }
          : section,
      ),
    );
    markSectionDirty(activeSectionKey);
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
        inlineComponent: inlineComponentTitle.trim()
          ? {
              title: inlineComponentTitle,
              description: inlineComponentDescription,
            }
          : undefined,
        status,
        sections,
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
    setMessage(null);
    try {
      const next = await window.aidd.updateCapability({
        projectPath: activeProject.path,
        slug: selectedSlug,
        title,
        componentSlugs: selectedComponents,
        status,
        sections,
      });
      setSetup(next);
      setMessage(
        dirtySectionCount > 0
          ? `Capability saved. ${dirtySectionCount} section${dirtySectionCount === 1 ? "" : "s"} changed.`
          : "Capability details saved.",
      );
      clearDirty();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createDeliveryPackage = async () => {
    if (!activeProject?.path || !selectedSlug) return;
    if (!foundationReady) {
      setError(
        `Project Foundation must be complete before creating a delivery package. Missing: ${foundationBlockers.join("; ")}`,
      );
      return;
    }
    if (!lifecycleReady || sectionBlockers.length > 0) {
      const blockers = [
        ...(!lifecycleReady
          ? [`Capability lifecycle is ${statusLabel(status)}`]
          : []),
        ...sectionBlockers,
      ];
      setError(
        `Capability must be active/complete and all template sections must be complete before creating a delivery package. Missing: ${blockers.join("; ")}`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.aidd.createDeliveryPackageFromCapability({
        projectPath: activeProject.path,
        capabilitySlug: selectedSlug,
      });
      await load();
      setMessage(
        `Created delivery package ${result.id}. Snapshot and implementation strategy files are ready for refinement.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return (
      <main className="flex h-full min-h-0 w-full flex-col bg-background p-6 text-foreground">
        <Card>
          <CardHeader>
            <CardTitle>No project selected</CardTitle>
            <CardDescription>Create or open a project first.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const isEditing = view === "edit";
  const saveText =
    dirtySectionCount > 0
      ? `Save ${dirtySectionCount} section${dirtySectionCount === 1 ? "" : "s"}`
      : dirtyMeta
        ? "Save details"
        : "Save changes";

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b bg-background px-4 py-3">
        <div className="min-w-0 flex-1">
          {view === "list" ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Capabilities
              </p>
              <h1 className="truncate text-xl font-semibold tracking-tight">
                Define what your system can do
              </h1>
            </>
          ) : (
            <div className="grid max-w-3xl gap-1">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Capability name
              </Label>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  markMetaDirty();
                }}
                placeholder="Runtime save system"
                className="h-9 text-base font-semibold"
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view !== "list" && (
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setView("list");
              }}
            >
              <ArrowLeft size={16} /> Back
            </Button>
          )}
          {view === "list" && (
            <Button onClick={openNew}>
              <Plus size={16} /> New Capability
            </Button>
          )}
          {isEditing && (
            <Button
              variant="outline"
              onClick={createDeliveryPackage}
              disabled={saving || !deliveryReady}
              title={
                deliveryReady
                  ? "Create a delivery package from this capability"
                  : "Complete Foundation, activate the capability, and mark every section complete first"
              }
            >
              <PackagePlus size={16} /> Create Delivery Package
            </Button>
          )}
          {view === "new" && (
            <Button
              onClick={createCapability}
              disabled={saving || !title.trim()}
            >
              <Plus size={16} />
              {saving ? "Creating..." : "Create"}
            </Button>
          )}
          {isEditing && (
            <Button
              onClick={saveCapability}
              disabled={saving || !title.trim() || !hasUnsavedChanges}
            >
              <Save size={16} />
              {saving ? "Saving..." : saveText}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <strong>Error:</strong> {error}
          </Alert>
        </div>
      )}
      {message && (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="success">
            <strong>Done:</strong> {message}
          </Alert>
        </div>
      )}

      {view === "list" && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-3xl">
                  {setup?.capabilities.length ?? 0}
                </CardTitle>
                <CardDescription>Total capabilities</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-3xl">
                  {statusCounts.get("draft") ?? 0}
                </CardTitle>
                <CardDescription>Draft</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-3xl">
                  {statusCounts.get("in-review") ?? 0}
                </CardTitle>
                <CardDescription>In review</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-3xl">
                  {statusCounts.get("active") ?? 0}
                </CardTitle>
                <CardDescription>Active</CardDescription>
              </CardHeader>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
              <div>
                <CardTitle>Capability catalogue</CardTitle>
                <CardDescription>
                  Click a capability to open the full-screen editor.
                </CardDescription>
              </div>
              <Button onClick={openNew}>
                <Plus size={16} /> New Capability
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {setup?.capabilities.map((capability) => {
                  const complete =
                    capability.status === "complete" ||
                    capability.status === "active";
                  const Icon = complete ? CheckCircle2 : Circle;
                  return (
                    <button
                      key={capability.slug}
                      className="group rounded-md border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/35"
                      onClick={() => openCapability(capability.slug)}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <Icon
                          size={20}
                          className={
                            complete
                              ? "text-emerald-600"
                              : "text-muted-foreground"
                          }
                        />
                        <Badge variant={badgeVariant(capability.status)}>
                          {statusLabel(capability.status)}
                        </Badge>
                      </div>
                      <h3 className="mb-2 text-base font-semibold">
                        {capability.title}
                      </h3>
                      <p className="mb-3 text-sm text-muted-foreground">
                        {capability.components?.length
                          ? `${capability.components.length} component(s) linked`
                          : "No components linked yet"}
                      </p>
                      {capability.components?.length ? (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {capability.components.map((component) => (
                            <Badge key={component} variant="outline">
                              {component}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                        <FileText size={14} /> Open editor
                      </span>
                    </button>
                  );
                })}
                {setup && setup.capabilities.length === 0 && (
                  <Card className="col-span-full border-dashed">
                    <CardHeader className="items-center text-center">
                      <Sparkles size={36} className="text-muted-foreground" />
                      <CardTitle>No capabilities yet</CardTitle>
                      <CardDescription>
                        Create the first capability by describing what the
                        system should make possible. You can link components now
                        or create them inline.
                      </CardDescription>
                      <Button onClick={openNew}>
                        <Plus size={16} /> New Capability
                      </Button>
                    </CardHeader>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {view !== "list" && (
        <>
          <div className="shrink-0 border-b bg-muted/30 px-4 py-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sections.map((section) => {
                const dirty = dirtySectionKeys.has(section.key);
                const SectionIcon = sectionIconMap[section.key] ?? FileText;
                const StatusIcon = sectionStatusIcon(section);
                const ready = sectionIsReady(section);
                return (
                  <button
                    key={section.key}
                    type="button"
                    title={`${section.title} - ${statusLabel(section.status)} (${section.fileName})`}
                    onClick={() => setActiveSectionKey(section.key)}
                    className={cn(
                      "relative flex h-20 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border bg-card px-2 py-2 text-center text-xs shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                      section.key === activeSectionKey
                        ? "border-primary ring-1 ring-primary"
                        : "border-border",
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        "absolute right-1.5 top-1.5 h-4 w-4",
                        sectionStatusClass(section),
                      )}
                      aria-label={statusLabel(section.status)}
                    />
                    {dirty && (
                      <span
                        className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-primary"
                        aria-label="Unsaved changes"
                      />
                    )}
                    <SectionIcon
                      className={cn(
                        "h-6 w-6",
                        ready ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                    <span className="line-clamp-2 leading-tight">
                      {section.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <section className="min-h-0 flex-1 overflow-hidden p-4">
            <Card className="flex h-full min-h-0 flex-col">
              <CardHeader className="shrink-0 flex-row items-start justify-between gap-4 space-y-0 border-b">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {activeSection?.fileName}
                  </p>
                  <CardTitle className="truncate">
                    {activeSection?.title}
                  </CardTitle>
                  <CardDescription>{activeSection?.prompt}</CardDescription>
                </div>
                <div className="grid w-48 gap-1">
                  <Label className="text-xs">Section status</Label>
                  <Select
                    value={
                      (activeSection?.status as AiddSetupStatus) ||
                      "not-started"
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
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-3">
                <AiddMarkdownEditor
                  value={activeSection?.body || ""}
                  onChange={updateActiveSectionBody}
                  height="100%"
                  className="h-full"
                />
              </CardContent>
            </Card>
          </section>

          <footer className="shrink-0 border-t bg-background px-4 py-3">
            <div className="grid gap-3 xl:grid-cols-[190px_160px_minmax(0,1fr)_minmax(280px,0.7fr)] xl:items-start">
              <div className="grid gap-1">
                <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Lifecycle
                </Label>
                <Select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as AiddSetupStatus);
                    markMetaDirty();
                  }}
                >
                  {statusOptions.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="rounded-md border bg-muted/30 p-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Template progress
                </span>
                <div className="text-lg font-bold leading-tight">
                  {progress.completed}/{progress.total}
                </div>
                <span className="text-xs text-muted-foreground">
                  sections complete
                </span>
              </div>

              <div className="grid min-w-0 gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Components touched
                  </Label>
                  <Badge variant="outline">
                    {selectedComponents.length} selected
                  </Badge>
                </div>
                <div className="flex max-h-20 flex-wrap gap-2 overflow-auto pr-1">
                  {setup?.components.map((component) => (
                    <Button
                      key={component.slug}
                      type="button"
                      variant={
                        selectedComponents.includes(component.slug)
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      onClick={() => toggleComponent(component.slug)}
                    >
                      {component.title}
                    </Button>
                  ))}
                  {setup && setup.components.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      No components yet.
                    </span>
                  )}
                </div>
                {!isEditing && (
                  <div className="grid gap-2 rounded-md border bg-muted/20 p-2 md:grid-cols-2">
                    <Input
                      value={inlineComponentTitle}
                      onChange={(event) =>
                        setInlineComponentTitle(event.target.value)
                      }
                      placeholder="Create component inline"
                    />
                    <Textarea
                      value={inlineComponentDescription}
                      onChange={(event) =>
                        setInlineComponentDescription(event.target.value)
                      }
                      placeholder="Component description"
                      className="min-h-9"
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                {status === "deprecated" && (
                  <Alert variant="warning">
                    <strong>Deprecated:</strong> Avoid new delivery packages
                    unless this is migration/removal work.
                  </Alert>
                )}
                {isEditing && !foundationReady && (
                  <Alert variant="warning">
                    <strong>Delivery package locked</strong>
                    <p className="mt-1">
                      Complete Foundation and Standards before creating a
                      delivery package.
                    </p>
                  </Alert>
                )}
                {isEditing && !lifecycleReady && (
                  <Alert variant="warning">
                    <strong>Lifecycle:</strong> Mark the capability active or
                    complete before creating a delivery package.
                  </Alert>
                )}
                {isEditing && lifecycleReady && sectionBlockers.length > 0 && (
                  <Alert variant="warning">
                    <strong>Sections:</strong> {sectionBlockers.length} template
                    section{sectionBlockers.length === 1 ? "" : "s"} still need
                    completion.
                  </Alert>
                )}
                {isEditing && deliveryReady && (
                  <Alert variant="success">
                    <strong>Ready:</strong> This capability can become a
                    delivery package.
                  </Alert>
                )}
                {hasUnsavedChanges && (
                  <Alert variant="default">
                    <strong>Unsaved changes:</strong> {dirtySectionCount}{" "}
                    section{dirtySectionCount === 1 ? "" : "s"} and{" "}
                    {dirtyMeta ? "details" : "no details"} changed.
                  </Alert>
                )}
              </div>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
