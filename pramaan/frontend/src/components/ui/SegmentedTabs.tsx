import type { KeyboardEvent, ReactNode } from 'react';

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  panelId?: string;
}

interface SegmentedTabsProps<T extends string> {
  ariaLabel: string;
  idPrefix: string;
  value: T;
  options: Array<SegmentedTabOption<T>>;
  onChange: (next: T) => void;
  tone?: 'light' | 'dark';
  className?: string;
}

/** Accessible segmented tablist with Home/End/Arrow (RTL-safe) navigation and visible focus rings. */
export function SegmentedTabs<T extends string>({
  ariaLabel,
  idPrefix,
  value,
  options,
  onChange,
  tone = 'light',
  className = '',
}: SegmentedTabsProps<T>) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    const cur = options.findIndex((o) => o.id === value);
    if (cur < 0) return;

    let nextIdx: number | null = null;
    if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = options.length - 1;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const forward = isRtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      nextIdx = forward
        ? (cur + 1) % options.length
        : (cur - 1 + options.length) % options.length;
    }

    if (nextIdx !== null) {
      e.preventDefault();
      const next = options[nextIdx];
      onChange(next.id);
      document.getElementById(`${idPrefix}-${next.id}`)?.focus();
    }
  };

  const containerClass =
    tone === 'dark'
      ? 'inline-flex flex-wrap rounded border border-rail-border-strong bg-rail-hover p-0.5 text-xs font-semibold'
      : 'inline-flex flex-wrap rounded border border-rule bg-subtle p-0.5 text-xs font-semibold';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`${containerClass} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const tabClass =
          tone === 'dark'
            ? active
              ? 'bg-surface text-action shadow-xs'
              : 'text-rail-muted hover:text-rail-ink'
            : active
              ? 'bg-surface text-action shadow-xs'
              : 'text-ink-secondary hover:text-ink';

        return (
          <button
            key={opt.id}
            id={`${idPrefix}-${opt.id}`}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-controls={opt.panelId}
            onClick={() => onChange(opt.id)}
            className={`inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 rounded-xs px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
              tone === 'dark' ? 'focus-visible:outline-rail-accent' : 'focus-visible:outline-action'
            } ${tabClass}`}
          >
            <span>{opt.label}</span>
            {opt.badge}
          </button>
        );
      })}
    </div>
  );
}
