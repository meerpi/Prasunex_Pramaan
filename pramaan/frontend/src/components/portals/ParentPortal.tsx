import { useMemo, useState } from 'react';
import { ExternalLink, Lock, Plus, ShieldOff } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { ParentPortalData, StudentErpRecord } from '../../api/types.ts';
import {
  classifyAppendixIxCert,
  formatCount,
  formatDate,
  formatDecimal,
  humanizeClaimKey,
  humanizeSchoolLabel,
  isIsoDateExpired,
  pluralize,
  todayIstIso,
} from '../../utils/format.ts';
import { Button, EmptyState, ExpandableText, PaginationBar, Sheet, StatusBadge } from '../ui/index.ts';

interface ParentPortalProps {
  data: ParentPortalData;
  onRefresh: () => void;
}

const CONSENTABLE_CLAIMS = [
  'full_name',
  'program',
  'batch_year',
  'cgpa',
  'active_backlogs',
  'attendance_pct',
  'degree_status',
] as const;

export function ParentPortal({ data, onRefresh }: ParentPortalProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [vpcNotice, setVpcNotice] = useState('');

  // Inline form for creating a real DPDP consent record for a linked ward
  const [showCreate, setShowCreate] = useState(false);
  const [wardPrn, setWardPrn] = useState(data.children[0]?.prn ?? '');
  const [granteeName, setGranteeName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [claims, setClaims] = useState<string[]>(['program', 'degree_status']);
  const [creating, setCreating] = useState(false);
  const [wardsPage, setWardsPage] = useState(0);
  const [consentPage, setConsentPage] = useState(0);

  const wardByPrn = useMemo(() => {
    const map = new Map<string, StudentErpRecord>();
    for (const ch of data.children) map.set(ch.prn, ch);
    return map;
  }, [data.children]);

  const wardPageSize = 10;
  const totalWardPages = Math.max(1, Math.ceil(data.children.length / wardPageSize));
  const safeWardPage = Math.min(wardsPage, totalWardPages - 1);
  const visibleWards = data.children.slice(
    safeWardPage * wardPageSize,
    (safeWardPage + 1) * wardPageSize,
  );

  const consentPageSize = 25;
  const totalConsentPages = Math.max(1, Math.ceil(data.consents.length / consentPageSize));
  const safeConsentPage = Math.min(consentPage, totalConsentPages - 1);
  const visibleConsents = data.consents.slice(
    safeConsentPage * consentPageSize,
    (safeConsentPage + 1) * consentPageSize,
  );
  const todayIso = todayIstIso();

  const effectiveWardPrn = wardByPrn.has(wardPrn) ? wardPrn : data.children[0]?.prn ?? '';
  const selectedWard = wardByPrn.get(effectiveWardPrn);
  const selectedWardIsK12 = selectedWard?.education_level === 'K12';

  const handleToggle = async (consentId: string, currentlyRevoked: boolean) => {
    setBusyId(consentId);
    setErr('');
    setVpcNotice('');
    try {
      await api.toggleConsent(consentId, !currentlyRevoked);
      setConfirmRevokeId(null);
      setVpcNotice(
        currentlyRevoked ? 'Guardian consent approved.' : 'Third-party access revoked.',
      );
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to update consent state');
    } finally {
      setBusyId(null);
    }
  };

  const handleDigiLockerRedirect = async (consentId: string) => {
    setBusyId(consentId);
    setErr('');
    setVpcNotice('');
    try {
      const challenge = await api.initDigiLockerConsent(consentId);
      window.location.assign(challenge.authorize_url);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to start DigiLocker verification');
      setBusyId(null);
    }
  };

  const handleCreateConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveWardPrn || !granteeName.trim() || !purpose.trim() || !expiresAt.trim() || claims.length === 0) {
      return;
    }
    setCreating(true);
    setErr('');
    setVpcNotice('');
    try {
      await api.createConsent({
        student_prn: effectiveWardPrn,
        grantee_name: granteeName.trim(),
        allowed_claims: claims,
        purpose: purpose.trim(),
        expires_at: expiresAt.trim(),
        revoked: false,
      });
      setGranteeName('');
      setPurpose('');
      setExpiresAt('');
      setShowCreate(false);
      setVpcNotice('Consent permission recorded for linked ward.');
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to save consent permission');
    } finally {
      setCreating(false);
    }
  };

  const disc = data.brochure_vs_erp_discrepancy;
  const brochureText = disc?.brochure_claim.trim() ?? '';
  const erpText = disc?.erp_verified.trim() ?? '';
  const hasComparison = Boolean(brochureText && erpText);
  const hasVariance = hasComparison && brochureText !== erpText;

  const pt = data.placement_truth;
  const erpPct =
    pt && pt.opting_in_eligible > 0 ? (pt.placed_students / pt.opting_in_eligible) * 100 : null;
  const pctMatch = brochureText.match(/(\d+(?:\.\d+)?)\s*%/);
  const claimedPct = pctMatch ? Number(pctMatch[1]) : null;
  const ctcMatch = brochureText.match(/(?:Rs\.?|INR|₹)\s*(\d+(?:\.\d+)?)\s*Lakhs?/i);
  const claimedCtc = ctcMatch ? Number(ctcMatch[1]) : null;
  const digilockerConfigured = Boolean(data.digilocker_configured);

  return (
    <div className="space-y-9 min-w-0">
      <header className="gazette-header space-y-1.5">
        <h1 dir="auto" className="font-display text-3xl sm:text-4xl font-semibold text-ink wrap-anywhere">
          Parent Portal
        </h1>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-secondary wrap-anywhere">
          <span>
            Guardian: <strong className="text-ink">{data.guardian}</strong>
          </span>
          <span>{pluralize(data.children.length, 'linked ward')}</span>
          <span>{pluralize(data.consents.length, 'data-sharing permission')}</span>
        </div>
      </header>

      {err && (
        <div
          role="alert"
          aria-atomic="true"
          className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker"
        >
          {err}
        </div>
      )}

      {vpcNotice && (
        <div
          role="status"
          aria-atomic="true"
          className="border-y border-verified-border bg-verified-bg px-4 py-2.5 text-sm font-medium text-verified-ink"
        >
          {vpcNotice}
        </div>
      )}

      {/* Brochure vs ERP Comparison ONLY when real institutional records exist */}
      {(hasComparison || pt) && (
        <Sheet
          tone="paper"
          title="Published Brochure vs. Audited Institutional Record"
          subtitle="Promotional placement figures checked directly against the registrar’s audited student denominator."
          actions={
            hasVariance ? (
              <StatusBadge tone="blocker">Discrepancy Flagged</StatusBadge>
            ) : hasComparison ? (
              <StatusBadge tone="verified" quiet>
                Figures match institutional record
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral" quiet>
                Awaiting uploaded prospectus PDF
              </StatusBadge>
            )
          }
          bodyClassName="p-0"
        >
          <div className="grid grid-cols-1 divide-y divide-rule md:grid-cols-2 md:divide-y-0 md:divide-x rtl:divide-x-reverse">
            <div className="px-6 py-5 space-y-3.5 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-ink">Published Admissions Brochure</span>
                <span className="text-xs font-mono text-ink-muted truncate max-w-[200px]" title={disc?.brochure_filename || 'Uploaded PDF extract'}>
                  {disc?.brochure_filename || 'Uploaded PDF extract'}
                </span>
              </div>

              {brochureText ? (
                <>
                  {(claimedPct !== null || claimedCtc !== null) && (
                    <div className="flex flex-wrap items-baseline gap-8 tabular">
                      {claimedPct !== null && (
                        <div>
                          <div
                            className={`font-display text-3xl font-semibold ${
                              hasVariance ? 'text-blocker' : 'text-ink'
                            }`}
                          >
                            {claimedPct.toFixed(0)}%
                          </div>
                          <div className="mt-0.5 text-xs text-ink-secondary">Claimed placement</div>
                        </div>
                      )}
                      {claimedCtc !== null && (
                        <div>
                          <div
                            className={`font-display text-3xl font-semibold ${
                              hasVariance ? 'text-blocker' : 'text-ink'
                            }`}
                          >
                            ₹{formatDecimal(claimedCtc, 2)}L
                          </div>
                          <div className="mt-0.5 text-xs text-ink-secondary">Stated package</div>
                        </div>
                      )}
                    </div>
                  )}
                  <blockquote className="font-display text-base text-ink-body italic leading-relaxed wrap-anywhere">
                    “{brochureText}”
                  </blockquote>
                </>
              ) : (
                <p className="text-sm text-ink-secondary leading-relaxed">
                  No admissions brochure or prospectus PDF has been uploaded to the Claim Reconciler
                  by this institution yet.
                </p>
              )}
            </div>

            <div className="px-6 py-5 space-y-3.5 min-w-0 bg-subtle/35">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-verified">Audited Institutional Record</span>
                <span className="text-xs text-ink-muted">Verified against Registrar ERP</span>
              </div>

              {pt && erpPct !== null ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-8 tabular">
                    <div>
                      <div className="flex flex-wrap items-baseline gap-2.5">
                        <span className="font-display text-3xl font-semibold text-ink">
                          {erpPct.toFixed(1)}%
                        </span>
                        {claimedPct !== null && Math.abs(claimedPct - erpPct) >= 1 && (() => {
                          const delta = erpPct - claimedPct;
                          return (
                            <StatusBadge tone={delta < 0 ? 'blocker' : 'warn'} mono>
                              {delta >= 0 ? `+${delta.toFixed(1)}` : `-${Math.abs(delta).toFixed(1)}`} pp
                            </StatusBadge>
                          );
                        })()}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-secondary">
                        {formatCount(pt.placed_students)} of {formatCount(pt.opting_in_eligible)}{' '}
                        eligible students
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-baseline gap-2.5">
                        <span className="font-display text-3xl font-semibold text-ink">
                          ₹{formatDecimal(pt.median_ctc_lakhs, 2)}L
                        </span>
                        {claimedCtc !== null && Math.abs(claimedCtc - pt.median_ctc_lakhs) >= 0.5 && (() => {
                          const delta = pt.median_ctc_lakhs - claimedCtc;
                          return (
                            <StatusBadge tone={delta < 0 ? 'blocker' : 'warn'} mono>
                              {delta >= 0 ? `+₹${formatDecimal(delta, 2)}L` : `-₹${formatDecimal(Math.abs(delta), 2)}L`}
                            </StatusBadge>
                          );
                        })()}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-secondary">Median domestic salary</div>
                    </div>
                  </div>
                  <p className="text-sm text-ink-body leading-relaxed wrap-anywhere">{erpText}</p>
                </>
              ) : (
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Placement cell records have not been published by the registrar yet.
                </p>
              )}
            </div>
          </div>
        </Sheet>
      )}

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[0.88fr_1.12fr] items-start">
        <div className="space-y-8 min-w-0">
          <Sheet
            title="Linked Wards"
            subtitle={`${pluralize(data.children.length, 'enrolled ward')} under your guardianship`}
          >
            {data.children.length === 0 ? (
              <EmptyState
                title="No wards linked yet"
                description="Ask your school or university registrar to link your guardian username to your dependent student record."
              />
            ) : (
              <div className="space-y-3">
                <ul className="divide-y divide-rule-subtle border-y border-rule">
                  {visibleWards.map((child) => (
                    <li key={child.prn} className="py-4 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="min-w-0">
                          <div dir="auto" className="text-base font-bold text-ink wrap-anywhere">
                            {child.full_name}
                          </div>
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-ink-secondary wrap-anywhere">
                            <span>{child.program}</span>
                            <span className="font-mono text-ink">{child.prn}</span>
                          </div>
                        </div>
                        {child.is_minor ? (
                          <StatusBadge tone="warn">Minor ({child.age_years}y)</StatusBadge>
                        ) : (
                          <span className="text-xs font-medium text-ink-secondary">
                            Adult ({child.age_years}y)
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-6 text-sm text-ink-secondary tabular">
                        <span>
                          {child.education_level === 'K12' ? 'Academic Score' : 'CGPA'}:{' '}
                          <strong className="text-ink">{formatDecimal(child.declared_cgpa, 2)}</strong>
                        </span>
                        <span>
                          Backlogs: <strong className="text-ink">{formatCount(child.active_backlogs)}</strong>
                        </span>
                        <span>
                          Courses: <strong className="text-ink">{formatCount(child.courses.length)}</strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <PaginationBar
                  page={safeWardPage}
                  totalPages={totalWardPages}
                  onPageChange={setWardsPage}
                />
              </div>
            )}
          </Sheet>

          {data.school_disclosure && (() => {
            const certs = data.school_disclosure.appendix_ix_certificates;
            const classified = certs.map((cert) => ({
              cert,
              cls: classifyAppendixIxCert(cert, todayIso),
            }));
            const flaggedEntries = classified.filter(
              (e) => e.cls.state !== 'valid' && e.cls.state !== 'permanent',
            );
            const validCount = certs.length - flaggedEntries.length;
            const qcFailed = data.k12_qc_report ? !data.k12_qc_report.passed_all_gates : false;
            const missingAllCerts = certs.length === 0;
            const hasSafetyBreach = missingAllCerts || flaggedEntries.length > 0 || qcFailed;
            const allFlaggedExpired =
              flaggedEntries.length > 0 && flaggedEntries.every((e) => e.cls.state === 'expired');
            return (
              <Sheet
                title="School Safety & Public Disclosure"
                subtitle={`${humanizeSchoolLabel(data.school_disclosure.school_name)}, ${data.school_disclosure.board}`}
                actions={
                  hasSafetyBreach ? (
                    <StatusBadge tone="blocker">
                      {missingAllCerts
                        ? '0 of 8 mandatory certificates on file'
                        : flaggedEntries.length > 0
                          ? pluralize(
                              flaggedEntries.length,
                              allFlaggedExpired ? 'expired certificate' : 'flagged certificate',
                            )
                          : 'Statutory safety breach'}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="verified" quiet>
                      {formatCount(validCount)} of {formatCount(certs.length)} safety certificates valid
                    </StatusBadge>
                  )
                }
              >
                <dl className="grid grid-cols-1 gap-4 border-y border-rule py-4 sm:grid-cols-3 text-sm tabular">
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Enrolled / Teachers</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">
                      {formatCount(data.school_disclosure.enrolled_students)} /{' '}
                      {formatCount(data.school_disclosure.core_teaching_staff)}
                    </dd>
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Peak Section</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">
                      {formatCount(data.school_disclosure.max_section_size)} max
                    </dd>
                  </div>
                  <div className="min-w-0 wrap-anywhere">
                    <dt className="text-xs text-ink-secondary">Classroom Area</dt>
                    <dd className="mt-1 text-lg font-bold text-ink">
                      {formatCount(data.school_disclosure.classroom_area_sqft)} sq ft
                    </dd>
                  </div>
                </dl>
                {missingAllCerts ? (
                  <div
                    role="alert"
                    aria-atomic="true"
                    className="mt-4 border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-xs font-medium text-blocker"
                  >
                    0 of 8 mandatory Appendix IX safety certificates are on file for this school.
                  </div>
                ) : (
                  flaggedEntries.length > 0 && (
                    <div
                      role="alert"
                      aria-atomic="true"
                      className="mt-4 border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-xs text-blocker space-y-1.5"
                    >
                      <div className="font-semibold">
                        Mandatory Appendix IX safety certificates requiring attention (
                        {formatCount(validCount)} of {formatCount(certs.length)} valid):
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
                  )
                )}
              </Sheet>
            );
          })()}
        </div>

        <Sheet
          title="Third-Party Data Permissions"
          subtitle="Control which organizations can verify your wards’ academic records. Revoking takes effect immediately."
          actions={
            data.children.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCreate((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                {showCreate ? 'Cancel' : 'Grant Permission'}
              </Button>
            )
          }
        >
          <div className="space-y-5">
            {showCreate && data.children.length > 0 && (
              <form
                onSubmit={handleCreateConsent}
                className="space-y-3 border-y border-rule bg-subtle/40 px-4 py-4 text-sm"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="consent-ward" className="block text-xs font-semibold text-ink">
                      Ward
                    </label>
                    <select
                      id="consent-ward"
                      value={effectiveWardPrn}
                      onChange={(e) => setWardPrn(e.target.value)}
                      className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink"
                    >
                      {data.children.map((ch) => (
                        <option key={ch.prn} value={ch.prn}>
                          {ch.full_name} ({ch.prn})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="consent-exp" className="block text-xs font-semibold text-ink">
                      Valid until
                    </label>
                    <input
                      id="consent-exp"
                      type="date"
                      required
                      min={todayIso}
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="consent-grantee" className="block text-xs font-semibold text-ink">
                    Exact recipient organization name
                  </label>
                  <input
                    id="consent-grantee"
                    name="grantee_name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={160}
                    value={granteeName}
                    onChange={(e) => setGranteeName(e.target.value)}
                    placeholder="Enter exact recipient organization name"
                    className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted"
                  />
                </div>

                <div>
                  <label htmlFor="consent-purpose" className="block text-xs font-semibold text-ink">
                    Purpose of disclosure
                  </label>
                  <input
                    id="consent-purpose"
                    name="purpose"
                    type="text"
                    required
                    minLength={3}
                    maxLength={256}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Describe verification purpose (e.g., scholarship review)"
                    className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted"
                  />
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-semibold text-ink">Allowed attributes</legend>
                  <div className="flex flex-wrap gap-3">
                    {CONSENTABLE_CLAIMS.map((ck) => {
                      const checked = claims.includes(ck);
                      return (
                        <label
                          key={ck}
                          htmlFor={`consent-claim-${ck}`}
                          className="inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 text-xs text-ink cursor-pointer"
                        >
                          <input
                            id={`consent-claim-${ck}`}
                            name={`consent_claim_${ck}`}
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setClaims((prev) =>
                                prev.includes(ck) ? prev.filter((x) => x !== ck) : [...prev, ck],
                              )
                            }
                            className="h-4 w-4 accent-action"
                          />
                          <span>{humanizeClaimKey(ck, selectedWardIsK12)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={creating || claims.length === 0}
                >
                  {creating ? 'Saving…' : 'Save Guardian Consent'}
                </Button>
              </form>
            )}

            {!digilockerConfigured && data.consents.length > 0 && (
              <p className="text-xs text-ink-secondary border-y border-rule-subtle bg-subtle/40 px-3.5 py-2">
                Guardian permissions are recorded immediately in your school’s official ledger.
              </p>
            )}

            {data.consents.length === 0 ? (
              <EmptyState
                title="No active third-party permissions"
                description="Grant a scoped permission above when an employer, scholarship desk, or competition board requests verified ward records."
              />
            ) : (
              <div className="space-y-3">
                <ul className="divide-y divide-rule border-y border-rule">
                  {visibleConsents.map((c) => {
                    const expired = !c.revoked && isIsoDateExpired(c.expires_at, todayIso);
                    const active = !c.revoked && !expired;
                    const ward = wardByPrn.get(c.student_prn);
                    const isMinorWard = Boolean(ward?.is_minor);
                    const wardIsK12 = ward?.education_level === 'K12';
                    const isConfirmingRevoke = confirmRevokeId === c.consent_id;
                    const isBusy = busyId === c.consent_id;
                    return (
                      <li
                        key={c.consent_id}
                        data-ward-prn={c.student_prn}
                        className="py-5 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div dir="auto" className="text-base font-bold text-ink wrap-anywhere">
                              {c.grantee_name}
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs font-medium text-ink-secondary">
                              <span>
                                {ward ? (
                                  <>
                                    For <bdi>{ward.full_name}</bdi>
                                  </>
                                ) : (
                                  c.student_prn
                                )}
                                {isMinorWard ? ' (Minor under 18)' : ''}
                              </span>
                              <span>
                                {expired ? 'Expired' : 'Expires'} {formatDate(c.expires_at)}
                              </span>
                            </div>
                          </div>
                          {active ? (
                            <StatusBadge tone="verified" quiet>
                              Permission active
                            </StatusBadge>
                          ) : expired ? (
                            <StatusBadge tone="warn">Expired</StatusBadge>
                          ) : (
                            <StatusBadge tone="blocker" icon={<Lock className="h-3.5 w-3.5" />}>
                              Locked / Revoked
                            </StatusBadge>
                          )}
                        </div>

                        <p className="text-sm text-ink-body leading-relaxed">
                          <ExpandableText text={c.purpose} maxChars={280} preserveLines />
                        </p>

                        <div className="text-xs text-ink-secondary wrap-anywhere">
                          <span className="font-semibold text-ink">Shared attributes:</span>{' '}
                          {c.allowed_claims
                            .map((k) => humanizeClaimKey(k, wardIsK12))
                            .join(', ')}
                        </div>

                        {c.digilocker_verified && c.digilocker_tx_id && (
                          <p className="text-xs text-verified wrap-anywhere">
                            Verified via DigiLocker (Receipt {c.digilocker_tx_id})
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {digilockerConfigured && !expired && (!c.digilocker_verified || c.revoked) && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleDigiLockerRedirect(c.consent_id)}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Verify via DigiLocker
                            </Button>
                          )}

                          {!expired && active ? (
                            isConfirmingRevoke ? (
                              <>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() => void handleToggle(c.consent_id, c.revoked)}
                                >
                                  <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                                  {isBusy ? 'Revoking…' : 'Confirm revoke'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() => setConfirmRevokeId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => setConfirmRevokeId(c.consent_id)}
                              >
                                Revoke access
                              </Button>
                            )
                          ) : (
                            !expired && (
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => void handleToggle(c.consent_id, c.revoked)}
                              >
                                {isBusy ? 'Updating…' : 'Approve consent'}
                              </Button>
                            )
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <PaginationBar
                  page={safeConsentPage}
                  totalPages={totalConsentPages}
                  onPageChange={setConsentPage}
                />
              </div>
            )}
          </div>
        </Sheet>
      </div>
    </div>
  );
}
