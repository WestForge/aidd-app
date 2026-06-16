import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@mdxeditor/editor/style.css';
import './styles/app.css';
import type { BundleStatus, DeliveryBundle } from './domain/types';
import { checkReadiness } from './domain/readiness';
import { Sidebar } from './components/Sidebar';
import { Projects } from './components/Projects';
import { ProjectCreate } from './components/ProjectCreate';
import { Home } from './components/Home';
import { SetupWorkflow } from './components/SetupWorkflow';
import { Capabilities } from './components/Capabilities';
import { Components } from './components/Components';
import { DeliveryPackages } from './components/DeliveryPackages';
import { BundleEditor } from './components/BundleEditor';
import { Reviews } from './components/Reviews';
import { Settings } from './components/Settings';
import { ProjectValidation } from './components/ProjectValidation';
import { PageHelp } from './components/PageHelp';

export type Screen = 'projects' | 'project-create' | 'home' | 'foundation' | 'standards' | 'capabilities' | 'components' | 'delivery-packages' | 'bundle-editor' | 'reviews' | 'validation' | 'settings';

type ThemeMode = 'system' | 'light' | 'dark';

type RendererBootState = {
  startedAt: string;
  stage: string;
  mounted?: boolean;
  preloadAvailable?: boolean;
  error?: string;
};

const bootWindow = window as Window & { __AIDD_RENDERER_BOOT_STATE__?: RendererBootState };

function setRendererBootState(update: Partial<RendererBootState>) {
  bootWindow.__AIDD_RENDERER_BOOT_STATE__ = {
    startedAt: bootWindow.__AIDD_RENDERER_BOOT_STATE__?.startedAt ?? new Date().toISOString(),
    stage: bootWindow.__AIDD_RENDERER_BOOT_STATE__?.stage ?? 'starting',
    ...bootWindow.__AIDD_RENDERER_BOOT_STATE__,
    ...update
  };
}

setRendererBootState({
  stage: 'module-loaded',
  preloadAvailable: Boolean(window.aidd)
});

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in unusual packaged/protocol states.
  }
}

function StartupFailureScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl border border-slate-600 bg-slate-800 text-xl font-bold">A</div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          The packaged window opened, but the renderer could not finish starting. This is normally a build path, preload, or startup exception rather than a UI layout issue.
        </p>
        <pre className="mt-5 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-200">{detail}</pre>
        <p className="mt-5 text-sm text-slate-400">
          Rebuild with a clean dist folder after applying the Vite <code className="rounded bg-slate-800 px-1">base: './'</code> setting.
        </p>
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; info: string }> {
  state = { error: null as Error | null, info: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, info: '' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const detail = `${formatError(error)}\n\n${info.componentStack}`;
    console.error('AIDD renderer crashed during React render.', error, info);
    setRendererBootState({ stage: 'react-error-boundary', error: detail });
    this.setState({ error, info: info.componentStack || '' });
  }

  render() {
    if (this.state.error) {
      return <StartupFailureScreen title="AIDD renderer crashed" detail={`${formatError(this.state.error)}\n\n${this.state.info}`} />;
    }

    return this.props.children;
  }
}

function RendererBootMarker({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setRendererBootState({ stage: 'mounted', mounted: true, preloadAvailable: Boolean(window.aidd) });
  }, []);

  return <>{children}</>;
}

window.addEventListener('error', (event) => {
  setRendererBootState({ stage: 'window-error', error: formatError(event.error || event.message) });
});

window.addEventListener('unhandledrejection', (event) => {
  setRendererBootState({ stage: 'unhandled-rejection', error: formatError(event.reason) });
});

function nextPackageId(packages: DeliveryBundle[]) {
  const max = packages.reduce((highest, item) => {
    const numeric = Number(item.id.replace(/\D/g, ''));
    return Number.isFinite(numeric) ? Math.max(highest, numeric) : highest;
  }, 0);
  return `DP-${String(max + 1).padStart(3, '0')}`;
}

function createBlankPackage(id: string): DeliveryBundle {
  return {
    id,
    title: 'Untitled Delivery Package',
    status: 'draft',
    workstream: '',
    capability: '',
    owner: '',
    goal: '',
    rationale: '',
    inScope: [],
    outOfScope: [],
    linkedContext: [],
    acceptanceCriteria: [],
    verificationPlan: [],
    risks: [],
    approvals: { product: 'pending', architecture: 'pending', delivery: 'pending' },
    verificationNotes: '',
    lastUpdated: new Date().toISOString().slice(0, 10)
  };
}

