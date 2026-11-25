import type { ReactNode } from 'react';

interface SheetProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * 'ledger' (default): Flat ruled Gazette section directly on the paper ground.
   * 'paper': Crisp white focal paper document framed with a single stark 2px black-ink top rule.
   */
  tone?: 'ledger' | 'paper';
  /** Stark matte-ink cap strictly for issued cryptographic seals & verifiable credentials. */
  darkHeader?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Sheet({
  title,
  subtitle,
  actions,
  tone = 'ledger',
  darkHeader = false,
  className = '',
  bodyClassName = '',
  children,
}: SheetProps) {
  if (tone === 'paper') {
    if (darkHeader) {
      return (
        <section
          className={`min-w-0 overflow-hidden rounded-xs border border-rule bg-surface shadow-[var(--shadow-seal)] ${className}`}
        >
          {(title || subtitle || actions) && (
            <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2.5 sm:gap-3 border-b border-rail-border bg-rail px-5 py-4 sm:px-6 text-rail-ink">
              <div className="min-w-[160px] flex-1">
                {title && (
                  <h2 className="font-display text-lg font-semibold text-rail-ink leading-snug wrap-anywhere">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="mt-1 text-xs text-rail-sub leading-relaxed wrap-anywhere">
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">{actions}</div>
              )}
            </header>
          )}
          <div className={`px-5 py-5 sm:px-6 min-w-0 ${bodyClassName}`}>{children}</div>
        </section>
      );
    }

    return (
      <section
        className={`gazette-folio min-w-0 border-x border-b border-rule bg-surface ${className}`}
      >
        {(title || subtitle || actions) && (
          <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-2.5 sm:gap-3 border-b border-rule-subtle px-5 py-4 sm:px-6">
            <div className="min-w-[160px] flex-1">
              {title && (
                <h2 className="font-display text-lg font-semibold text-ink leading-snug wrap-anywhere">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="mt-1 text-sm text-ink-secondary leading-relaxed wrap-anywhere">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">{actions}</div>
            )}
          </header>
        )}
        <div className={`px-5 py-5 sm:px-6 min-w-0 ${bodyClassName}`}>{children}</div>
      </section>
    );
  }

  /* Default flat Gazette ledger section */
  return (
    <section className={`min-w-0 border-t border-rule pt-5 ${className}`}>
      {(title || subtitle || actions) && (
        <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between gap-2.5 pb-4">
          <div className="min-w-[160px] flex-1">
            {title && (
              <h2 className="font-display text-lg font-semibold text-ink leading-snug wrap-anywhere">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-ink-secondary leading-relaxed wrap-anywhere">
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">{actions}</div>
          )}
        </header>
      )}
      <div className={`min-w-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
