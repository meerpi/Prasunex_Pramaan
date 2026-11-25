import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, UserPlus } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  AuthUser,
  InstitutionalMetricsRecord,
  K12SchoolDisclosure,
  PlacementBatchRecord,
  RoleName,
} from '../../api/types.ts';
import { INPUT_CLS } from '../../utils/format.ts';
import { Button, DataTable, SegmentedTabs, Sheet, StatusBadge } from '../ui/index.ts';
import { AdminBulkImportSheet } from './AdminBulkImportSheet.tsx';
import { AdminK12RegisterForm } from './AdminK12RegisterForm.tsx';

interface AdminRegisterFormsProps {
  existingMetrics?: InstitutionalMetricsRecord | null;
  existingPlacement?: PlacementBatchRecord | null;
  existingK12?: K12SchoolDisclosure | null;
  onSaved: () => void;
}

const ROLE_LABELS: Record<RoleName, string> = {
  student: 'Student',
  parent: 'Parent / Guardian',
  teacher: 'Faculty',
  recruiter: 'Recruiter',
  admin: 'Registrar / Admin',
};

function formatBudgetHeadsText(heads?: Record<string, number> | null): string {
  if (!heads) return '';
  return Object.entries(heads)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function AdminRegisterForms({
  existingMetrics,
  existingPlacement,
  existingK12,
  onSaved,
}: AdminRegisterFormsProps) {
  const [regTab, setRegTab] = useState<'hei' | 'k12' | 'people'>('hei');
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  // Institutional NAAC / AISHE metrics (value-signature sync avoids wiping edits on sibling saves)
  const metricsSig = useMemo(() => JSON.stringify(existingMetrics ?? null), [existingMetrics]);
  const [prevMetricsSig, setPrevMetricsSig] = useState(metricsSig);
  const [instYear, setInstYear] = useState(existingMetrics?.academic_year ?? '');
  const [fiscalYear, setFiscalYear] = useState(existingMetrics?.fiscal_year ?? '');
  const [naacGrade, setNaacGrade] = useState(existingMetrics?.naac_grade ?? '');
  const [naacValidUntil, setNaacValidUntil] = useState(existingMetrics?.naac_cycle_valid_until ?? '');
  const [learners, setLearners] = useState(
    existingMetrics ? String(existingMetrics.enrolled_learners) : '',
  );
  const [facultyCount, setFacultyCount] = useState(
    existingMetrics ? String(existingMetrics.regular_faculty_count) : '',
  );
  const [infraSpend, setInfraSpend] = useState(
    existingMetrics ? String(existingMetrics.criterion4_infra_spend_crores) : '',
  );
  const [budgetLines, setBudgetLines] = useState(
    formatBudgetHeadsText(existingMetrics?.budget_heads),
  );
  const [minAttPct, setMinAttPct] = useState(
    existingMetrics?.min_attendance_pct !== undefined
      ? String(existingMetrics.min_attendance_pct)
      : '75',
  );
  const [maxCondPct, setMaxCondPct] = useState(
    existingMetrics?.max_medical_condonation_pct !== undefined
      ? String(existingMetrics.max_medical_condonation_pct)
      : '10',
  );
  const [cgpaExempt, setCgpaExempt] = useState(
    existingMetrics?.cgpa_exemption_threshold != null
      ? String(existingMetrics.cgpa_exemption_threshold)
      : '',
  );

  // Placement record (value-signature sync avoids wiping edits on sibling saves)
  const placementSig = useMemo(
    () => JSON.stringify(existingPlacement ?? null),
    [existingPlacement],
  );
  const [prevPlacementSig, setPrevPlacementSig] = useState(placementSig);
  const [plYear, setPlYear] = useState(existingPlacement?.academic_year ?? '');
  const [plDept, setPlDept] = useState(existingPlacement?.department ?? '');
  const [plBatchTotal, setPlBatchTotal] = useState(
    existingPlacement ? String(existingPlacement.batch_total) : '',
  );
  const [plOptingIn, setPlOptingIn] = useState(
    existingPlacement ? String(existingPlacement.opting_in_eligible) : '',
  );
  const [plPlaced, setPlPlaced] = useState(
    existingPlacement ? String(existingPlacement.placed_students) : '',
  );
  const [plMedian, setPlMedian] = useState(
    existingPlacement ? String(existingPlacement.median_ctc_lakhs) : '',
  );
  const [plHighest, setPlHighest] = useState(
    existingPlacement ? String(existingPlacement.highest_ctc_lakhs) : '',
  );
  const [plRecruiters, setPlRecruiters] = useState(
    existingPlacement ? existingPlacement.top_recruiters.join(', ') : '',
  );

  if (metricsSig !== prevMetricsSig) {
    setPrevMetricsSig(metricsSig);
    if (existingMetrics) {
      setInstYear(existingMetrics.academic_year);
      setFiscalYear(existingMetrics.fiscal_year);
      setNaacGrade(existingMetrics.naac_grade);
      setNaacValidUntil(existingMetrics.naac_cycle_valid_until);
      setLearners(String(existingMetrics.enrolled_learners));
      setFacultyCount(String(existingMetrics.regular_faculty_count));
      setInfraSpend(String(existingMetrics.criterion4_infra_spend_crores));
      setBudgetLines(formatBudgetHeadsText(existingMetrics.budget_heads));
      setMinAttPct(String(existingMetrics.min_attendance_pct ?? 75));
      setMaxCondPct(String(existingMetrics.max_medical_condonation_pct ?? 10));
      setCgpaExempt(
        existingMetrics.cgpa_exemption_threshold != null
          ? String(existingMetrics.cgpa_exemption_threshold)
          : '',
      );
    }
  }

  if (placementSig !== prevPlacementSig) {
    setPrevPlacementSig(placementSig);
    if (existingPlacement) {
      setPlYear(existingPlacement.academic_year);
      setPlDept(existingPlacement.department);
      setPlBatchTotal(String(existingPlacement.batch_total));
      setPlOptingIn(String(existingPlacement.opting_in_eligible));
      setPlPlaced(String(existingPlacement.placed_students));
      setPlMedian(String(existingPlacement.median_ctc_lakhs));
      setPlHighest(String(existingPlacement.highest_ctc_lakhs));
      setPlRecruiters(existingPlacement.top_recruiters.join(', '));
    }
  }

  // Student record
  const [stuPrn, setStuPrn] = useState('');
  const [stuName, setStuName] = useState('');
  const [stuProgram, setStuProgram] = useState('');
  const [stuDept, setStuDept] = useState('');
  const [stuBatch, setStuBatch] = useState('');
  const [stuLevel, setStuLevel] = useState<'HEI' | 'K12'>('HEI');
  const [stuAge, setStuAge] = useState('');
  const [stuCgpa, setStuCgpa] = useState('');
  const [stuBacklogs, setStuBacklogs] = useState('0');
  const [stuStatus, setStuStatus] = useState('');
  const [stuParent, setStuParent] = useState('');
  const [stuCourseCode, setStuCourseCode] = useState('');
  const [stuCourseTitle, setStuCourseTitle] = useState('');
  const [stuAttended, setStuAttended] = useState('');
  const [stuTotalClasses, setStuTotalClasses] = useState('');

  // Faculty record
  const [facId, setFacId] = useState('');
  const [facName, setFacName] = useState('');
  const [facDesig, setFacDesig] = useState('');
  const [facDept, setFacDept] = useState('');
  const [facPresent, setFacPresent] = useState('');
  const [facWorking, setFacWorking] = useState('');
  const [facGrants, setFacGrants] = useState('');

  // Institutional user accounts
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<RoleName>('student');
  const [newLinkedPrn, setNewLinkedPrn] = useState('');
  const [newLinkedFac, setNewLinkedFac] = useState('');
  const [linkEdits, setLinkEdits] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;
    api
      .listUsers()
      .then((list) => {
        if (active) setUsers(list);
      })
      .catch((ex: unknown) => {
        if (active) setErr(ex instanceof Error ? ex.message : 'Unable to load user accounts');
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshUsers = async () => {
    try {
      setUsers(await api.listUsers());
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to refresh user accounts');
    }
  };

  const handleSaveMetrics = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('metrics');
    setErr('');
    setNotice('');
    try {
      const heads: Record<string, number> = {};
      for (const rawLine of budgetLines.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        const sep = trimmed.lastIndexOf(':');
        if (sep <= 0) {
          throw new Error(`Invalid budget head line "${trimmed}". Use "head_name: amount_cr".`);
        }
        const key = trimmed.slice(0, sep).trim();
        const valStr = trimmed.slice(sep + 1).trim();
        const num = Number(valStr);
        if (!key || valStr === '' || !Number.isFinite(num) || num < 0) {
          throw new Error(
            `Budget head "${key || trimmed}" must have a non-negative numeric amount in ₹ Crores.`,
          );
        }
        heads[key.toLowerCase().replace(/\s+/g, '_')] = num;
      }
      const exemptNum = cgpaExempt.trim() === '' ? null : Number(cgpaExempt);
      await api.adminUpsertInstitutional({
        academic_year: instYear.trim(),
        fiscal_year: fiscalYear.trim(),
        naac_grade: naacGrade.trim(),
        naac_cycle_valid_until: naacValidUntil.trim(),
        enrolled_learners: Number(learners),
        regular_faculty_count: Number(facultyCount),
        criterion4_infra_spend_crores: Number(infraSpend),
        budget_heads: heads,
        min_attendance_pct: minAttPct.trim() === '' ? 75 : Number(minAttPct),
        max_medical_condonation_pct: maxCondPct.trim() === '' ? 10 : Number(maxCondPct),
        cgpa_exemption_threshold:
          exemptNum !== null && Number.isFinite(exemptNum) ? exemptNum : null,
      });
      setNotice(`Saved institutional statutory metrics for ${instYear.trim()}.`);
      onSaved();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to save institutional metrics');
    } finally {
      setBusy('');
    }
  };

  const handleSavePlacement = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('placement');
    setErr('');
    setNotice('');
    try {
      await api.adminUpsertPlacement({
        academic_year: plYear.trim(),
        department: plDept.trim(),
        batch_total: Number(plBatchTotal),
        opting_in_eligible: Number(plOptingIn),
        placed_students: Number(plPlaced),
        median_ctc_lakhs: Number(plMedian),
        highest_ctc_lakhs: Number(plHighest),
        top_recruiters: plRecruiters
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotice(`Saved audited placement register for ${plDept.trim()} (${plYear.trim()}).`);
      onSaved();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to save placement register');
    } finally {
      setBusy('');
    }
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('student');
    setErr('');
    setNotice('');
    try {
      const ageNum = Number(stuAge);
      const cgpaNum = Number(stuCgpa);
      const courses =
        stuCourseCode.trim() && stuCourseTitle.trim()
          ? [
              {
                course_code: stuCourseCode.trim(),
                course_title: stuCourseTitle.trim(),
                credits: 4.0,
                grade_point: cgpaNum,
                semester: 1,
              },
            ]
          : [];
      const attendance =
        stuCourseCode.trim() && stuAttended.trim() && stuTotalClasses.trim()
          ? [
              {
                course_code: stuCourseCode.trim(),
                course_title: stuCourseTitle.trim() || stuCourseCode.trim(),
                attended_classes: Number(stuAttended),
                total_classes: Number(stuTotalClasses),
                medical_condonation_pct: 0.0,
                approved_by_medical_board: false,
                raw_pct: 0,
                effective_pct: 0,
              },
            ]
          : [];
      await api.adminUpsertStudent({
        prn: stuPrn.trim(),
        full_name: stuName.trim(),
        program: stuProgram.trim(),
        batch_year: Number(stuBatch),
        department: stuDept.trim(),
        education_level: stuLevel,
        age_years: ageNum,
        is_minor: ageNum < 18,
        declared_cgpa: cgpaNum,
        active_backlogs: Number(stuBacklogs || '0'),
        degree_status: stuStatus.trim() || 'Enrolled',
        parent_username: stuParent.trim(),
        courses,
        attendance,
      });
      setNotice(`Saved student ERP record ${stuPrn.trim()} (${stuName.trim()}).`);
      setStuPrn('');
      setStuName('');
      setStuParent('');
      setStuAge('');
      setStuCgpa('');
      setStuBacklogs('0');
      setStuAttended('');
      setStuTotalClasses('');
      onSaved();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to save student record');
    } finally {
      setBusy('');
    }
  };

  const handleSaveFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('faculty');
    setErr('');
    setNotice('');
    try {
      await api.adminUpsertFaculty({
        faculty_id: facId.trim(),
        full_name: facName.trim(),
        designation: facDesig.trim(),
        department: facDept.trim(),
        biometric_days_present: Number(facPresent),
        working_days_total: Number(facWorking),
        sponsored_grant_inr_lakhs: Number(facGrants || '0'),
        publications: [],
      });
      setNotice(`Saved faculty record ${facId.trim()} (${facName.trim()}).`);
      setFacId('');
      setFacName('');
      onSaved();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to save faculty record');
    } finally {
      setBusy('');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('user');
    setErr('');
    setNotice('');
    try {
      const created = await api.adminCreateUser({
        username: newUsername.trim(),
        display_name: newDisplay.trim(),
        password: newPassword,
        role: newRole,
        linked_prn: newRole === 'student' ? newLinkedPrn.trim() : '',
        linked_faculty_id: newRole === 'teacher' ? newLinkedFac.trim() : '',
      });
      setNotice(`Provisioned ${ROLE_LABELS[created.role] ?? created.role} account @${created.username}.`);
      setNewUsername('');
      setNewDisplay('');
      setNewPassword('');
      setNewLinkedPrn('');
      setNewLinkedFac('');
      await refreshUsers();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to create user account');
    } finally {
      setBusy('');
    }
  };

  const handleLinkUser = useCallback(
    async (u: AuthUser, nextValRaw: string) => {
      const isTeacher = u.role === 'teacher';
      const nextVal = nextValRaw.trim();
      setBusy(`link-${u.id}`);
      setErr('');
      setNotice('');
      try {
        const updated = await api.adminUpdateUser(
          u.id,
          isTeacher ? { linked_faculty_id: nextVal } : { linked_prn: nextVal },
        );
        setLinkEdits((prev) => {
          const next = { ...prev };
          delete next[u.id];
          return next;
        });
        const shownVal = isTeacher ? updated.linked_faculty_id : updated.linked_prn;
        setNotice(
          `Updated ${isTeacher ? 'Faculty ID' : 'PRN'} link for @${updated.username} to ${shownVal || '(none)'}.`,
        );
        await refreshUsers();
      } catch (ex: unknown) {
        setErr(ex instanceof Error ? ex.message : 'Unable to update account link');
      } finally {
        setBusy('');
      }
    },
    [],
  );

  const userSearchText = useCallback(
    (u: AuthUser) =>
      `${u.display_name} ${u.username} ${u.role} ${ROLE_LABELS[u.role] ?? u.role} ${u.linked_prn} ${u.linked_faculty_id}`,
    [],
  );

  const userColumns = useMemo(
    () => [
      {
        key: 'user',
        header: 'Account',
        sortValue: (u: AuthUser) => u.display_name,
        render: (u: AuthUser) => (
          <div>
            <div dir="auto" className="font-semibold text-ink">
              {u.display_name}
            </div>
            <div className="font-mono text-xs text-ink-secondary">@{u.username}</div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        cellClassName: 'whitespace-nowrap',
        sortValue: (u: AuthUser) => ROLE_LABELS[u.role] ?? u.role,
        render: (u: AuthUser) => (
          <StatusBadge tone="neutral" quiet className="whitespace-nowrap">
            {ROLE_LABELS[u.role] ?? u.role}
          </StatusBadge>
        ),
      },
      {
        key: 'link',
        header: 'Linked PRN / Faculty ID',
        align: 'right' as const,
        cellClassName: 'whitespace-nowrap',
        render: (u: AuthUser) => {
          if (u.role !== 'student' && u.role !== 'teacher') {
            return <span className="text-xs text-ink-muted">—</span>;
          }
          const isTeacher = u.role === 'teacher';
          const currentVal = isTeacher ? u.linked_faculty_id : u.linked_prn;
          const draftVal = linkEdits[u.id] ?? currentVal;
          return (
            <div className="inline-flex items-center justify-end gap-2">
              <input
                aria-label={
                  isTeacher
                    ? `Linked Faculty ID for ${u.username}`
                    : `Linked PRN for ${u.username}`
                }
                name={isTeacher ? `linked_faculty_${u.id}` : `linked_prn_${u.id}`}
                type="text"
                maxLength={40}
                title={draftVal || undefined}
                value={draftVal}
                onChange={(e) =>
                  setLinkEdits((prev) => ({ ...prev, [u.id]: e.target.value }))
                }
                placeholder={isTeacher ? 'Faculty ID' : 'Unlinked'}
                className="min-h-11 lg:min-h-8 w-44 sm:w-52 rounded border border-rule bg-surface px-2.5 py-1 font-mono text-xs text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
              />
              <Button
                variant="ghost"
                size="sm"
                className="whitespace-nowrap shrink-0"
                disabled={busy === `link-${u.id}` || draftVal.trim() === currentVal.trim()}
                onClick={() => void handleLinkUser(u, draftVal)}
              >
                Save
              </Button>
            </div>
          );
        },
      },
    ],
    [busy, handleLinkUser, linkEdits],
  );

  return (
    <div className="space-y-8 min-w-0">
      <SegmentedTabs
        ariaLabel="Register category"
        idPrefix="admin-reg-tab"
        value={regTab}
        onChange={setRegTab}
        options={[
          {
            id: 'hei',
            label: 'Higher Education (NAAC & Placements)',
            panelId: 'admin-reg-panel-hei',
          },
          {
            id: 'k12',
            label: 'K-12 School (CBSE Appendix IX)',
            panelId: 'admin-reg-panel-k12',
          },
          {
            id: 'people',
            label: 'People & Accounts',
            panelId: 'admin-reg-panel-people',
          },
        ]}
      />

      {err && (
        <div
          role="alert"
          className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker"
        >
          {err}
        </div>
      )}
      {notice && (
        <div
          role="status"
          aria-atomic="true"
          className="flex items-center gap-2 border-y border-verified-border bg-verified-bg px-4 py-2.5 text-sm font-medium text-verified-ink"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {regTab === 'k12' && (
        <div
          id="admin-reg-panel-k12"
          role="tabpanel"
          aria-labelledby="admin-reg-tab-k12"
        >
          <AdminK12RegisterForm
            existingK12={existingK12}
            onSaved={onSaved}
          />
        </div>
      )}

      {regTab === 'hei' && (
      <div
        id="admin-reg-panel-hei"
        role="tabpanel"
        aria-labelledby="admin-reg-tab-hei"
        className="grid grid-cols-1 gap-10 xl:grid-cols-2 items-start"
      >
        <Sheet
          tone="paper"
          title="Institutional NAAC / AISHE Metrics"
          subtitle="Record your institution’s verified academic year, enrollment, faculty count, and Criterion IV spend."
        >
          <form onSubmit={handleSaveMetrics} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="m-ay" className="block text-xs font-semibold text-ink">
                  Academic year
                </label>
                <input
                  id="m-ay"
                  name="academic_year"
                  required
                  maxLength={32}
                  value={instYear}
                  onChange={(e) => setInstYear(e.target.value)}
                  placeholder="AY YYYY-YY"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="m-fy" className="block text-xs font-semibold text-ink">
                  Fiscal year
                </label>
                <input
                  id="m-fy"
                  name="fiscal_year"
                  required
                  maxLength={32}
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(e.target.value)}
                  placeholder="FY YYYY-YY"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="m-grade" className="block text-xs font-semibold text-ink">
                  NAAC grade
                </label>
                <input
                  id="m-grade"
                  name="naac_grade"
                  required
                  maxLength={24}
                  value={naacGrade}
                  onChange={(e) => setNaacGrade(e.target.value)}
                  placeholder="Grade (e.g., A+)"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="m-valid" className="block text-xs font-semibold text-ink">
                  Cycle valid until
                </label>
                <input
                  id="m-valid"
                  name="naac_cycle_valid_until"
                  type="date"
                  required
                  value={naacValidUntil}
                  onChange={(e) => setNaacValidUntil(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="m-learners" className="block text-xs font-semibold text-ink">
                  Enrolled learners
                </label>
                <input
                  id="m-learners"
                  name="enrolled_learners"
                  type="number"
                  min={1}
                  max={1000000}
                  required
                  value={learners}
                  onChange={(e) => setLearners(e.target.value)}
                  placeholder="Total enrolled students"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="m-faculty" className="block text-xs font-semibold text-ink">
                  Regular faculty
                </label>
                <input
                  id="m-faculty"
                  name="regular_faculty_count"
                  type="number"
                  min={1}
                  max={200000}
                  required
                  value={facultyCount}
                  onChange={(e) => setFacultyCount(e.target.value)}
                  placeholder="Full-time faculty count"
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <div>
              <label htmlFor="m-spend" className="block text-xs font-semibold text-ink">
                Criterion IV infrastructure spend (₹ Crores)
              </label>
              <input
                id="m-spend"
                name="criterion4_infra_spend_crores"
                type="number"
                step="0.01"
                min={0}
                max={100000}
                required
                value={infraSpend}
                onChange={(e) => setInfraSpend(e.target.value)}
                placeholder="Total spend in ₹ Crores"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="m-heads" className="block text-xs font-semibold text-ink">
                Budget heads (one per line: <code className="font-mono">head_name: amount_cr</code>)
              </label>
              <textarea
                id="m-heads"
                name="budget_heads"
                rows={3}
                maxLength={10000}
                value={budgetLines}
                onChange={(e) => setBudgetLines(e.target.value)}
                placeholder={'head_one: 0.00\nhead_two: 0.00'}
                className={`${INPUT_CLS} font-mono text-xs`}
              />
            </div>
            <div className="border-t border-rule-subtle pt-3 space-y-2">
              <div className="text-xs font-semibold text-ink">Campus Attendance Ordinance</div>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                <div>
                  <label htmlFor="m-min-att" className="block text-xs font-medium text-ink-secondary">
                    Min attendance (%)
                  </label>
                  <input
                    id="m-min-att"
                    name="min_attendance_pct"
                    type="number"
                    step="0.5"
                    min={0}
                    max={100}
                    value={minAttPct}
                    onChange={(e) => setMinAttPct(e.target.value)}
                    placeholder="75"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label htmlFor="m-max-cond" className="block text-xs font-medium text-ink-secondary">
                    Max medical relief (%)
                  </label>
                  <input
                    id="m-max-cond"
                    name="max_medical_condonation_pct"
                    type="number"
                    step="0.5"
                    min={0}
                    max={100}
                    value={maxCondPct}
                    onChange={(e) => setMaxCondPct(e.target.value)}
                    placeholder="10"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label htmlFor="m-cgpa-exempt" className="block text-xs font-medium text-ink-secondary">
                    CGPA exemption ≥ (optional)
                  </label>
                  <input
                    id="m-cgpa-exempt"
                    name="cgpa_exemption_threshold"
                    type="number"
                    step="0.01"
                    min={0}
                    max={10}
                    value={cgpaExempt}
                    onChange={(e) => setCgpaExempt(e.target.value)}
                    placeholder="None (e.g., 9.00)"
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            </div>
            <Button type="submit" variant="primary" size="sm" disabled={busy === 'metrics'}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {busy === 'metrics' ? 'Saving…' : 'Save Institutional Metrics'}
            </Button>
          </form>
        </Sheet>

        <Sheet
          title="Placement Cell Audited Register"
          subtitle="Record verified opting-in denominator, placed headcount, and audited median package."
        >
          <form onSubmit={handleSavePlacement} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="p-ay" className="block text-xs font-semibold text-ink">
                  Academic year
                </label>
                <input
                  id="p-ay"
                  name="placement_academic_year"
                  required
                  maxLength={32}
                  value={plYear}
                  onChange={(e) => setPlYear(e.target.value)}
                  placeholder="AY YYYY-YY"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-dept" className="block text-xs font-semibold text-ink">
                  Department
                </label>
                <input
                  id="p-dept"
                  name="placement_department"
                  required
                  maxLength={120}
                  value={plDept}
                  onChange={(e) => setPlDept(e.target.value)}
                  placeholder="Department name"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-total" className="block text-xs font-semibold text-ink">
                  Total batch
                </label>
                <input
                  id="p-total"
                  name="batch_total"
                  type="number"
                  min={1}
                  max={500000}
                  required
                  value={plBatchTotal}
                  onChange={(e) => setPlBatchTotal(e.target.value)}
                  placeholder="Total graduating cohort"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-opt" className="block text-xs font-semibold text-ink">
                  Opting-in eligible
                </label>
                <input
                  id="p-opt"
                  name="opting_in_eligible"
                  type="number"
                  min={0}
                  max={500000}
                  required
                  value={plOptingIn}
                  onChange={(e) => setPlOptingIn(e.target.value)}
                  placeholder="Registered eligible pool"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-placed" className="block text-xs font-semibold text-ink">
                  Placed students
                </label>
                <input
                  id="p-placed"
                  name="placed_students"
                  type="number"
                  min={0}
                  max={500000}
                  required
                  value={plPlaced}
                  onChange={(e) => setPlPlaced(e.target.value)}
                  placeholder="Confirmed offers accepted"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-med" className="block text-xs font-semibold text-ink">
                  Median CTC (₹ Lakhs)
                </label>
                <input
                  id="p-med"
                  name="median_ctc_lakhs"
                  type="number"
                  step="0.01"
                  min={0}
                  max={10000}
                  required
                  value={plMedian}
                  onChange={(e) => setPlMedian(e.target.value)}
                  placeholder="Median LPA"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-high" className="block text-xs font-semibold text-ink">
                  Highest CTC (₹ Lakhs)
                </label>
                <input
                  id="p-high"
                  name="highest_ctc_lakhs"
                  type="number"
                  step="0.01"
                  min={0}
                  max={10000}
                  required
                  value={plHighest}
                  onChange={(e) => setPlHighest(e.target.value)}
                  placeholder="Highest verified LPA"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="p-rec" className="block text-xs font-semibold text-ink">
                  Top recruiters (comma-separated)
                </label>
                <input
                  id="p-rec"
                  name="top_recruiters"
                  maxLength={500}
                  value={plRecruiters}
                  onChange={(e) => setPlRecruiters(e.target.value)}
                  placeholder="Comma-separated recruiter names"
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy === 'placement'}>
              <Plus className="h-3.5 w-3.5 text-action" aria-hidden="true" />
              {busy === 'placement' ? 'Saving…' : 'Save Placement Register'}
            </Button>
          </form>
        </Sheet>
      </div>
      )}

      {regTab === 'people' && (
      <div
        id="admin-reg-panel-people"
        role="tabpanel"
        aria-labelledby="admin-reg-tab-people"
        className="space-y-8"
      >
      <AdminBulkImportSheet onImported={onSaved} />
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 items-start">
        <Sheet
          title="Add or Update Student Record"
          subtitle="Register a student PRN, academic standing, optional guardian link, and course/attendance log."
        >
          <form onSubmit={handleSaveStudent} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="s-prn" className="block text-xs font-semibold text-ink">
                  Student PRN / Roll ID
                </label>
                <input
                  id="s-prn"
                  name="student_prn"
                  required
                  maxLength={40}
                  value={stuPrn}
                  onChange={(e) => setStuPrn(e.target.value)}
                  placeholder="Official roll number / PRN"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-name" className="block text-xs font-semibold text-ink">
                  Full name
                </label>
                <input
                  id="s-name"
                  name="student_full_name"
                  required
                  maxLength={120}
                  value={stuName}
                  onChange={(e) => setStuName(e.target.value)}
                  placeholder="Student full name"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-prog" className="block text-xs font-semibold text-ink">
                  Program / Grade
                </label>
                <input
                  id="s-prog"
                  name="student_program"
                  required
                  maxLength={120}
                  value={stuProgram}
                  onChange={(e) => setStuProgram(e.target.value)}
                  placeholder="Degree program or grade"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-dept" className="block text-xs font-semibold text-ink">
                  Department / Board
                </label>
                <input
                  id="s-dept"
                  name="student_department"
                  required
                  maxLength={120}
                  value={stuDept}
                  onChange={(e) => setStuDept(e.target.value)}
                  placeholder="Department or board"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-batch" className="block text-xs font-semibold text-ink">
                  Batch year
                </label>
                <input
                  id="s-batch"
                  name="batch_year"
                  type="number"
                  min={1950}
                  max={2100}
                  required
                  value={stuBatch}
                  onChange={(e) => setStuBatch(e.target.value)}
                  placeholder="Graduation year (YYYY)"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-level" className="block text-xs font-semibold text-ink">
                  Education level
                </label>
                <select
                  id="s-level"
                  name="education_level"
                  value={stuLevel}
                  onChange={(e) => setStuLevel(e.target.value as 'HEI' | 'K12')}
                  className={INPUT_CLS}
                >
                  <option value="HEI">Higher Education (HEI)</option>
                  <option value="K12">K-12 School</option>
                </select>
              </div>
              <div>
                <label htmlFor="s-age" className="block text-xs font-semibold text-ink">
                  Age (years; &lt;18 enables DPDP Rule 10)
                </label>
                <input
                  id="s-age"
                  name="age_years"
                  type="number"
                  min={3}
                  max={120}
                  required
                  value={stuAge}
                  onChange={(e) => setStuAge(e.target.value)}
                  placeholder="Learner age in years"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-cgpa" className="block text-xs font-semibold text-ink">
                  Verified CGPA / GPA
                </label>
                <input
                  id="s-cgpa"
                  name="declared_cgpa"
                  type="number"
                  step="0.01"
                  min={0}
                  max={10}
                  required
                  value={stuCgpa}
                  onChange={(e) => setStuCgpa(e.target.value)}
                  placeholder="0.00 to 10.00"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-back" className="block text-xs font-semibold text-ink">
                  Active backlogs
                </label>
                <input
                  id="s-back"
                  name="active_backlogs"
                  type="number"
                  min={0}
                  max={50}
                  value={stuBacklogs}
                  onChange={(e) => setStuBacklogs(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-status" className="block text-xs font-semibold text-ink">
                  Enrollment status
                </label>
                <input
                  id="s-status"
                  name="degree_status"
                  maxLength={80}
                  value={stuStatus}
                  onChange={(e) => setStuStatus(e.target.value)}
                  placeholder="Current academic standing"
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <div>
              <label htmlFor="s-parent" className="block text-xs font-semibold text-ink">
                Linked guardian username (optional)
              </label>
              <input
                id="s-parent"
                name="parent_username"
                maxLength={80}
                value={stuParent}
                onChange={(e) => setStuParent(e.target.value)}
                placeholder="Guardian login username"
                className={INPUT_CLS}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 border-t border-rule-subtle pt-3 sm:grid-cols-2">
              <div>
                <label htmlFor="s-cc" className="block text-xs font-semibold text-ink">
                  Add / update course code (optional)
                </label>
                <input
                  id="s-cc"
                  name="course_code"
                  maxLength={32}
                  value={stuCourseCode}
                  onChange={(e) => setStuCourseCode(e.target.value)}
                  placeholder="Course code"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-ct" className="block text-xs font-semibold text-ink">
                  Course title (optional)
                </label>
                <input
                  id="s-ct"
                  name="course_title"
                  maxLength={160}
                  value={stuCourseTitle}
                  onChange={(e) => setStuCourseTitle(e.target.value)}
                  placeholder="Course title"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-att" className="block text-xs font-semibold text-ink">
                  Classes attended
                </label>
                <input
                  id="s-att"
                  name="attended_classes"
                  type="number"
                  min={0}
                  max={10000}
                  value={stuAttended}
                  onChange={(e) => setStuAttended(e.target.value)}
                  placeholder="Sessions attended"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="s-tot" className="block text-xs font-semibold text-ink">
                  Total classes
                </label>
                <input
                  id="s-tot"
                  name="total_classes"
                  type="number"
                  min={1}
                  max={10000}
                  value={stuTotalClasses}
                  onChange={(e) => setStuTotalClasses(e.target.value)}
                  placeholder="Total sessions held"
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy === 'student'}>
              <Plus className="h-3.5 w-3.5 text-action" aria-hidden="true" />
              {busy === 'student' ? 'Saving…' : 'Save Student Record'}
            </Button>
          </form>
        </Sheet>

        <Sheet
          title="Add or Update Faculty Record"
          subtitle="Record faculty biometric presence and sponsored R&D grant disclosures."
        >
          <form onSubmit={handleSaveFaculty} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="f-id" className="block text-xs font-semibold text-ink">
                  Faculty ID
                </label>
                <input
                  id="f-id"
                  name="faculty_id"
                  required
                  maxLength={40}
                  value={facId}
                  onChange={(e) => setFacId(e.target.value)}
                  placeholder="Official faculty ID"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="f-name" className="block text-xs font-semibold text-ink">
                  Full name
                </label>
                <input
                  id="f-name"
                  name="faculty_full_name"
                  required
                  maxLength={120}
                  value={facName}
                  onChange={(e) => setFacName(e.target.value)}
                  placeholder="Faculty full name"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="f-desig" className="block text-xs font-semibold text-ink">
                  Designation
                </label>
                <input
                  id="f-desig"
                  name="designation"
                  required
                  maxLength={120}
                  value={facDesig}
                  onChange={(e) => setFacDesig(e.target.value)}
                  placeholder="Academic designation"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="f-dept" className="block text-xs font-semibold text-ink">
                  Department
                </label>
                <input
                  id="f-dept"
                  name="faculty_department"
                  required
                  maxLength={120}
                  value={facDept}
                  onChange={(e) => setFacDept(e.target.value)}
                  placeholder="Department name"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="f-pres" className="block text-xs font-semibold text-ink">
                  Biometric days present
                </label>
                <input
                  id="f-pres"
                  name="biometric_days_present"
                  type="number"
                  min={0}
                  max={366}
                  required
                  value={facPresent}
                  onChange={(e) => setFacPresent(e.target.value)}
                  placeholder="Days present"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="f-work" className="block text-xs font-semibold text-ink">
                  Working days total
                </label>
                <input
                  id="f-work"
                  name="working_days_total"
                  type="number"
                  min={1}
                  max={366}
                  required
                  value={facWorking}
                  onChange={(e) => setFacWorking(e.target.value)}
                  placeholder="Total working days"
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <div>
              <label htmlFor="f-grants" className="block text-xs font-semibold text-ink">
                Sponsored grants (₹ Lakhs)
              </label>
              <input
                id="f-grants"
                name="sponsored_grant_inr_lakhs"
                type="number"
                step="0.01"
                min={0}
                max={100000}
                value={facGrants}
                onChange={(e) => setFacGrants(e.target.value)}
                placeholder="Total grants in ₹ Lakhs"
                className={INPUT_CLS}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy === 'faculty'}>
              <Plus className="h-3.5 w-3.5 text-action" aria-hidden="true" />
              {busy === 'faculty' ? 'Saving…' : 'Save Faculty Record'}
            </Button>
          </form>
        </Sheet>
      </div>

      <Sheet
        title="Institutional User Accounts & PRN Linking"
        subtitle="Provision Student, Parent, Faculty, Recruiter, or Admin logins and bind students to their official ERP roll numbers."
      >
        <div className="space-y-6">
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-end border-b border-rule pb-5">
            <div>
              <label htmlFor="u-name" className="block text-xs font-semibold text-ink">
                Username
              </label>
              <input
                id="u-name"
                name="new_username"
                required
                minLength={3}
                maxLength={64}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Login username"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="u-disp" className="block text-xs font-semibold text-ink">
                Full name
              </label>
              <input
                id="u-disp"
                name="new_display_name"
                required
                minLength={2}
                maxLength={120}
                value={newDisplay}
                onChange={(e) => setNewDisplay(e.target.value)}
                placeholder="Display name"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="u-pw" className="block text-xs font-semibold text-ink">
                Initial password (min 8 chars)
              </label>
              <input
                id="u-pw"
                name="new_password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="u-role" className="block text-xs font-semibold text-ink">
                Role
              </label>
              <select
                id="u-role"
                name="new_role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as RoleName)}
                className={INPUT_CLS}
              >
                <option value="student">Student</option>
                <option value="parent">Parent / Guardian</option>
                <option value="teacher">Teacher / Faculty</option>
                <option value="recruiter">Recruiter</option>
                <option value="admin">Registrar / Admin</option>
              </select>
            </div>
            {newRole === 'teacher' ? (
              <div>
                <label htmlFor="u-fac" className="block text-xs font-semibold text-ink">
                  Linked Faculty ID (optional)
                </label>
                <input
                  id="u-fac"
                  name="new_linked_faculty_id"
                  maxLength={40}
                  value={newLinkedFac}
                  onChange={(e) => setNewLinkedFac(e.target.value)}
                  placeholder="Faculty ID"
                  className={INPUT_CLS}
                />
              </div>
            ) : newRole === 'student' ? (
              <div>
                <label htmlFor="u-prn" className="block text-xs font-semibold text-ink">
                  Linked PRN (optional)
                </label>
                <input
                  id="u-prn"
                  name="new_linked_prn"
                  maxLength={40}
                  value={newLinkedPrn}
                  onChange={(e) => setNewLinkedPrn(e.target.value)}
                  placeholder="Student PRN"
                  className={INPUT_CLS}
                />
              </div>
            ) : null}
            <div>
              <Button type="submit" variant="primary" size="sm" disabled={busy === 'user'} className="w-full">
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {busy === 'user' ? 'Creating…' : 'Create Account'}
              </Button>
            </div>
          </form>

          <DataTable
            rows={users}
            rowKey={(u) => String(u.id)}
            searchText={userSearchText}
            searchPlaceholder="Filter accounts by name, username, role, or PRN…"
            searchThreshold={5}
            minWidthClassName="min-w-[560px] xl:min-w-0"
            dense
            emptyTitle="No accounts listed"
            emptyDescription="Provisioned accounts for this institution appear here."
            columns={userColumns}
          />
        </div>
      </Sheet>
      </div>
      )}
    </div>
  );
}