function applyStatus(item: DeliveryBundle, status: BundleStatus): DeliveryBundle {
  return { ...item, status, lastUpdated: new Date().toISOString().slice(0, 10) };
}

function getStoredThemeMode(): ThemeMode {
  const value = readLocalStorage('aidd.themeMode');
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function App() {
  const [screen, setScreen] = useState<Screen>('projects');
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [projects, setProjects] = useState<AiddTrackedProject[]>([]);
  const [activeProject, setActiveProject] = useState<AiddTrackedProject | null>(null);
  const [packages, setPackages] = useState<DeliveryBundle[]>([]);
  const [selectedId, setSelectedId] = useState('DP-001');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalStorage('aidd.sidebarCollapsed') === 'true');
  const [capabilityToOpen, setCapabilityToOpen] = useState<string | null>(null);

  useEffect(() => {
    const applyTheme = () => {
      const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
      writeLocalStorage('aidd.themeMode', themeMode);
    };
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themeMode]);

  useEffect(() => {
    writeLocalStorage('aidd.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!window.aidd?.listProjects) {
      const message = [
        'Electron preload API did not load. window.aidd.listProjects is unavailable.',
        '',
        'Likely causes:',
        '- dist/main/preload.js was not built or not packaged.',
        '- BrowserWindow preload path is pointing at the wrong file after packaging.',
        '- The packaged app is loading an old main bundle.'
      ].join('\n');
      console.error(message);
      setRendererBootState({ stage: 'preload-missing', error: message, preloadAvailable: false });
      setStartupError(message);
      setProjectsLoaded(true);
      return;
    }

    setRendererBootState({ stage: 'loading-projects', preloadAvailable: true });
    window.aidd.listProjects().then((trackedProjects) => {
      setProjects(trackedProjects);
      if (trackedProjects[0]) {
        setActiveProject(trackedProjects[0]);
        setScreen('projects');
      } else {
        setScreen('project-create');
      }
      setProjectsLoaded(true);
    }).catch((error) => {
      console.error(error);
      setProjectsLoaded(true);
      setScreen('project-create');
    });
  }, []);

  const selectedPackage = useMemo(() => packages.find((item) => item.id === selectedId) ?? createBlankPackage(selectedId), [packages, selectedId]);

  const refreshProjects = async (active?: AiddTrackedProject | null) => {
    const trackedProjects = await window.aidd.listProjects();
    setProjects(trackedProjects);
    if (active) setActiveProject(active);
  };

  const updatePackage = (updated: DeliveryBundle) => setPackages((current) => current.map((item) => item.id === updated.id ? updated : item));
  const selectPackage = (id: string, target: Screen = 'bundle-editor') => { setSelectedId(id); setScreen(target); };
  const createPackage = () => { const id = nextPackageId(packages); const item = createBlankPackage(id); setPackages((current) => [item, ...current]); setSelectedId(id); setScreen('bundle-editor'); };
  const openCreatedDeliveryPackage = (id: string) => { setSelectedId(id); setScreen('bundle-editor'); };
  const transitionSelectedPackage = (status: BundleStatus) => updatePackage(applyStatus(selectedPackage, status));
  const submitSelectedForReview = () => { const readiness = checkReadiness(selectedPackage); if (!readiness.readyForReview) return; transitionSelectedPackage('needs-review'); setScreen('reviews'); };

  const openExistingProject = async () => {
    const project = await window.aidd.openExistingProject();
    if (project) { await refreshProjects(project); setScreen('home'); }
  };

  const forgetProject = async (project: AiddTrackedProject) => {
    const confirmed = window.confirm(`Remove "${project.name}" from tracked projects?\n\nThis will not delete any files from disk.`);
    if (!confirmed) return;
    const remaining = await window.aidd.forgetProject(project.id);
    setProjects(remaining);
    if (activeProject?.id === project.id) {
      setActiveProject(remaining[0] ?? null);
      setScreen(remaining.length > 0 ? 'projects' : 'project-create');
    }
  };

  const projectCreated = async (project: AiddTrackedProject) => { await refreshProjects(project); setScreen('foundation'); };

  if (startupError) {
    return <StartupFailureScreen title="AIDD preload did not start" detail={startupError} />;
  }

  if (!projectsLoaded) {
    return <div className="flex h-full items-center justify-center bg-background"><div className="space-y-3 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-lg border bg-card text-lg font-bold">A</div><h1 className="text-2xl font-semibold">Opening AIDD</h1><p className="text-sm text-muted-foreground">Checking tracked projects...</p></div></div>;
  }

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background text-foreground">
      <Sidebar active={screen} onChange={setScreen} activeProject={activeProject} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} />
      <main className="min-w-0 flex-1 overflow-hidden">
        {screen === 'projects' && <Projects projects={projects} activeProject={activeProject} onCreateProject={() => setScreen('project-create')} onOpenProject={(project) => { setActiveProject(project); setScreen('home'); }} onOpenExistingProject={openExistingProject} onForgetProject={forgetProject} />}
        {screen === 'project-create' && <ProjectCreate onCreated={projectCreated} onCancel={() => setScreen('projects')} />}
        {screen === 'home' && (
          <Home
            packages={packages}
            selectedId={selectedId}
            onSelectPackage={selectPackage}
            onCreatePackage={createPackage}
            activeProject={activeProject}
            onProjectUpdated={(project) => {
              void refreshProjects(project);
            }}
            onOpenSetup={() => setScreen('foundation')}
            onOpenCapabilities={() => setScreen('capabilities')}
            onOpenComponents={() => setScreen('components')}
            onOpenDelivery={() => setScreen('delivery-packages')}
          />
        )}
        {screen === 'foundation' && (
          <SetupWorkflow
            activeProject={activeProject}
            initialStep="foundation"
            activeArea="foundation"
            onOpenCapabilities={() => setScreen('capabilities')}
            onOpenComponents={() => setScreen('components')}
          />
        )}
        {screen === 'standards' && (
          <SetupWorkflow
            activeProject={activeProject}
            initialStep="standards"
            activeArea="standards"
            onOpenCapabilities={() => setScreen('capabilities')}
            onOpenComponents={() => setScreen('components')}
          />
        )}
        {screen === 'capabilities' && <Capabilities activeProject={activeProject} onDeliveryPackageCreated={openCreatedDeliveryPackage} initialCapabilitySlug={capabilityToOpen} onInitialCapabilityOpened={() => setCapabilityToOpen(null)} />}
        {screen === 'components' && <Components activeProject={activeProject} onOpenCapability={(slug) => { setCapabilityToOpen(slug); setScreen('capabilities'); }} onDeliveryPackageCreated={openCreatedDeliveryPackage} />}
        {screen === 'delivery-packages' && <DeliveryPackages packages={packages} selectedId={selectedId} onSelectPackage={selectPackage} onCreatePackage={createPackage} activeProject={activeProject} />}
        {screen === 'bundle-editor' && <BundleEditor bundle={selectedPackage} onChange={updatePackage} onSubmitForReview={submitSelectedForReview} activeProject={activeProject} onBack={() => setScreen('delivery-packages')} />}
        {screen === 'reviews' && <Reviews bundles={packages} selectedId={selectedId} onSelectBundle={(id) => selectPackage(id, 'reviews')} bundle={selectedPackage} onChange={updatePackage} />}
        {screen === 'validation' && <ProjectValidation activeProject={activeProject} />}
        {screen === 'settings' && <Settings activeProject={activeProject} themeMode={themeMode} onThemeModeChange={setThemeMode} />}
      </main>
      <PageHelp screen={screen} />
    </div>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  const detail = 'The packaged index.html does not contain <div id="root"></div>.';
  setRendererBootState({ stage: 'root-missing', error: detail });
  document.body.innerHTML = `<main style="font-family: system-ui; margin: 48px; max-width: 760px"><h1>AIDD could not start</h1><p>${detail}</p></main>`;
} else {
  setRendererBootState({ stage: 'rendering-react', preloadAvailable: Boolean(window.aidd) });
  createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <RendererBootMarker>
          <App />
        </RendererBootMarker>
      </AppErrorBoundary>
    </React.StrictMode>
  );
}
