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
import { Verification } from './components/Verification';
import { Settings } from './components/Settings';
import { SourceCode } from './components/SourceCode';
import { ProjectValidation } from './components/ProjectValidation';

export type Screen = 'projects' | 'project-create' | 'home' | 'foundation' | 'validation' | 'capabilities' | 'components' | 'source-code' | 'delivery-packages' | 'bundle-editor' | 'reviews' | 'verification' | 'settings';

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
    approvals: {
      product: 'pending',
      architecture: 'pending',
      delivery: 'pending'
    },
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

  useEffect(() => {
    document.documentElement.dataset.themeMode = themeMode;
    localStorage.setItem('aidd.themeMode', themeMode);
  }, [themeMode]);

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

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedId) ?? packages[0],
    [packages, selectedId]
  );

  const refreshProjects = async (active?: AiddTrackedProject | null) => {
    const trackedProjects = await window.aidd.listProjects();
    setProjects(trackedProjects);
    if (active) setActiveProject(active);
  };

  const updatePackage = (updated: DeliveryBundle) => {
    setPackages((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const selectPackage = (id: string, target: Screen = 'bundle-editor') => {
    setSelectedId(id);
    setScreen(target);
  };

  const createPackage = () => {
    const id = nextPackageId(packages);
    const item = createBlankPackage(id);
    setPackages((current) => [item, ...current]);
    setSelectedId(id);
    setScreen('bundle-editor');
  };

  const transitionSelectedPackage = (status: BundleStatus) => {
    updatePackage(applyStatus(selectedPackage, status));
  };

  const submitSelectedForReview = () => {
    const readiness = checkReadiness(selectedPackage);
    if (!readiness.readyForReview) return;
    transitionSelectedPackage('needs-review');
    setScreen('reviews');
  };

  const openExistingProject = async () => {
    const project = await window.aidd.openExistingProject();
    if (project) {
      await refreshProjects(project);
      setScreen('home');
    }
  };


  const forgetProject = async (project: AiddTrackedProject) => {
    const confirmed = window.confirm(`Remove "${project.name}" from tracked projects?

This will not delete any files from disk.`);
    if (!confirmed) return;
    const remaining = await window.aidd.forgetProject(project.id);
    setProjects(remaining);
    if (activeProject?.id === project.id) {
      setActiveProject(remaining[0] ?? null);
      setScreen(remaining.length > 0 ? 'projects' : 'project-create');
    }
  };

  const projectCreated = async (project: AiddTrackedProject) => {
    await refreshProjects(project);
    setScreen('foundation');
  };

  if (!projectsLoaded) {
    return (
      <div className="loadingShell">
        <div className="brandMark large">A</div>
        <h1>Opening AIDD</h1>
        <p>Checking tracked projects...</p>
      </div>
    );
  }

  return (
    <div className="appShell">
      <Sidebar active={screen} onChange={setScreen} />
      <div className="contentShell">
        {screen === 'projects' && <Projects projects={projects} activeProject={activeProject} onCreateProject={() => setScreen('project-create')} onOpenProject={(project) => { setActiveProject(project); setScreen('home'); }} onOpenExistingProject={openExistingProject} onForgetProject={forgetProject} />}
        {screen === 'project-create' && <ProjectCreate onCreated={projectCreated} onCancel={() => setScreen('projects')} />}
        {screen === 'home' && <Home packages={packages} selectedId={selectedId} onSelectPackage={selectPackage} onCreatePackage={createPackage} activeProject={activeProject} onOpenSetup={() => setScreen('foundation')} onOpenCapabilities={() => setScreen('capabilities')} onOpenComponents={() => setScreen('components')} />}
        {screen === 'foundation' && <SetupWorkflow activeProject={activeProject} onOpenCapabilities={() => setScreen('capabilities')} onOpenComponents={() => setScreen('components')} />}
        {screen === 'validation' && <ProjectValidation activeProject={activeProject} />}
        {screen === 'capabilities' && <Capabilities activeProject={activeProject} />}
        {screen === 'components' && <Components activeProject={activeProject} />}
        {screen === 'source-code' && <SourceCode activeProject={activeProject} />}
        {screen === 'delivery-packages' && <DeliveryPackages packages={packages} selectedId={selectedId} onSelectPackage={selectPackage} onCreatePackage={createPackage} />}
        {screen === 'bundle-editor' && <BundleEditor bundle={selectedPackage} onChange={updatePackage} onSubmitForReview={submitSelectedForReview} />}
        {screen === 'reviews' && <Reviews bundles={packages} selectedId={selectedId} onSelectBundle={(id) => selectPackage(id, 'reviews')} bundle={selectedPackage} onChange={updatePackage} />}
        {screen === 'verification' && <Verification bundle={selectedPackage} onChange={updatePackage} />}
        {screen === 'settings' && <Settings activeProject={activeProject} themeMode={themeMode} onThemeModeChange={setThemeMode} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
