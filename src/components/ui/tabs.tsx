import * as React from 'react';
import { cn } from '../../lib/utils';

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex flex-wrap items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground', className)} {...props} />;
}

export function TabsTrigger({ className, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
        active ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/60 hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}
