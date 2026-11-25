import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileCheck2,
  GitBranch,
  Landmark,
  LogOut,
  Menu,
  UserCheck,
  X,
} from 'lucide-react';
import type { AuthUser } from '../api/types.ts';
import { initialsForName, isStaffWorkbenchRole } from '../utils/format.ts';
import { Button, PramaanSeal } from './ui/index.ts';

export type WorkspaceTab = 'portals' | 'studio' | 'graph' | 'governance';

const WORKBENCH_NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  desc: string;
  Icon: typeof UserCheck;
}> = [
  { id: 'portals', label: 'Institutional Ledger', desc: 'Statutory filings & registers', Icon: UserCheck },
  { id: 'studio', label: 'Review Studio', desc: 'Pre-publish manuscript check', Icon: FileCheck2 },
  { id: 'graph', label: 'Claim Reconciler', desc: 'Cross-PDF evidence audit', Icon: GitBranch },
  { id: 'governance', label: 'Ordinances & Chain', desc: 'Canons, gate & audit log', Icon: Landmark },
];

const ROLE_LABELS: Record<AuthUser['role'], string> = {
  student: 'Student',
  parent: 'Parent / Guardian',
  teacher: 'Faculty',
  recruiter: 'Recruiter',
  admin: 'Registrar / Admin',
};

interface ShellProps {
  user: AuthUser;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export function BrandHeader({
  user,
  activeTab,
  onSelectTab,
  onLogout,
  children,
}: ShellProps) {
  const [drawerPhase, setDrawerPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const drawerOpen = drawerPhase === 'open';
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const openDrawer = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) return;
    setDrawerPhase('open');
  };
  const closeDrawer = () =>
    setDrawerPhase((prev) => (prev === 'open' ? 'closing' : 'closed'));

  useEffect(() => {
    if (drawerPhase !== 'closing') return;
    const timer = window.setTimeout(() => setDrawerPhase('closed'), 210);
    return () => window.clearTimeout(timer);
  }, [drawerPhase]);

