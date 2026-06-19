import {
  Archive,
  CheckCircle2,
  CircleDashed,
  Code2,
  Eye,
  FileText,
  Layers3,
  Pencil,
  PlayCircle,
  Puzzle,
  ServerCog,
  ShieldCheck,
  SkipForward,
  Sparkles,
  TestTube2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Select } from "./ui/select";
import { MarkdownEditor } from "./MarkdownEditor";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { cn } from "../lib/utils";
import { statusSurfaceClass, statusTextClass } from "../lib/statusTheme";

type SetupStep = "foundation" | "standards" | "starting-point";

interface SetupWorkflowProps {
  activeProject?: AiddTrackedProject | null;
  initialStep?: SetupStep;
  activeArea?: "foundation" | "standards";
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

const statusVisuals: Record<string, { icon: LucideIcon; className: string }> = {
  "not-started": { icon: CircleDashed, className: statusTextClass("not-started") },
  draft: { icon: Pencil, className: statusTextClass("draft") },
  "in-review": { icon: Eye, className: statusTextClass("in-review") },
  active: { icon: PlayCircle, className: statusTextClass("active") },
  deprecated: { icon: Archive, className: statusTextClass("deprecated") },
  complete: { icon: CheckCircle2, className: statusTextClass("complete") },
  skipped: { icon: SkipForward, className: statusTextClass("skipped") },
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



function FoundationDocumentTile({
  title,
  icon: Icon,
  selected,
  status,
  fileName,
  dragReady,
  dropActive,
  disabled,
  onClick,
  onDragStart,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  title: string;
  icon: LucideIcon;
  selected: boolean;
  status?: string;
  fileName: string;
  dragReady: boolean;
  dropActive: boolean;
  disabled?: boolean;
  onClick: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const displayStatus = status ?? "not-started";
  return (
    <button
      type="button"
      disabled={disabled}
      draggable={dragReady && !disabled}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      title={
        dragReady
          ? `${title}: drag out this Markdown file, or drop an updated ${fileName} here.`
          : `${title}: preparing Markdown drag file. You can drop an updated ${fileName} here.`
      }
      className={cn(
        "relative flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
        selected && "border-ring bg-accent ring-1 ring-ring",
        dropActive && "border-ring bg-accent ring-1 ring-ring",
        disabled && "cursor-not-allowed opacity-50",
        dragReady && !disabled && "cursor-grab active:cursor-grabbing",
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
      <span className="text-[10px] text-muted-foreground">
        {dropActive ? "Drop update" : dragReady ? "Drag/drop" : "Preparing"}
      </span>
    </button>
  );
}

function FoundationReviewTile({
  scopeLabel = "Foundation",
  ready,
  busy,
  dropActive,
  fileName,
  onClick,
  onDragStart,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  scopeLabel?: string;
  ready: boolean;
  busy: boolean;
  dropActive: boolean;
  fileName?: string | null;
  onClick: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      draggable={ready && !busy}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      disabled={busy}
      title={
        ready
          ? `${scopeLabel} review package ready: ${fileName ?? "review.zip"}. Drag out, or drop a returned review zip here.`
          : `Create a ${scopeLabel} review package zip. You can also drop a returned review zip here.`
      }
      className={cn(
        "relative flex h-16 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border/70 bg-card px-2 text-[11px] transition hover:bg-accent",
        ready && statusSurfaceClass("ready"),
        dropActive && "border-ring bg-accent ring-1 ring-ring",
        busy && "cursor-wait opacity-70",
      )}
    >
      <StatusIcon
        status={ready ? "complete" : "in-review"}
        className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
      />
      <Archive className="h-4 w-4 text-muted-foreground" />
      <span className="line-clamp-2 px-1 text-center font-medium leading-tight">
        Review package
      </span>
      <span className="text-[10px] text-muted-foreground">
        {dropActive ? "Drop zip" : busy ? "Working…" : ready ? "Drag out" : "Create zip"}
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
  if (fileName.includes("project-overview")) return "Overview";
  if (fileName.includes("product-definition")) return "Product";
  if (fileName.includes("audience")) return "Audience";
  if (fileName.includes("goals")) return "Goals";
  return fallback.replace(/ & /g, " ");
}

function docSortWeight(fileName: string) {
  if (fileName.includes("project-overview")) return 1;
  if (fileName.includes("product-definition")) return 2;
  if (fileName.includes("audience")) return 3;
  if (fileName.includes("goals")) return 4;
  return 99;
}


function standardIcon(fileName: string): LucideIcon {
  if (fileName.includes("coding")) return Code2;
  if (fileName.includes("security")) return ShieldCheck;
  if (fileName.includes("testing")) return TestTube2;
  if (fileName.includes("architecture")) return Layers3;
  if (fileName.includes("hosting")) return ServerCog;
  return FileText;
}

function standardShortTitle(fileName: string, fallback: string) {
  if (fileName === "index.md") return "Overview";
  if (fileName.includes("coding")) return "Coding";
  if (fileName.includes("security")) return "Security";
  if (fileName.includes("testing")) return "Testing";
  if (fileName.includes("architecture")) return "Architecture";
  if (fileName.includes("hosting")) return "Hosting";
  return fallback;
}

function standardSortWeight(fileName: string) {
  if (fileName === "index.md") return 1;
  const match = fileName.match(/^(\d+)/);
  return match ? Number(match[1]) + 1 : 99;
}

function findDroppedFilePath(files: FileList | File[], extension: string) {
  const expectedExtension = extension.toLowerCase();
  const droppedFile = Array.from(files || []).find((file) =>
    file.name.toLowerCase().endsWith(expectedExtension),
  );
  if (!droppedFile) return "";
  return getDroppedPath(droppedFile);
}

function findDroppedReviewResponsePath(files: FileList | File[]) {
  const droppedFiles = Array.from(files || []);
  const droppedFile =
    droppedFiles.find((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith(".zip") || name === "review.md";
    }) || droppedFiles[0];
  if (!droppedFile) return "";
  return getDroppedPath(droppedFile);
}

function getDroppedPath(droppedFile: File) {
  return (
    window.aidd.getDroppedFilePath(droppedFile) ||
    (droppedFile as File & { path?: string }).path ||
    ""
  );
}

export function SetupWorkflow({
  activeProject,
  initialStep = "foundation",
  activeArea = "foundation",
  onOpenCapabilities,
  onOpenComponents,
}: SetupWorkflowProps) {
  const [setup, setSetup] = useState<AiddProjectSetupState | null>(null);
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedFile, setSelectedFile] = useState<string>(
    "01-project-overview.md",
  );
  const [draftBody, setDraftBody] = useState("");
  const [draftStatus, setDraftStatus] =
    useState<AiddSetupStatus>("not-started");
  const [selectedStandardFile, setSelectedStandardFile] = useState("index.md");
  const [standardDraftBody, setStandardDraftBody] = useState("");
  const [standardDraftStatus, setStandardDraftStatus] =
    useState<AiddSetupStatus>("not-started");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [foundationDragFiles, setFoundationDragFiles] = useState<Record<string, string>>({});
  const [foundationDragError, setFoundationDragError] = useState<string | null>(null);
  const [foundationDocDropTarget, setFoundationDocDropTarget] = useState<string | null>(null);
  const [foundationReviewFilePath, setFoundationReviewFilePath] = useState<string | null>(null);
  const [foundationReviewFileName, setFoundationReviewFileName] = useState<string | null>(null);
  const [foundationReviewBusy, setFoundationReviewBusy] = useState(false);
  const [foundationReviewDropActive, setFoundationReviewDropActive] = useState(false);
  const [foundationReviewError, setFoundationReviewError] = useState<string | null>(null);
  const [standardDragFiles, setStandardDragFiles] = useState<Record<string, string>>({});
  const [standardDragError, setStandardDragError] = useState<string | null>(null);
  const [standardDocDropTarget, setStandardDocDropTarget] = useState<string | null>(null);
  const [standardsReviewFilePath, setStandardsReviewFilePath] = useState<string | null>(null);
  const [standardsReviewFileName, setStandardsReviewFileName] = useState<string | null>(null);
  const [standardsReviewBusy, setStandardsReviewBusy] = useState(false);
  const [standardsReviewDropActive, setStandardsReviewDropActive] = useState(false);
  const [standardsReviewError, setStandardsReviewError] = useState<string | null>(null);
  const selectedFileRef = useRef(selectedFile);
  const selectedStandardFileRef = useRef(selectedStandardFile);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  useEffect(() => {
    selectedStandardFileRef.current = selectedStandardFile;
  }, [selectedStandardFile]);

  const selectedDoc = useMemo(
    () => setup?.foundation.find((doc) => doc.fileName === selectedFile),
    [setup, selectedFile],
  );
  const selectedStandardSection = useMemo(
    () => setup?.standards.sections?.find((section) => section.fileName === selectedStandardFile),
    [setup, selectedStandardFile],
  );
  const modelStarted = Boolean(
    setup && (setup.capabilities.length > 0 || setup.components.length > 0),
  );

  const selectFoundationDocument = (doc: AiddFoundationDocument) => {
    setStep("foundation");
    setSelectedFile(doc.fileName);
    setDraftBody(doc.body);
    setDraftStatus(doc.status);
  };

  const selectStandardSection = (section: AiddStandardSection) => {
    setStep("standards");
    setSelectedStandardFile(section.fileName);
    setStandardDraftBody(section.body);
    setStandardDraftStatus(section.status);
  };

  const updateFoundationDraftBody = (fileName: string, markdown: string) => {
    if (selectedFileRef.current !== fileName) return;
    setDraftBody(markdown);
  };

  const updateStandardDraftBody = (fileName: string, markdown: string) => {
    if (selectedStandardFileRef.current !== fileName) return;
    setStandardDraftBody(markdown);
  };

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
    const standard =
      next.standards.sections?.find((item) => item.fileName === selectedStandardFile) ||
      next.standards.sections?.[0];
    if (standard) {
      setSelectedStandardFile(standard.fileName);
      setStandardDraftBody(standard.body);
      setStandardDraftStatus(standard.status);
    }
  };

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [activeProject?.path]);
  useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);
  useEffect(() => {
    if (!selectedDoc) return;
    setDraftBody(selectedDoc.body);
    setDraftStatus(selectedDoc.status);
  }, [selectedDoc?.fileName, selectedDoc?.body, selectedDoc?.status]);
  useEffect(() => {
    if (!selectedStandardSection) return;
    setStandardDraftBody(selectedStandardSection.body);
    setStandardDraftStatus(selectedStandardSection.status);
  }, [selectedStandardSection?.fileName, selectedStandardSection?.body, selectedStandardSection?.status]);
  useEffect(() => {
    if (modelStarted && step === "starting-point")
      setStep(
        stepComplete("standards", setup ?? undefined)
          ? "standards"
          : "foundation",
      );
  }, [modelStarted, setup, step]);

  useEffect(() => {
    if (!activeProject?.path || step !== "foundation" || !setup) {
      setFoundationDragFiles({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const docs = setup.foundation;
      Promise.all(
        docs.map(async (doc) => {
          const body = doc.fileName === selectedFile ? draftBody : doc.body;
          const status = doc.fileName === selectedFile ? draftStatus : doc.status;
          const filePath = await window.aidd.prepareFoundationDragFile({
            projectPath: activeProject.path,
            fileName: doc.fileName,
            title: doc.title,
            status,
            body,
          });
          return [doc.fileName, filePath] as const;
        }),
      )
        .then((entries) => {
          if (cancelled) return;
          setFoundationDragFiles(Object.fromEntries(entries));
          setFoundationDragError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setFoundationDragFiles({});
          setFoundationDragError(err instanceof Error ? err.message : String(err));
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeProject?.path,
    draftBody,
    draftStatus,
    selectedFile,
    setup,
    step,
  ]);


  useEffect(() => {
    if (!activeProject?.path || activeArea !== "standards" || !setup) {
      setStandardDragFiles({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const sections = setup.standards.sections ?? [];
      Promise.all(
        sections.map(async (section) => {
          const body = section.fileName === selectedStandardFile ? standardDraftBody : section.body;
          const status = section.fileName === selectedStandardFile ? standardDraftStatus : section.status;
          const filePath = await window.aidd.prepareStandardSectionDragFile({
            projectPath: activeProject.path,
            fileName: section.fileName,
            title: section.title,
            status,
            body,
          });
          return [section.fileName, filePath] as const;
        }),
      )
        .then((entries) => {
          if (cancelled) return;
          setStandardDragFiles(Object.fromEntries(entries));
          setStandardDragError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setStandardDragFiles({});
          setStandardDragError(err instanceof Error ? err.message : String(err));
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeArea,
    activeProject?.path,
    selectedStandardFile,
    setup,
    standardDraftBody,
    standardDraftStatus,
  ]);

  const startFoundationFileDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    fileName: string,
  ) => {
    event.preventDefault();
    const filePath = foundationDragFiles[fileName];
    if (!filePath) return;
    window.aidd.startNativeFileDrag(filePath);
  };

  const foundationDocumentDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const importFoundationDocumentUpdate = async (
    event: React.DragEvent<HTMLButtonElement>,
    doc: AiddFoundationDocument,
  ) => {
    event.preventDefault();
    setFoundationDocDropTarget(null);
    if (!activeProject?.path) return;

    const updateFilePath = findDroppedFilePath(event.dataTransfer.files, ".md");

    if (!updateFilePath) {
      const message = `Drop an updated Markdown file for ${docShortTitle(doc.fileName, doc.title)}.`;
      setFoundationReviewError(message);
      void window.aidd.notify({ title: "Foundation update rejected", body: message });
      return;
    }

    setSaving(true);
    setError(null);
    setFoundationReviewError(null);
    try {
      const nextSetup = await window.aidd.importFoundationDocumentUpdate({
        projectPath: activeProject.path,
        fileName: doc.fileName,
        updateFilePath,
      });
      setSetup(nextSetup);
      const updatedDoc = nextSetup.foundation.find((item) => item.fileName === doc.fileName);
      if (updatedDoc) {
        selectFoundationDocument(updatedDoc);
      } else {
        setStep("foundation");
        setSelectedFile(doc.fileName);
      }
      void window.aidd.notify({
        title: "Foundation updated",
        body: `${docShortTitle(doc.fileName, doc.title)} was updated from the dropped Markdown file.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFoundationReviewError(message);
      void window.aidd.notify({ title: "Foundation update failed", body: message });
    } finally {
      setSaving(false);
    }
  };


  const createFoundationReviewPackage = async () => {
    if (!activeProject?.path) return;
    setFoundationReviewBusy(true);
    setFoundationReviewError(null);
    try {
      const result = await window.aidd.packageFoundationForReview(activeProject.path);
      setFoundationReviewFilePath(result.filePath);
      setFoundationReviewFileName(result.fileName);
      void window.aidd.notify({
        title: "Foundation review package ready",
        body: "Drag the Review package tile to share it for review.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFoundationReviewError(message);
      void window.aidd.notify({ title: "Foundation review package failed", body: message });
    } finally {
      setFoundationReviewBusy(false);
    }
  };

  const startFoundationReviewPackageDrag = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!foundationReviewFilePath) return;
    window.aidd.startNativeFileDrag(foundationReviewFilePath);
  };

  const foundationReviewDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const importFoundationReviewResponse = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setFoundationReviewDropActive(false);
    if (!activeProject?.path) return;

    const responsePath = findDroppedReviewResponsePath(event.dataTransfer.files);
    if (!responsePath) {
      const message = "Drop a returned Foundation review .zip, unpacked review folder, or REVIEW.md file.";
      setFoundationReviewError(message);
      void window.aidd.notify({ title: "Foundation review import rejected", body: message });
      return;
    }

    setFoundationReviewBusy(true);
    setFoundationReviewError(null);
    try {
      const result = await window.aidd.importFoundationReviewPackage({
        projectPath: activeProject.path,
        zipPath: responsePath,
      });
      await load();
      void window.aidd.notify({
        title: "Foundation review imported",
        body: `${result.importedFiles.length} Foundation file${result.importedFiles.length === 1 ? "" : "s"} updated.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFoundationReviewError(message);
      void window.aidd.notify({ title: "Foundation review import failed", body: message });
    } finally {
      setFoundationReviewBusy(false);
    }
  };


  const startStandardFileDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    fileName: string,
  ) => {
    event.preventDefault();
    const filePath = standardDragFiles[fileName];
    if (!filePath) return;
    window.aidd.startNativeFileDrag(filePath);
  };

  const standardDocumentDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const importStandardDocumentUpdate = async (
    event: React.DragEvent<HTMLButtonElement>,
    section: AiddStandardSection,
  ) => {
    event.preventDefault();
    setStandardDocDropTarget(null);
    if (!activeProject?.path) return;

    const updateFilePath = findDroppedFilePath(event.dataTransfer.files, ".md");

    if (!updateFilePath) {
      const message = `Drop an updated Markdown file for ${standardShortTitle(section.fileName, section.title)}.`;
      setStandardsReviewError(message);
      void window.aidd.notify({ title: "Standards update rejected", body: message });
      return;
    }

    setSaving(true);
    setError(null);
    setStandardsReviewError(null);
    try {
      const nextSetup = await window.aidd.importStandardSectionUpdate({
        projectPath: activeProject.path,
        fileName: section.fileName,
        updateFilePath,
      });
      setSetup(nextSetup);
      const updatedSection = nextSetup.standards.sections?.find((item) => item.fileName === section.fileName);
      if (updatedSection) {
        selectStandardSection(updatedSection);
      } else {
        setStep("standards");
        setSelectedStandardFile(section.fileName);
      }
      void window.aidd.notify({
        title: "Standards updated",
        body: `${standardShortTitle(section.fileName, section.title)} was updated from the dropped Markdown file.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStandardsReviewError(message);
      void window.aidd.notify({ title: "Standards update failed", body: message });
    } finally {
      setSaving(false);
    }
  };

  const createStandardsReviewPackage = async () => {
    if (!activeProject?.path) return;
    setStandardsReviewBusy(true);
    setStandardsReviewError(null);
    try {
      const result = await window.aidd.packageStandardsForReview(activeProject.path);
      setStandardsReviewFilePath(result.filePath);
      setStandardsReviewFileName(result.fileName);
      void window.aidd.notify({
        title: "Standards review package ready",
        body: "Drag the Review package tile to share it for review.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStandardsReviewError(message);
      void window.aidd.notify({ title: "Standards review package failed", body: message });
    } finally {
      setStandardsReviewBusy(false);
    }
  };

  const startStandardsReviewPackageDrag = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!standardsReviewFilePath) return;
    window.aidd.startNativeFileDrag(standardsReviewFilePath);
  };

  const standardsReviewDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const importStandardsReviewZip = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setStandardsReviewDropActive(false);
    if (!activeProject?.path) return;

    const zipPath = findDroppedFilePath(event.dataTransfer.files, ".zip");
    if (!zipPath) {
      const message = "Drop a returned Standards review .zip file from your file system.";
      setStandardsReviewError(message);
      void window.aidd.notify({ title: "Standards review import rejected", body: message });
      return;
    }

    setStandardsReviewBusy(true);
    setStandardsReviewError(null);
    try {
      const result = await window.aidd.importStandardsReviewPackage({
        projectPath: activeProject.path,
        zipPath,
      });
      const nextSetup = await window.aidd.readProjectSetup(activeProject.path);
      setSetup(nextSetup);
      const current = nextSetup.standards.sections?.find((section) => section.fileName === selectedStandardFile) ?? nextSetup.standards.sections?.[0];
      if (current) {
        selectStandardSection(current);
      }
      void window.aidd.notify({
        title: "Standards review imported",
        body: `${result.importedFiles.length} Standards file${result.importedFiles.length === 1 ? "" : "s"} updated.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStandardsReviewError(message);
      void window.aidd.notify({ title: "Standards review import failed", body: message });
    } finally {
      setStandardsReviewBusy(false);
    }
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
      if (savedDoc) {
        setDraftBody(savedDoc.body);
        setDraftStatus(savedDoc.status);
      }
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

  const saveStandardSection = async (statusOverride?: AiddSetupStatus) => {
    if (!activeProject?.path || !selectedStandardSection) return;
    const nextStatus = statusOverride ?? standardDraftStatus;
    setSaving(true);
    setError(null);
    try {
      const nextSetup = await window.aidd.saveStandardSection({
        projectPath: activeProject.path,
        fileName: selectedStandardSection.fileName,
        body: standardDraftBody,
        status: nextStatus,
      });
      setSetup(nextSetup);
      setStandardDraftStatus(nextStatus);
      const savedSection = nextSetup.standards.sections?.find(
        (section) => section.fileName === selectedStandardSection.fileName,
      );
      if (savedSection) {
        setStandardDraftBody(savedSection.body);
        setStandardDraftStatus(savedSection.status);
      }
      void window.aidd.notify({
        title: "Saved",
        body:
          statusOverride === "complete"
            ? `${selectedStandardSection.title} saved and marked complete.`
            : statusOverride === "skipped"
              ? `${selectedStandardSection.title} skipped.`
              : `${selectedStandardSection.title} saved.`,
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

  const startingPointSteps: Array<{ id: SetupStep; title: string; icon: LucideIcon }> = modelStarted
    ? []
    : [{ id: "starting-point", title: "Start", icon: Sparkles }];
  const orderedFoundationDocs =
    setup?.foundation
      .slice()
      .sort(
        (a, b) =>
          docSortWeight(a.fileName) - docSortWeight(b.fileName) ||
          a.title.localeCompare(b.title),
      ) ?? [];
  const orderedStandardSections =
    setup?.standards.sections
      ?.slice()
      .sort(
        (a, b) =>
          standardSortWeight(a.fileName) - standardSortWeight(b.fileName) ||
          a.title.localeCompare(b.title),
      ) ?? [];
  const pageTitle = activeArea === "standards" ? "Standards" : "Foundation";
  const pageDescription =
    activeArea === "standards"
      ? "Define technical standards used by delivery packages, components, capabilities, and reviews."
      : "Define project overview, product context, audience, and goals used by delivery packages.";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
          <p className="text-xs text-muted-foreground">{pageDescription}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </header>

      {activeArea === "foundation" && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/30 px-4 py-2">
          {orderedFoundationDocs.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-2"
              aria-label="Foundation context sections"
            >
            {orderedFoundationDocs.map((doc) => (
              <FoundationDocumentTile
                key={doc.fileName}
                title={docShortTitle(doc.fileName, doc.title)}
                icon={docIcon(doc.fileName)}
                fileName={doc.fileName}
                selected={step === "foundation" && selectedFile === doc.fileName}
                status={doc.status}
                dragReady={Boolean(foundationDragFiles[doc.fileName])}
                dropActive={foundationDocDropTarget === doc.fileName}
                onClick={() => selectFoundationDocument(doc)}
                onDragStart={(event) => startFoundationFileDrag(event, doc.fileName)}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setFoundationDocDropTarget(doc.fileName);
                }}
                onDragLeave={() => setFoundationDocDropTarget(null)}
                onDragOver={foundationDocumentDragOver}
                onDrop={(event) => importFoundationDocumentUpdate(event, doc)}
              />
            ))}
            <FoundationReviewTile
              ready={Boolean(foundationReviewFilePath)}
              busy={foundationReviewBusy}
              dropActive={foundationReviewDropActive}
              fileName={foundationReviewFileName}
              onClick={createFoundationReviewPackage}
              onDragStart={startFoundationReviewPackageDrag}
              onDragEnter={(event) => {
                event.preventDefault();
                setFoundationReviewDropActive(true);
              }}
              onDragLeave={() => setFoundationReviewDropActive(false)}
              onDragOver={foundationReviewDragOver}
              onDrop={importFoundationReviewResponse}
            />
          </div>
        )}

          {startingPointSteps.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-l pl-3">
              {startingPointSteps.map((item) => (
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
          )}
        </div>
      )}

      {activeArea === "standards" && orderedStandardSections.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-muted/30 px-4 py-2">
          {orderedStandardSections.map((section) => (
            <FoundationDocumentTile
              key={section.fileName}
              title={standardShortTitle(section.fileName, section.title)}
              icon={standardIcon(section.fileName)}
              fileName={section.fileName}
              selected={step === "standards" && selectedStandardFile === section.fileName}
              status={section.status}
              dragReady={Boolean(standardDragFiles[section.fileName])}
              dropActive={standardDocDropTarget === section.fileName}
              onClick={() => selectStandardSection(section)}
              onDragStart={(event) => startStandardFileDrag(event, section.fileName)}
              onDragEnter={(event) => {
                event.preventDefault();
                setStandardDocDropTarget(section.fileName);
              }}
              onDragLeave={() => setStandardDocDropTarget(null)}
              onDragOver={standardDocumentDragOver}
              onDrop={(event) => importStandardDocumentUpdate(event, section)}
            />
          ))}
          <FoundationReviewTile
            scopeLabel="Standards"
            ready={Boolean(standardsReviewFilePath)}
            busy={standardsReviewBusy}
            dropActive={standardsReviewDropActive}
            fileName={standardsReviewFileName}
            onClick={createStandardsReviewPackage}
            onDragStart={startStandardsReviewPackageDrag}
            onDragEnter={(event) => {
              event.preventDefault();
              setStandardsReviewDropActive(true);
            }}
            onDragLeave={() => setStandardsReviewDropActive(false)}
            onDragOver={standardsReviewDragOver}
            onDrop={importStandardsReviewZip}
          />
        </div>
      )}

      {(error || foundationReviewError || foundationDragError || standardsReviewError || standardDragError) && (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <AlertTitle>{activeArea === "standards" ? "Standards error" : "Foundation error"}</AlertTitle>
            <AlertDescription>
              {error ||
                (activeArea === "standards"
                  ? standardsReviewError || standardDragError
                  : foundationReviewError || foundationDragError)}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {step === "foundation" && setup && (
          <div className="h-full min-h-0">
            <Card className="flex h-full min-h-0 flex-col rounded-md">
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
                <MarkdownEditor
                  key={`foundation-editor-${selectedFile}`}
                  editorKey={`foundation-${selectedFile}`}
                  className="h-full min-h-[520px]"
                  value={draftBody}
                  initialValue={selectedDoc?.body ?? draftBody}
                  onChange={(markdown) => updateFoundationDraftBody(selectedDoc?.fileName ?? selectedFile, markdown)}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {step === "standards" && setup && selectedStandardSection && (
          <div className="h-full min-h-0">
            <Card className="flex h-full min-h-0 flex-col rounded-md">
              <CardHeader className="shrink-0 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {selectedStandardSection.title}
                    </CardTitle>
                    <CardDescription>
                      Edit this standards section independently. Saved to foundation/standards/{selectedStandardSection.fileName}.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={standardDraftStatus}
                      onChange={(event) =>
                        setStandardDraftStatus(event.target.value as AiddSetupStatus)
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
                      onClick={() => saveStandardSection()}
                      disabled={saving}
                    >
                      Save
                    </Button>
                    {!selectedStandardSection.required && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveStandardSection("skipped")}
                        disabled={saving}
                      >
                        Skip
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => saveStandardSection("complete")}
                      disabled={saving}
                    >
                      Save complete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 px-4 pb-4">
                <MarkdownEditor
                  key={`standards-editor-${selectedStandardFile}`}
                  editorKey={`standards-${selectedStandardFile}`}
                  className="h-full min-h-[520px]"
                  value={standardDraftBody}
                  initialValue={selectedStandardSection.body}
                  onChange={(markdown) => updateStandardDraftBody(selectedStandardSection.fileName, markdown)}
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
