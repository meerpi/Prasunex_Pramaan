import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileBadge2,
  Lock,
  QrCode,
  RefreshCw,
  ShieldOff,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  AttendanceRecord,
  AuthUser,
  CourseCreditRecord,
  MintedQrPassport,
  StudentPortalData,
} from '../../api/types.ts';
import { StudentPreFlightPanel } from './StudentPreFlightPanel.tsx';
import {
  ALL_CLAIM_KEYS,
  classifyAppendixIxCert,
  clearLastQrToken,
  downloadBlob,
  formatClaimValue,
  formatCount,
  formatDateTime,
  formatDecimal,
  formatPercent,
  humanizeClaimKey,
  humanizeSchoolLabel,
  humanizeStatus,
  isIsoDateExpired,
  orderDisclosedKeys,
  pluralize,
  saveLastQrToken,
  todayIstIso,
  truncateMiddle,
} from '../../utils/format.ts';
import { useCopyFeedback } from '../../utils/useCopyFeedback.ts';
import {
  Button,
  DataTable,
  DisclosureProof,
  EmptyState,
  PaginationBar,
  PramaanSeal,
  SegmentedTabs,
  Sheet,
  StatusBadge,
} from '../ui/index.ts';

type StudentTab = 'pass' | 'preflight' | 'records';

interface StudentPortalProps {
  user: AuthUser;
  data: StudentPortalData;
  onRefresh: () => void;
}

function CopyIconMorph({ copied }: { copied: boolean }) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
      <Copy
        className={`icon-morph absolute h-3.5 w-3.5 ${
          copied ? 'scale-85 opacity-0' : 'scale-100 opacity-100'
        }`}
      />
      <Check
        className={`icon-morph absolute h-3.5 w-3.5 text-verified ${
          copied ? 'scale-100 opacity-100' : 'scale-85 opacity-0'
        }`}
      />
    </span>
  );
}

