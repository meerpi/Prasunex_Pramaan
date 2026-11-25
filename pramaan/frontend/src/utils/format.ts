import type { AppendixIxCertificate, AuthUser, FindingRow } from '../api/types.ts';

export const INPUT_CLS =
  'mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action';

export const PERMANENT_TOKENS: ReadonlySet<string> = new Set([
  'PERMANENT',
  'LIFETIME',
  'NON-EXPIRING',
]);

export const PERMANENT_ALLOWED_CODES: ReadonlySet<string> = new Set(['B2', 'B3']);

export function isStaffWorkbenchRole(role: AuthUser['role']): boolean {
  return role === 'admin' || role === 'teacher';
}

/** Canonical claim field keys used when calling selective-disclosure QR APIs. */
export const ALL_CLAIM_KEYS = [
  'full_name',
  'program',
  'batch_year',
  'cgpa',
  'active_backlogs',
  'attendance_pct',
  'degree_status',
  'disciplinary_standing',
] as const;

const CLAIM_KEY_LABELS: Record<string, string> = {
  full_name: 'Student Name',
  program: 'Degree Program',
  batch_year: 'Admission Batch',
  cgpa: 'Cumulative GPA',
  cgpa_band: 'CGPA Band',
  active_backlogs: 'Active Backlogs',
  attendance_pct: 'Cumulative Attendance',
  degree_status: 'Enrollment Status',
  disciplinary_standing: 'Conduct Standing',
  school_name: 'School Name',
  board: 'Education Board',
  udise_qc_code: 'UDISE+ Code',
  affiliation_qc_code: 'Board Affiliation ID',
  smart_labs_upgradation: 'Smart Labs Upgradation',
  library_ejournals_ieee_acm: 'Library & IEEE/ACM e-Journals',
  campus_wifi_6_backbone: 'Campus Wi-Fi 6 Backbone',
  hostel_solar_accessibility: 'Hostel Solar & Accessibility Retrofits',
  placement_percentage: 'Placement Rate',
  infra_spend: 'Criterion IV Infrastructure Spend',
  median_ctc: 'Median Domestic CTC',
  pupil_teacher_ratio: 'Pupil–Teacher / Faculty Ratio',
  sanctioned_intake: 'Sanctioned Intake',
  board_pass_rate: 'Board Pass Rate',
  campus_area: 'Total Campus Area',
  teaching_staff: 'Teaching Staff Count',
  reported_metric: 'Reported Institutional Metric',
};

const TIER_LABELS: Record<string, string> = {
  tier_1_deterministic: 'Statutory Rule Check',
  tier_1_5_smt: 'Formal Z3 Proof',
  tier_2_conformal: 'Risk-Calibrated Claim Audit',
  tier_2_nli: 'Cross-Source Claim Inference',
  deterministic: 'Deterministic Check',
  z3_smt: 'Formal Z3 Proof',
  nli: 'Cross-Source Entailment',
};

const DISPUTE_CODE_LABELS: Record<string, string> = {
  value_contradiction: 'Conflicting Values',
  dispute_genuine_conflict: 'Genuine Value Conflict',
  corroborated: 'Sources Agree',
  reconciled_temporal: 'Different Academic Years',
  reconciled_scope: 'Different Sub-Cohorts',
  reconciled_rounding: 'Rounding Variance',
  contradicted: 'Direct Conflict',
};

const ANOMALY_KIND_LABELS: Record<string, string> = {
  micro_font: 'Microscopic Text (<4pt)',
  low_contrast: 'Low Contrast Footnote',
  hidden_layer: 'Hidden / Off-Canvas Text',
  scanned_ocr: 'OCR-Scanned Page',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  published: 'Published',
  allow: 'Approved',
  needs_review: 'Needs Human Review',
  block: 'Blocked',
};

