import * as React from 'react';
import { cn } from '../../lib/utils';
export function Switch({ checked, onCheckedChange, className, ...props }: { checked: boolean; onCheckedChange: (checked: boolean) => void; className?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} className={cn('inline-flex h-5 w-9 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', checked ? 'bg-primary' : 'bg-input', className)} {...props}><span className={cn('pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} /></button>;
}
