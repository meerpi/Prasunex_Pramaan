import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { AppendixIxCertificate, K12SchoolDisclosure } from '../../api/types.ts';
import {
  INPUT_CLS,
  PERMANENT_ALLOWED_CODES,
  PERMANENT_TOKENS,
  classifyAppendixIxCert,
  formatCount,
  parseCalendarDateIso,
  todayIstIso,
} from '../../utils/format.ts';
import { Button, Sheet, StatusBadge } from '../ui/index.ts';

interface AdminK12RegisterFormProps {
  existingK12?: K12SchoolDisclosure | null;
  onSaved: () => void;
}

// Official CBSE Circular 03/2021 Appendix IX Section B statutory document schema (values blank until entered)
const STATUTORY_SECTION_B_SLOTS: ReadonlyArray<{ doc_code: string; title: string }> = [
  { doc_code: 'B1', title: 'Affiliation / Extension Letter' },
  { doc_code: 'B2', title: 'Society / Trust / Company Registration Certificate' },
  { doc_code: 'B3', title: 'State Government No Objection Certificate (NOC)' },
  { doc_code: 'B4', title: 'RTE Act 2009 Recognition Certificate' },
  { doc_code: 'B5', title: 'Building Safety Certificate' },
  { doc_code: 'B6', title: 'Fire Safety Certificate' },
  { doc_code: 'B7', title: 'DEO / Self-Certification for Affiliation' },
  { doc_code: 'B8', title: 'Safe Drinking Water, Health & Sanitation Certificate' },
];

interface CertDraft {
  doc_code: string;
  title: string;
  issuing_authority: string;
  valid_until: string;
  permanent: boolean;
}

function initialCertDrafts(existing?: K12SchoolDisclosure | null): CertDraft[] {
  const existingByCode = new Map<string, AppendixIxCertificate>();
  for (const c of existing?.appendix_ix_certificates ?? []) {
    existingByCode.set(c.doc_code.trim().toUpperCase(), c);
  }
  const seen = new Set<string>();
  const drafts: CertDraft[] = STATUTORY_SECTION_B_SLOTS.map((slot) => {
    const code = slot.doc_code.toUpperCase();
    seen.add(code);
    const saved = existingByCode.get(code);
    if (!saved) {
      return {
        doc_code: slot.doc_code,
        title: slot.title,
        issuing_authority: '',
        valid_until: '',
        permanent: false,
      };
    }
    const isPerm = PERMANENT_TOKENS.has(saved.valid_until.trim().toUpperCase());
    const isoDate = isPerm ? '' : parseCalendarDateIso(saved.valid_until) ?? '';
    return {
      doc_code: saved.doc_code,
      title: saved.title || slot.title,
      issuing_authority: saved.issuing_authority,
      valid_until: isoDate,
      permanent: isPerm,
    };
  });
  for (const c of existing?.appendix_ix_certificates ?? []) {
    const code = c.doc_code.trim().toUpperCase();
    if (!seen.has(code)) {
      const isPerm = PERMANENT_TOKENS.has(c.valid_until.trim().toUpperCase());
      const isoDate = isPerm ? '' : parseCalendarDateIso(c.valid_until) ?? '';
      drafts.push({
        doc_code: c.doc_code,
        title: c.title,
        issuing_authority: c.issuing_authority,
        valid_until: isoDate,
        permanent: isPerm,
      });
    }
  }
  return drafts;
}

