import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, CheckCircle2, CircleHelp, Lightbulb, X } from 'lucide-react';
import type { Screen } from '../main';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface PageHelpContent {
  title: string;
  summary: string;
  purpose: string;
  useThisPageFor: string[];
  goodOutcome: string[];
  tip?: string;
}

const pageHelpContent: Record<Screen, PageHelpContent> = {
  projects: {
    title: 'Projects',
    summary: 'Choose which AIDD workspace you are working in.',
    purpose: 'This page is the launcher for your tracked AIDD projects. It lets you create a new Git-backed workspace, open an existing workspace from disk, switch the current project, or remove a project from the tracked list without deleting files.',
    useThisPageFor: [
      'Opening the project you want AIDD to edit or package.',
      'Creating a fresh workspace from the AIDD template.',
      'Adding an existing project folder that already contains AIDD files.',
      'Forgetting old entries that should no longer appear in the app.'
    ],
    goodOutcome: [
      'One active project is selected.',
      'The selected project path points at the workspace you expect.',
      'Old or duplicate tracked projects are removed from the list.'
    ],
    tip: 'Forgetting a project only removes it from AIDD tracking. It does not delete the folder from disk.'
  },
  'project-create': {
    title: 'New project',
    summary: 'Create a new local AIDD workspace.',
    purpose: 'This page creates a project folder, adds the AIDD starter structure, and initializes local Git history so future changes can be reviewed, shared, and recovered safely.',
    useThisPageFor: [
      'Starting a new product, tool, service, game, or internal workflow from the AIDD structure.',
      'Setting the project name and description that other pages will use as context.',
      'Choosing where the workspace should live on disk.',
      'Setting the author identity used for local Git commits.'
    ],
    goodOutcome: [
      'A project folder exists in the selected parent location.',
      'The project has an initial AIDD document structure.',
      'Local Git has enough identity information to create commits.'
    ],
    tip: 'Use a short, stable project name. It becomes easier to recognise package files, review bundles, and Git history later.'
  },
  home: {
    title: 'Home',
    summary: 'Get oriented and jump to the next useful step.',
    purpose: 'Home is the project dashboard. It gives you a quick route into the main workflow areas: define the project, shape capabilities, map components, and manage delivery packages.',
    useThisPageFor: [
      'Checking which project is currently open.',
      'Jumping into Foundation, Capabilities, Components, or Delivery.',
      'Seeing high-level delivery package activity.',
      'Deciding what part of the AIDD workflow needs attention next.'
    ],
    goodOutcome: [
      'You know the next area to work on.',
      'The active project is correct before making edits.',
      'Delivery work is connected back to the right project context.'
    ],
    tip: 'When in doubt, start with Foundation. The later pages are only useful when the project intent is clear.'
  },
  foundation: {
    title: 'Foundation',
    summary: 'Define what the product is, who it serves, and what success means.',
    purpose: 'Foundation is the project source of truth for intent. It captures the product definition, audience, goals, constraints, and success measures that AI agents and people should respect when making decisions.',
    useThisPageFor: [
      'Explaining the product in plain language.',
      'Capturing the audience and user needs.',
      'Writing goals and success metrics that can guide delivery decisions.',
      'Updating the project definition when accepted work changes what the product is meant to do.'
    ],
    goodOutcome: [
      'A new reader can understand the project without asking you to explain it again.',
      'AI agents have enough context to avoid inventing the wrong product direction.',
      'Goals are specific enough to judge whether future work is useful.'
    ],
    tip: 'Treat this page as the thing you would hand to a new person before asking them to help.'
  },
  standards: {
    title: 'Standards',
    summary: 'Define the rules that delivery work must follow.',
    purpose: 'Standards collects the reusable rules, preferences, and constraints that should apply across the project. This is where you make expectations explicit before AI or developers start changing files.',
    useThisPageFor: [
      'Recording code style, architecture, hosting, security, testing, and review expectations.',
      'Capturing project-specific rules that should be reused across delivery packages.',
      'Making sections skippable when a rule does not apply yet.',
      'Reducing repeated prompting by keeping shared instructions in one place.'
    ],
    goodOutcome: [
      'Delivery packages can reference consistent rules instead of repeating them.',
      'AI agents know what not to change as well as what to build.',
      'Reviewers can challenge work against written standards.'
    ],
    tip: 'A useful standard should be clear enough that someone can tell whether a change followed it or broke it.'
  },
  capabilities: {
    title: 'Capabilities',
    summary: 'Describe what the system must be able to do.',
    purpose: 'Capabilities turn product intent into meaningful areas of behaviour. They describe user-facing or business-facing abilities without mixing in low-level technical design.',
    useThisPageFor: [
      'Creating and editing capability documents.',
      'Defining behaviour, boundaries, assumptions, and acceptance expectations.',
      'Keeping capabilities focused on what the product must support.',
      'Creating delivery packages from well-understood slices of capability work.'
    ],
    goodOutcome: [
      'Each capability has a clear purpose and scope.',
      'Technical design is kept separate from the capability definition.',
      'Delivery packages can be created from stable capability context.'
    ],
    tip: 'A capability is not a component. Write what the system needs to do before deciding where the code should live.'
  },
  components: {
    title: 'Components',
    summary: 'Map the technical parts of the system.',
    purpose: 'Components describe the code-facing modules, source locations, responsibilities, and relationships that implement the product capabilities.',
    useThisPageFor: [
      'Creating component documents for modules, services, UI areas, libraries, or runtime pieces.',
      'Linking components back to the capabilities they support.',
      'Recording source paths so delivery packages can include the right implementation context.',
      'Keeping technical ownership and boundaries visible.'
    ],
    goodOutcome: [
      'A developer or AI agent can find the relevant source area quickly.',
      'Component responsibilities do not overlap accidentally.',
      'Capabilities and source files are connected through explicit component context.'
    ],
    tip: 'Use this page when the question is “where does this live?” rather than “what should the product do?”'
  },
  'delivery-packages': {
    title: 'Delivery',
    summary: 'Plan and track implementation slices.',
    purpose: 'Delivery packages are the controlled units of work that can be reviewed, packaged, handed to AI, verified, and accepted. They keep implementation focused and tied to project context.',
    useThisPageFor: [
      'Seeing all delivery packages and their status.',
      'Creating a new package for a specific slice of work.',
      'Opening an existing package to refine scope or package it for review.',
      'Tracking whether work is draft, in review, approved, implemented, or accepted.'
    ],
    goodOutcome: [
      'Work is broken into small packages instead of vague requests.',
      'Each package has enough linked context to be executed safely.',
      'The team can see which packages are ready, blocked, or complete.'
    ],
    tip: 'A good delivery package should be small enough to review and specific enough that AI cannot wander.'
  },
  'bundle-editor': {
    title: 'Delivery package editor',
    summary: 'Define one implementation slice precisely.',
    purpose: 'This page edits a single delivery package. It captures goal, rationale, scope, linked context, acceptance criteria, verification plan, review packaging, and the final handoff instructions for agentic AI.',
    useThisPageFor: [
      'Writing the implementation goal and why it matters.',
      'Separating in-scope work from out-of-scope work.',
      'Linking foundation, standards, capabilities, components, and source files as context.',
      'Creating or importing review packages before approving work for AI execution.'
    ],
    goodOutcome: [
      'The package can be understood without a separate conversation.',
      'Reviewers can approve or request changes based on written criteria.',
      'After approval, the package becomes read-only and can be copied into an AI handoff.'
    ],
    tip: 'Keep the acceptance criteria testable. If you cannot verify it, the AI cannot reliably know it is done.'
  },
  reviews: {
    title: 'Review',
    summary: 'Approve delivery packages before they become executable work.',
    purpose: 'Review is the gate between definition and execution. It helps you decide whether a package is ready for implementation or needs changes before AI or developers act on it.',
    useThisPageFor: [
      'Checking a package status and readiness before execution.',
      'Approving a delivery package for AI-assisted implementation.',
      'Requesting changes when the package is unclear, incomplete, or too broad.',
      'Keeping review decisions visible in the workflow.'
    ],
    goodOutcome: [
      'Only clear, bounded packages are approved.',
      'Ambiguous packages are sent back for refinement.',
      'Implementation starts from reviewed context instead of an informal prompt.'
    ],
    tip: 'Review the package as if someone else will implement it with no extra explanation from you.'
  },
  validation: {
    title: 'Health Check',
    summary: 'Check whether the AIDD workspace structure is valid.',
    purpose: 'Health Check validates the project structure and important AIDD files. It is about workspace integrity, not whether a delivery package is strategically good or implementation-ready.',
    useThisPageFor: [
      'Finding missing templates, invalid front matter, corrupt JSON, or broken AIDD links.',
      'Repairing safe structural problems created by older templates or manual edits.',
      'Checking whether project source workspace configuration is usable.',
      'Producing repair logs that explain what changed.'
    ],
    goodOutcome: [
      'The workspace passes integrity checks or shows clear repairable issues.',
      'Template and metadata problems are repaired safely.',
      'You know structural errors are not blocking the delivery workflow.'
    ],
    tip: 'Run this after importing older projects, applying generated updates, or changing the project files outside AIDD.'
  },
  settings: {
    title: 'Settings',
    summary: 'Configure local identity, appearance, and repository sync.',
    purpose: 'Settings controls app-level preferences and project connection details. It keeps local Git identity, theme mode, and remote Git sync configuration out of the delivery documents.',
    useThisPageFor: [
      'Saving the author name and email used for local Git history.',
      'Switching light, dark, or system theme mode.',
      'Connecting the active project to GitHub or GitLab using a token.',
      'Testing whether the local project can sync with the configured remote repository.'
    ],
    goodOutcome: [
      'Local commits use the right author identity.',
      'The UI appearance matches your preference.',
      'Remote sync is either connected or clearly marked as not configured.'
    ],
    tip: 'Keep tokens private. AIDD stores whether a token exists, but the token value should not be written into project documents.'
  }
};

