import type { ReactNode } from 'react';
import { FileSearch } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center border-y border-rule bg-subtle/40 px-6 py-8 text-center">
      <div className="mb-2.5 text-ink-muted" aria-hidden="true">
        {icon ?? <FileSearch className="h-5 w-5 stroke-[1.75]" />}
      </div>
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-secondary leading-relaxed">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
