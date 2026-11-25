import { useCallback, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CondonationAuditResult,
  FacultyErpRecord,
  PublicationRecord,
  TeacherPortalData,
} from '../../api/types.ts';
import {
  formatCount,
  formatDecimal,
  formatInr,
  formatPercent,
  pluralize,
} from '../../utils/format.ts';
import {
  Button,
  DataTable,
  DisclosureProof,
  Sheet,
  StatusBadge,
} from '../ui/index.ts';

interface TeacherPortalProps {
  data: TeacherPortalData;
}

type IndexedPublication = PublicationRecord & {
  facultyName: string;
  facultyDept: string;
};

export function TeacherPortal({ data }: TeacherPortalProps) {
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedPrn, setSelectedPrn] = useState(data.students[0]?.prn ?? '');

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return data.students;
    return data.students.filter((st) =>
      `${st.full_name} ${st.prn} ${st.program} ${st.department}`.toLowerCase().includes(q),
    );
  }, [data.students, studentQuery]);

  const activeStudent =
    filteredStudents.find((s) => s.prn === selectedPrn) ?? filteredStudents[0] ?? data.students[0];
  const effectivePrn = activeStudent?.prn ?? '';
  const [courseCode, setCourseCode] = useState(
    activeStudent?.attendance[0]?.course_code ?? '',
  );
  const effectiveCourseCode = activeStudent?.attendance.some((a) => a.course_code === courseCode)
    ? courseCode
    : activeStudent?.attendance[0]?.course_code ?? '';
  const [proposedPct, setProposedPct] = useState('');
  const [auditResult, setAuditResult] = useState<CondonationAuditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const numericPct = proposedPct.trim() === '' ? Number.NaN : Number(proposedPct);
  const canAudit =
    Boolean(effectivePrn) &&
    Boolean(effectiveCourseCode) &&
    Number.isFinite(numericPct) &&
    numericPct >= 0 &&
    numericPct <= 100;

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAudit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.auditCondonation(effectivePrn, effectiveCourseCode, numericPct);
      setAuditResult(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Condonation ordinance check failed');
    } finally {
      setBusy(false);
    }
  };

  const publications = useMemo<IndexedPublication[]>(
    () =>
      data.faculty.flatMap((fac) =>
        fac.publications.map((pub) => ({
          ...pub,
          facultyName: fac.full_name,
          facultyDept: fac.department,
        })),
      ),
    [data.faculty],
  );

  const facultySearchText = useCallback(
    (f: FacultyErpRecord) => `${f.full_name} ${f.department} ${f.designation}`,
    [],
  );

  const facultyColumns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Faculty Member',
        sortValue: (f: FacultyErpRecord) => f.full_name,
        render: (f: FacultyErpRecord) => (
          <div>
            <div dir="auto" className="font-semibold text-ink">
              {f.full_name}
            </div>
            <div className="text-xs text-ink-secondary">
              {[f.designation, f.department].filter((s) => s?.trim()).join(', ') || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'bio',
        header: 'Biometric Presence',
        align: 'right' as const,
        sortValue: (f: FacultyErpRecord) => f.biometric_days_present,
        render: (f: FacultyErpRecord) => (
          <span>
            {formatCount(f.biometric_days_present)} / {formatCount(f.working_days_total)} d
          </span>
        ),
      },
      {
        key: 'grants',
        header: 'Sponsored Grants',
        align: 'right' as const,
        sortValue: (f: FacultyErpRecord) => f.sponsored_grant_inr_lakhs,
        render: (f: FacultyErpRecord) => (
          <span dir="ltr" className="whitespace-nowrap">
            {formatInr(f.sponsored_grant_inr_lakhs, ' L')}
          </span>
        ),
      },
    ],
    [],
  );

  const pubSearchText = useCallback(
    (p: IndexedPublication) => `${p.doi} ${p.title} ${p.venue} ${p.facultyName}`,
    [],
  );

  const pubColumns = useMemo(
    () => [
      {
        key: 'title',
        header: 'Publication & DOI',
        render: (p: IndexedPublication) => (
          <div className="space-y-0.5">
            <div className="font-semibold text-ink wrap-anywhere">{p.title}</div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-ink-secondary wrap-anywhere">
              <span className="font-mono">{p.doi}</span>
              <span>
                {p.venue} ({p.year})
              </span>
            </div>
          </div>
        ),
      },
      {
        key: 'author',
        header: 'Faculty',
        sortValue: (p: IndexedPublication) => p.facultyName,
        render: (p: IndexedPublication) => <span dir="auto">{p.facultyName}</span>,
      },
      {
        key: 'index',
        header: 'Indexing',
        render: (p: IndexedPublication) => p.indexing,
      },
      {
        key: 'verified',
        header: 'Status',
        align: 'right' as const,
        render: (p: IndexedPublication) =>
          p.verified ? (
            <StatusBadge tone="verified" quiet>
              DOI attested
            </StatusBadge>
          ) : (
            <StatusBadge tone="warn">Pending Match</StatusBadge>
          ),
      },
    ],
    [],
  );

  const minAttPct = data.min_attendance_pct ?? 75;
  const effectiveMaxCond =
    auditResult?.max_medical_condonation_pct ?? data.max_medical_condonation_pct;

  return (
    <div className="space-y-9 min-w-0">
      <header className="gazette-header space-y-1.5">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
          Faculty Ledger &amp; Medical Condonation
        </h1>
        <p className="text-sm text-ink-secondary">
          Evaluate medical attendance petitions against the{' '}
          {formatPercent(data.max_medical_condonation_pct, 1)} institutional uplift ceiling
          {data.cgpa_exemption_threshold != null
            ? ` (CGPA ≥ ${formatDecimal(data.cgpa_exemption_threshold, 2)} exempt from ${formatPercent(
                minAttPct,
                1,
              )} floor)`
            : ` and ${formatPercent(minAttPct, 1)} attendance floor`}{' '}
          and review verified faculty publications.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[0.95fr_1.05fr] items-start">
        <Sheet
          tone="paper"
          title="Attendance Medical Condonation Check"
          subtitle="Verify whether a proposed medical uplift satisfies attendance ordinances."
        >
          <form onSubmit={handleAudit} className="space-y-4">
            {err && (
              <div
                role="alert"
                aria-atomic="true"
                className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-sm font-medium text-blocker"
              >
                {err}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="condon-student" className="block text-xs font-semibold text-ink">
                Student record
              </label>
              {data.students.length > 25 && (
                <input
                  id="condon-student-filter"
                  name="student_filter"
                  type="search"
                  aria-label="Filter students by name, PRN, or department"
                  value={studentQuery}
                  onChange={(e) => {
                    setStudentQuery(e.target.value);
                    setAuditResult(null);
                  }}
                  placeholder={`Filter ${formatCount(data.students.length)} students by name or PRN…`}
                  className="w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                />
              )}
              <select
                id="condon-student"
                value={effectivePrn}
                disabled={filteredStudents.length === 0}
                onChange={(e) => {
                  setSelectedPrn(e.target.value);
                  setAuditResult(null);
                  setErr('');
                }}
                className="w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action disabled:bg-subtle"
              >
                {data.students.length === 0 ? (
                  <option value="">No student records entered yet</option>
                ) : filteredStudents.length === 0 ? (
                  <option value="">No matching students</option>
                ) : (
                  <>
                    {(() => {
                      const MAX_VISIBLE = 50;
                      const slice = filteredStudents.slice(0, MAX_VISIBLE);
                      const list =
                        activeStudent && !slice.some((st) => st.prn === activeStudent.prn)
                          ? [activeStudent, ...slice.slice(0, MAX_VISIBLE - 1)]
                          : slice;
                      return (
                        <>
                          {list.map((st) => (
                            <option key={st.prn} value={st.prn}>
                              {st.full_name} ({st.prn})
                            </option>
                          ))}
                          {filteredStudents.length > MAX_VISIBLE && (
                            <option value="" disabled>
                              — Showing first {MAX_VISIBLE} of {formatCount(filteredStudents.length)}{' '}
                              students; type above to filter —
                            </option>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="condon-course" className="block text-xs font-semibold text-ink">
                  Course code
                </label>
                <select
                  id="condon-course"
                  value={effectiveCourseCode}
                  disabled={!activeStudent || activeStudent.attendance.length === 0}
                  onChange={(e) => {
                    setCourseCode(e.target.value);
                    setAuditResult(null);
                    setErr('');
                  }}
                  className="mt-1.5 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action disabled:bg-subtle"
                >
                  {(activeStudent?.attendance ?? []).length === 0 ? (
                    <option value="">No attendance logs recorded</option>
                  ) : (
                    activeStudent!.attendance.map((a) => (
                      <option key={a.course_code} value={a.course_code}>
                        {a.course_code} ({a.raw_pct.toFixed(1)}% attendance)
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="condon-pct" className="block text-xs font-semibold text-ink">
                  Proposed medical relief (%)
                </label>
                <input
                  id="condon-pct"
                  name="proposed_condonation_pct"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={proposedPct}
                  onChange={(e) => setProposedPct(e.target.value)}
                  placeholder="Enter % relief"
                  className="mt-1.5 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted tabular focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                />
              </div>
            </div>

            <Button type="submit" variant="primary" disabled={busy || !canAudit}>
              <Calculator className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Auditing ordinance…' : 'Verify Condonation Proposal'}
            </Button>

            {auditResult && (
              <div className="space-y-3 border-t border-rule pt-4 text-sm">
                <div role="status" aria-atomic="true" className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {auditResult.exempt_by_cgpa ? (
                      <StatusBadge tone="verified" quiet>
                        Exempt (CGPA ≥{' '}
                        {formatDecimal(
                          auditResult.cgpa_exemption_threshold ?? data.cgpa_exemption_threshold ?? 9,
                          2,
                        )}
                        )
                      </StatusBadge>
                    ) : auditResult.compliant ? (
                      <StatusBadge tone="verified" quiet>
                        Ordinance compliant
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="blocker">Ordinance Breach</StatusBadge>
                    )}
                    <span className="text-xs text-ink-secondary tabular">
                      Effective capped: {formatPercent(auditResult.effective_capped_pct, 1)}
                    </span>
                  </div>
                  <p className="font-medium text-ink wrap-anywhere">{auditResult.verdict}</p>
                  {auditResult.witness !== null &&
                    auditResult.witness !== undefined &&
                    String(auditResult.witness).trim() !== '' &&
                    Number(auditResult.witness) !== 0 && (
                      <p className="border-y border-blocker-border bg-blocker-bg px-3 py-2 text-sm text-blocker wrap-anywhere">
                        {!Number.isNaN(Number(auditResult.witness))
                          ? `Proposed relief (${formatPercent(
                              auditResult.proposed_condonation_pct,
                              1,
                            )}) exceeds the ${formatPercent(
                              effectiveMaxCond,
                              1,
                            )} ceiling by ${formatPercent(
                              Math.max(0, auditResult.proposed_condonation_pct - effectiveMaxCond),
                              1,
                            )}.`
                          : String(auditResult.witness)}
                      </p>
                    )}
                </div>
                <DisclosureProof label="Formal solver verification details">
                  Raw: {formatPercent(auditResult.raw_attendance_pct, 1)} | Proposed: +
                  {formatPercent(auditResult.proposed_condonation_pct, 1)} | Solver:{' '}
                  {auditResult.solver_id}
                </DisclosureProof>
              </div>
            )}
          </form>
        </Sheet>

        <Sheet
          title="Faculty Attendance & Research Grants"
          subtitle={`${pluralize(data.faculty.length, 'faculty record')} synced from institutional registers`}
        >
          <DataTable
            rows={data.faculty}
            rowKey={(f) => f.faculty_id}
            searchText={facultySearchText}
            searchPlaceholder="Search faculty member or department…"
            emptyTitle="No faculty records"
            emptyDescription="Faculty biometric and research records appear once entered by the registrar."
            columns={facultyColumns}
          />
        </Sheet>
      </div>

      <Sheet
        title="Peer-Reviewed DOI & Publication Ledger"
        subtitle={`${pluralize(publications.length, 'indexed publication')} linked across faculty profiles`}
      >
        <DataTable
          rows={publications}
          rowKey={(p, i) => `${p.doi}-${i}`}
          searchText={pubSearchText}
          searchPlaceholder="Filter by DOI, journal venue, or title…"
          emptyTitle="No verified DOIs indexed"
          emptyDescription="Add DOI references from the registrar faculty register to enable verification."
          columns={pubColumns}
        />
      </Sheet>
    </div>
  );
}
