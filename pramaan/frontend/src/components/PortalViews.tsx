import { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  AdminInstitutionalData,
  AuthUser,
  ParentPortalData,
  StudentPortalData,
  TeacherPortalData,
} from '../api/types.ts';
import type { WorkspaceTab } from './BrandHeader.tsx';
import { Button, EmptyState } from './ui/index.ts';

const AdminPortal = lazy(() =>
  import('./portals/AdminPortal.tsx').then((m) => ({ default: m.AdminPortal })),
);
const ParentPortal = lazy(() =>
  import('./portals/ParentPortal.tsx').then((m) => ({ default: m.ParentPortal })),
);
const RecruiterPortal = lazy(() =>
  import('./portals/RecruiterPortal.tsx').then((m) => ({ default: m.RecruiterPortal })),
);
const StudentPortal = lazy(() =>
  import('./portals/StudentPortal.tsx').then((m) => ({ default: m.StudentPortal })),
);
const TeacherPortal = lazy(() =>
  import('./portals/TeacherPortal.tsx').then((m) => ({ default: m.TeacherPortal })),
);

interface PortalViewsProps {
  user: AuthUser;
  onSelectTab?: (tab: WorkspaceTab) => void;
}

export function PortalViews({ user, onSelectTab }: PortalViewsProps) {
  return <PortalInner key={user.username} user={user} onSelectTab={onSelectTab} />;
}

function PortalInner({ user, onSelectTab }: PortalViewsProps) {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(user.role !== 'recruiter');
  const [err, setErr] = useState('');

  const [studentData, setStudentData] = useState<StudentPortalData | null>(null);
  const [parentData, setParentData] = useState<ParentPortalData | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherPortalData | null>(null);
  const [adminData, setAdminData] = useState<AdminInstitutionalData | null>(null);

  useEffect(() => {
    if (user.role === 'recruiter') return;
    let active = true;
    const run = async () => {
      try {
        if (user.role === 'student') {
          const d = await api.studentPortal();
          if (active) setStudentData(d);
        } else if (user.role === 'parent') {
          const d = await api.parentPortal();
          if (active) setParentData(d);
        } else if (user.role === 'teacher') {
          const d = await api.teacherPortal();
          if (active) setTeacherData(d);
        } else if (user.role === 'admin') {
          const d = await api.adminInstitutional();
          if (active) setAdminData(d);
        }
        if (active) setErr('');
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load portal data.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [user.role, user.username, reloadNonce]);

  const refresh = () => {
    setLoading(true);
    setErr('');
    setReloadNonce((n) => n + 1);
  };

  const hasCurrentData =
    (user.role === 'student' && Boolean(studentData)) ||
    (user.role === 'parent' && Boolean(parentData)) ||
    (user.role === 'teacher' && Boolean(teacherData)) ||
    (user.role === 'admin' && Boolean(adminData)) ||
    user.role === 'recruiter';

  if (loading && !hasCurrentData) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 border-y border-rule py-6 text-sm text-ink-secondary"
      >
        <Loader2 className="h-4 w-4 animate-spin text-action" aria-hidden="true" />
        <span>Loading verified institutional records…</span>
      </div>
    );
  }

  if (err && !hasCurrentData) {
    return (
      <EmptyState
        title="Unable to reach institutional register"
        description={err}
        action={
          <Button variant="primary" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry request
          </Button>
        }
      />
    );
  }

  const loadingFallback = (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 border-y border-rule py-6 text-sm text-ink-secondary"
    >
      <Loader2 className="h-4 w-4 animate-spin text-action" aria-hidden="true" />
      <span>Loading portal module…</span>
    </div>
  );

  let content: React.ReactNode = (
    <EmptyState
      title="No portal view loaded"
      description="Retry loading your institutional register."
    />
  );

  if (user.role === 'student' && studentData) {
    content = <StudentPortal user={user} data={studentData} onRefresh={refresh} />;
  } else if (user.role === 'parent' && parentData) {
    content = <ParentPortal data={parentData} onRefresh={refresh} />;
  } else if (user.role === 'teacher' && teacherData) {
    content = <TeacherPortal data={teacherData} />;
  } else if (user.role === 'recruiter') {
    content = <RecruiterPortal />;
  } else if (user.role === 'admin' && adminData) {
    content = <AdminPortal data={adminData} onRefresh={refresh} onSelectTab={onSelectTab} />;
  }

  return (
    <div className="space-y-4 min-w-0">
      {err && hasCurrentData && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker"
        >
          <span className="min-w-0 flex-1 wrap-anywhere">
            Unable to refresh portal data: {err}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="secondary" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Dismiss refresh error"
              onClick={() => setErr('')}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      <Suspense fallback={loadingFallback}>{content}</Suspense>
    </div>
  );
}
