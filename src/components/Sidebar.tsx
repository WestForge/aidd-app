import { CheckSquare, ChevronLeft, ChevronRight, Code2, FolderGit2, Home, ListChecks, PackageCheck, Settings, Sparkles, Puzzle, ClipboardCheck, type LucideIcon } from 'lucide-react';
import type { Screen } from '../main';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

interface SidebarProps {
  active: Screen;
  onChange: (screen: Screen) => void;
  activeProject?: AiddTrackedProject | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const items: Array<{ id: Screen; label: string; icon: LucideIcon }> = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'foundation', label: 'Foundation', icon: ListChecks },
  { id: 'validation', label: 'Validation', icon: ClipboardCheck },
  { id: 'capabilities', label: 'Capabilities', icon: Sparkles },
  { id: 'components', label: 'Components', icon: Puzzle },
  { id: 'source-code', label: 'Source Code', icon: Code2 },
  { id: 'delivery-packages', label: 'Delivery', icon: PackageCheck },
  { id: 'verification', label: 'Verification', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Sidebar({ active, onChange, activeProject, collapsed = false, onToggleCollapsed }: SidebarProps) {
  return (
    <aside className={cn('flex h-full shrink-0 flex-col border-r bg-card transition-all', collapsed ? 'w-16' : 'w-64')}>
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">A</div>
        {!collapsed && <div className="min-w-0"><div className="truncate text-sm font-semibold">AIDD</div><div className="truncate text-xs text-muted-foreground">Delivery Control</div></div>}
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onToggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && activeProject && (
        <div className="border-b p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current project</div>
          <div className="mt-1 truncate text-sm font-medium">{activeProject.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{activeProject.path}</div>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id || (active === 'project-create' && item.id === 'projects') || (active === 'bundle-editor' && item.id === 'delivery-packages');
          return (
            <Button
              key={item.id}
              variant={isActive ? 'secondary' : 'ghost'}
              className={cn('w-full justify-start', collapsed && 'justify-center px-0')}
              title={item.label}
              onClick={() => onChange(item.id)}
            >
              <Icon className="h-4 w-4" />
              {!collapsed && <span>{item.label}</span>}
            </Button>
          );
        })}
      </nav>

      <div className="border-t p-3">
        {!collapsed ? <div className="space-y-2"><Badge variant="outline">v0.8.0</Badge><div className="text-xs text-muted-foreground">Template workflow 0.5.x+</div></div> : <Badge variant="outline" className="px-1">0.8</Badge>}
      </div>
    </aside>
  );
}
