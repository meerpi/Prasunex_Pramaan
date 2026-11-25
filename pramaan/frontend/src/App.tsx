import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, clearLegacyStoredToken } from './api/client.ts';
import type { AuthUser } from './api/types.ts';
import { BrandHeader, type WorkspaceTab } from './components/BrandHeader.tsx';
import { PublicHome } from './components/PublicHome.tsx';
import { clearLastQrToken, isStaffWorkbenchRole } from './utils/format.ts';

const PortalViews = lazy(() =>
  import('./components/PortalViews.tsx').then((m) => ({ default: m.PortalViews })),
);
const ReviewStudioPanel = lazy(() =>
  import('./components/ReviewStudioPanel.tsx').then((m) => ({ default: m.ReviewStudioPanel })),
);
const ClaimGraphWorkbench = lazy(() =>
  import('./components/ClaimGraphWorkbench.tsx').then((m) => ({ default: m.ClaimGraphWorkbench })),
);
const GovernanceMcpHub = lazy(() =>
  import('./components/GovernanceMcpHub.tsx').then((m) => ({ default: m.GovernanceMcpHub })),
);

function readTabFromUrl(): WorkspaceTab {
  if (typeof window === 'undefined') return 'portals';
  const raw = new URLSearchParams(window.location.search).get('tab');
  if (raw === 'studio' || raw === 'graph' || raw === 'governance' || raw === 'portals') return raw;
  return 'portals';
}

function syncWorkspaceUrl(tab: WorkspaceTab, options: { push?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('persona');
  url.searchParams.set('tab', tab);
  if (options.push) {
    window.history.pushState({}, '', url.toString());
  } else {
    window.history.replaceState({}, '', url.toString());
  }
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(true);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [activeTab, setActiveTabState] = useState<WorkspaceTab>(readTabFromUrl);

  const setActiveTab = useCallback((next: WorkspaceTab) => {
    setActiveTabState(next);
    syncWorkspaceUrl(next, { push: true });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPop = () => {
      setActiveTabState(readTabFromUrl());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        clearLegacyStoredToken();
        const [status, sess] = await Promise.all([api.setupStatus(), api.session()]);
        if (!active) return;
        setInitialized(status.initialized);
        if (sess.authenticated && sess.user) {
          setUser(sess.user);
          const initialTab = isStaffWorkbenchRole(sess.user.role) ? readTabFromUrl() : 'portals';
          setActiveTabState(initialTab);
          syncWorkspaceUrl(initialTab);
        }
      } catch (e: unknown) {
        if (active) {
          setBootError(e instanceof Error ? e.message : 'Unable to connect to Pramaan backend.');
        }
      } finally {
        if (active) setBooting(false);
      }
    };
    void boot();
    return () => {
      active = false;
    };
  }, []);

  const handleAuthenticated = (authedUser: AuthUser) => {
    setInitialized(true);
    setBootError('');
    setUser(authedUser);
    const initialTab: WorkspaceTab = 'portals';
    setActiveTabState(initialTab);
    syncWorkspaceUrl(initialTab);
  };

  const handleLogout = () => {
    clearLastQrToken();
    void api.logout().catch(() => {
      // Clear local UI state even if server session already expired
    });
    setUser(null);
    setBootError('');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      url.searchParams.delete('persona');
      window.history.replaceState({}, '', url.toString());
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-canvas p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-action" aria-hidden="true" />
          <span className="text-sm font-semibold text-ink">Opening Pramaan…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <PublicHome
        initialized={initialized}
        initialError={bootError}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const effectiveTab: WorkspaceTab = isStaffWorkbenchRole(user.role) ? activeTab : 'portals';

  return (
    <BrandHeader
      user={user}
      activeTab={effectiveTab}
      onSelectTab={setActiveTab}
      onLogout={handleLogout}
    >
      <div key={`${user.role}:${effectiveTab}`} className="animate-panel min-w-0">
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2.5 border-y border-rule py-6 text-sm text-ink-secondary"
            >
              <Loader2 className="h-4 w-4 animate-spin text-action" aria-hidden="true" />
              <span>Loading register…</span>
            </div>
          }
        >
          {effectiveTab === 'portals' && <PortalViews user={user} onSelectTab={setActiveTab} />}
          {effectiveTab === 'studio' && <ReviewStudioPanel user={user} />}
          {effectiveTab === 'graph' && (
            <ClaimGraphWorkbench user={user} onOpenReviewStudio={() => setActiveTab('studio')} />
          )}
          {effectiveTab === 'governance' && <GovernanceMcpHub user={user} />}
        </Suspense>
      </div>
    </BrandHeader>
  );
}
