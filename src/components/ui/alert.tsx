import * as React from 'react';
import { cn } from '../../lib/utils';

type AlertVariant = 'default' | 'destructive' | 'success' | 'warning';
const variants: Record<AlertVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
};

export function Alert({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  return <div className={cn('relative w-full rounded-lg border p-4 text-sm', variants[variant], className)} {...props} />;
}