function titleCaseSnake(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/(^|\s)(\p{L})/gu, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`)
    .replace(/\b(Cgpa|Ctc|Erp|Naac|Nba|Nirf|Sfr|Udise|Ieee|Acm|Iqac|Dpdp|Smt|Z3|Mcp|Hpc)\b/g, (m) =>
      m.toUpperCase(),
    );
}

export function humanizeClaimKey(key: string, isK12 = false): string {
  const norm = key.trim().toLowerCase();
  if (isK12) {
    if (norm === 'program') return 'Grade & Board Stream';
    if (norm === 'cgpa') return 'Academic Score / GPA';
  }
  if (CLAIM_KEY_LABELS[norm]) return CLAIM_KEY_LABELS[norm];
  if (CLAIM_KEY_LABELS[key]) return CLAIM_KEY_LABELS[key];
  if (!key.includes('_')) return key;
  return titleCaseSnake(key);
}

export function humanizeTier(tier?: string | null): string {
  if (!tier) return 'Verification Check';
  const norm = tier.trim().toLowerCase();
  return TIER_LABELS[norm] ?? titleCaseSnake(tier);
}

export function humanizeDispute(code?: string | null): string {
  if (!code) return 'Claim Cluster';
  const norm = code.trim().toLowerCase();
  return DISPUTE_CODE_LABELS[norm] ?? titleCaseSnake(code);
}

export function humanizeAnomalyKind(kind?: string | null): string {
  if (!kind) return 'Document Forensic Flag';
  const norm = kind.trim().toLowerCase();
  return ANOMALY_KIND_LABELS[norm] ?? titleCaseSnake(kind);
}

export function humanizeStatus(status?: string | null): string {
  if (!status) return 'Pending';
  const norm = status.trim().toLowerCase();
  return WORKFLOW_STATUS_LABELS[norm] ?? titleCaseSnake(status);
}

const numberFmt = new Intl.NumberFormat('en-IN');
const decimalFmt = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pluralRules = new Intl.PluralRules('en');

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  return numberFmt.format(value);
}

export function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  if (digits === 2) return decimalFmt.format(value);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}%`;
}

export function formatInr(
  value: number | null | undefined,
  unit = '',
  digits = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  const neg = value < 0;
  const formatted = formatDecimal(Math.abs(value), digits);
  return `${neg ? '−' : ''}₹${formatted}${unit}`;
}

export function formatClaimValue(key: string, raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '—';
  const trimmed = String(raw).trim();
  if (!trimmed) return '—';
  const norm = key.trim().toLowerCase();
  if (norm === 'cgpa') {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return formatDecimal(num, 2);
  }
  if (norm === 'attendance_pct') {
    const stripped = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed;
    const num = Number(stripped);
    if (Number.isFinite(num)) return formatPercent(num, 1);
  }
  return trimmed;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  // SQLite strips timezone suffixes on read; treat naive ISO timestamps as UTC so all portals render in local time.
  const normalized =
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(iso) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)
      ? `${iso.replace(' ', 'T')}Z`
      : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  if (d.getTime() === 0) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

const istIsoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayIstIso(now: Date = new Date()): string {
  return istIsoFmt.format(now);
}

export function parseCalendarDateIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  let y = 0;
  let m = 0;
  let d = 0;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const dmy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!dmy) return null;
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const trimmed = iso.trim();
  if (!trimmed) return '—';
  const parsedCalendar = parseCalendarDateIso(trimmed);
  const isDateOnly = parsedCalendar !== null;
  const normalized = isDateOnly ? `${parsedCalendar}T00:00:00Z` : trimmed;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return trimmed;
  if (d.getTime() === 0) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    ...(isDateOnly ? { timeZone: 'UTC' } : {}),
  }).format(d);
}

export function localDateIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isIsoDateExpired(
  raw: string | null | undefined,
  todayIso: string = todayIstIso(),
): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (!s) return false;
  if (PERMANENT_TOKENS.has(s.toUpperCase())) return false;
  const iso = parseCalendarDateIso(s);
  return iso !== null && iso < todayIso;
}

export interface ClassifiedAppendixIxCert {
  state: 'permanent' | 'valid' | 'expired' | 'invalid_date' | 'flagged';
  label: string;
  detail: string;
}

export function classifyAppendixIxCert(
  cert: Pick<AppendixIxCertificate, 'doc_code' | 'valid_until' | 'status'>,
  todayIso: string = todayIstIso(),
): ClassifiedAppendixIxCert {
  const statusNorm = (cert.status ?? '').trim().toUpperCase();
  const statusOk = statusNorm === 'VALID' || statusNorm === 'VERIFIED';
  const rawDate = (cert.valid_until ?? '').trim();
  const upperDate = rawDate.toUpperCase();
  const isPermToken = PERMANENT_TOKENS.has(upperDate);
  const permAllowed = PERMANENT_ALLOWED_CODES.has((cert.doc_code ?? '').trim().toUpperCase());

  if (isPermToken) {
    if (!permAllowed) {
      return {
        state: 'flagged',
        label: 'Expiry required',
        detail: 'Permanent validity is only permitted on B2/B3; renewable expiry date required',
      };
    }
    if (!statusOk) {
      return {
        state: 'flagged',
        label: 'Flagged / Revoked',
        detail: 'Flagged / Revoked (permanent record)',
      };
    }
    return {
      state: 'permanent',
      label: 'Permanent',
      detail: 'Permanent validity',
    };
  }

  const parsedIso = parseCalendarDateIso(rawDate);
  if (!parsedIso) {
    return {
      state: 'invalid_date',
      label: 'Invalid Date',
      detail: rawDate ? `Unparseable expiry date (${rawDate})` : 'Missing expiry date',
    };
  }

  const formatted = formatDate(parsedIso);
  if (parsedIso < todayIso) {
    return {
      state: 'expired',
      label: 'Expired',
      detail: `Expired ${formatted}`,
    };
  }

  if (!statusOk) {
    return {
      state: 'flagged',
      label: 'Flagged / Revoked',
      detail: `Flagged / Revoked (valid until ${formatted})`,
    };
  }

  return {
    state: 'valid',
    label: 'Valid',
    detail: `Valid until ${formatted}`,
  };
}