export function PageHelp({ screen, rightOffset = 20 }: { screen: Screen; rightOffset?: number }) {
  const [open, setOpen] = useState(false);
  const content = useMemo(() => pageHelpContent[screen], [screen]);

  useEffect(() => {
    setOpen(false);
  }, [screen]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!content) return null;

  return (
    <>
      <Button
        type="button"
        className="fixed bottom-5 z-40 h-11 rounded-full px-4 shadow-lg"
        style={{ right: rightOffset }}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Open help for ${content.title}`}
      >
        <CircleHelp className="h-5 w-5" />
        <span>Page help</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-help-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-hidden rounded-xl border bg-card shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b p-5">
              <div className="min-w-0 space-y-2">
                <Badge variant="outline" className="w-fit">Help overlay</Badge>
                <div>
                  <h2 id="page-help-title" className="text-2xl font-semibold">{content.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{content.summary}</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close page help">
                <X className="h-5 w-5" />
              </Button>
            </header>

            <div className="max-h-[calc(100vh-11rem)] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <HelpSection title="Purpose" icon={<BookOpen className="h-4 w-4" />} className="md:col-span-2">
                  <p>{content.purpose}</p>
                </HelpSection>

                <HelpSection title="Use this page for" icon={<Lightbulb className="h-4 w-4" />}>
                  <ul className="space-y-2">
                    {content.useThisPageFor.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </HelpSection>

                <HelpSection title="Good outcome" icon={<CheckCircle2 className="h-4 w-4" />}>
                  <ul className="space-y-2">
                    {content.goodOutcome.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </HelpSection>

                {content.tip && (
                  <div className="md:col-span-2 rounded-lg border bg-accent/40 p-4 text-sm text-accent-foreground">
                    <div className="font-medium">Practical tip</div>
                    <p className="mt-1 text-muted-foreground">{content.tip}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function HelpSection({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-background p-4 text-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2 font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="leading-6 text-muted-foreground [&_li]:list-disc [&_li]:ml-5">
        {children}
      </div>
    </section>
  );
}
