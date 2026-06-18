import { ChevronLeft, ChevronRight, FolderGit2, GitPullRequestArrow, HeartPulse, Home, ListChecks, Map, PackageCheck, Settings, ShieldCheck, Sparkles, Puzzle, type LucideIcon } from 'lucide-react';
import type { Screen } from '../main';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Select } from './ui/select';
import { cn } from '../lib/utils';
import packageJson from '../../package.json';

interface SidebarProps {
  active: Screen;
  onChange: (screen: Screen) => void;
  activeProject?: AiddTrackedProject | null;
  projects?: AiddTrackedProject[];
  onProjectChange?: (project: AiddTrackedProject) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type SidebarItem = { id: Screen; label: string; icon: LucideIcon };

const APP_VERSION = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
const APP_VERSION_SHORT = APP_VERSION.split('.').slice(0, 2).join('.');

const primaryItems: SidebarItem[] = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'foundation', label: 'Foundation', icon: ListChecks },
  { id: 'standards', label: 'Standards', icon: ShieldCheck },
  { id: 'capabilities', label: 'Capabilities', icon: Sparkles },
  { id: 'components', label: 'Components', icon: Puzzle },
  { id: 'changes', label: 'Changes', icon: GitPullRequestArrow },
  { id: 'delivery-packages', label: 'Delivery', icon: PackageCheck },
  { id: 'roadmap', label: 'Roadmap', icon: Map }
];

const utilityItems: SidebarItem[] = [
  { id: 'validation', label: 'Health Check', icon: HeartPulse },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Sidebar({
  active,
  onChange,
  activeProject,
  projects = [],
  onProjectChange,
  collapsed = false,
  onToggleCollapsed
}: SidebarProps) {
  const selectedProjectId = activeProject?.id ?? '';

  const handleProjectChange = (projectId: string) => {
    const nextProject = projects.find((project) => project.id === projectId);
    if (nextProject) onProjectChange?.(nextProject);
  };

  return (
    <aside className={cn('flex h-full shrink-0 flex-col border-r bg-card transition-all', collapsed ? 'w-16' : 'w-64')}>
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">A</div>
        {!collapsed && <div className="min-w-0"><div className="truncate text-sm font-semibold">AIDD</div><div className="truncate text-xs text-muted-foreground">Delivery Control</div></div>}
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onToggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (activeProject || projects.length > 0) && (
        <div className="border-b p-3">
          <label htmlFor="sidebar-project-select" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Project
          </label>
          <Select
            id="sidebar-project-select"
            className="mt-2 h-8 text-xs"
            value={selectedProjectId}
            disabled={!onProjectChange || projects.length === 0}
            onChange={(event) => handleProjectChange(event.target.value)}
            title={activeProject?.path ?? 'No project selected'}
          >
            {!activeProject && <option value="">No project selected</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id} title={project.path}>
                {project.name}
              </option>
            ))}
          </Select>
          {activeProject && <div className="mt-2 truncate text-xs text-muted-foreground">{activeProject.path}</div>}
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {primaryItems.map((item) => (
          <SidebarButton
            key={item.id}
            item={item}
            active={active}
            collapsed={collapsed}
            onChange={onChange}
          />
        ))}
      </nav>

      <nav className="space-y-1 border-t p-2">
        {utilityItems.map((item) => (
          <SidebarButton
            key={item.id}
            item={item}
            active={active}
            collapsed={collapsed}
            onChange={onChange}
          />
        ))}
      </nav>

      <div className="border-t p-3">
        {!collapsed ? (
          <div className="space-y-2">
            <Badge variant="outline">v{APP_VERSION}</Badge>
            <div className="text-xs text-muted-foreground">AIDD app version</div>
          </div>
        ) : (
          <Badge variant="outline" className="px-1">{APP_VERSION_SHORT}</Badge>
        )}
      </div>
    </aside>
  );
}

function SidebarButton({ item, active, collapsed, onChange }: { item: SidebarItem; active: Screen; collapsed: boolean; onChange: (screen: Screen) => void }) {
  const Icon = item.icon;
  const isActive = active === item.id || (active === 'project-create' && item.id === 'projects') || (active === 'bundle-editor' && item.id === 'delivery-packages');

  return (
    <Button
      variant={isActive ? 'secondary' : 'ghost'}
      className={cn('w-full justify-start', collapsed && 'justify-center px-0')}
      title={item.label}
      onClick={() => onChange(item.id)}
    >
      <Icon className="h-4 w-4" />
      {!collapsed && <span>{item.label}</span>}
    </Button>
  );
}
