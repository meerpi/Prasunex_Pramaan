import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface AccessibleModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function AccessibleModal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-4xl',
  footer,
  children,
}: AccessibleModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed');

  if (open !== prevOpen) {
    setPrevOpen(open);
    setPhase(open ? 'open' : phase === 'open' ? 'closing' : 'closed');
  }

  useEffect(() => {
    if (phase !== 'closing') return;
    // Fallback timer in case transitionend does not fire (e.g., off-screen or instant display)
    const timer = window.setTimeout(() => setPhase('closed'), 160);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const rootEl = document.getElementById('root');
    const prevInert = rootEl?.inert ?? false;
    if (rootEl) rootEl.inert = true;

    const raf = requestAnimationFrame(() => {
      const bodyControl = bodyRef.current?.querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]',
      );
      const firstFocusable = bodyControl ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialogRef.current)?.focus();
    });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      if (rootEl) rootEl.inert = prevInert;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (phase === 'closed') return null;
  const isClosing = phase === 'closing';
  const dataState = isClosing ? 'closing' : 'open';

  const modalContent = (
    <div
      data-state={dataState}
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-rail/65 p-3 sm:p-5"
      role="presentation"
      onMouseDown={(e) => {
        if (!isClosing && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-state={dataState}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (isClosing && e.target === e.currentTarget && e.propertyName === 'opacity') {
            setPhase('closed');
          }
        }}
        className={`modal-panel gazette-folio flex max-h-[90vh] w-full ${maxWidthClass} flex-col rounded-b-md border-x border-b border-rule bg-surface shadow-[var(--shadow-popover)] min-w-0`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-rule bg-surface px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-semibold text-ink wrap-anywhere">
              {title}
            </h2>
            {subtitle && (
              <p id={descId} className="mt-0.5 text-xs text-ink-secondary wrap-anywhere">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close modal"
            className="btn-interactive inline-flex h-11 w-11 lg:h-8 lg:w-8 shrink-0 items-center justify-center rounded border border-rule bg-surface text-ink-secondary hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 min-w-0">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-rule bg-subtle px-4 py-3 sm:px-5 rounded-b-md">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
}
