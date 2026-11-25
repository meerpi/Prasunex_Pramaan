import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Info,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

export type BadgeTone = 'verified' | 'warn' | 'blocker' | 'smt' | 'neutral';

const TONE_MAP: Record<
  BadgeTone,
  { pill: string; quiet: string; Icon: typeof Check }
> = {
  verified: {
    pill: 'bg-verified-bg text-verified-ink border-verified-border',
    quiet: 'text-verified',
    Icon: Check,
  },
  warn: {
    pill: 'bg-warn-bg text-warn border-warn-border',
    quiet: 'text-warn',
    Icon: AlertTriangle,
  },
  blocker: {
    pill: 'bg-blocker-bg text-blocker border-blocker-border',
    quiet: 'text-blocker',
    Icon: ShieldAlert,
  },
  smt: {
    pill: 'bg-smt-bg text-smt border-smt-border',
    quiet: 'text-smt',
    Icon: ShieldCheck,
  },
  neutral: {
    pill: 'bg-subtle text-ink-body border-rule',
    quiet: 'text-ink-secondary',
    Icon: Info,
  },
};

interface StatusBadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  mono?: boolean;
  /** Quiet exception-first indicator: crisp icon + pigment ink, zero bordered pill background. */
  quiet?: boolean;
  className?: string;
}

export function StatusBadge({
  tone = 'neutral',
  children,
  icon,
  mono = false,
  quiet = false,
  className = '',
}: StatusBadgeProps) {
  const { pill, quiet: quietCls, Icon } = TONE_MAP[tone];
  if (quiet) {
    return (
      <span
        className={`inline-flex items-start gap-1.5 text-sm font-medium leading-snug tabular break-words ${quietCls} ${
          mono ? 'font-mono text-xs' : ''
        } ${className}`}
      >
        <span className="mt-[3px] shrink-0 flex items-center" aria-hidden="true">
          {icon ?? <Icon className="h-3.5 w-3.5 stroke-[2.25]" />}
        </span>
        <span className="min-w-0">{children}</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-semibold leading-5 tabular ${pill} ${
        mono ? 'font-mono' : ''
      } ${className}`}
    >
      <span className="shrink-0 flex items-center" aria-hidden="true">
        {icon ?? <Icon className="h-3.5 w-3.5 stroke-[2]" />}
      </span>
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </span>
  );
}