export function AdminK12RegisterForm({ existingK12, onSaved }: AdminK12RegisterFormProps) {
  const errRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const k12Sig = useMemo(() => JSON.stringify(existingK12 ?? null), [existingK12]);
  const [prevK12Sig, setPrevK12Sig] = useState(k12Sig);
  const todayIso = todayIstIso();

  const [affCode, setAffCode] = useState(existingK12?.affiliation_qc_code ?? '');
  const [udiseCode, setUdiseCode] = useState(existingK12?.udise_qc_code ?? '');
  const [schoolName, setSchoolName] = useState(existingK12?.school_name ?? '');
  const [board, setBoard] = useState(existingK12?.board ?? 'CBSE');
  const [ay, setAy] = useState(existingK12?.academic_year ?? '');
  const [classesOffered, setClassesOffered] = useState(existingK12?.classes_offered ?? '');
  const [mgmtType, setMgmtType] = useState(existingK12?.management_type ?? '');
  const [cityState, setCityState] = useState(existingK12?.city_state ?? '');

  const [enrolled, setEnrolled] = useState(existingK12 ? String(existingK12.enrolled_students) : '');
  const [sections, setSections] = useState(existingK12 ? String(existingK12.sections_count) : '');
  const [maxSection, setMaxSection] = useState(
    existingK12 ? String(existingK12.max_section_size) : '',
  );
  const [classrooms, setClassrooms] = useState(
    existingK12 ? String(existingK12.classroom_count) : '',
  );
  const [areaSqft, setAreaSqft] = useState(
    existingK12 ? String(existingK12.classroom_area_sqft) : '',
  );
  const [areaSqm, setAreaSqm] = useState(existingK12 ? String(existingK12.classroom_area_sqm) : '');
  const [sqmTouched, setSqmTouched] = useState(Boolean(existingK12?.classroom_area_sqm));
  const [coreStaff, setCoreStaff] = useState(
    existingK12 ? String(existingK12.core_teaching_staff) : '',
  );
  const [pgt, setPgt] = useState(
    existingK12?.staff_breakdown?.PGT !== undefined ? String(existingK12.staff_breakdown.PGT) : '',
  );
  const [tgt, setTgt] = useState(
    existingK12?.staff_breakdown?.TGT !== undefined ? String(existingK12.staff_breakdown.TGT) : '',
  );
  const [prt, setPrt] = useState(
    existingK12?.staff_breakdown?.PRT !== undefined ? String(existingK12.staff_breakdown.PRT) : '',
  );

  const [classXStr, setClassXStr] = useState(
    existingK12?.class_x_3yr_pass_pct.join(', ') ?? '',
  );
  const [classXiiStr, setClassXiiStr] = useState(
    existingK12?.class_xii_3yr_pass_pct.join(', ') ?? '',
  );

  const [certs, setCerts] = useState<CertDraft[]>(() => initialCertDrafts(existingK12));

  if (k12Sig !== prevK12Sig) {
    setPrevK12Sig(k12Sig);
    if (existingK12) {
      setAffCode(existingK12.affiliation_qc_code);
      setUdiseCode(existingK12.udise_qc_code);
      setSchoolName(existingK12.school_name);
      setBoard(existingK12.board);
      setAy(existingK12.academic_year);
      setClassesOffered(existingK12.classes_offered);
      setMgmtType(existingK12.management_type);
      setCityState(existingK12.city_state);
      setEnrolled(String(existingK12.enrolled_students));
      setSections(String(existingK12.sections_count));
      setMaxSection(String(existingK12.max_section_size));
      setClassrooms(String(existingK12.classroom_count));
      setAreaSqft(String(existingK12.classroom_area_sqft));
      setAreaSqm(String(existingK12.classroom_area_sqm));
      setSqmTouched(Boolean(existingK12.classroom_area_sqm));
      setCoreStaff(String(existingK12.core_teaching_staff));
      setPgt(existingK12.staff_breakdown?.PGT !== undefined ? String(existingK12.staff_breakdown.PGT) : '');
      setTgt(existingK12.staff_breakdown?.TGT !== undefined ? String(existingK12.staff_breakdown.TGT) : '');
      setPrt(existingK12.staff_breakdown?.PRT !== undefined ? String(existingK12.staff_breakdown.PRT) : '');
      setClassXStr(existingK12.class_x_3yr_pass_pct.join(', '));
      setClassXiiStr(existingK12.class_xii_3yr_pass_pct.join(', '));
      setCerts(initialCertDrafts(existingK12));
    }
  }

  const liveBounds = useMemo(() => {
    const enr = Number(enrolled);
    const sec = Number(sections);
    const maxSec = Number(maxSection);
    const sqft = Number(areaSqft);
    const sqm = Number(areaSqm);
    const staff = Number(coreStaff);
    const pgtN = Number(pgt || 0);
    const tgtN = Number(tgt || 0);
    const prtN = Number(prt || 0);
    const hasStaffBreakdown = pgt.trim() !== '' || tgt.trim() !== '' || prt.trim() !== '';

    const ptr = enr > 0 && staff > 0 ? enr / staff : null;
    const avgSec = enr > 0 && sec > 0 ? enr / sec : null;
    const sqmWorst = sqm > 0 && maxSec > 0 ? sqm / maxSec : null;
    const sqmAvg = sqm > 0 && avgSec && avgSec > 0 ? sqm / avgSec : null;
    const staffSum = pgtN + tgtN + prtN;
    const staffMatches = !hasStaffBreakdown || (staff > 0 && staffSum === staff);

    let expiredCount = 0;
    let filledCerts = 0;
    for (const c of certs) {
      const hasDateOrPerm = c.permanent || Boolean(c.valid_until.trim());
      if (c.issuing_authority.trim() && hasDateOrPerm) {
        filledCerts += 1;
      }
      if (hasDateOrPerm) {
        const cls = classifyAppendixIxCert(
          {
            doc_code: c.doc_code,
            valid_until: c.permanent ? 'PERMANENT' : c.valid_until.trim(),
            status: 'VALID',
          },
          todayIso,
        );
        if (cls.state === 'expired') expiredCount += 1;
      }
    }

    return {
      ptr,
      maxSec: maxSec > 0 ? maxSec : null,
      sqft: sqft > 0 ? sqft : null,
      sqmWorst,
      sqmAvg,
      staffSum,
      hasStaffBreakdown,
      staffMatches,
      expiredCount,
      filledCerts,
    };
  }, [enrolled, sections, maxSection, areaSqft, areaSqm, coreStaff, pgt, tgt, prt, certs, todayIso]);

  const updateCert = (idx: number, patch: Partial<CertDraft>) => {
    setCerts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      const parseTrend = (raw: string, label: string): number[] => {
        if (!raw.trim()) return [];
        const tokens = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (tokens.length > 5) {
          throw new Error(
            `${label} accepts at most 5 annual percentages (entered ${tokens.length}).`,
          );
        }
        const values: number[] = [];
        for (const tok of tokens) {
          const n = Number(tok);
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            throw new Error(`${label} value "${tok}" must be between 0 and 100.`);
          }
          values.push(n);
        }
        return values;
      };

      const staffBreakdown: Record<string, number> = {};
      if (pgt.trim() !== '' || tgt.trim() !== '' || prt.trim() !== '') {
        staffBreakdown.PGT = Math.max(0, Number(pgt || 0));
        staffBreakdown.TGT = Math.max(0, Number(tgt || 0));
        staffBreakdown.PRT = Math.max(0, Number(prt || 0));
      }

      const certPayload: AppendixIxCertificate[] = [];
      for (const c of certs) {
        const auth = c.issuing_authority.trim();
        const dateVal = c.valid_until.trim();
        if (!auth && !dateVal && !c.permanent) continue;
        if (auth.length < 2) {
          throw new Error(
            `Certificate ${c.doc_code} (${c.title}) requires an issuing authority of at least 2 characters.`,
          );
        }
        if (!c.permanent && !dateVal) {
          throw new Error(
            `Certificate ${c.doc_code} (${c.title}) requires an expiry date or the Permanent option.`,
          );
        }
        const cls = classifyAppendixIxCert(
          {
            doc_code: c.doc_code.trim(),
            valid_until: c.permanent ? 'PERMANENT' : dateVal,
            status: 'VALID',
          },
          todayIso,
        );
        certPayload.push({
          doc_code: c.doc_code.trim(),
          title: c.title.trim(),
          section: 'Section B',
          issuing_authority: auth,
          valid_until: c.permanent ? 'PERMANENT' : dateVal,
          status: cls.state === 'expired' ? 'EXPIRED' : 'VALID',
        });
      }

      const res = await api.adminUpsertK12School({
        affiliation_qc_code: affCode.trim(),
        udise_qc_code: udiseCode.trim(),
        school_name: schoolName.trim(),
        board: board.trim(),
        academic_year: ay.trim(),
        classes_offered: classesOffered.trim(),
        management_type: mgmtType.trim(),
        city_state: cityState.trim(),
        enrolled_students: Number(enrolled),
        sections_count: Number(sections),
        max_section_size: Number(maxSection),
        classroom_count: Number(classrooms),
        classroom_area_sqft: Number(areaSqft),
        classroom_area_sqm: Number(areaSqm),
        core_teaching_staff: Number(coreStaff),
        staff_breakdown: staffBreakdown,
        class_x_3yr_pass_pct: parseTrend(classXStr, 'Class X 3-year pass %'),
        class_xii_3yr_pass_pct: parseTrend(classXiiStr, 'Class XII 3-year pass %'),
        appendix_ix_certificates: certPayload,
      });

      const passed = res.qc_report.passed_all_gates;
      setNotice(
        passed
          ? `Saved K-12 disclosure for ${schoolName.trim()} — all 4 CBSE Appendix IX gates passed.`
          : `Saved K-12 disclosure for ${schoolName.trim()} — review flagged statutory gate(s) on the K-12 School (CBSE) tab.`,
      );
      onSaved();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to save K-12 school disclosure');
      window.setTimeout(() => errRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="K-12 School Disclosure Register (CBSE Appendix IX & UDISE+)"
      subtitle="Enter official school identity, Clause 4.1 infrastructure metrics, 3-year board trends, and Section B certificates. Live compliance bounds update as you type."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {err && (
          <div
            ref={errRef}
            tabIndex={-1}
            role="alert"
            className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker wrap-anywhere focus-visible:outline-2 focus-visible:outline-action"
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

        {/* Live Clause 4.1 Statutory Preview Strip */}
        <dl className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-x-6 gap-y-3 border-y border-rule bg-subtle/40 px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-5 tabular">
          <div className="min-w-0">
            <dt className="text-ink-secondary">Live PTR (≤ 30:1)</dt>
            <dd
              dir="ltr"
              className={`mt-0.5 font-mono text-sm font-bold ${
                liveBounds.ptr === null
                  ? 'text-ink-muted'
                  : liveBounds.ptr <= 30
                    ? 'text-verified'
                    : 'text-blocker'
              }`}
            >
              {liveBounds.ptr === null ? '—' : `${liveBounds.ptr.toFixed(2)}:1`}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-secondary">Max Section (≤ 40)</dt>
            <dd
              dir="ltr"
              className={`mt-0.5 font-mono text-sm font-bold ${
                liveBounds.maxSec === null
                  ? 'text-ink-muted'
                  : liveBounds.maxSec <= 40
                    ? 'text-verified'
                    : 'text-blocker'
              }`}
            >
              {liveBounds.maxSec === null ? '—' : `${formatCount(liveBounds.maxSec)} / 40`}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-secondary">Room Area (≥ 500 ft²)</dt>
            <dd
              dir="ltr"
              className={`mt-0.5 font-mono text-sm font-bold ${
                liveBounds.sqft === null
                  ? 'text-ink-muted'
                  : liveBounds.sqft >= 500
                    ? 'text-verified'
                    : 'text-blocker'
              }`}
            >
              {liveBounds.sqft === null ? '—' : `${formatCount(Math.round(liveBounds.sqft))} sq ft`}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-secondary">Floor / Child (≥ 1.0 m²)</dt>
            <dd
              dir="ltr"
              className={`mt-0.5 font-mono text-sm font-bold ${
                liveBounds.sqmWorst === null
                  ? 'text-ink-muted'
                  : liveBounds.sqmWorst >= 1.0
                    ? 'text-verified'
                    : 'text-blocker'
              }`}
            >
              {liveBounds.sqmWorst === null
                ? '—'
                : `${liveBounds.sqmWorst.toFixed(2)} m²`}
              {liveBounds.sqmAvg !== null && (
                <span className="ms-1 font-normal text-ink-muted">
                  (avg {liveBounds.sqmAvg.toFixed(2)})
                </span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-secondary">Section B Certs</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold text-ink">
              {formatCount(liveBounds.filledCerts)}/{formatCount(certs.length)}
              {liveBounds.expiredCount > 0 && (
                <span className="ms-1.5 text-blocker">
                  ({formatCount(liveBounds.expiredCount)} expired)
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* Part A: School Identity */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-ink">Part A — School Identity &amp; Affiliation</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="k12-aff" className="block text-xs font-semibold text-ink">
                CBSE Affiliation Code
              </label>
              <input
                id="k12-aff"
                name="affiliation_qc_code"
                required
                maxLength={64}
                value={affCode}
                onChange={(e) => setAffCode(e.target.value)}
                placeholder="Affiliation number"
                className={`${INPUT_CLS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="k12-udise" className="block text-xs font-semibold text-ink">
                UDISE+ Code
              </label>
              <input
                id="k12-udise"
                name="udise_qc_code"
                required
                maxLength={64}
                value={udiseCode}
                onChange={(e) => setUdiseCode(e.target.value)}
                placeholder="11-digit UDISE+ code"
                className={`${INPUT_CLS} font-mono`}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="k12-name" className="block text-xs font-semibold text-ink">
                Official School Name
              </label>
              <input
                id="k12-name"
                name="school_name"
                required
                minLength={2}
                maxLength={200}
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Full registered school name"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-board" className="block text-xs font-semibold text-ink">
                Affiliation Board
              </label>
              <input
                id="k12-board"
                name="board"
                required
                minLength={2}
                maxLength={64}
                value={board}
                onChange={(e) => setBoard(e.target.value)}
                placeholder="CBSE / CISCE / State"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-ay" className="block text-xs font-semibold text-ink">
                Academic Year
              </label>
              <input
                id="k12-ay"
                name="k12_academic_year"
                required
                minLength={4}
                maxLength={32}
                value={ay}
                onChange={(e) => setAy(e.target.value)}
                placeholder="AY YYYY-YY"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-classes" className="block text-xs font-semibold text-ink">
                Classes Offered
              </label>
              <input
                id="k12-classes"
                name="classes_offered"
                required
                minLength={2}
                maxLength={64}
                value={classesOffered}
                onChange={(e) => setClassesOffered(e.target.value)}
                placeholder="e.g., Class I - XII"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-mgmt" className="block text-xs font-semibold text-ink">
                Management Type
              </label>
              <input
                id="k12-mgmt"
                name="management_type"
                required
                minLength={2}
                maxLength={120}
                value={mgmtType}
                onChange={(e) => setMgmtType(e.target.value)}
                placeholder="Private Unaided / Govt / Trust"
                className={INPUT_CLS}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="k12-city" className="block text-xs font-semibold text-ink">
                City &amp; State
              </label>
              <input
                id="k12-city"
                name="city_state"
                required
                minLength={2}
                maxLength={120}
                value={cityState}
                onChange={(e) => setCityState(e.target.value)}
                placeholder="City, State"
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>

        {/* Parts D & E: Infrastructure & Teaching Staff */}
        <div className="space-y-3 border-t border-rule pt-5">
          <h3 className="text-sm font-bold text-ink">
            Parts D &amp; E — Clause 4.1 Enrollment, Classrooms &amp; Faculty
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="k12-enrolled" className="block text-xs font-semibold text-ink">
                Enrolled Students
              </label>
              <input
                id="k12-enrolled"
                name="enrolled_students"
                type="number"
                min={1}
                max={200000}
                required
                value={enrolled}
                onChange={(e) => setEnrolled(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-sections" className="block text-xs font-semibold text-ink">
                Total Sections
              </label>
              <input
                id="k12-sections"
                name="sections_count"
                type="number"
                min={1}
                max={5000}
                required
                value={sections}
                onChange={(e) => setSections(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-max-sec" className="block text-xs font-semibold text-ink">
                Peak Section Size (≤ 40)
              </label>
              <input
                id="k12-max-sec"
                name="max_section_size"
                type="number"
                min={1}
                max={200}
                required
                value={maxSection}
                onChange={(e) => setMaxSection(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-rooms" className="block text-xs font-semibold text-ink">
                Total Classrooms
              </label>
              <input
                id="k12-rooms"
                name="classroom_count"
                type="number"
                min={1}
                max={5000}
                required
                value={classrooms}
                onChange={(e) => setClassrooms(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-sqft" className="block text-xs font-semibold text-ink">
                Classroom Area (sq ft, ≥ 500)
              </label>
              <input
                id="k12-sqft"
                name="classroom_area_sqft"
                type="number"
                step="0.1"
                min={1}
                max={50000}
                required
                value={areaSqft}
                onChange={(e) => {
                  const val = e.target.value;
                  setAreaSqft(val);
                  if (!sqmTouched) {
                    const n = Number(val);
                    setAreaSqm(Number.isFinite(n) && n > 0 ? (n * 0.092903).toFixed(2) : '');
                  }
                }}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-sqm" className="block text-xs font-semibold text-ink">
                Classroom Area (sq m)
              </label>
              <input
                id="k12-sqm"
                name="classroom_area_sqm"
                type="number"
                step="0.01"
                min={0.1}
                max={5000}
                required
                value={areaSqm}
                onChange={(e) => {
                  setSqmTouched(e.target.value.trim().length > 0);
                  setAreaSqm(e.target.value);
                }}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="k12-staff" className="block text-xs font-semibold text-ink">
                Core Teaching Staff
              </label>
              <input
                id="k12-staff"
                name="core_teaching_staff"
                type="number"
                min={1}
                max={20000}
                required
                aria-describedby={!liveBounds.staffMatches ? 'k12-staff-parity-err' : undefined}
                value={coreStaff}
                onChange={(e) => setCoreStaff(e.target.value)}
                className={INPUT_CLS}
              />
              {!liveBounds.staffMatches && (
                <p id="k12-staff-parity-err" className="mt-1 text-xs font-medium text-blocker">
                  PGT + TGT + PRT ({liveBounds.staffSum}) must equal Core Staff ({coreStaff}).
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="k12-pgt" className="block text-xs font-semibold text-ink">
                  PGT
                </label>
                <input
                  id="k12-pgt"
                  name="staff_pgt"
                  type="number"
                  min={0}
                  max={20000}
                  value={pgt}
                  onChange={(e) => setPgt(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="k12-tgt" className="block text-xs font-semibold text-ink">
                  TGT
                </label>
                <input
                  id="k12-tgt"
                  name="staff_tgt"
                  type="number"
                  min={0}
                  max={20000}
                  value={tgt}
                  onChange={(e) => setTgt(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="k12-prt" className="block text-xs font-semibold text-ink">
                  PRT
                </label>
                <input
                  id="k12-prt"
                  name="staff_prt"
                  type="number"
                  min={0}
                  max={20000}
                  value={prt}
                  onChange={(e) => setPrt(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
            <div>
              <label htmlFor="k12-x" className="block text-xs font-semibold text-ink">
                Class X 3-Year Board Pass % (comma-separated)
              </label>
              <input
                id="k12-x"
                name="class_x_3yr_pass_pct"
                maxLength={64}
                value={classXStr}
                onChange={(e) => setClassXStr(e.target.value)}
                placeholder="3 annual pass percentages, e.g. 98.2, 99.0, 99.4"
                className={`${INPUT_CLS} font-mono text-xs`}
              />
            </div>
            <div>
              <label htmlFor="k12-xii" className="block text-xs font-semibold text-ink">
                Class XII 3-Year Board Pass % (comma-separated)
              </label>
              <input
                id="k12-xii"
                name="class_xii_3yr_pass_pct"
                maxLength={64}
                value={classXiiStr}
                onChange={(e) => setClassXiiStr(e.target.value)}
                placeholder="3 annual pass percentages"
                className={`${INPUT_CLS} font-mono text-xs`}
              />
            </div>
          </div>
        </div>

        {/* Part B: 8 Mandatory Statutory Certificates */}
        <div className="space-y-3 border-t border-rule pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">
              Part B — Mandatory Statutory Certificates (Circular 03/2021)
            </h3>
            <span className="text-xs text-ink-secondary">
              Expired dates automatically flag Gate 1 on save and read.
            </span>
          </div>

          <div className="divide-y divide-rule-subtle border-y border-rule">
            {certs.map((c, idx) => {
              const permAllowed = PERMANENT_ALLOWED_CODES.has(c.doc_code.trim().toUpperCase());
              const hasDateOrPerm = c.permanent || Boolean(c.valid_until.trim());
              const cls = hasDateOrPerm
                ? classifyAppendixIxCert(
                    {
                      doc_code: c.doc_code,
                      valid_until: c.permanent ? 'PERMANENT' : c.valid_until.trim(),
                      status: 'VALID',
                    },
                    todayIso,
                  )
                : null;
              return (
                <div
                  key={`${c.doc_code}-${idx}`}
                  className="grid grid-cols-1 gap-2.5 py-3 md:grid-cols-[1.35fr_1fr_1fr_auto] md:items-end"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-ink-muted">{c.doc_code} (Section B)</div>
                    <div className="text-xs font-semibold text-ink wrap-anywhere">{c.title}</div>
                  </div>
                  <div>
                    <label
                      htmlFor={`k12-cert-auth-${c.doc_code}`}
                      className="block text-xs font-medium text-ink-secondary"
                    >
                      Issuing authority
                    </label>
                    <input
                      id={`k12-cert-auth-${c.doc_code}`}
                      name={`cert_auth_${c.doc_code}`}
                      minLength={2}
                      maxLength={160}
                      value={c.issuing_authority}
                      onChange={(e) => updateCert(idx, { issuing_authority: e.target.value })}
                      placeholder="Department / Authority"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor={`k12-cert-exp-${c.doc_code}`}
                        className="text-xs font-medium text-ink-secondary"
                      >
                        Valid until
                      </label>
                      <label
                        title={
                          permAllowed
                            ? 'Registration / NOC certificates may be permanent'
                            : 'CBSE Gate 1 requires a renewable expiry date on this certificate'
                        }
                        className="inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 text-xs text-ink-secondary cursor-pointer"
                      >
                        <input
                          id={`k12-cert-perm-${c.doc_code}`}
                          name={`cert_perm_${c.doc_code}`}
                          type="checkbox"
                          checked={c.permanent}
                          onChange={(e) =>
                            updateCert(idx, {
                              permanent: e.target.checked,
                              valid_until: e.target.checked ? '' : c.valid_until,
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-ink-muted accent-action"
                        />
                        <span>Permanent</span>
                      </label>
                    </div>
                    <input
                      id={`k12-cert-exp-${c.doc_code}`}
                      name={`cert_exp_${c.doc_code}`}
                      type="date"
                      disabled={c.permanent}
                      value={c.valid_until}
                      onChange={(e) => updateCert(idx, { valid_until: e.target.value })}
                      className={`${INPUT_CLS} font-mono text-xs disabled:bg-subtle disabled:text-ink-muted`}
                    />
                  </div>
                  <div className="flex items-center md:justify-end">
                    {cls && (cls.state === 'permanent' || cls.state === 'valid') && c.issuing_authority.trim().length >= 2 ? (
                      <StatusBadge tone="verified" quiet>
                        {cls.label}
                      </StatusBadge>
                    ) : cls && cls.state === 'flagged' && c.permanent ? (
                      <StatusBadge tone="warn">{cls.label}</StatusBadge>
                    ) : cls && (cls.state === 'expired' || cls.state === 'invalid_date') ? (
                      <StatusBadge tone="blocker">{cls.label}</StatusBadge>
                    ) : (
                      <span className="text-xs text-ink-muted">Pending</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? 'Validating & Saving…' : 'Save K-12 Statutory Disclosure'}
        </Button>
      </form>
    </Sheet>
  );
}