export function StudentPortal({ user, data, onRefresh }: StudentPortalProps) {
  const s = data.student;
  const proof = data.z3_cgpa_proof;
  const consents = data.consents;

  const isK12 = s?.education_level === 'K12';
  const todayIso = todayIstIso();
  const minAtt = data.attendance_policy?.min_attendance_pct ?? 75;
  const exemptThreshold = data.attendance_policy?.cgpa_exemption_threshold ?? null;
  const isExemptByCgpa = Boolean(data.attendance_policy?.student_exempt_by_cgpa);
  const activeConsents = consents.filter((c) => !c.revoked && !isIsoDateExpired(c.expires_at, todayIso));
  const primaryConsent = activeConsents[0] ?? null;
  const minorLocked =
    Boolean(data.minor_consent_locked) || (Boolean(s?.is_minor) && activeConsents.length === 0);

  // Expose ONLY claim keys genuinely present on the student's real ERP record
  const availableKeys = ALL_CLAIM_KEYS.filter((key) => {
    if (!s) return false;
    if (key === 'attendance_pct') return s.attendance.length > 0;
    if (key === 'disciplinary_standing') return Boolean(s.disciplinary_standing?.trim());
    return true;
  });

  const defaultClaimsForStudent = (): string[] => {
    if (!s) return [];
    if (s.is_minor && primaryConsent) {
      return orderDisclosedKeys(
        primaryConsent.allowed_claims.filter((k) => availableKeys.includes(k as (typeof ALL_CLAIM_KEYS)[number])),
      );
    }
    return orderDisclosedKeys(
      ['full_name', 'program', 'batch_year', 'cgpa', 'active_backlogs'].filter((k) =>
        availableKeys.includes(k as (typeof ALL_CLAIM_KEYS)[number]),
      ),
    );
  };

  const defaultGranteeForStudent = (): string =>
    s?.is_minor && primaryConsent ? primaryConsent.grantee_name : '';

  const activeConsentSig = activeConsents
    .map((c) => `${c.consent_id}:${[...c.allowed_claims].sort().join(',')}`)
    .join('|');
  const consentSyncKey = `${s?.prn ?? 'unlinked'}:${activeConsentSig}`;
  const [activeTab, setActiveTab] = useState<StudentTab>('pass');
  const [prevSyncKey, setPrevSyncKey] = useState(consentSyncKey);
  const [discloseKeys, setDiscloseKeys] = useState<string[]>(defaultClaimsForStudent);
  const [grantee, setGrantee] = useState<string>(defaultGranteeForStudent);
  const [minted, setMinted] = useState<MintedQrPassport | null>(null);
  const [mintedGrantee, setMintedGrantee] = useState<string>('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmHistoryRevokeId, setConfirmHistoryRevokeId] = useState<string | null>(null);
  const [revokingHistoryId, setRevokingHistoryId] = useState<string | null>(null);
  const [passesPage, setPassesPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const { copiedKey, copy: copyWithFeedback } = useCopyFeedback<'payload' | 'sd_jwt'>();
  const [err, setErr] = useState('');
  const [revokeMsg, setRevokeMsg] = useState('');
  const [draftResumeFile, setDraftResumeFile] = useState<File | null>(null);
  const [stamping, setStamping] = useState(false);
  const [stampMsg, setStampMsg] = useState('');
  const stampInputRef = useRef<HTMLInputElement | null>(null);

  const courseSearchText = useCallback(
    (r: CourseCreditRecord) => `${r.course_code} ${r.course_title}`,
    [],
  );
  const attendanceSearchText = useCallback(
    (r: AttendanceRecord) => `${r.course_code} ${r.course_title}`,
    [],
  );

  const courseColumns = useMemo(
    () => [
      {
        key: 'code',
        header: 'Course',
        sortValue: (r: CourseCreditRecord) => r.course_code,
        render: (r: CourseCreditRecord) => (
          <div>
            <span className="font-mono text-xs text-ink-secondary">{r.course_code}</span>
            <div dir="auto" className="font-medium text-ink">
              {r.course_title}
            </div>
          </div>
        ),
      },
      {
        key: 'sem',
        header: 'Term',
        align: 'right' as const,
        sortValue: (r: CourseCreditRecord) => r.semester,
        render: (r: CourseCreditRecord) => `${isK12 ? 'Term' : 'Sem'} ${formatCount(r.semester)}`,
      },
      {
        key: 'credits',
        header: 'Credits',
        align: 'right' as const,
        sortValue: (r: CourseCreditRecord) => r.credits,
        render: (r: CourseCreditRecord) => formatCount(r.credits),
      },
      {
        key: 'gp',
        header: 'Grade Point',
        align: 'right' as const,
        sortValue: (r: CourseCreditRecord) => r.grade_point,
        render: (r: CourseCreditRecord) => (
          <span className="font-bold text-ink">{formatDecimal(r.grade_point, 2)}</span>
        ),
      },
    ],
    [isK12],
  );

  const attendanceColumns = useMemo(
    () => [
      {
        key: 'code',
        header: 'Course',
        sortValue: (r: AttendanceRecord) => r.course_code,
        render: (r: AttendanceRecord) => (
          <div>
            <span className="font-mono text-xs text-ink-secondary">{r.course_code}</span>
            <div dir="auto" className="font-medium text-ink">
              {r.course_title}
            </div>
          </div>
        ),
      },
      {
        key: 'raw',
        header: 'Classes Attended',
        align: 'right' as const,
        render: (r: AttendanceRecord) => (
          <div>
            <div>
              {formatCount(r.attended_classes)} / {formatCount(r.total_classes)} (
              {formatPercent(r.raw_pct, 1)})
            </div>
            {r.medical_condonation_pct > 0 && (
              <div className="text-xs font-medium text-action">
                +{formatPercent(r.medical_condonation_pct, 1)} medical relief
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'effective',
        header: 'Effective %',
        align: 'right' as const,
        cellClassName: 'whitespace-nowrap',
        sortValue: (r: AttendanceRecord) => r.effective_pct,
        render: (r: AttendanceRecord) =>
          r.effective_pct >= minAtt ? (
            <StatusBadge tone="verified" quiet className="whitespace-nowrap">
              {formatPercent(r.effective_pct, 1)}
            </StatusBadge>
          ) : isExemptByCgpa ? (
            <StatusBadge tone="verified" quiet className="whitespace-nowrap">
              {formatPercent(r.effective_pct, 1)} (Exempt)
            </StatusBadge>
          ) : (
            <StatusBadge tone="blocker" className="whitespace-nowrap">
              {formatPercent(r.effective_pct, 1)}
            </StatusBadge>
          ),
      },
    ],
    [minAtt, isExemptByCgpa],
  );

  if (consentSyncKey !== prevSyncKey) {
    setPrevSyncKey(consentSyncKey);
    setDiscloseKeys(defaultClaimsForStudent());
    setGrantee(defaultGranteeForStudent());
    setMinted(null);
    setMintedGrantee('');
    setConfirmRevoke(false);
    setErr('');
    setRevokeMsg('');
  }

  const uniqueMinorConsents = s?.is_minor
    ? Array.from(
        new Map(activeConsents.map((c) => [c.grantee_name.trim().toLowerCase(), c])).values(),
      )
    : [];
  const effectiveGrantee =
    s?.is_minor && uniqueMinorConsents.length > 0
      ? uniqueMinorConsents.some(
          (c) => c.grantee_name.trim().toLowerCase() === grantee.trim().toLowerCase(),
        )
        ? grantee
        : uniqueMinorConsents[0].grantee_name
      : grantee;

  const matchedMinorConsent = s?.is_minor
    ? activeConsents.find(
        (c) => c.grantee_name.trim().toLowerCase() === effectiveGrantee.trim().toLowerCase(),
      ) ?? primaryConsent
    : null;
  const minorAllowedSet =
    s?.is_minor && matchedMinorConsent ? new Set(matchedMinorConsent.allowed_claims) : null;
  const effectiveDiscloseKeys = minorAllowedSet
    ? discloseKeys.filter((k) => minorAllowedSet.has(k))
    : discloseKeys;

  if (!s || !proof) {
    return (
      <div className="space-y-8 min-w-0">
        <header className="gazette-header space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            {user.display_name}
          </h1>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-secondary">
            <span>
              Account <span className="font-mono text-xs text-ink">@{user.username}</span>
            </span>
            <span>
              Institution <span className="font-mono text-xs text-ink">{user.tenant_id}</span>
            </span>
          </div>
        </header>

        <EmptyState
          title="No institutional student record linked yet"
          description="Your Pramaan account is active, but your school or university registrar has not linked an official roll number (PRN) to this login yet. Once linked, your verified transcript, attendance ledger, and selective-disclosure QR pass will appear here."
          action={
            <Button variant="secondary" onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Check for linked record
            </Button>
          }
        />
      </div>
    );
  }

  const toggleKey = (key: string) => {
    setDiscloseKeys((prev) =>
      orderDisclosedKeys(prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]),
    );
  };

  const handleMint = async () => {
    const trimmedGrantee = effectiveGrantee.trim();
    if (minorLocked || effectiveDiscloseKeys.length === 0 || trimmedGrantee.length < 2) return;
    setBusy(true);
    setErr('');
    setRevokeMsg('');
    try {
      const res = await api.mintPassport(
        s.prn,
        orderDisclosedKeys(effectiveDiscloseKeys),
        trimmedGrantee,
      );
      setMinted(res);
      setMintedGrantee(trimmedGrantee);
      setConfirmRevoke(false);
      saveLastQrToken(s.full_name, res.base45_payload, res.portability?.sd_jwt);
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to issue verified pass.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!minted) return;
    setBusy(true);
    setErr('');
    try {
      await api.revokePassport(minted.passport_id, 'Student initiated revocation');
      clearLastQrToken();
      setRevokeMsg(`Pass ${truncateMiddle(minted.passport_id, 10, 6)} has been revoked.`);
      setMinted(null);
      setMintedGrantee('');
      setConfirmRevoke(false);
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Revocation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeHistoryPass = async (passportId: string) => {
    setRevokingHistoryId(passportId);
    setErr('');
    try {
      await api.revokePassport(passportId, 'Student initiated revocation');
      if (minted?.passport_id === passportId) {
        clearLastQrToken();
        setMinted(null);
        setMintedGrantee('');
        setConfirmRevoke(false);
      }
      setRevokeMsg(`Pass ${truncateMiddle(passportId, 10, 6)} has been revoked.`);
      setConfirmHistoryRevokeId(null);
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Revocation failed');
    } finally {
      setRevokingHistoryId(null);
    }
  };

  const copyPayload = async () => {
    if (!minted) return;
    const ok = await copyWithFeedback('payload', minted.base45_payload);
    if (!ok) {
      setErr('Clipboard write was blocked by your browser.');
    }
  };

  const downloadPng = () => {
    if (!minted) return;
    const bin = atob(minted.qr_png_b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: 'image/png' }), `pramaan-pass-${s.prn.slice(0, 24)}.png`);
  };

  const copySdJwt = async () => {
    if (!minted?.portability?.sd_jwt) return;
    const ok = await copyWithFeedback('sd_jwt', minted.portability.sd_jwt);
    if (!ok) {
      setErr('Clipboard write was blocked by your browser.');
    }
  };

  const downloadW3cVcJson = () => {
    if (!minted?.portability?.w3c_vc_2_0) return;
    const blob = new Blob([JSON.stringify(minted.portability.w3c_vc_2_0, null, 2)], {
      type: 'application/vc+ld+json',
    });
    downloadBlob(blob, `pramaan-vc2-${s.prn.slice(0, 24)}.vc.json`);
  };

  const handleStampPdf = async (pdfFile: File | null) => {
    if (!pdfFile || !minted) return;
    setStamping(true);
    setErr('');
    setStampMsg('');
    try {
      const blob = await api.stampPassportPdf(pdfFile, minted.base45_payload);
      const stem = pdfFile.name.replace(/\.pdf$/i, '').slice(0, 48) || 'resume';
      downloadBlob(blob, `${stem}-verified-qr.pdf`);
      setStampMsg(`Downloaded ${stem}-verified-qr.pdf with your signed Pramaan QR badge stamped on Page 1.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to stamp QR badge onto resume PDF.');
    } finally {
      setStamping(false);
    }
  };

  const attendanceSum = s.attendance.reduce((acc, a) => acc + a.effective_pct, 0);
  const avgAttendance = s.attendance.length > 0 ? attendanceSum / s.attendance.length : null;
  const attendanceLow = avgAttendance !== null && avgAttendance < minAtt && !isExemptByCgpa;
  const orderedMintedKeys = minted ? orderDisclosedKeys(Object.keys(minted.disclosed_claims)) : [];

  const selectEssentialKeys = () => {
    setDiscloseKeys(
      orderDisclosedKeys(
        ['full_name', 'program', 'batch_year', 'cgpa', 'active_backlogs'].filter((k) =>
          availableKeys.includes(k as (typeof ALL_CLAIM_KEYS)[number]),
        ),
      ),
    );
  };

  const selectAllKeys = () => {
    setDiscloseKeys(orderDisclosedKeys([...availableKeys]));
  };

  return (
    <div className="space-y-8 min-w-0">
      <header className="gazette-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 dir="auto" className="font-display text-3xl sm:text-4xl font-semibold text-ink wrap-anywhere">
              {s.full_name}
            </h1>
            {s.is_minor && (
              <StatusBadge tone="warn">Minor ({s.age_years}y), Guardian Consent Required</StatusBadge>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-secondary wrap-anywhere">
            <span className="font-medium text-ink-body">{s.program}</span>
            <span className="font-mono text-xs text-ink">{s.prn}</span>
            <span>{s.batch_year > 0 ? `Batch ${s.batch_year}` : 'Cohort unassigned'}</span>
            <span>{humanizeStatus(s.degree_status)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {minorLocked ? (
            <StatusBadge tone="blocker" icon={<Lock className="h-3.5 w-3.5" />}>
              Pass Issuance Locked
            </StatusBadge>
          ) : s.courses.length === 0 ? (
            <StatusBadge tone="neutral" quiet>
              No courses linked yet
            </StatusBadge>
          ) : proof.verified ? (
            <StatusBadge tone="verified" quiet>
              {isK12 ? 'Score verified with school register' : 'CGPA verified with Registrar'}
            </StatusBadge>
          ) : (
            <StatusBadge tone="blocker">
              {isK12 ? 'Score Variance Detected' : 'CGPA Variance Detected'}
            </StatusBadge>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-rule bg-rule-subtle shadow-[var(--shadow-sheet)] sm:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))] tabular">
        <div className="min-w-0 bg-surface p-4 sm:p-5">
          <dt className="text-xs font-medium text-ink-secondary">
            {isK12 ? 'Verified Grade Score' : 'Verified CGPA'}
          </dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold text-ink">
              {formatDecimal(s.declared_cgpa, 2)}
            </span>
            <span className="text-xs text-ink-muted">/ 10.00</span>
          </dd>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-trough">
            <div
              className="gauge-fill h-full w-full bg-action"
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, s.declared_cgpa / 10))})` }}
            />
          </div>
        </div>
        <div className="min-w-0 bg-surface p-4 sm:p-5">
          <dt className="text-xs font-medium text-ink-secondary">Effective Attendance</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-2">
            <span
              className={`font-display text-2xl font-semibold ${
                attendanceLow ? 'text-blocker' : 'text-ink'
              }`}
            >
              {avgAttendance === null ? '—' : formatPercent(avgAttendance, 1)}
            </span>
            {avgAttendance !== null && (
              <span
                className={`text-xs ${
                  attendanceLow ? 'font-medium text-blocker' : 'text-ink-secondary'
                }`}
              >
                {avgAttendance >= minAtt
                  ? `Meets ${formatPercent(minAtt, 1)} rule`
                  : isExemptByCgpa && exemptThreshold !== null
                    ? `Exempt (CGPA ≥ ${formatDecimal(exemptThreshold, 2)})`
                    : isExemptByCgpa
                      ? 'Exempt by CGPA'
                      : `Below ${formatPercent(minAtt, 1)}`}
              </span>
            )}
          </dd>
          {avgAttendance !== null ? (
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-trough">
              <div
                className={`gauge-fill h-full w-full ${
                  attendanceLow ? 'bg-blocker-strong' : 'bg-verified'
                }`}
                style={{ transform: `scaleX(${Math.min(1, Math.max(0, avgAttendance / 100))})` }}
              />
            </div>
          ) : (
            <div className="mt-2 text-xs text-ink-muted">Awaiting attendance logs</div>
          )}
        </div>
        <div className="min-w-0 bg-surface p-4 sm:p-5">
          <dt className="text-xs font-medium text-ink-secondary">Active Backlogs</dt>
          <dd
            className={`mt-1 font-display text-2xl font-semibold ${
              s.active_backlogs > 0 ? 'text-warn' : 'text-ink'
            }`}
          >
            {formatCount(s.active_backlogs)}
          </dd>
          <div
            className={`mt-2 text-xs ${
              s.active_backlogs > 0 ? 'font-medium text-warn' : 'text-ink-secondary'
            }`}
          >
            {s.active_backlogs === 0
              ? 'Clear academic standing'
              : `${pluralize(s.active_backlogs, 'active backlog')} on record`}
          </div>
        </div>
        <div className="min-w-0 bg-surface p-4 sm:p-5">
          <dt className="text-xs font-medium text-ink-secondary">Active Data Permissions</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-ink">
            {formatCount(activeConsents.length)}
          </dd>
          <div className="mt-2 text-xs text-ink-secondary">Scoped data consents</div>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel="Student portal sections"
          idPrefix="student-tab"
          tone="light"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { id: 'pass', label: 'Academic Pass', panelId: 'student-panel-pass' },
            { id: 'preflight', label: 'Resume Check', panelId: 'student-panel-preflight' },
            { id: 'records', label: 'Transcript & School', panelId: 'student-panel-records' },
          ]}
        />
      </div>

      <div>
        <div
          id="student-panel-pass"
          role="tabpanel"
          aria-labelledby="student-tab-pass"
          hidden={activeTab !== 'pass'}
          className="space-y-8"
        >
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.95fr_1.05fr] items-start">
            <div className="space-y-5 min-w-0">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  Issue Verified Academic Pass
                </h2>
                <p className="mt-1 text-sm text-ink-secondary leading-relaxed">
                  Select only the verified attributes your employer or scholarship board needs.
                  Unselected fields remain private.
                </p>
              </div>

              {minorLocked && (
                <div
                  role="status"
                  aria-atomic="true"
                  className="border-y border-blocker-border bg-blocker-bg px-4 py-3.5 text-sm text-blocker"
                >
                  <div className="flex items-start gap-2.5">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-semibold">
                        Guardian approval required for students under 18
                      </p>
                      <p className="text-blocker-deep leading-relaxed">
                        Under India’s Digital Personal Data Protection Rules (Rule 10), your linked
                        parent or guardian must approve an exact recipient and attribute scope before
                        a pass can be issued.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {err && (
                <div
                  role="alert"
                  aria-atomic="true"
                  className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker wrap-anywhere"
                >
                  {err}
                </div>
              )}

              {revokeMsg && (
                <div
                  role="status"
                  aria-atomic="true"
                  className="border-y border-warn-border bg-warn-bg px-4 py-2.5 text-sm font-medium text-warn wrap-anywhere"
                >
                  {revokeMsg}
                </div>
              )}

              {!minorLocked && s.is_minor && matchedMinorConsent && (
                <div
                  role="status"
                  aria-atomic="true"
                  className="min-w-0 border-y border-verified-border bg-verified-bg px-4 py-2.5 text-sm text-verified-ink wrap-anywhere"
                >
                  <strong>Approved by guardian for:</strong>{' '}
                  <bdi>{matchedMinorConsent.grantee_name}</bdi>
                  {matchedMinorConsent.digilocker_tx_id && (
                    <span
                      dir="ltr"
                      title={matchedMinorConsent.digilocker_tx_id}
                      className="ms-2 inline-block max-w-full font-mono text-xs wrap-anywhere"
                    >
                      ({truncateMiddle(matchedMinorConsent.digilocker_tx_id, 18, 12)})
                    </span>
                  )}
                </div>
              )}

              {!s.is_minor && !minorLocked && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-ink-secondary tabular">
                    {pluralize(effectiveDiscloseKeys.length, 'attribute')} selected
                  </span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={selectEssentialKeys}>
                      Essentials
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={selectAllKeys}>
                      Select all
                    </Button>
                  </div>
                </div>
              )}

              <fieldset className="border-y border-rule divide-y divide-rule-subtle">
                <legend className="sr-only">Attributes to include on pass</legend>
                {availableKeys.map((key) => {
                  const blockedByConsent = minorAllowedSet !== null && !minorAllowedSet.has(key);
                  const checked = effectiveDiscloseKeys.includes(key);
                  return (
                    <label
                      key={key}
                      htmlFor={`disclose-claim-${key}`}
                      title={
                        blockedByConsent
                          ? 'Not included in current guardian approval'
                          : undefined
                      }
                      className={`flex min-h-11 lg:min-h-10 items-center justify-between gap-3 px-2 py-2 text-sm transition-colors ${
                        blockedByConsent
                          ? 'cursor-not-allowed text-ink-muted opacity-60'
                          : 'cursor-pointer row-hoverable text-ink'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <input
                          id={`disclose-claim-${key}`}
                          name="disclose_claims"
                          type="checkbox"
                          checked={checked}
                          disabled={minorLocked || blockedByConsent}
                          onChange={() => toggleKey(key)}
                          className="h-4 w-4 shrink-0 rounded border-ink-muted accent-action focus-visible:outline-2 focus-visible:outline-action"
                        />
                        <span className={checked ? 'font-semibold text-ink' : 'text-ink-secondary'}>
                          {humanizeClaimKey(key, isK12)}
                        </span>
                      </span>
                      <span className="text-xs text-ink-muted shrink-0">
                        {blockedByConsent ? 'Locked by guardian' : checked ? 'Included' : 'Withheld'}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="flex flex-wrap items-end gap-3 pt-1">
                <div className="flex-1 min-w-[210px]">
                  <label htmlFor="grantee-input" className="block text-xs font-semibold text-ink">
                    {s.is_minor && uniqueMinorConsents.length > 0
                      ? 'Guardian-approved recipient'
                      : 'Recipient or verifier desk'}
                  </label>
                  {s.is_minor && uniqueMinorConsents.length > 0 ? (
                    <select
                      id="grantee-input"
                      name="grantee_name"
                      disabled={minorLocked}
                      value={effectiveGrantee}
                      onChange={(e) => {
                        const nextName = e.target.value;
                        setGrantee(nextName);
                        const nextConsent = activeConsents.find(
                          (c) =>
                            c.grantee_name.trim().toLowerCase() === nextName.trim().toLowerCase(),
                        );
                        if (nextConsent) {
                          setDiscloseKeys(
                            orderDisclosedKeys(
                              nextConsent.allowed_claims.filter((k) =>
                                availableKeys.includes(k as (typeof ALL_CLAIM_KEYS)[number]),
                              ),
                            ),
                          );
                        }
                      }}
                      className="mt-1.5 min-h-11 lg:min-h-9 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action disabled:bg-subtle"
                    >
                      {uniqueMinorConsents.map((c) => (
                        <option key={c.consent_id} value={c.grantee_name}>
                          {c.grantee_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="grantee-input"
                      name="grantee_name"
                      type="text"
                      minLength={2}
                      maxLength={160}
                      disabled={minorLocked}
                      value={grantee}
                      onChange={(e) => setGrantee(e.target.value)}
                      placeholder="Enter exact recipient organization name…"
                      className="mt-1.5 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action disabled:bg-subtle"
                    />
                  )}
                </div>
                <Button
                  variant={minted ? 'secondary' : 'primary'}
                  disabled={
                    busy ||
                    minorLocked ||
                    effectiveDiscloseKeys.length === 0 ||
                    effectiveGrantee.trim().length < 2
                  }
                  onClick={() => void handleMint()}
                >
                  <QrCode className="h-4 w-4" aria-hidden="true" />
                  {busy
                    ? 'Issuing pass…'
                    : minted
                      ? 'Re-issue Verified Pass'
                      : 'Issue Verified Pass'}
                </Button>
              </div>
            </div>

            <div className="space-y-6 min-w-0">
              {minted ? (
                <article className="passport-stamp overflow-hidden rounded-xs border border-rule bg-surface shadow-[var(--shadow-seal)]">
                  <header className="flex flex-col items-start gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between border-b border-rail-border bg-rail px-5 sm:px-6 py-4 text-rail-ink">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <PramaanSeal size={34} tone="dark" />
                      <div className="min-w-0">
                        <div className="font-display text-lg font-semibold leading-tight text-rail-ink">
                          Verified Academic Pass
                        </div>
                        <div dir="auto" className="mt-0.5 text-xs text-rail-sub/90 wrap-anywhere">
                          Issued for {mintedGrantee || effectiveGrantee.trim()}
                        </div>
                      </div>
                    </div>
                    <StatusBadge tone="verified">Active &amp; Signed</StatusBadge>
                  </header>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-subtle bg-subtle/60 px-6 py-2 text-xs">
                    <span className="font-mono text-ink-secondary">
                      PRN <strong className="text-ink">{s.prn}</strong>
                    </span>
                    <span className="font-medium text-ink-secondary">
                      Official Signed Credential
                    </span>
                  </div>

                  <div className="flex flex-col gap-6 px-6 py-5 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 space-y-4">
                      <dl className="divide-y divide-rule-subtle text-sm">
                        {orderedMintedKeys.map((k) => (
                          <div
                            key={k}
                            className="flex items-baseline justify-between gap-4 py-2 first:pt-0"
                          >
                            <dt className="text-xs font-medium text-ink-secondary shrink-0">
                              {humanizeClaimKey(k, isK12)}
                            </dt>
                            <dd
                              dir="auto"
                              title={minted.disclosed_claims[k]}
                              className="font-semibold text-ink text-end tabular wrap-anywhere min-w-0"
                            >
                              {formatClaimValue(k, minted.disclosed_claims[k])}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {minted.hidden_claims.length > 0 && (
                        <p className="text-xs text-ink-secondary">
                          {pluralize(minted.hidden_claims.length, 'private academic field')} withheld
                          from this pass.
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-center gap-2 self-center sm:self-start">
                      <div className="qr-vault-frame">
                        <img
                          src={`data:image/png;base64,${minted.qr_png_b64}`}
                          alt="Signed Selective Disclosure QR Pass"
                          className="h-36 w-36 object-contain"
                        />
                      </div>
                      <span
                        dir="ltr"
                        title={minted.passport_id}
                        className="font-mono text-xs text-ink-muted tabular"
                      >
                        {truncateMiddle(minted.passport_id, 8, 5)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-rule-subtle bg-canvas px-6 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="primary" size="sm" onClick={downloadPng}>
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Download QR Pass
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={stamping}
                          onClick={() => {
                            if (draftResumeFile && /\.pdf$/i.test(draftResumeFile.name)) {
                              void handleStampPdf(draftResumeFile);
                            } else {
                              stampInputRef.current?.click();
                            }
                          }}
                        >
                          <FileBadge2 className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                          {stamping
                            ? 'Stamping PDF…'
                            : draftResumeFile && /\.pdf$/i.test(draftResumeFile.name)
                              ? 'Stamp onto Loaded Resume PDF'
                              : 'Stamp QR onto Resume PDF'}
                        </Button>
                        <input
                          ref={stampInputRef}
                          id="student-stamp-resume-pdf"
                          name="stamp_resume_pdf"
                          type="file"
                          accept=".pdf,application/pdf"
                          disabled={stamping}
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.currentTarget.value = '';
                            if (f) {
                              setDraftResumeFile(f);
                              void handleStampPdf(f);
                            }
                          }}
                        />
                        <Button variant="secondary" size="sm" onClick={() => void copyPayload()}>
                          <CopyIconMorph copied={copiedKey === 'payload'} />
                          {copiedKey === 'payload' ? 'Copied share code' : 'Copy share code'}
                        </Button>
                      </div>
                      <span className="text-xs text-ink-secondary">Offline verifiable</span>
                    </div>
                    {stampMsg && (
                      <p
                        role="status"
                        aria-atomic="true"
                        className="text-xs font-medium text-verified-ink"
                      >
                        {stampMsg}
                      </p>
                    )}
                  </div>

                  <div className="px-6 py-1">
                    <DisclosureProof label="Portable formats, cryptographic proof & revocation">
                      <div className="space-y-3 font-sans">
                        <div className="font-mono text-xs space-y-1.5">
                          <div>
                            <strong>Pass ID:</strong> {minted.passport_id} (QR v{minted.qr_version},{' '}
                            {formatCount(minted.payload_bytes_len)} bytes)
                          </div>
                          <div>
                            <strong>Base45 CBOR (RFC 9162):</strong>{' '}
                            <span title={minted.base45_payload}>
                              {truncateMiddle(minted.base45_payload, 36, 16)}
                            </span>
                          </div>
                          {minted.portability?.sd_jwt && (
                            <div>
                              <strong>SD-JWT (RFC 9901):</strong>{' '}
                              <span title={minted.portability.sd_jwt}>
                                {truncateMiddle(minted.portability.sd_jwt, 36, 16)}
                              </span>
                            </div>
                          )}
                          <div>
                            <strong>CGPA Audit:</strong> declared{' '}
                            {formatDecimal(proof.declared_cgpa, 2)} vs weighted{' '}
                            {formatDecimal(proof.weighted_exact_cgpa, 2)} ({proof.solver_id})
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-rule">
                          {minted.portability?.sd_jwt && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void copySdJwt()}
                            >
                              <CopyIconMorph copied={copiedKey === 'sd_jwt'} />
                              {copiedKey === 'sd_jwt' ? 'Copied SD-JWT' : 'Copy SD-JWT'}
                            </Button>
                          )}
                          {minted.portability?.w3c_vc_2_0 && (
                            <Button variant="secondary" size="sm" onClick={downloadW3cVcJson}>
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                              Export W3C VC 2.0
                            </Button>
                          )}
                          {confirmRevoke ? (
                            <>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={busy}
                                onClick={() => void handleRevoke()}
                              >
                                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                                Confirm revoke
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => setConfirmRevoke(false)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() => setConfirmRevoke(true)}
                            >
                              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                              Revoke pass
                            </Button>
                          )}
                        </div>
                      </div>
                    </DisclosureProof>
                  </div>
                </article>
              ) : (
                <div className="gazette-folio border-x border-b border-rule bg-surface px-6 py-6 space-y-4">
                  <div className="flex items-center justify-between gap-3 border-b border-rule-subtle pb-4">
                    <div className="flex items-center gap-2.5">
                      <PramaanSeal size={26} tone="light" />
                      <span className="font-display text-lg font-semibold text-ink">
                        Pass Preview
                      </span>
                    </div>
                    <span className="text-xs text-ink-muted tabular">
                      {minorLocked
                        ? 'Locked, guardian consent required'
                        : `${pluralize(effectiveDiscloseKeys.length, 'field')} selected`}
                    </span>
                  </div>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    {minorLocked
                      ? 'Guardian consent under DPDP Act Section 9 is required before a minor learner can issue a shareable credential pass. Ask your linked parent or guardian to grant scoped permission in the Parent Portal.'
                      : 'Enter the recipient name and issue a pass on the left to generate an offline-verifiable QR code containing only your chosen attributes.'}
                  </p>
                  <dl className="divide-y divide-rule-subtle text-sm">
                    <div className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-xs font-medium text-ink-secondary shrink-0">Holder</dt>
                      <dd
                        dir="auto"
                        className="font-semibold text-ink text-end min-w-0 wrap-anywhere"
                      >
                        {s.full_name}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-xs font-medium text-ink-secondary shrink-0">
                        Intended Recipient
                      </dt>
                      <dd
                        dir="auto"
                        className="font-medium text-ink text-end min-w-0 wrap-anywhere"
                      >
                        {effectiveGrantee.trim() || 'Not specified yet'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-xs font-medium text-ink-secondary shrink-0">
                        Selected Attributes
                      </dt>
                      <dd className="text-end text-ink-body min-w-0 wrap-anywhere">
                        {effectiveDiscloseKeys.length > 0
                          ? orderDisclosedKeys(effectiveDiscloseKeys)
                              .map((k) => humanizeClaimKey(k, isK12))
                              .join(', ')
                          : 'None selected'}
                      </dd>
                    </div>
                  </dl>
                  <DisclosureProof label="Registrar CGPA verification proof">
                    Declared {isK12 ? 'score' : 'CGPA'}: {formatDecimal(proof.declared_cgpa, 2)} |
                    Credit-weighted exact: {formatDecimal(proof.weighted_exact_cgpa, 2)} | Solver:{' '}
                    {proof.solver_id}
                  </DisclosureProof>
                </div>
              )}
            </div>
          </div>

          {(data.issued_passports?.length ?? 0) > 0 && (() => {
            const issuedList = data.issued_passports ?? [];
            const PASSES_PAGE_SIZE = 10;
            const passesTotalPages = Math.max(1, Math.ceil(issuedList.length / PASSES_PAGE_SIZE));
            const safePassesPage = Math.min(passesPage, passesTotalPages - 1);
            const pagePasses = issuedList.slice(
              safePassesPage * PASSES_PAGE_SIZE,
              (safePassesPage + 1) * PASSES_PAGE_SIZE,
            );
            return (
              <Sheet
                title="Issued Passes &amp; Revocation Ledger"
                subtitle="Passes previously issued for your roll number. Revoking an active pass immediately invalidates it on every recruiter verifier."
              >
                <div className="space-y-3">
                  <ul className="divide-y divide-rule-subtle border-y border-rule text-sm">
                    {pagePasses.map((p) => {
                      const isConfirming = confirmHistoryRevokeId === p.passport_id;
                      const isRevoking = revokingHistoryId === p.passport_id;
                      return (
                        <li
                          key={p.passport_id}
                          className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span dir="auto" className="font-semibold text-ink wrap-anywhere">
                                {p.grantee_name || 'Unspecified recipient'}
                              </span>
                              {p.revoked ? (
                                <StatusBadge tone="blocker">Revoked</StatusBadge>
                              ) : (
                                <StatusBadge tone="verified" quiet>
                                  Active
                                </StatusBadge>
                              )}
                            </div>
                            <div className="text-xs text-ink-secondary flex flex-wrap items-center gap-x-4 gap-y-0.5">
                              <span dir="ltr" className="font-mono" title={p.passport_id}>
                                {truncateMiddle(p.passport_id, 14, 6)}
                              </span>
                              <span>Issued {formatDateTime(p.issued_at)}</span>
                              {p.revoked && p.revoked_at && (
                                <span className="text-blocker">
                                  Revoked {formatDateTime(p.revoked_at)}
                                </span>
                              )}
                            </div>
                          </div>
                          {!p.revoked && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {isConfirming ? (
                                <>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={isRevoking}
                                    onClick={() => void handleRevokeHistoryPass(p.passport_id)}
                                  >
                                    <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                                    {isRevoking ? 'Revoking…' : 'Confirm revoke'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isRevoking}
                                    onClick={() => setConfirmHistoryRevokeId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={isRevoking}
                                  onClick={() => setConfirmHistoryRevokeId(p.passport_id)}
                                >
                                  <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                                  Revoke pass
                                </Button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <PaginationBar
                    page={safePassesPage}
                    totalPages={passesTotalPages}
                    onPageChange={setPassesPage}
                  />
                </div>
              </Sheet>
            );
          })()}
        </div>

        <div
          id="student-panel-preflight"
          role="tabpanel"
          aria-labelledby="student-tab-preflight"
          hidden={activeTab !== 'preflight'}
          className="space-y-8"
        >
          <StudentPreFlightPanel
            studentPrn={s.prn}
            draftFile={draftResumeFile}
            onDraftFileChange={setDraftResumeFile}
          />
        </div>

        <div
          id="student-panel-records"
          role="tabpanel"
          aria-labelledby="student-tab-records"
          hidden={activeTab !== 'records'}
          className="space-y-8"
        >
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 items-start">
            <Sheet
              title="Verified Academic Courses"
              subtitle={`${pluralize(s.courses.length, 'course')} recorded in registrar transcript`}
            >
              <DataTable
                rows={s.courses}
                rowKey={(r, i) => `${r.course_code}-${i}`}
                searchText={courseSearchText}
                searchPlaceholder="Search course code or title…"
                emptyTitle="No courses on record"
                emptyDescription="Completed or registered courses appear here once synchronized."
                columns={courseColumns}
              />
            </Sheet>

            <Sheet
              title="Attendance & Medical Condonation"
              subtitle={
                isExemptByCgpa && exemptThreshold !== null
                  ? `${pluralize(s.attendance.length, 'course log')}, exempt via CGPA ≥ ${formatDecimal(
                      exemptThreshold,
                      2,
                    )} ordinance`
                  : `${pluralize(s.attendance.length, 'course log')} audited against ${formatPercent(
                      minAtt,
                      1,
                    )} requirement`
              }
            >
              <DataTable
                rows={s.attendance}
                rowKey={(r, i) => `${r.course_code}-${i}`}
                searchText={attendanceSearchText}
                searchPlaceholder="Filter attendance courses…"
                emptyTitle="No attendance entries"
                emptyDescription="Session attendance logs have not been recorded yet."
                columns={attendanceColumns}
              />
            </Sheet>
          </div>

          {data.placement_benchmark && (() => {
            const pb = data.placement_benchmark;
            const rate =
              pb.opting_in_eligible > 0 ? (pb.placed_students / pb.opting_in_eligible) * 100 : 0;
            return (
              <Sheet
                title="Department Placement Reference"
                subtitle={`${pb.department} (${pb.academic_year})`}
                actions={
                  <StatusBadge tone="verified" quiet>
                    {formatPercent(rate, 1)} placed of {formatCount(pb.opting_in_eligible)} eligible
                  </StatusBadge>
                }
              >
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm tabular">
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Audited Median</dt>
                    <dd className="mt-0.5 font-bold text-ink">
                      ₹{formatDecimal(pb.median_ctc_lakhs, 2)} LPA
                    </dd>
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Highest Verified</dt>
                    <dd className="mt-0.5 font-bold text-ink">
                      ₹{formatDecimal(pb.highest_ctc_lakhs, 2)} LPA
                    </dd>
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Batch Cohort</dt>
                    <dd className="mt-0.5 font-semibold text-ink">
                      {formatCount(pb.placed_students)} / {formatCount(pb.batch_total)} total
                    </dd>
                  </div>
                </dl>
              </Sheet>
            );
          })()}

          {data.school_benchmark && (() => {
            const sb = data.school_benchmark;
            const certs = sb.appendix_ix_certificates;
            const classified = certs.map((cert) => ({
              cert,
              cls: classifyAppendixIxCert(cert, todayIso),
            }));
            const flaggedEntries = classified.filter(
              (e) => e.cls.state !== 'valid' && e.cls.state !== 'permanent',
            );
            const validCount = certs.length - flaggedEntries.length;
            const qcFailed = data.k12_qc_report ? !data.k12_qc_report.passed_all_gates : false;
            const z3Ok = data.z3_k12_proofs ? data.z3_k12_proofs.all_compliant : true;
            const missingAllCerts = certs.length === 0;
            const fullyCompliant =
              z3Ok && !qcFailed && !missingAllCerts && flaggedEntries.length === 0;
            const allFlaggedExpired =
              flaggedEntries.length > 0 && flaggedEntries.every((e) => e.cls.state === 'expired');
            const schoolSubtitle = [
              sb.board,
              sb.city_state?.trim(),
              sb.affiliation_qc_code ? `Affiliation ${sb.affiliation_qc_code}` : '',
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <Sheet
                title={humanizeSchoolLabel(sb.school_name)}
                subtitle={schoolSubtitle}
                actions={
                  <StatusBadge
                    tone={fullyCompliant ? 'verified' : 'blocker'}
                    quiet={fullyCompliant}
                  >
                    {missingAllCerts
                      ? '0 of 8 mandatory certificates on file'
                      : flaggedEntries.length > 0
                        ? pluralize(
                            flaggedEntries.length,
                            allFlaggedExpired
                              ? 'expired safety certificate'
                              : 'flagged safety certificate',
                          )
                        : fullyCompliant
                          ? 'CBSE Clause 4.1 compliant'
                          : 'Statutory threshold breach'}
                  </StatusBadge>
                }
              >
                <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3 text-sm tabular">
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Enrolled Learners &amp; Staff</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">
                      {formatCount(sb.enrolled_students)} / {formatCount(sb.core_teaching_staff)}
                    </dd>
                    {data.z3_k12_proofs && (
                      <div className="mt-0.5 text-xs text-ink-secondary">
                        Pupil–Teacher Ratio: {formatDecimal(data.z3_k12_proofs.computed_ptr, 2)}:1
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Classroom Area &amp; Peak Section</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">
                      {formatCount(sb.classroom_area_sqft)} sq ft, max{' '}
                      {formatCount(sb.max_section_size)}
                    </dd>
                    {data.z3_k12_proofs && (
                      <div className="mt-0.5 text-xs text-ink-secondary">
                        {formatDecimal(data.z3_k12_proofs.sqm_per_student, 2)} m² / learner
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Appendix IX Safety Certificates</dt>
                    <dd
                      className={`mt-1 text-lg font-bold ${
                        missingAllCerts || flaggedEntries.length > 0 ? 'text-blocker' : 'text-ink'
                      }`}
                    >
                      {missingAllCerts
                        ? '0 of 8 mandatory certificates on file'
                        : `${formatCount(validCount)} of ${formatCount(certs.length)} valid`}
                    </dd>
                    <div className="mt-0.5 text-xs text-ink-secondary">
                      {missingAllCerts ? (
                        <span className="font-medium text-blocker">
                          Mandatory Section B certificates missing
                        </span>
                      ) : flaggedEntries.length > 0 ? (
                        <span className="font-medium text-blocker">
                          {pluralize(flaggedEntries.length, 'expired / flagged certificate')}
                        </span>
                      ) : (
                        <>UDISE+ {sb.udise_qc_code}</>
                      )}
                    </div>
                  </div>
                </dl>
                {flaggedEntries.length > 0 && (
                  <div
                    role="alert"
                    aria-atomic="true"
                    className="mt-4 border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-xs text-blocker space-y-1.5"
                  >
                    <div className="font-semibold">
                      Mandatory school safety certificates requiring action:
                    </div>
                    <ul className="space-y-1">
                      {flaggedEntries.map(({ cert: c, cls }, idx) => (
                        <li key={`${c.doc_code}-${idx}`} className="wrap-anywhere">
                          <span className="font-mono font-semibold">{c.doc_code}</span> {c.title}:{' '}
                          {cls.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Sheet>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