  useEffect(() => {
    if (!drawerOpen) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onDesktopBreakpoint = (ev: MediaQueryListEvent) => {
      if (ev.matches) setDrawerPhase('closed');
    };
    mq.addEventListener('change', onDesktopBreakpoint);
    const prevFocus = document.activeElement as HTMLElement | null;
    const triggerEl = menuBtnRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const rootEl = document.getElementById('root');
    const prevInert = rootEl?.inert ?? false;
    if (rootEl) rootEl.inert = true;
    const raf = requestAnimationFrame(() => {
      drawerRef.current
        ?.querySelector<HTMLElement>('button:not(:disabled), a[href]')
        ?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
        );
        if (focusables.length === 0) return;
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
    window.addEventListener('keydown', onKey);
    return () => {
      mq.removeEventListener('change', onDesktopBreakpoint);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (rootEl) rootEl.inert = prevInert;
      (triggerEl ?? prevFocus)?.focus?.();
    };
  }, [drawerOpen]);

  const staffMode = isStaffWorkbenchRole(user.role);
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  /* Calm, sidebar-free shell for Student, Parent, and Recruiter users */
  if (!staffMode) {
    const folioRoleLabel =
      user.role === 'student'
        ? 'Student Pass'
        : user.role === 'parent'
          ? 'Parent Portal'
          : 'Recruiter Desk';
    return (
      <div className="min-h-screen flex flex-col bg-canvas text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[60] focus:rounded focus:bg-rail focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-surface"
        >
          Skip to main content
        </a>

        <header className="sticky top-0 z-30 border-t-2 border-t-action border-b border-rule bg-surface">
          <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-2 sm:gap-3 px-4 py-3 sm:px-8">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
              <PramaanSeal size={26} tone="light" />
              <div className="flex items-baseline gap-1.5 sm:gap-2 shrink-0">
                <span lang="hi" className="text-lg sm:text-xl font-bold leading-none text-ink">
                  प्रमाण
                </span>
                <span className="hidden min-[380px]:inline text-sm font-bold tracking-tight text-ink">
                  Pramaan
                </span>
              </div>
              <span className="hidden sm:inline text-rule" aria-hidden="true">
                /
              </span>
              <span className="hidden sm:inline text-xs font-medium text-ink-secondary truncate">
                {folioRoleLabel}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 sm:gap-2.5 min-w-0">
              <div className="text-end min-w-0 max-w-[140px] sm:max-w-[260px]">
                <div
                  dir="auto"
                  title={user.display_name}
                  className="text-xs font-semibold leading-normal text-ink truncate"
                >
                  {user.display_name}
                </div>
                <div
                  title={`${roleLabel}, ${user.tenant_id}`}
                  className="text-xs text-ink-secondary truncate"
                >
                  {roleLabel}, {user.tenant_id}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Sign out">
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full max-w-[1160px] mx-auto px-4 py-7 sm:px-8 sm:py-9 min-w-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-action/40"
        >
          {children}
        </main>
      </div>
    );
  }

  /* Registrar Workbench Shell for Admin & Faculty */
  const currentNav =
    WORKBENCH_NAV_ITEMS.find((n) => n.id === activeTab) ?? WORKBENCH_NAV_ITEMS[0];

  const railContent = (
    <div className="flex h-full flex-col bg-rail text-rail-ink">
      <div className="flex items-center justify-between border-b border-rail-border px-4 py-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <PramaanSeal size={30} tone="dark" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span lang="hi" className="text-xl font-bold leading-none text-rail-ink">
                प्रमाण
              </span>
              <span className="text-sm font-bold tracking-tight text-rail-ink">Pramaan</span>
            </div>
            <div
              title={`${user.tenant_id} (${user.role === 'teacher' ? 'Faculty' : 'Registrar'})`}
              className="mt-0.5 text-xs text-rail-muted truncate"
            >
              {user.tenant_id}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={closeDrawer}
          aria-label="Close navigation menu"
          className="lg:hidden btn-interactive inline-flex h-11 w-11 items-center justify-center rounded text-rail-muted hover:bg-rail-hover hover:text-surface focus-visible:outline-2 focus-visible:outline-rail-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Workspace sections" className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {WORKBENCH_NAV_ITEMS.map(({ id, label, desc, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                onSelectTab(id);
                closeDrawer();
              }}
              aria-current={active ? 'page' : undefined}
              className={`btn-interactive relative flex min-h-11 w-full items-start gap-3 rounded px-3 py-2.5 text-start focus-visible:outline-2 focus-visible:outline-rail-accent ${
                active
                  ? 'bg-rail-hover-strong text-rail-ink'
                  : 'text-rail-muted hover:bg-rail-hover hover:text-rail-ink'
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute start-0 top-2 bottom-2 w-0.5 bg-rail-accent"
                />
              )}
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  active ? 'text-rail-accent' : 'text-rail-muted'
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{label}</span>
                <span
                  className={`mt-0.5 block text-xs leading-tight ${
                    active ? 'text-rail-sub' : 'text-rail-muted'
                  }`}
                >
                  {desc}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-rail-border px-4 py-4 text-xs space-y-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-rail-border-strong bg-rail-hover-strong text-xs font-bold text-rail-ink"
          >
            {initialsForName(user.display_name)}
          </span>
          <div className="min-w-0 space-y-0.5">
            <div
              dir="auto"
              title={user.display_name}
              className="font-semibold leading-normal text-rail-ink truncate"
            >
              {user.display_name}
            </div>
            <div title={`${roleLabel} (@${user.username})`} className="text-rail-muted truncate">
              {roleLabel} (@{user.username})
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="btn-interactive flex min-h-11 lg:min-h-8 w-full items-center justify-center gap-2 rounded border border-rail-border-strong bg-rail-hover px-3 py-1.5 text-xs font-medium text-rail-ink hover:bg-rail-hover-strong focus-visible:outline-2 focus-visible:outline-rail-accent"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );

  const isDrawerClosing = drawerPhase === 'closing';
  const drawerState = isDrawerClosing ? 'closing' : 'open';
  const drawerOverlay =
    drawerPhase !== 'closed' ? (
      <div
        data-state={drawerState}
        className="modal-backdrop fixed inset-0 z-50 flex lg:hidden bg-rail/65"
        role="presentation"
        onMouseDown={(e) => {
          if (!isDrawerClosing && e.target === e.currentTarget) closeDrawer();
        }}
      >
        <div
          ref={drawerRef}
          id="mobile-nav-drawer"
          data-state={drawerState}
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation"
          tabIndex={-1}
          onTransitionEnd={(e) => {
            if (
              isDrawerClosing &&
              e.target === e.currentTarget &&
              (e.propertyName === 'transform' || e.propertyName === 'opacity')
            ) {
              setDrawerPhase('closed');
            }
          }}
          className="drawer-panel h-full w-72 max-w-[85vw] shadow-[var(--shadow-popover)]"
        >
          {railContent}
        </div>
      </div>
    ) : null;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[60] focus:rounded focus:bg-rail focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-surface"
      >
        Skip to main content
      </a>
      <aside className="hidden lg:block lg:w-60 lg:shrink-0 bg-rail border-e border-rail-border">
        <div className="sticky top-0 h-screen">{railContent}</div>
      </aside>

      {drawerOverlay && typeof document !== 'undefined'
        ? createPortal(drawerOverlay, document.body)
        : drawerOverlay}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-rule bg-surface px-4 py-2.5 sm:px-8">
          <div className="flex flex-1 items-center gap-2.5 min-w-0">
            <button
              ref={menuBtnRef}
              type="button"
              onClick={openDrawer}
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              aria-label="Open navigation menu"
              className="lg:hidden btn-interactive inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-rule bg-surface text-ink focus-visible:outline-2 focus-visible:outline-action"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <PramaanSeal size={22} tone="light" className="lg:hidden shrink-0" />
              <span
                title={currentNav.label}
                className="text-sm font-semibold text-ink truncate"
              >
                {currentNav.label}
              </span>
            </div>
          </div>

          <div className="hidden min-[440px]:flex items-center gap-2 text-xs text-ink-secondary min-w-[72px] max-w-[160px] sm:max-w-[260px] shrink-0">
            <span
              dir="auto"
              title={user.display_name}
              className="font-semibold leading-normal text-ink truncate"
            >
              {user.display_name}
            </span>
            <span className="hidden xl:inline text-ink-muted shrink-0">({roleLabel})</span>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full max-w-[1320px] mx-auto px-4 py-6 sm:px-8 sm:py-8 min-w-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-action/40"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