const NAME_HONORIFICS = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'shri', 'smt', 'er', 'kumari']);
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);

function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Seg = (Intl as unknown as { Segmenter: new (loc?: string, opts?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
    const seg = new Seg(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

export function initialsForName(name: string): string {
  const rawTokens = name
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const graphemes = splitGraphemes(tok);
      const firstIdx = graphemes.findIndex((g) => /^[\p{L}\p{N}]/u.test(g));
      return firstIdx >= 0 ? graphemes.slice(firstIdx).join('') : '';
    })
    .filter(Boolean);

  const stripped = [...rawTokens];
  while (
    stripped.length > 1 &&
    NAME_HONORIFICS.has(stripped[0].replace(/[.,]+$/g, '').toLowerCase())
  ) {
    stripped.shift();
  }
  while (
    stripped.length > 1 &&
    NAME_SUFFIXES.has(stripped[stripped.length - 1].replace(/[.,]+$/g, '').toLowerCase())
  ) {
    stripped.pop();
  }
  const tokens = stripped.length > 0 ? stripped : rawTokens;
  if (tokens.length === 0) return 'PR';
  if (tokens.length === 1) {
    const gs = splitGraphemes(tokens[0]).filter((g) => /^[\p{L}\p{N}]/u.test(g));
    return (gs.slice(0, 2).join('') || 'PR').toUpperCase();
  }
  const firstG = splitGraphemes(tokens[0])[0] ?? '';
  const lastG = splitGraphemes(tokens[tokens.length - 1])[0] ?? '';
  return `${firstG}${lastG}`.toUpperCase() || 'PR';
}

export function csvCell(val: unknown): string {
  const collapsed = String(val ?? '').replace(/[\r\n]+/g, ' ');
  const safe = /^[=+\-@\t\r]/.test(collapsed) ? `'${collapsed}` : collapsed;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below when Clipboard API is unavailable or denied
  }
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    ta.remove();
  }
  return ok;
}

export function pluralize(count: number, singular: string, pluralForm?: string): string {
  const safeCount = Number.isFinite(count) ? count : 0;
  const autoPlural =
    /(?:s|ss|sh|ch|x|z)$/i.test(singular)
      ? `${singular}es`
      : /[^aeiou]y$/i.test(singular)
        ? `${singular.slice(0, -1)}ies`
        : `${singular}s`;
  const word = pluralRules.select(safeCount) === 'one' ? singular : pluralForm ?? autoPlural;
  return `${formatCount(safeCount)} ${word}`;
}

