import type { BreakUiMode, BreakUiRole } from './breakUiFixtures.ts';
import { readBreakUiState } from './breakUiFetch.ts';

const MODES: Array<{ id: BreakUiMode; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'demo', label: 'Demo data' },
  { id: 'worst', label: 'Worst case' },
  { id: 'empty', label: 'Empty' },
  { id: 'one', label: 'One' },
  { id: 'huge', label: '1,000 rows' },
];

const ROLES: Array<{ id: BreakUiRole; label: string }> = [
  { id: 'public', label: 'Public' },
  { id: 'admin', label: 'Admin' },
  { id: 'student', label: 'Student' },
  { id: 'parent', label: 'Parent' },
  { id: 'teacher', label: 'Faculty' },
  { id: 'recruiter', label: 'Recruiter' },
];

function navigateWithParams(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.location.assign(url.toString());
}

/** Dev-only, neutral bottom-center segmented control for swapping data-boundary fixtures. */
export function BreakUiToggle() {
  const { mode, role, rtl, hideToggle } = readBreakUiState();
  if (hideToggle) return null;

  return (
    <div
      role="region"
      aria-label="Dev break-ui data fixture switch"
      style={{
        position: 'fixed',
        bottom: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        maxWidth: 'calc(100vw - 16px)',
        padding: '4px',
        borderRadius: '9999px',
        backgroundColor: '#E5E7EB',
        border: '1px solid #D1D5DB',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.14)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        lineHeight: 1.2,
        color: '#111827',
      }}
    >
      <div
        role="group"
        aria-label="Fixture dataset"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}
      >
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                navigateWithParams({
                  data: m.id === 'live' ? null : m.id,
                  role: m.id === 'live' ? null : role,
                })
              }
              style={{
                border: 'none',
                borderRadius: '9999px',
                padding: '4px 9px',
                cursor: 'pointer',
                fontWeight: active ? 600 : 500,
                backgroundColor: active ? '#FFFFFF' : 'transparent',
                color: active ? '#111827' : '#4B5563',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode !== 'live' && (
        <>
          <span aria-hidden="true" style={{ width: '1px', height: '14px', backgroundColor: '#CBD5E1' }} />
          <select
            aria-label="Fixture role"
            value={role}
            onChange={(e) => navigateWithParams({ role: e.target.value })}
            style={{
              border: '1px solid #D1D5DB',
              borderRadius: '9999px',
              padding: '3px 8px',
              backgroundColor: '#FFFFFF',
              color: '#111827',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => navigateWithParams({ dir: rtl ? null : 'rtl' })}
            style={{
              border: 'none',
              borderRadius: '9999px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontWeight: rtl ? 600 : 500,
              backgroundColor: rtl ? '#FFFFFF' : 'transparent',
              color: rtl ? '#111827' : '#4B5563',
              boxShadow: rtl ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            RTL
          </button>
        </>
      )}
    </div>
  );
}
