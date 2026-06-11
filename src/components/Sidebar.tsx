import { CheckSquare, Code2, FolderGit2, Home, ListChecks, PackageCheck, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Puzzle, ClipboardCheck, type LucideIcon } from 'lucide-react';
import type { Screen } from '../main';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

interface SidebarProps {
  active: Screen;
  activeProject?: AiddTrackedProject | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onChange: (screen: Screen) => void;
}

const items: Array<{ id: Screen; label: string; icon: LucideIcon; hint?: string }> = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'foundation', label: 'Foundation', icon: ListChecks },
  { id: 'validation', label: 'Validation', icon: ClipboardCheck },
  { id: 'capabilities', label: 'Capabilities', icon: Sparkles, hint: 'Value' },
  { id: 'components', label: 'Components', icon: Puzzle, hint: 'System' },
  { id: 'source-code', label: 'Source Code', icon: Code2 },
  { id: 'delivery-packages', label: 'Delivery', icon: PackageCheck },
  { id: 'verification', label: 'Verification', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: Settings }
];

function isItemActive(active: Screen, id: Screen) {
  return active === id || (active === 'project-create' && id === 'projects') || (active === 'bundle-editor' && id === 'delivery-packages');
}

function shortPath(path?: string) {
  if (!path) return 'No project selected';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join(' / ') || path;
}

export function Sidebar({ active, activeProject, collapsed, onToggleCollapsed, onChange }: SidebarProps) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside className={cn('flex h-screen shrink-0 flex-col border-r bg-card text-card-foreground transition-[width] duration-200', collapsed ? 'w-16' : 'w-64')}>
      <div className={cn('flex items-center gap-3 px-3 py-3', collapsed && 'justify-center')}>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-black text-primary-foreground shadow-sm">A</div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">AIDD</div>
            <div className="text-xs text-muted-foreground">Delivery Control</div>
          </div>
        )}
        {!collapsed && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleCollapsed} title="Collapse sidebar" aria-label="Collapse sidebar">
            <ToggleIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      {collapsed ? (
        <div className="border-y bg-muted/35 px-2 py-3">
          <Button variant="ghost" size="icon" className="h-9 w-full" onClick={onToggleCollapsed} title="Expand sidebar" aria-label="Expand sidebar">
            <ToggleIcon className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="border-y bg-muted/35 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current project</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground" title={activeProject?.name ?? 'No project selected'}>
            {activeProject?.name ?? 'No project selected'}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={activeProject?.path ?? ''}>{shortPath(activeProject?.path)}</div>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(active, item.id);
          return (
            <Button
              key={item.id}
              variant={isActive ? 'secondary' : 'ghost'}
              className={cn(
                'h-9 w-full gap-2 text-sm font-medium',
                collapsed ? 'justify-center px-0' : 'justify-start px-3',
                isActive && 'bg-secondary text-secondary-foreground'
              )}
              onClick={() => onChange(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && item.hint && <Badge variant="outline" className="ml-auto hidden px-1.5 py-0 text-[10px] font-semibold xl:inline-flex">{item.hint}</Badge>}
            </Button>
          );
        })}
      </nav>

      <Separator />

      {collapsed ? (
        <div className="p-2">
          <Badge variant="secondary" className="w-full justify-center px-0" title="AIDD App v0.8.0">v</Badge>
        </div>
      ) : (
        <div className="space-y-2 p-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>AIDD App</span>
            <Badge variant="secondary">v0.8.0</Badge>
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            Template workflow <strong className="text-foreground">0.5.x+</strong>
          </div>
        </div>
      )}
    </aside>
  );
}
