import {
  Archive,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileText,
  FolderOpen,
  Pencil,
  PlayCircle,
  Puzzle,
  ShieldCheck,
  SkipForward,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { cn } from "../lib/utils";

type SetupStep = "foundation" | "standards" | "starting-point";

interface SetupWorkflowProps {
  activeProject?: AiddTrackedProject | null;
  onOpenCapabilities: () => void;
  onOpenComponents: () => void;
}

const statusOptions: AiddSetupStatus[] = [
  "not-started",
  "draft",
  "in-review",
  "active",
  "deprecated",
  "complete",
  "skipped",
];
const softwareTypeOptions = [
  "JavaScript / TypeScript",
  "Java",
  "C# / .NET",
  "Python",
  "C++",
  "Unreal Engine",
  "Web app",
  "Desktop app",
  "Mobile app",
  "Service / API",
];
const designStandardOptions = [
  "SOLID",
  "Clean Architecture",
  "Hexagonal Architecture",
  "Domain-Driven Design",
  "Event-driven design",
  "CQRS",
  "Repository pattern",
];
const qualityOptions = [
  "Unit tests",
  "Integration tests",
  "End-to-end tests",
  "UI testing",
  "Accessibility checks",
  "Static analysis",
  "Linting",
  "Formatting",
  "Test scripts required in delivery packages",
];

function statusLabel(status: string) {
  return status
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function stepComplete(step: SetupStep, setup?: AiddProjectSetupState) {
  if (!setup) return false;
  if (step === "foundation")
    return setup.foundation.every(
      (doc) =>
        doc.status === "complete" ||
        (!doc.required && doc.status === "skipped"),
    );
  if (step === "standards") return setup.standards.status === "complete";
  return setup.capabilities.length > 0 || setup.components.length > 0;
}

function toggleValue(
  value: string,
  values: string[],
  setter: (next: string[]) => void,
) {
  setter(
    values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value],
  );
}

function buildStandardsBody(
  softwareTypes: string[],
  designStandards: string[],
  qualityStandards: string[],
  projectSpecificNotes: string,
) {
  const notes = projectSpecificNotes.trim();
  const sections = [
    "# Project Standards",
    "",
    "These standards define the technical expectations used when creating components, capabilities, delivery packages, and AI reviews.",
    "",
    "## Software Types",
    "",
    softwareTypes.length
      ? softwareTypes.map((item) => `- ${item}`).join("\n")
      : "TODO: Select software types.",
    "",
    "## Software Design Standards",
    "",
    designStandards.length
      ? designStandards.map((item) => `- ${item}`).join("\n")
      : "TODO: Select design standards.",
    "",
    "## Coding, Testing, and Quality Rules",
    "",
    qualityStandards.length
      ? qualityStandards.map((item) => `- ${item}`).join("\n")
      : "TODO: Select coding and testing expectations.",
    "",
  ];

  if (notes) sections.push("## Project-Specific Notes", "", notes, "");
  return sections.join("\n");
}

function readMarkdownSection(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(
    new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"),
  );
  return match ? match[1].trim() : "";
}

function readMarkdownListSection(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(
    new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"),
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

const statusVisuals: Record<string, { icon: LucideIcon; className: string }> = {
  "not-started": { icon: CircleDashed, className: "text-muted-foreground" },
  draft: { icon: Pencil, className: "text-sky-400" },
  "in-review": { icon: Eye, className: "text-amber-400" },
  active: { icon: PlayCircle, className: "text-emerald-400" },
  deprecated: { icon: Archive, className: "text-orange-400" },
  complete: { icon: CheckCircle2, className: "text-green-400" },
  skipped: { icon: SkipForward, className: "text-zinc-400" },
};

function getStatusVisual(status?: string) {
  return statusVisuals[status ?? "not-started"] ?? statusVisuals["not-started"];
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

function RibbonTile({
  title,
  icon: Icon,
  selected,
  status,
  onClick,
  disabled,
}: {
  title: string;
  icon: LucideIcon;
  selected: boolean;
  status?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const displayStatus = status ?? "not-started";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={`${title}: ${statusLabel(displayStatus)}`}
      className={cn(
        "relative flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
        selected && "border-ring bg-accent ring-1 ring-ring",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <StatusIcon
        status={displayStatus}
        className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
      />
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="line-clamp-2 px-1 text-center font-medium leading-tight">
        {title}
      </span>
    </button>
  );
}

function docIcon(fileName: string): LucideIcon {
  if (fileName.includes("audience")) return Puzzle;
  if (fileName.includes("goals")) return Sparkles;
  return FileText;
}

function docShortTitle(fileName: string, fallback: string) {
  if (fileName.includes("product-definition")) return "Product";
  if (fileName.includes("audience")) return "Audience";
  if (fileName.includes("goals")) return "Goals";
  return fallback.replace(/ & /g, " ");
}

function docSortWeight(fileName: string) {
  if (fileName.includes("product-definition")) return 1;
  if (fileName.includes("audience")) return 2;
  if (fileName.includes("goals")) return 3;
  return 99;
}

export function SetupWorkflow({
  activeProject,
  onOpenCapabilities,
  onOpenComponents,
}: SetupWorkflowProps) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [step, setStep] = useState<SetupStep>("foundation");
  const [selectedFile, setSelectedFile] = useState<string>(
    "02-product-definition.md",
  );
  const [draftBody, setDraftBody] = useState("");
  const [draftStatus, setDraftStatus] =
    useState<AiddSetupStatus>("not-started");
  const [standardsStatus, setStandardsStatus] =
    useState<AiddSetupStatus>("not-started");
  const [softwareTypes, setSoftwareTypes] = useState<string[]>([]);
  const [designStandards, setDesignStandards] = useState<string[]>([]);
  const [qualityStandards, setQualityStandards] = useState<string[]>([]);
  const [projectSpecificNotes, setProjectSpecificNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragFilePath, setDragFilePath] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const selectedDoc = useMemo(
    () => setup?.foundation.find((doc) => doc.fileName === selectedFile),
    [setup, selectedFile],
  );
  const generatedStandardsBody = useMemo(
    () =>
      buildStandardsBody(
        softwareTypes,
        designStandards,
        qualityStandards,
        projectSpecificNotes,
      ),
    [softwareTypes, designStandards, qualityStandards, projectSpecificNotes],
  );
  const modelStarted = Boolean(
    setup && (setup.capabilities.length > 0 || setup.components.length > 0),
  );

  const load = async () => {
    if (!activeProject?.path) return;
    const next = await window.aidd.readProjectSetup(activeProject.path);
    setSetup(next);
    const doc =
      next.foundation.find((item) => item.fileName === selectedFile) ||
      next.foundation[0];
    if (doc) {
      setSelectedFile(doc.fileName);
      setDraftBody(doc.body);
      setDraftStatus(doc.status);
    }
    setStandardsStatus(next.standards.status);
    setSoftwareTypes(
      readMarkdownListSection(next.standards.body, "Software Types"),
    );
    setDesignStandards(
      readMarkdownListSection(next.standards.body, "Software Design Standards"),
    );
    setQualityStandards(
      [
        ...readMarkdownListSection(
          next.standards.body,
          "Coding, Testing, and Quality Rules",
        ),
        ...readMarkdownListSection(
          next.standards.body,
          "Coding Style, Testing, and Verification",
        ),
      ].filter((value, index, values) => values.indexOf(value) === index),
    );
    setProjectSpecificNotes(
      readMarkdownSection(next.standards.body, "Project-Specific Notes"),
    );
  };

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [activeProject?.path]);
  useEffect(() => {
    if (!selectedDoc) return;
    setDraftBody(selectedDoc.body);
    setDraftStatus(selectedDoc.status);
  }, [selectedDoc?.fileName]);
  useEffect(() => {
    if (modelStarted && step === "starting-point")
      setStep(
        stepComplete("standards", setup ?? undefined)
          ? "standards"
          : "foundation",
      );
  }, [modelStarted, setup, step]);

  useEffect(() => {
    if (!activeProject?.path || step !== "foundation" || !selectedDoc) {
      setDragFilePath(null);
      return;
    }

    const timer = window.setTimeout(() => {
      window.aidd
        .prepareFoundationDragFile({
          projectPath: activeProject.path,
          fileName: selectedDoc.fileName,
          title: selectedDoc.title,
          status: draftStatus,
          body: draftBody,
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
  }, [
    activeProject?.path,
    selectedDoc?.fileName,
    selectedDoc?.title,
    draftBody,
    draftStatus,
    step,
  ]);

  const startFoundationFileDrag = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragFilePath) return;
    window.aidd.startNativeFileDrag(dragFilePath);
  };

  const openDragFileLocation = () => {
    if (!dragFilePath) return;
    window.aidd
      .showItemInFolder(dragFilePath)
      .catch((err) =>
        setDragError(err instanceof Error ? err.message : String(err)),
      );
  };

  const saveFoundation = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path || !selectedDoc) return;
    const nextStatus = statusOverride ?? draftStatus;
    setSaving(true);
    setError(null);
    try {
      const nextSetup = await window.aidd.saveFoundationDocument({
        projectPath: activeProject.path,
        fileName: selectedDoc.fileName,
        status: nextStatus,
        body: draftBody,
      });
      setSetup(nextSetup);
      setDraftStatus(nextStatus);
      const savedDoc = nextSetup.foundation.find(
        (doc) => doc.fileName === selectedDoc.fileName,
      );
      if (savedDoc) setDraftBody(savedDoc.body);
      void window.aidd.notify({
        title: "Saved",
        body:
          statusOverride === "complete"
            ? "Foundation section saved and marked complete."
            : "Foundation section saved.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveStandards = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path) return;
    const nextStatus = statusOverride ?? standardsStatus;
    setSaving(true);
    setError(null);
    try {
      setSetup(
        await window.aidd.defineStandards({
          projectPath: activeProject.path,
          body: generatedStandardsBody,
          status: nextStatus,
        }),
      );
      setStandardsStatus(nextStatus);
      void window.aidd.notify({
        title: "Saved",
        body:
          statusOverride === "complete"
            ? "Standards saved and marked complete."
            : "Standards saved.",
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
            <CardDescription>
              Create or open an AIDD project first.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const steps: Array<{ id: SetupStep; title: string; icon: LucideIcon }> = [
    { id: "foundation", title: "Foundation", icon: FileText },
    { id: "standards", title: "Standards", icon: ShieldCheck },
    ...(modelStarted
      ? []
      : [
          { id: "starting-point" as SetupStep, title: "Start", icon: Sparkles },
        ]),
  ];
  const orderedFoundationDocs =
    setup?.foundation
      .slice()
      .sort(
        (a, b) =>
          docSortWeight(a.fileName) - docSortWeight(b.fileName) ||
          a.title.localeCompare(b.title),
      ) ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h1 className="text-lg font-semibold">Foundation</h1>
          <p className="text-xs text-muted-foreground">
            Define product context, audience, goals and standards used by
            delivery packages.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-4 overflow-x-auto border-b bg-muted/30 px-4 py-2">
        <div className="flex shrink-0 items-center gap-2">
          {steps.map((item) => (
            <RibbonTile
              key={item.id}
              title={item.title}
              icon={item.icon}
              selected={step === item.id}
              status={
                stepComplete(item.id, setup ?? undefined)
                  ? "complete"
                  : "not-started"
              }
              onClick={() => setStep(item.id)}
            />
          ))}
        </div>

        {step === "foundation" && orderedFoundationDocs.length > 0 && (
          <div
            className="ml-auto flex shrink-0 items-center gap-2 border-l pl-4"
            aria-label="Foundation context sections"
          >
            {orderedFoundationDocs.map((doc) => (
              <RibbonTile
                key={doc.fileName}
                title={docShortTitle(doc.fileName, doc.title)}
                icon={docIcon(doc.fileName)}
                selected={selectedFile === doc.fileName}
                status={doc.status}
                onClick={() => {
                  setStep("foundation");
                  setSelectedFile(doc.fileName);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <AlertTitle>Foundation error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {step === "foundation" && setup && (
          <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_108px]">
            <Card className="flex min-h-0 flex-col rounded-md">
              <CardHeader className="shrink-0 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {selectedDoc?.title ?? "Foundation"}
                    </CardTitle>
                    <CardDescription>
                      Save each foundation section and mark it complete when
                      ready.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={draftStatus}
                      onChange={(event) =>
                        setDraftStatus(event.target.value as AiddSetupStatus)
                      }
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveFoundation()}
                      disabled={saving}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveFoundation("complete")}
                      disabled={saving}
                    >
                      Save complete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 px-4 pb-4">
                <Textarea
                  className="h-full min-h-[520px] resize-none font-mono text-sm"
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                />
              </CardContent>
            </Card>

            <aside
              className="flex min-h-0 flex-col gap-2"
              aria-label="Current foundation file drag column"
            >
              <Card className="rounded-md">
                <CardHeader className="px-2 py-2">
                  <CardTitle className="text-center text-xs">File</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <div
                    draggable={Boolean(dragFilePath)}
                    onDragStart={startFoundationFileDrag}
                    title={
                      dragFilePath
                        ? "Drag this Markdown file into Explorer, ChatGPT, Claude, or another file upload target."
                        : "Preparing current Markdown file..."
                    }
                    className={cn(
                      "flex h-28 select-none flex-col items-center justify-center gap-2 rounded-md border bg-card p-2 text-center text-xs text-card-foreground shadow-sm",
                      dragFilePath
                        ? "cursor-grab hover:bg-accent active:cursor-grabbing"
                        : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <FileText className="h-8 w-8" />
                    <span className="line-clamp-2 break-all leading-tight">
                      {selectedDoc?.fileName ?? "foundation.md"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Drag out
                    </span>
                  </div>
                  <Button
                    className="mt-2 w-full px-1 text-[11px]"
                    variant="outline"
                    size="sm"
                    onClick={openDragFileLocation}
                    disabled={!dragFilePath}
                    title="Open the generated file location"
                  >
                    <FolderOpen className="mr-1 h-3 w-3" />
                    Folder
                  </Button>
                  {dragError && (
                    <p className="mt-2 text-[10px] text-destructive">
                      {dragError}
                    </p>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        )}

        {step === "standards" && setup && (
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="flex min-h-0 flex-col overflow-hidden rounded-md">
              <CardHeader className="shrink-0 px-4 py-3">
                <CardTitle className="text-base">Define Standards</CardTitle>
                <CardDescription>
                  Choose the technical standards that influence delivery
                  planning and review.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 pb-4">
                <div className="grid shrink-0 gap-2">
                  <Label>Status</Label>
                  <Select
                    value={standardsStatus}
                    onChange={(event) =>
                      setStandardsStatus(event.target.value as AiddSetupStatus)
                    }
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="shrink-0 space-y-5 overflow-auto pr-1">
                  <OptionPanel
                    title="Software types"
                    options={softwareTypeOptions}
                    values={softwareTypes}
                    setValues={setSoftwareTypes}
                  />
                  <OptionPanel
                    title="Software design standards"
                    options={designStandardOptions}
                    values={designStandards}
                    setValues={setDesignStandards}
                  />
                  <OptionPanel
                    title="Coding, test, and quality rules"
                    options={qualityOptions}
                    values={qualityStandards}
                    setValues={setQualityStandards}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <div className="flex h-full min-h-[360px] flex-col gap-2">
                    <Label>Project-specific additions</Label>
                    <Textarea
                      className="h-full min-h-[320px] resize-none font-mono text-sm"
                      value={projectSpecificNotes}
                      onChange={(event) => setProjectSpecificNotes(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveStandards()}
                    disabled={saving}
                  >
                    Save Standards
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveStandards("complete")}
                    disabled={saving}
                  >
                    Save complete
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card className="flex min-h-0 flex-col rounded-md">
              <CardHeader className="px-4 py-3">
                <CardTitle className="text-base">Generated Markdown</CardTitle>
                <CardDescription>
                  This is written to foundation/standards/index.md.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 px-4 pb-4">
                <Textarea
                  className="h-full min-h-[420px] font-mono text-xs"
                  value={generatedStandardsBody}
                  readOnly
                />
              </CardContent>
            </Card>
          </div>
        )}

        {step === "starting-point" && setup && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card
              className="cursor-pointer rounded-md hover:bg-accent"
              onClick={onOpenCapabilities}
            >
              <CardHeader>
                <Sparkles className="h-5 w-5" />
                <CardTitle>I know what I want it to do</CardTitle>
                <CardDescription>
                  Start with capabilities, outcomes and user-value focused
                  behaviour.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card
              className="cursor-pointer rounded-md hover:bg-accent"
              onClick={onOpenComponents}
            >
              <CardHeader>
                <Puzzle className="h-5 w-5" />
                <CardTitle>I know the architecture shape</CardTitle>
                <CardDescription>
                  Start with components, apps, services, libraries or
                  integrations.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function OptionPanel({
  title,
  options,
  values,
  setValues,
}: {
  title: string;
  options: string[];
  values: string[];
  setValues: (next: string[]) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((item) => (
          <Button
            key={item}
            type="button"
            variant={values.includes(item) ? "secondary" : "outline"}
            size="sm"
            onClick={() => toggleValue(item, values, setValues)}
          >
            {item}
          </Button>
        ))}
      </div>
    </section>
  );
}
