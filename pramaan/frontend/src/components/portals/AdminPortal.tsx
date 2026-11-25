import { Suspense, lazy, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Plus } from 'lucide-react';
import type { AdminInstitutionalData, AppendixIxCertificate } from '../../api/types.ts';
import type { WorkspaceTab } from '../BrandHeader.tsx';
import {
  classifyAppendixIxCert,
  formatCount,
  formatDate,
  formatDecimal,
  formatInr,
  humanizeClaimKey,
  humanizeGateId,
  humanizeSchoolLabel,
  pluralize,
  todayIstIso,
} from '../../utils/format.ts';
import {
  Button,
  DataTable,
  DisclosureProof,
  EmptyState,
  SegmentedTabs,
  Sheet,
  StatusBadge,
} from '../ui/index.ts';

const AdminRegisterForms = lazy(() =>
  import('./AdminRegisterForms.tsx').then((m) => ({ default: m.AdminRegisterForms })),
);

interface AdminPortalProps {
  data: AdminInstitutionalData;
  onRefresh: () => void;
  onSelectTab?: (tab: WorkspaceTab) => void;
}

export function AdminPortal({ data, onRefresh, onSelectTab }: AdminPortalProps) {
  const m = data.metrics;
  const z3 = data.z3_proofs;
  const hasK12 = Boolean(data.k12_disclosure);
  const [scope, setScope] = useState<'hei' | 'k12' | 'manage'>(
    m ? 'hei' : hasK12 ? 'k12' : 'manage',
  );

  const headsBalanced = Boolean(z3?.criterion4_balanced);
  const todayIso = todayIstIso();

  const budgetRows = useMemo(
    () =>
      Object.entries(m?.budget_heads ?? {}).map(([head, amountCr]) => ({
        head,
        amountCr,
      })),
    [m?.budget_heads],
  );

  const totalBudgetCr = useMemo(
    () =>
      budgetRows.reduce((acc, r) => acc + Math.max(0, r.amountCr), 0) ||
      m?.criterion4_infra_spend_crores ||
      1,
    [budgetRows, m?.criterion4_infra_spend_crores],
  );

  const budgetColumns = useMemo(
    () => [
      {
        key: 'head',
        header: 'Infrastructure Budget Head',
        render: (r: { head: string; amountCr: number }) => {
          const share = Math.min(1, Math.max(0, r.amountCr / totalBudgetCr));
          return (
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2">
                <span className="font-medium text-ink wrap-anywhere">
                  {humanizeClaimKey(r.head)}
                </span>
                <span className="font-mono text-xs text-ink-muted tabular shrink-0">
                  {(share * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-[3px] w-full overflow-hidden bg-trough">
                <div
                  className="gauge-fill h-full w-full bg-action"
                  style={{ transform: `scaleX(${share})` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        key: 'amt',
        header: 'Allocation',
        align: 'right' as const,
        render: (r: { head: string; amountCr: number }) => (
          <span dir="ltr" className="font-bold text-ink whitespace-nowrap">
            {formatInr(r.amountCr, ' Cr')}
          </span>
        ),
      },
    ],
    [totalBudgetCr],
  );

  const certColumns = useMemo(
    () => [
      {
        key: 'code',
        header: 'Mandatory Document',
        sortValue: (c: AppendixIxCertificate) => c.doc_code,
        render: (c: AppendixIxCertificate) => (
          <div>
            <span className="font-mono text-xs text-ink-secondary">
              {c.doc_code} ({c.section})
            </span>
            <div dir="auto" className="font-medium text-ink">
              {c.title}
            </div>
          </div>
        ),
      },
      {
        key: 'auth',
        header: 'Issuing Authority',
        render: (c: AppendixIxCertificate) => c.issuing_authority?.trim() || '—',
      },
      {
        key: 'valid',
        header: 'Valid Until',
        sortValue: (c: AppendixIxCertificate) => c.valid_until,
        render: (c: AppendixIxCertificate) => (
          <span dir="ltr" className="font-mono text-xs whitespace-nowrap">
            {formatDate(c.valid_until)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        align: 'right' as const,
        cellClassName: 'whitespace-nowrap',
        sortValue: (c: AppendixIxCertificate) => c.status,
        render: (c: AppendixIxCertificate) => {
          const cls = classifyAppendixIxCert(c, todayIso);
          return cls.state === 'valid' || cls.state === 'permanent' ? (
            <StatusBadge tone="verified" quiet>
              {cls.label}
            </StatusBadge>
          ) : (
            <StatusBadge tone="blocker">{cls.label}</StatusBadge>
          );
        },
      },
    ],
    [todayIso],
  );

  const sectionAtCap =
    data.k12_disclosure &&
    data.z3_k12_proofs?.section_cap_within_40 &&
    data.k12_disclosure.max_section_size >= 40;

  return (
    <div className="space-y-8 min-w-0">
      <header className="gazette-header flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="min-w-[min(100%,18rem)] flex-1 space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Institutional Statutory Ledger
          </h1>
          <p className="text-sm text-ink-secondary wrap-anywhere">
            {m ? (
              <>
                Academic Year {m.academic_year}, Fiscal {m.fiscal_year} — NAAC Grade{' '}
                <strong className="text-ink">{m.naac_grade}</strong> (Valid through{' '}
                {formatDate(m.naac_cycle_valid_until)})
              </>
            ) : (
              <>
                {pluralize(data.students_count ?? 0, 'student record')},{' '}
                {pluralize(data.faculty_count ?? 0, 'faculty record')},{' '}
                {pluralize(data.revocations_count, 'revoked pass')}
              </>
            )}
          </p>
        </div>

        <SegmentedTabs
          ariaLabel="Statutory disclosure scope"
          idPrefix="admin-scope-tab"
          value={scope}
          onChange={setScope}
          options={[
            {
              id: 'hei' as const,
              label: 'Higher Education (NAAC / NIRF)',
              panelId: 'admin-scope-panel-hei',
            },
            ...(hasK12
              ? [
                  {
                    id: 'k12' as const,
                    label: 'K-12 School (CBSE)',
                    panelId: 'admin-scope-panel-k12',
                    badge: sectionAtCap ? (
                      <>
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-warn-accent"
                          aria-hidden="true"
                        />
                        <span className="sr-only"> (statutory attention required)</span>
                      </>
                    ) : undefined,
                  },
                ]
              : []),
            {
              id: 'manage' as const,
              label: 'Manage Registers',
              panelId: 'admin-scope-panel-manage',
            },
          ]}
        />
      </header>

      {scope === 'manage' ? (
        <div
          id="admin-scope-panel-manage"
          role="tabpanel"
          aria-labelledby="admin-scope-tab-manage"
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex items-center gap-2.5 border-y border-rule py-6 text-sm text-ink-secondary"
              >
                <Loader2 className="h-4 w-4 animate-spin text-action" aria-hidden="true" />
                <span>Loading register editor…</span>
              </div>
            }
          >
            <AdminRegisterForms
              existingMetrics={m ?? null}
              existingPlacement={data.placement ?? null}
              existingK12={data.k12_disclosure ?? null}
              onSaved={() => {
                onRefresh();
              }}
            />
          </Suspense>
        </div>
      ) : scope === 'hei' ? (
        <div
          id="admin-scope-panel-hei"
          role="tabpanel"
          aria-labelledby="admin-scope-tab-hei"
        >
        {!m || !z3 ? (
          <EmptyState
            title="No institutional metrics entered yet"
            description="Record your institution’s academic year, NAAC accreditation cycle, faculty count, placement denominator, and student roster under Manage Registers to populate live statutory proofs."
            action={
              <Button variant="primary" onClick={() => setScope('manage')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Enter Institutional Registers
              </Button>
            }
          />
        ) : (
          <div className="space-y-9">
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-rule bg-rule-subtle shadow-[var(--shadow-sheet)] sm:grid-cols-[repeat(auto-fit,minmax(12.25rem,1fr))] tabular">
              <div className="min-w-0 bg-surface p-4">
                <dt className="text-xs font-medium text-ink-secondary">Enrolled Learners</dt>
                <dd className="mt-1 font-display text-2xl font-semibold text-ink wrap-anywhere">
                  {formatCount(m.enrolled_learners)}
                </dd>
                <div className="mt-1 text-xs text-ink-muted">
                  {formatCount(m.regular_faculty_count)} regular faculty
                </div>
              </div>
              <div className="min-w-0 bg-surface p-4">
                <dt className="text-xs font-medium text-ink-secondary">Student–Faculty Ratio</dt>
                <dd
                  dir="ltr"
                  className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                    z3.sfr_within_15_to_1 ? 'text-ink' : 'text-blocker'
                  }`}
                >
                  {formatDecimal(z3.computed_sfr, 2)}:1
                </dd>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-trough">
                  <div
                    className={`gauge-fill h-full w-full ${
                      z3.sfr_within_15_to_1 ? 'bg-action' : 'bg-blocker-strong'
                    }`}
                    style={{ transform: `scaleX(${Math.min(1, Math.max(0, z3.computed_sfr / 15))})` }}
                  />
                </div>
                <div className="mt-1.5">
                  {z3.sfr_within_15_to_1 ? (
                    <StatusBadge tone="verified" quiet>
                      Within 15:1 norm
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="blocker">Exceeds 15:1 ceiling</StatusBadge>
                  )}
                </div>
              </div>
              <div className="min-w-0 bg-surface p-4">
                <dt className="text-xs font-medium text-ink-secondary">Criterion IV Spend</dt>
                <dd
                  dir="ltr"
                  className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                    headsBalanced ? 'text-ink' : 'text-blocker'
                  }`}
                >
                  {formatInr(z3.criterion4_declared_crores, ' Cr')}
                </dd>
                <div className="mt-1.5">
                  {headsBalanced ? (
                    <StatusBadge tone="verified" quiet>
                      Cross-foot balanced
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="blocker">
                      Sum {formatInr(z3.criterion4_heads_sum_crores, ' Cr')}
                    </StatusBadge>
                  )}
                </div>
              </div>
              <div className="min-w-0 bg-surface p-4">
                <dt className="text-xs font-medium text-ink-secondary">Sponsored R&amp;D Grants</dt>
                <dd dir="ltr" className="mt-1 font-display text-2xl font-semibold text-ink wrap-anywhere">
                  {formatInr(z3.total_faculty_grants_lakhs, 'L')}
                </dd>
                <div className="mt-1 text-xs text-ink-muted">Verified faculty register</div>
              </div>
              <div className="min-w-0 bg-surface p-4">
                <dt className="text-xs font-medium text-ink-secondary">Revoked Passes</dt>
                <dd className="mt-1 font-display text-2xl font-semibold text-ink wrap-anywhere">
                  {formatCount(data.revocations_count)}
                </dd>
                <div className="mt-1 text-xs text-ink-muted">Live revocation list</div>
              </div>
            </dl>

            <div className="grid grid-cols-1 gap-10 2xl:grid-cols-[1.05fr_0.95fr] items-start">
              <Sheet
                title="Criterion IV Expenditure Breakdown"
                subtitle={`${pluralize(budgetRows.length, 'budget head')} totaling ₹${formatDecimal(
                  m.criterion4_infra_spend_crores,
                  2,
                )} Cr`}
              >
                {budgetRows.length === 0 ? (
                  <EmptyState
                    title="No expenditure heads recorded"
                    description="Add itemized Criterion IV budget heads in Manage Registers to run cross-foot proofs."
                  />
                ) : (
                  <DataTable
                    rows={budgetRows}
                    rowKey={(r) => r.head}
                    dense
                    columns={budgetColumns}
                  />
                )}
              </Sheet>

              {data.placement ? (() => {
                const pl = data.placement;
                const eligiblePct =
                  pl.batch_total > 0 ? (pl.opting_in_eligible / pl.batch_total) * 100 : 0;
                const placedPct =
                  pl.opting_in_eligible > 0 ? (pl.placed_students / pl.opting_in_eligible) * 100 : 0;
                const placedOfBatchPct =
                  pl.batch_total > 0 ? (pl.placed_students / pl.batch_total) * 100 : 0;
                return (
                  <Sheet
                    title={`Placement Denominator Audit — ${pl.department}`}
                    subtitle={`${pl.academic_year}, verified against Placement Cell ERP`}
                    actions={
                      onSelectTab && (
                        <Button variant="secondary" size="sm" onClick={() => onSelectTab('graph')}>
                          Check brochure conflicts
                          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                        </Button>
                      )
                    }
                  >
                    <div className="space-y-6">
                      <div className="space-y-2.5 tabular">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="font-bold text-ink">
                            {placedPct.toFixed(1)}% placed ({formatCount(pl.placed_students)} of{' '}
                            {formatCount(pl.opting_in_eligible)} opting-in)
                          </span>
                          <span className="font-mono text-xs text-ink-secondary">
                            {formatCount(pl.batch_total)} total batch
                          </span>
                        </div>
                        <div className="relative h-2.5 w-full overflow-hidden bg-trough">
                          <div
                            className="gauge-fill absolute inset-y-0 start-0 w-full bg-action/30"
                            style={{ transform: `scaleX(${Math.min(1, eligiblePct / 100)})` }}
                          />
                          <div
                            className="gauge-fill absolute inset-y-0 start-0 w-full bg-verified"
                            style={{ transform: `scaleX(${Math.min(1, placedOfBatchPct / 100)})` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-secondary">
                          <span>Placed: {formatCount(pl.placed_students)}</span>
                          <span>Opting-in pool: {formatCount(pl.opting_in_eligible)}</span>
                          <span>
                            Higher studies / non-registered:{' '}
                            {formatCount(Math.max(0, pl.batch_total - pl.opting_in_eligible))}
                          </span>
                        </div>
                      </div>

                      <dl className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-6 border-t border-rule pt-4 tabular">
                        <div className="min-w-0">
                          <dt className="text-xs text-ink-secondary">Median Domestic CTC</dt>
                          <dd dir="ltr" className="mt-1 text-2xl font-bold text-ink wrap-anywhere">
                            ₹{formatDecimal(pl.median_ctc_lakhs, 2)} LPA
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-ink-secondary">Highest Verified Offer</dt>
                          <dd dir="ltr" className="mt-1 text-2xl font-bold text-ink wrap-anywhere">
                            ₹{formatDecimal(pl.highest_ctc_lakhs, 2)} LPA
                          </dd>
                        </div>
                      </dl>

                      {pl.top_recruiters.length > 0 && (
                        <div className="border-t border-rule-subtle pt-4 text-sm min-w-0 wrap-anywhere">
                          <span className="text-xs font-semibold text-ink-secondary">
                            Verified top recruiters:{' '}
                          </span>
                          <span dir="auto" className="text-ink wrap-anywhere">
                            {pl.top_recruiters.slice(0, 6).join(', ')}
                            {pl.top_recruiters.length > 6
                              ? `, +${formatCount(pl.top_recruiters.length - 6)} more`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </Sheet>
                );
              })() : (
                <Sheet
                  title="Placement Denominator Audit"
                  subtitle="No placement cohort figures entered yet"
                >
                  <EmptyState
                    title="No placement register recorded"
                    description="Add verified placement cell figures under Manage Registers to compare brochures against real cohort denominators."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setScope('manage')}>
                        Add Placement Register
                      </Button>
                    }
                  />
                </Sheet>
              )}
            </div>
          </div>
        )}
        </div>
      ) : (
        data.k12_disclosure && (
          <div
            id="admin-scope-panel-k12"
            role="tabpanel"
            aria-labelledby="admin-scope-tab-k12"
            className="space-y-9"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    {humanizeSchoolLabel(data.k12_disclosure.school_name)}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    {data.k12_disclosure.board} — UDISE+ {data.k12_disclosure.udise_qc_code} (
                    {data.k12_disclosure.classes_offered})
                  </p>
                </div>
                {data.z3_k12_proofs &&
                  (() => {
                    const qcFailed = data.k12_qc_report ? !data.k12_qc_report.passed_all_gates : false;
                    if (!data.z3_k12_proofs.all_compliant) {
                      return <StatusBadge tone="blocker">Statutory Breach Detected</StatusBadge>;
                    }
                    if (qcFailed) {
                      const certs = data.k12_disclosure?.appendix_ix_certificates ?? [];
                      if (certs.length === 0) {
                        return (
                          <StatusBadge tone="blocker">
                            0 of 8 Mandatory Certificates on File
                          </StatusBadge>
                        );
                      }
                      const flagged = certs
                        .map((c) => classifyAppendixIxCert(c, todayIso))
                        .filter((cls) => cls.state !== 'valid' && cls.state !== 'permanent');
                      if (flagged.length > 0) {
                        const allExpired = flagged.every((cls) => cls.state === 'expired');
                        return (
                          <StatusBadge tone="blocker">
                            {allExpired
                              ? 'Statutory Safety Certificate Expired'
                              : 'Statutory Certificate Flagged'}
                          </StatusBadge>
                        );
                      }
                      return <StatusBadge tone="blocker">Appendix IX Gate Failed</StatusBadge>;
                    }
                    return sectionAtCap ? (
                      <StatusBadge tone="warn">
                        Compliant — Section size at statutory ceiling
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="verified" quiet>
                        CBSE Clause 4.1 compliant
                      </StatusBadge>
                    );
                  })()}
              </div>

              {data.z3_k12_proofs && (
                <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-rule bg-rule-subtle shadow-[var(--shadow-sheet)] sm:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))] tabular">
                  <div className="min-w-0 bg-surface p-4">
                    <dt className="text-xs font-medium text-ink-secondary">Pupil–Teacher Ratio</dt>
                    <dd
                      dir="ltr"
                      className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                        data.z3_k12_proofs.ptr_within_30_to_1 ? 'text-ink' : 'text-blocker'
                      }`}
                    >
                      {formatDecimal(data.z3_k12_proofs.computed_ptr, 2)}:1
                    </dd>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-trough">
                      <div
                        className={`gauge-fill h-full w-full ${
                          data.z3_k12_proofs.ptr_within_30_to_1
                            ? 'bg-action'
                            : 'bg-blocker-strong'
                        }`}
                        style={{
                          transform: `scaleX(${Math.min(1, Math.max(0, data.z3_k12_proofs.computed_ptr / 30))})`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5">
                      {data.z3_k12_proofs.ptr_within_30_to_1 ? (
                        <StatusBadge tone="verified" quiet>
                          Within 30:1 ceiling
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="blocker">Exceeds 30:1 limit</StatusBadge>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 bg-surface p-4">
                    <dt className="text-xs font-medium text-ink-secondary">Peak Section Size</dt>
                    <dd
                      dir="ltr"
                      className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                        !data.z3_k12_proofs.section_cap_within_40
                          ? 'text-blocker'
                          : data.k12_disclosure.max_section_size >= 36
                            ? 'text-warn'
                            : 'text-ink'
                      }`}
                    >
                      {formatCount(data.k12_disclosure.max_section_size)}{' '}
                      <span className="font-sans text-xs font-normal text-ink-secondary">/ 40 cap</span>
                    </dd>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-trough">
                      <div
                        className={`gauge-fill h-full w-full ${
                          !data.z3_k12_proofs.section_cap_within_40
                            ? 'bg-blocker-strong'
                            : data.k12_disclosure.max_section_size >= 36
                              ? 'bg-warn-accent'
                              : 'bg-action'
                        }`}
                        style={{
                          transform: `scaleX(${Math.min(1, Math.max(0, data.k12_disclosure.max_section_size / 40))})`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5">
                      {!data.z3_k12_proofs.section_cap_within_40 ? (
                        <StatusBadge tone="blocker">Exceeds 40-student cap</StatusBadge>
                      ) : data.k12_disclosure.max_section_size >= 40 ? (
                        <StatusBadge tone="warn">At statutory cap (0 headroom)</StatusBadge>
                      ) : (
                        <StatusBadge tone="verified" quiet>
                          Within 40-student cap
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 bg-surface p-4">
                    <dt className="text-xs font-medium text-ink-secondary">Classroom Area</dt>
                    <dd
                      dir="ltr"
                      className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                        data.z3_k12_proofs.classroom_area_min_500_sqft ? 'text-ink' : 'text-blocker'
                      }`}
                    >
                      {formatCount(data.z3_k12_proofs.classroom_area_sqft)} sq ft
                    </dd>
                    {(() => {
                      const delta = Math.round(data.z3_k12_proofs.classroom_area_sqft - 500);
                      return (
                        <div className="mt-2 space-y-1.5">
                          <div
                            dir="ltr"
                            className={`text-xs ${
                              data.z3_k12_proofs.classroom_area_min_500_sqft
                                ? 'text-ink-secondary'
                                : 'font-medium text-blocker'
                            }`}
                          >
                            {data.z3_k12_proofs.classroom_area_min_500_sqft
                              ? delta > 0
                                ? `+${formatCount(delta)} sq ft above 500 sq ft floor`
                                : 'At 500 sq ft statutory floor'
                              : `${formatCount(Math.abs(delta))} sq ft below 500 sq ft floor`}
                          </div>
                          {data.z3_k12_proofs.classroom_area_min_500_sqft ? (
                            <StatusBadge tone="verified" quiet>
                              Meets 500 sq ft norm
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="blocker">Below 500 sq ft min</StatusBadge>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="min-w-0 bg-surface p-4">
                    <dt className="text-xs font-medium text-ink-secondary">Floor Area / Student</dt>
                    <dd
                      dir="ltr"
                      className={`mt-1 font-display text-2xl font-semibold wrap-anywhere ${
                        data.z3_k12_proofs.floor_space_min_1_sqm ? 'text-ink' : 'text-blocker'
                      }`}
                    >
                      {formatDecimal(data.z3_k12_proofs.sqm_per_student, 2)} m²
                    </dd>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-trough">
                      <div
                        className={`gauge-fill h-full w-full ${
                          data.z3_k12_proofs.floor_space_min_1_sqm
                            ? 'bg-verified'
                            : 'bg-blocker-strong'
                        }`}
                        style={{
                          transform: `scaleX(${Math.min(1, Math.max(0, data.z3_k12_proofs.sqm_per_student / 1.5))})`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5">
                      {data.z3_k12_proofs.floor_space_min_1_sqm ? (
                        <StatusBadge tone="verified" quiet>
                          +
                          {formatCount(
                            Math.round(
                              Math.max(0, (data.z3_k12_proofs.sqm_per_student - 1) * 100),
                            ),
                          )}
                          % above 1 m² min
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="blocker">Below 1.00 m² min</StatusBadge>
                      )}
                    </div>
                  </div>
                </dl>
              )}
            </div>

            <Sheet
              title="CBSE Appendix IX Mandatory Certificates"
              subtitle={`${pluralize(data.k12_disclosure.appendix_ix_certificates.length, 'statutory document')} on file`}
            >
              <div className="space-y-4">
                <DataTable
                  rows={data.k12_disclosure.appendix_ix_certificates}
                  rowKey={(c, i) => `${c.doc_code}-${i}`}
                  searchText={(c) => `${c.doc_code} ${c.title} ${c.issuing_authority} ${c.section}`}
                  searchPlaceholder="Filter Appendix IX certificates…"
                  dense
                  emptyTitle="No Appendix IX certificates uploaded"
                  emptyDescription="Mandatory fire, building safety, water, and affiliation certificates appear here."
                  columns={certColumns}
                />

                <DisclosureProof label="Formal statutory proof & registry integrity checks">
                  <div className="space-y-2">
                    <div>
                      <strong>Solver:</strong> {data.z3_k12_proofs?.solver_id ?? '—'} |{' '}
                      <strong>Unsat core:</strong>{' '}
                      {data.z3_k12_proofs?.unsat_core?.join(', ') || 'none (satisfiable)'}
                    </div>
                    {data.k12_qc_report && (
                      <ul className="space-y-1 border-t border-rule pt-2">
                        {data.k12_qc_report.gates.map((g) => (
                          <li key={g.gate_id}>
                            <strong>{humanizeGateId(g.gate_id)}</strong> ({g.passed ? 'PASS' : 'FAIL'}
                            ) — {g.name.trim()}: {g.detail.trim()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </DisclosureProof>
              </div>
            </Sheet>
          </div>
        )
      )}
    </div>
  );
}
