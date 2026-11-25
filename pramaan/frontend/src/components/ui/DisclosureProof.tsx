import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';

interface DisclosureProofProps {
  label?: string;
  children: ReactNode;
}

/** Progressive disclosure drawer keeping cryptographic/solver internals off primary surfaces. */
export function DisclosureProof({
  label = 'Verification & cryptographic proof details',
  children,
}: DisclosureProofProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="border-t border-rule-subtle text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="btn-interactive flex min-h-11 lg:min-h-8 w-full items-center justify-between gap-2 py-2 text-start font-medium text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-action" aria-hidden="true" />
          <span title={label} className="truncate">
            {label}
          </span>
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] ${
            open ? 'rotate-90 text-action' : 'rtl:rotate-180 text-ink-muted'
          }`}
          aria-hidden="true"
        />
      </button>
      <div
        id={contentId}
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
        inert={!open || undefined}
        className="disclosure-body"
      >
        <div>
          <div className="mb-2 bg-subtle px-3.5 py-3 font-mono text-xs text-ink-body leading-relaxed wrap-anywhere">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
