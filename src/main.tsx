import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { sampleBundles } from './domain/sampleData';
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

export type Screen = 'projects' | 'project-create' | 'home' | 'foundation' | 'standards' | 'capabilities' | 'components' | 'delivery-packages' | 'bundle-editor' | 'reviews' | 'validation' | 'settings';

type ThemeMode = 'system' | 'light' | 'dark';

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
    workstream: 'Unassigned',
    capability: 'Unassigned',
    owner: 'Francis',
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
  const value = localStorage.getItem('aidd.themeMode');
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function App() {
  const [screen, setScreen] = useState<Screen>('projects');
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projects, setProjects] = useState<AiddTrackedProject[]>([]);
  const [activeProject, setActiveProject] = useState<AiddTrackedProject | null>(null);
  const [packages, setPackages] = useState<DeliveryBundle[]>(sampleBundles.map((item) => ({ ...item, id: item.id.replace('DB-', 'DP-') })));
  const [selectedId, setSelectedId] = useState('DP-001');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('aidd.sidebarCollapsed') === 'true');
  const [capabilityToOpen, setCapabilityToOpen] = useState<string | null>(null);

  useEffect(() => {
    const applyTheme = () => {
      const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('aidd.themeMode', themeMode);
    };
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem('aidd.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
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

  if (!projectsLoaded) {
    return <div className="flex h-full items-center justify-center bg-background"><div className="space-y-3 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-lg border bg-card text-lg font-bold">A</div><h1 className="text-2xl font-semibold">Opening AIDD</h1><p className="text-sm text-muted-foreground">Checking tracked projects...</p></div></div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <Sidebar active={screen} onChange={setScreen} activeProject={activeProject} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} />
      <main className="min-w-0 flex-1 overflow-hidden">
        {screen === 'projects' && <Projects projects={projects} activeProject={activeProject} onCreateProject={() => setScreen('project-create')} onOpenProject={(project) => { setActiveProject(project); setScreen('home'); }} onOpenExistingProject={openExistingProject} onForgetProject={forgetProject} />}
        {screen === 'project-create' && <ProjectCreate onCreated={projectCreated} onCancel={() => setScreen('projects')} />}
        {screen === 'home' && <Home packages={packages} selectedId={selectedId} onSelectPackage={selectPackage} onCreatePackage={createPackage} activeProject={activeProject} onOpenSetup={() => setScreen('foundation')} onOpenCapabilities={() => setScreen('capabilities')} onOpenComponents={() => setScreen('components')} onOpenDelivery={() => setScreen('delivery-packages')} />}
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
        {screen === 'components' && <Components activeProject={activeProject} onOpenCapability={(slug) => { setCapabilityToOpen(slug); setScreen('capabilities'); }} />}
        {screen === 'delivery-packages' && <DeliveryPackages packages={packages} selectedId={selectedId} onSelectPackage={selectPackage} onCreatePackage={createPackage} activeProject={activeProject} />}
        {screen === 'bundle-editor' && <BundleEditor bundle={selectedPackage} onChange={updatePackage} onSubmitForReview={submitSelectedForReview} activeProject={activeProject} onBack={() => setScreen('delivery-packages')} />}
        {screen === 'reviews' && <Reviews bundles={packages} selectedId={selectedId} onSelectBundle={(id) => selectPackage(id, 'reviews')} bundle={selectedPackage} onChange={updatePackage} />}
        {screen === 'validation' && <ProjectValidation activeProject={activeProject} />}
        {screen === 'settings' && <Settings activeProject={activeProject} themeMode={themeMode} onThemeModeChange={setThemeMode} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
