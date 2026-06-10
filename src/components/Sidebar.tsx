import { CheckSquare, Code2, FolderGit2, Home, ListChecks, PackageCheck, Settings, ShieldCheck, Sparkles, Puzzle, ClipboardCheck, type LucideIcon } from 'lucide-react';
import type { Screen } from '../main';

interface SidebarProps {
  active: Screen;
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
  { id: 'delivery-packages', label: 'Delivery Packages', icon: PackageCheck },
  { id: 'reviews', label: 'AI Reviews', icon: ShieldCheck },
  { id: 'verification', label: 'Verification', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark">A</div>
        <div>
          <strong>AIDD</strong>
          <span>Delivery Control</span>
        </div>
      </div>
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id || (active === 'project-create' && item.id === 'projects') || (active === 'bundle-editor' && item.id === 'delivery-packages');
          return (
            <button key={item.id} className={isActive ? 'navItem active' : 'navItem'} onClick={() => onChange(item.id)}>
              <Icon size={17} />
              <span>{item.label}</span>
              {item.hint && <small className="navHint">{item.hint}</small>}
            </button>
          );
        })}
      </nav>
      <div className="sidebarVersion">
        <span>AIDD App</span>
        <strong>v0.8.0</strong>
        <small>Template workflow: 0.5.x+</small>
      </div>
    </aside>
  );
}