export function truncateMiddle(text: string | null | undefined, head = 12, tail = 8): string {
  if (!text) return '—';
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

export function findingTone(f: Pick<FindingRow, 'severity' | 'payload'>): 'smt' | 'blocker' | 'warn' {
  if (f.payload.trace?.tier === 'tier_1_5_smt') return 'smt';
  if (f.severity >= 50) return 'blocker';
  return 'warn';
}

export function humanizeSchoolLabel(raw: string | null | undefined): string {
  if (!raw) return 'Verified School';
  return raw.trim();
}

export function humanizeAuditAction(action: string | null | undefined): string {
  if (!action) return 'Recorded';
  const norm = action.trim().toLowerCase();
  const map: Record<string, string> = {
    create: 'Draft Created',
    submit: 'Submitted for Review',
    approve: 'Approved',
    publish: 'Signed & Published',
    request_changes: 'Revisions Requested',
    edit: 'Revision Saved',
  };
  return map[norm] ?? humanizeStatus(action);
}

export function humanizeSeverity(severity: number): string {
  if (severity >= 75) return 'Statutory Blocker';
  if (severity >= 50) return 'Compliance Blocker';
  return 'Advisory';
}

export function humanizeFindingMessage(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = raw.match(
    /^Tier\s+\d+\s+NLI\/Slot\s+mismatch\s+vs\s+Canon\s+['`‘’"]([^'`‘’"]+)['`‘’"]:\s*(.*)$/i,
  );
  if (m) {
    return `Omission against institutional canon: ${m[2]}`;
  }
  return raw
    .replace(/\bCanon\s+['`‘’"][^'`‘’"]+['`‘’"]\s*:\s*/gi, 'institutional ordinance: ')
    .trim();
}

export function humanizeAnomalySummary(page: number, kind: string, detail: string): string {
  const pg = Math.max(1, page + 1);
  const ptMatch = detail.match(/(\d+(?:\.\d+)?)\s*pt/i);
  if (/micro/i.test(kind) || /microtext/i.test(detail)) {
    return ptMatch
      ? `Page ${pg}: Microscopic footnote (${ptMatch[1]}pt text, below 3.0pt legibility threshold)`
      : `Page ${pg}: Microscopic footnote below minimum legibility size`;
  }
  if (/contrast/i.test(kind)) {
    return `Page ${pg}: Low-contrast disclosure text (${detail.replace(/WCAG/i, 'contrast')})`;
  }
  if (/hidden/i.test(kind)) {
    return `Page ${pg}: Hidden or off-canvas text layer detected`;
  }
  return `Page ${pg}: ${humanizeAnomalyKind(kind)} — ${detail}`;
}

export function orderDisclosedKeys(keys: string[]): string[] {
  const rank = new Map<string, number>(ALL_CLAIM_KEYS.map((k, idx) => [k, idx]));
  return [...keys].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
}

export function humanizeDocumentName(filename: string | null | undefined): string {
  if (!filename) return 'Source Document';
  return titleCaseSnake(filename.replace(/\.pdf$/i, ''));
}

export function humanizeGateId(gateId: string): string {
  const m = gateId.match(/^GATE[-_ ]?(\d+)$/i);
  if (m) return `Check ${m[1]}`;
  return gateId;
}

export function humanizeClusterSubject(subject: string, predicate: string): { title: string; subtitle: string } {
  const pred = predicate.trim().toLowerCase();
  const titleMap: Record<string, string> = {
    placement_rate: 'Campus Placement Rate',
    placement_percentage: 'Campus Placement Rate',
    median_ctc: 'Median Compensation Package',
    infra_spend: 'Criterion IV Infrastructure Spend',
    criterion_4_spend: 'Criterion IV Infrastructure Spend',
  };
  const cleanSubject = subject.replace(/_/g, ' ').trim();
  return {
    title:
      titleMap[pred] ??
      (pred === 'reported_metric' && cleanSubject ? cleanSubject : humanizeClaimKey(predicate)),
    subtitle: cleanSubject,
  };
}

export function humanizeClusterExplanation(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\bplacement_percentage\b/g, 'placement rate')
    .replace(/\bplacement_rate\b/g, 'placement rate')
    .replace(/\bmedian_ctc\b/g, 'median compensation package')
    .replace(/\binfra_spend\b/g, 'infrastructure expenditure');
}

const LAST_QR_KEY = 'pramaan_last_qr_v1';

interface SessionQrHandoff {
  holder: string;
  base45: string;
  sdJwt?: string;
}

export function saveLastQrToken(holder: string, base45: string, sdJwt?: string): void {
  try {
    sessionStorage.setItem(LAST_QR_KEY, JSON.stringify({ holder, base45, sdJwt }));
  } catch {
    // Ignore storage quota / privacy mode restrictions
  }
}

export function paragraphsToHtml(text: string): string {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  if (parts.length === 0) return '<p></p>';
  return parts
    .map(
      (p) =>
        `<p>${p
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`,
    )
    .join('');
}

export function clearLastQrToken(): void {
  try {
    sessionStorage.removeItem(LAST_QR_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

export function loadLastQrToken(): SessionQrHandoff | null {
  try {
    const raw = sessionStorage.getItem(LAST_QR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionQrHandoff>;
    if (typeof parsed.holder === 'string' && typeof parsed.base45 === 'string' && parsed.base45.length > 0) {
      return {
        holder: parsed.holder,
        base45: parsed.base45,
        sdJwt: typeof parsed.sdJwt === 'string' && parsed.sdJwt.length > 0 ? parsed.sdJwt : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

