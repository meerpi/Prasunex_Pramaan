import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  Filter,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  CanonSummary,
  RecruiterBatchItem,
  RecruiterBatchResult,
  RecruiterFileScreenItem,
  RecruiterFileScreenResult,
  RevocationEntry,
  VerifiedQrPassport,
} from '../../api/types.ts';
import {
  csvCell,
  downloadBlob,
  formatClaimValue,
  formatCount,
  formatDateTime,
  humanizeAnomalyKind,
  humanizeClaimKey,
  humanizeStatus,
  loadLastQrToken,
  localDateIso,
  orderDisclosedKeys,
  pluralize,
  truncateMiddle,
} from '../../utils/format.ts';
import { useCopyFeedback } from '../../utils/useCopyFeedback.ts';
import {
  Button,
  DataTable,
  DisclosureProof,
  SegmentedTabs,
  Sheet,
  StatusBadge,
} from '../ui/index.ts';

const CANON_TITLE_MAP: Record<string, string> = {
  'pramaan-campus-placement': 'Campus Placement & Career Claims',
  'pramaan-faculty-academic-audit': 'Faculty & Academic Audit Ordinance',
  'pramaan-naac-aishe-ssr': 'NAAC / AISHE Statutory Disclosure',
  'pramaan-cbse-k12-disclosure': 'CBSE K-12 Mandatory Disclosure',
};

function humanizeCanonId(id: string): string {
  if (CANON_TITLE_MAP[id]) return CANON_TITLE_MAP[id];
  return id
    .replace(/^pramaan-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\b(Naac|Aishe|Ssr|Cbse|K12|Erp|Cgpa)\b/g, (m) => m.toUpperCase());
}

function canonDisplayTitle(canon: CanonSummary): string {
  const maybeTitle = (canon as CanonSummary & { title?: string }).title?.trim();
  if (maybeTitle) return maybeTitle;
  const yamlTitle = canon.yaml.match(/^\s*(?:title|name):\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim();
  return yamlTitle || humanizeCanonId(canon.id);
}

function resolveCanonTitle(canonId: string, canons: CanonSummary[]): string {
  const found = canons.find((c) => c.id === canonId);
  return found ? canonDisplayTitle(found) : humanizeCanonId(canonId);
}

const RecruiterCameraScanner = lazy(() =>
  import('./RecruiterCameraScanner.tsx').then((m) => ({ default: m.RecruiterCameraScanner })),
);

interface SessionLogEntry {
  id: string;
  timestamp: string;
  candidate: string;
  channel: 'Pass Verify' | 'File Screen' | 'Text Batch';
  passStatus: string;
  forensics: string;
  decision: string;
}

interface QueuedResumeFile {
  id: string;
  file: File;
  uploadName: string;
  token: string;
}

function disambiguateFilename(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  let n = 2;
  while (usedNames.has(`${stem} (${n})${ext}`)) n += 1;
  return `${stem} (${n})${ext}`;
}

export function RecruiterPortal() {
  const [activeTab, setActiveTab] = useState<'verify' | 'screen' | 'log'>('verify');
  const [recentQr, setRecentQr] = useState(() => loadLastQrToken());
  const [payloadInput, setPayloadInput] = useState('');
  const [verified, setVerified] = useState<VerifiedQrPassport | null>(null);
  const [verifyErr, setVerifyErr] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Live revocation register & institutional canons loaded in parallel on mount
  const [revocations, setRevocations] = useState<RevocationEntry[]>([]);
  const [crlLoading, setCrlLoading] = useState(true);
  const [crlErr, setCrlErr] = useState('');
  const [canons, setCanons] = useState<CanonSummary[]>([]);
  const [selectedCanonId, setSelectedCanonId] = useState('pramaan-campus-placement');

  const refreshCrl = useCallback(async () => {
    setCrlLoading(true);
    setCrlErr('');
    try {
      const res = await api.listRevocations();
      setRevocations(res.revocations ?? []);
    } catch (e: unknown) {
      setCrlErr(
        e instanceof Error
          ? e.message
          : 'Unable to sync the revoked passes register. Displaying last known list.',
      );
    } finally {
      setCrlLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      setCrlLoading(true);
      setCrlErr('');
      const [crlRes, canonRes] = await Promise.allSettled([api.listRevocations(), api.listCanons()]);
      if (!active) return;
      if (crlRes.status === 'fulfilled') {
        setRevocations(crlRes.value.revocations ?? []);
      } else {
        setCrlErr(
          crlRes.reason instanceof Error
            ? crlRes.reason.message
            : 'Unable to load the revoked passes register.',
        );
      }
      if (canonRes.status === 'fulfilled' && canonRes.value.length > 0) {
        setCanons(canonRes.value);
      }
      setCrlLoading(false);
    };
    void init();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncRecent = () => {
      const next = loadLastQrToken();
      setRecentQr((prev) =>
        prev?.base45 === next?.base45 && prev?.sdJwt === next?.sdJwt && prev?.holder === next?.holder
          ? prev
          : next,
      );
    };
    window.addEventListener('focus', syncRecent);
    return () => {
      window.removeEventListener('focus', syncRecent);
    };
  }, []);

  // Multi-file PDF/DOCX/TXT screening desk state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const verifyReqRef = useRef(0);
  const screenReqRef = useRef(0);
  const fileIdSeqRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<QueuedResumeFile[]>([]);
  const [attachingFileId, setAttachingFileId] = useState<string | null>(null);
  const [showEligibility, setShowEligibility] = useState(false);
  const [minCgpa, setMinCgpa] = useState('');
  const [maxBacklogs, setMaxBacklogs] = useState('');
  const [reqBatchYear, setReqBatchYear] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileErr, setFileErr] = useState('');
  const [fileResult, setFileResult] = useState<RecruiterFileScreenResult | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const { copiedKey: copiedSafeId, copy: copyWithFeedback } = useCopyFeedback<string>();

  // Progressive-disclosure legacy quick-text / JSON batch drawer
  const [showTextBatch, setShowTextBatch] = useState(false);
  const [batchJson, setBatchJson] = useState('');
  const [candName, setCandName] = useState('');
  const [candContent, setCandContent] = useState('');
  const [expandedRowIdx, setExpandedRowIdx] = useState<number | null>(null);
  const [batchResult, setBatchResult] = useState<RecruiterBatchResult | null>(null);
  const [batchErr, setBatchErr] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Session Verification & Screening Ledger (accumulates across candidates; CSV exportable)
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const [confirmClearLog, setConfirmClearLog] = useState(false);

  const appendLog = useCallback((entries: SessionLogEntry[]) => {
    setSessionLog((prev) => [...entries, ...prev].slice(0, 1000));
  }, []);

  const handleVerifyPayload = useCallback(
    async (overridePayload?: string) => {
      const raw = (overridePayload ?? payloadInput).trim();
      if (raw.length < 4) {
        setVerifyErr('Enter at least 4 characters of a verification code or token.');
        return;
      }
      const seq = ++verifyReqRef.current;
      setVerifyBusy(true);
      setVerifyErr('');
      try {
        const res = await api.verifyPassport(raw);
        if (seq !== verifyReqRef.current) return;
        setVerified(res);
        setCameraOpen(false);
        appendLog([
          {
            id: `pass-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            candidate: res.disclosed_claims.full_name || res.holder_prn || 'Unknown Pass',
            channel: 'Pass Verify',
            passStatus: res.revoked ? 'Revoked' : res.valid ? 'Authentic' : 'Invalid',
            forensics: 'QR / Token',
            decision: res.valid && !res.revoked ? 'Approved' : 'Blocked',
          },
        ]);
      } catch (e: unknown) {
        if (seq === verifyReqRef.current) {
          setVerifyErr(e instanceof Error ? e.message : 'Unable to verify pass payload');
        }
      } finally {
        if (seq === verifyReqRef.current) setVerifyBusy(false);
      }
    },
    [appendLog, payloadInput],
  );

  const handleUploadQrImage = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const seq = ++verifyReqRef.current;
      setVerifyBusy(true);
      setVerifyErr('');
      try {
        const res = await api.verifyPassportImage(file);
        if (seq !== verifyReqRef.current) return;
        setVerified(res);
        setCameraOpen(false);
        appendLog([
          {
            id: `qrimg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            candidate: res.disclosed_claims.full_name || res.holder_prn || file.name,
            channel: 'Pass Verify',
            passStatus: res.revoked ? 'Revoked' : res.valid ? 'Authentic' : 'Invalid',
            forensics: 'QR Image',
            decision: res.valid && !res.revoked ? 'Approved' : 'Blocked',
          },
        ]);
      } catch (e: unknown) {
        if (seq === verifyReqRef.current) {
          setVerifyErr(e instanceof Error ? e.message : 'Unable to decode uploaded QR image');
        }
      } finally {
        if (seq === verifyReqRef.current) setVerifyBusy(false);
      }
    },
    [appendLog],
  );

  const enqueueFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setFileErr('');
    const added = Array.from(incoming);
    const remainingSlots = Math.max(0, 25 - queuedFiles.length);
    const accepted = added.slice(0, remainingSlots);
    const droppedCount = added.length - accepted.length;
    if (accepted.length > 0) {
      setQueuedFiles((prev) => {
        const next = [...prev];
        const usedNames = new Set(prev.map((q) => q.uploadName));
        for (const f of accepted) {
          if (next.length >= 25) break;
          const uploadName = disambiguateFilename(f.name, usedNames);
          usedNames.add(uploadName);
          const normalizedFile =
            uploadName === f.name
              ? f
              : new File([f], uploadName, { type: f.type, lastModified: f.lastModified });
          fileIdSeqRef.current += 1;
          next.push({
            id: `qf-${fileIdSeqRef.current}`,
            file: normalizedFile,
            uploadName,
            token: '',
          });
        }
        return next;
      });
    }
    if (droppedCount > 0) {
      setFileErr(
        `Maximum 25 resumes per batch; ${pluralize(droppedCount, 'extra file')} ignored.`,
      );
    }
  };

  const removeQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((q) => q.id !== id));
    if (attachingFileId === id) setAttachingFileId(null);
  };

  const handleScreenFiles = async () => {
    if (queuedFiles.length === 0) return;
    const cgpaVal = minCgpa.trim() ? Number(minCgpa) : null;
    if (cgpaVal !== null && (!Number.isFinite(cgpaVal) || cgpaVal < 0 || cgpaVal > 10)) {
      setFileErr('Minimum CGPA must be a number between 0 and 10.');
      return;
    }
    const backlogsVal = maxBacklogs.trim() ? Number(maxBacklogs) : null;
    if (
      backlogsVal !== null &&
      (!Number.isInteger(backlogsVal) || backlogsVal < 0 || backlogsVal > 50)
    ) {
      setFileErr('Maximum active backlogs must be a whole number between 0 and 50.');
      return;
    }
    const batchVal = reqBatchYear.trim() ? Number(reqBatchYear) : null;
    if (batchVal !== null && (!Number.isInteger(batchVal) || batchVal < 1950 || batchVal > 2100)) {
      setFileErr('Required batch year must be a valid year between 1950 and 2100.');
      return;
    }

    const seq = ++screenReqRef.current;
    setFileBusy(true);
    setFileErr('');
    setExpandedFileId(null);
    const attachedMap: Record<string, string> = {};
    for (const q of queuedFiles) {
      if (q.token.trim()) attachedMap[q.uploadName] = q.token.trim();
    }
    try {
      const res = await api.recruiterScreenFiles({
        files: queuedFiles.map((q) => q.file),
        canon_id: selectedCanonId,
        alpha: 0.1,
        attached_passports: attachedMap,
        min_cgpa: cgpaVal,
        max_backlogs: backlogsVal,
        required_batch_year: batchVal,
      });
      if (seq !== screenReqRef.current) return;
      setFileResult(res);
      if (res.items.length === 1) {
        setExpandedFileId(res.items[0].item_id);
      }
      const nowIso = new Date().toISOString();
      appendLog(
        res.items.map((it) => ({
          id: it.item_id,
          timestamp: nowIso,
          candidate: it.embedded_pass?.disclosed_claims?.full_name || it.filename,
          channel: 'File Screen',
          passStatus: !it.embedded_pass
            ? 'No pass'
            : it.embedded_pass.revoked
              ? 'Revoked'
              : it.embedded_pass.valid
                ? 'Verified Pass'
                : 'Invalid Pass',
          forensics: it.forensics.has_hidden_text
            ? `${pluralize(it.forensics.anomalies.length || 1, 'hidden layer')}`
            : 'Clean',
          decision: humanizeStatus(it.decision),
        })),
      );
    } catch (e: unknown) {
      if (seq === screenReqRef.current) {
        setFileErr(e instanceof Error ? e.message : 'Unable to screen uploaded candidate files');
      }
    } finally {
      if (seq === screenReqRef.current) setFileBusy(false);
    }
  };

  const copySanitizedText = async (itemId: string, text: string) => {
    if (!text) return;
    const ok = await copyWithFeedback(itemId, text);
    if (!ok) {
      setFileErr('Clipboard write was blocked by your browser.');
    }
  };

  const handleAddCandidateRow = () => {
    const trimmedName = candName.trim();
    const trimmedContent = candContent.trim();
    if (!trimmedName || !trimmedContent) return;
    if (trimmedName.length > 160) {
      setBatchErr('Candidate name must be 160 characters or fewer.');
      return;
    }
    if (trimmedContent.length > 50_000) {
      setBatchErr('Resume statement must be 50,000 characters or fewer.');
      return;
    }
    setBatchErr('');
    try {
      const current = batchJson.trim() ? (JSON.parse(batchJson) as unknown) : [];
      const arr = Array.isArray(current) ? current : [];
      if (arr.length >= 100) {
        setBatchErr('Text batch audit supports up to 100 candidates per submission.');
        return;
      }
      const next = [...arr, { name: trimmedName, content: trimmedContent }];
      setBatchJson(JSON.stringify(next, null, 2));
      setCandName('');
      setCandContent('');
    } catch {
      setBatchErr('Fix existing JSON array syntax before appending a candidate.');
    }
  };

  const handleBatchAudit = async () => {
    if (!batchJson.trim()) return;
    setBatchBusy(true);
    setBatchErr('');
    setExpandedRowIdx(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(batchJson);
      } catch {
        throw new Error(
          'Invalid JSON syntax. Provide an array like [{"name": "Candidate", "content": "Claim text"}].',
        );
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some((x) => !x || typeof x.name !== 'string' || typeof x.content !== 'string')
      ) {
        throw new Error(
          'Expected a non-empty JSON array where each entry has "name" and "content" strings.',
        );
      }
      if (parsed.length > 100) {
        throw new Error('Batch audit supports at most 100 candidates per request.');
      }
      const typed = parsed as Array<{ name: string; content: string }>;
      if (typed.some((x) => x.name.length > 160 || x.content.length > 50_000)) {
        throw new Error(
          'Each entry must have a name ≤ 160 characters and content ≤ 50,000 characters.',
        );
      }
      const res = await api.recruiterBatchAudit(selectedCanonId, 0.1, typed);
      setBatchResult(res);
      const nowIso = new Date().toISOString();
      appendLog(
        res.items.map((it, i) => ({
          id: it.item_id ?? `txt-${Date.now()}-${i}`,
          timestamp: nowIso,
          candidate: it.filename,
          channel: 'Text Batch',
          passStatus: 'Text only',
          forensics: `${formatCount(it.blockers_count)} blockers, ${formatCount(it.warnings_count)} advisories`,
          decision: humanizeStatus(it.decision),
        })),
      );
    } catch (e: unknown) {
      setBatchErr(e instanceof Error ? e.message : 'Batch claim audit failed');
    } finally {
      setBatchBusy(false);
    }
  };

  const exportSessionCsv = () => {
    if (sessionLog.length === 0) return;
    const header = ['Timestamp', 'Candidate', 'Channel', 'Pass Status', 'Forensics', 'Decision'];
    const lines = [
      header.map(csvCell).join(','),
      ...sessionLog.map((row) =>
        [row.timestamp, row.candidate, row.channel, row.passStatus, row.forensics, row.decision]
          .map(csvCell)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `pramaan-recruiter-session-${localDateIso()}.csv`);
  };

  const crlSearchText = useCallback((r: RevocationEntry) => `${r.passport_id} ${r.reason}`, []);

  const crlColumns = useMemo(
    () => [
      {
        key: 'id',
        header: 'Pass ID',
        cellClassName: 'whitespace-nowrap',
        render: (r: RevocationEntry) => (
          <span dir="ltr" title={r.passport_id} className="font-mono text-xs text-ink whitespace-nowrap">
            {truncateMiddle(r.passport_id, 10, 6)}
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (r: RevocationEntry) => (
          <span className="text-xs text-ink-secondary wrap-anywhere">
            {r.reason?.trim() || '—'}
          </span>
        ),
      },
      {
        key: 'at',
        header: 'Revoked',
        align: 'right' as const,
        render: (r: RevocationEntry) => (
          <span className="text-xs text-ink-muted whitespace-nowrap tabular">
            {formatDateTime(r.revoked_at)}
          </span>
        ),
      },
    ],
    [],
  );

  const fileSearchText = useCallback(
    (r: RecruiterFileScreenItem) =>
      `${r.filename} ${r.embedded_pass?.disclosed_claims?.full_name ?? ''} ${r.decision}`,
    [],
  );

  const fileColumns = useMemo(
    () => [
      {
        key: 'candidate',
        header: 'Candidate / File',
        sortValue: (r: RecruiterFileScreenItem) => r.filename,
        render: (r: RecruiterFileScreenItem) => (
          <div className="min-w-0">
            <div
              dir="auto"
              title={r.embedded_pass?.disclosed_claims?.full_name || r.filename}
              className="font-semibold text-ink wrap-anywhere"
            >
              {r.embedded_pass?.disclosed_claims?.full_name || truncateMiddle(r.filename, 24, 12)}
            </div>
            {r.embedded_pass?.disclosed_claims?.full_name && (
              <div
                title={r.filename}
                className="font-mono text-xs text-ink-muted truncate max-w-[26ch]"
              >
                {truncateMiddle(r.filename, 18, 10)}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'signals',
        header: 'Pass & Forensics',
        render: (r: RecruiterFileScreenItem) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {r.embedded_pass ? (
              r.embedded_pass.revoked ? (
                <StatusBadge tone="blocker">Pass Revoked</StatusBadge>
              ) : r.embedded_pass.valid ? (
                <StatusBadge tone="verified" quiet>
                  {r.embedded_pass.source === 'embedded_pdf_qr' ? 'PDF QR Valid' : 'Pass Valid'}
                </StatusBadge>
              ) : (
                <StatusBadge tone="blocker">Invalid Pass</StatusBadge>
              )
            ) : (
              <span className="text-xs text-ink-muted">No pass</span>
            )}
            {r.forensics.has_hidden_text && (
              <StatusBadge tone="blocker">Hidden Text</StatusBadge>
            )}
            {r.cross_checks.some((c) => c.status === 'mismatch') && (
              <StatusBadge tone="blocker">Claim Mismatch</StatusBadge>
            )}
            {r.eligibility.active && r.eligibility.passed === false && (
              <StatusBadge tone="warn">Below Cutoff</StatusBadge>
            )}
          </div>
        ),
      },
      {
        key: 'decision',
        header: 'Decision',
        cellClassName: 'whitespace-nowrap',
        sortValue: (r: RecruiterFileScreenItem) => r.decision,
        render: (r: RecruiterFileScreenItem) =>
          r.decision === 'allow' ? (
            <StatusBadge tone="verified" quiet className="whitespace-nowrap">
              {humanizeStatus(r.decision)}
            </StatusBadge>
          ) : (
            <StatusBadge tone={r.decision === 'block' ? 'blocker' : 'warn'} className="whitespace-nowrap">
              {humanizeStatus(r.decision)}
            </StatusBadge>
          ),
      },
      {
        key: 'inspect',
        header: 'Dossier',
        align: 'right' as const,
        render: (r: RecruiterFileScreenItem) => {
          const open = expandedFileId === r.item_id;
          return (
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              aria-expanded={open}
              onClick={() => setExpandedFileId(open ? null : r.item_id)}
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              )}
              {open ? 'Hide' : 'Inspect'}
            </Button>
          );
        },
      },
    ],
    [expandedFileId],
  );

  type IndexedBatchItem = RecruiterBatchItem & { _rowIdx: number };

  const indexedBatchRows = useMemo<IndexedBatchItem[]>(
    () => (batchResult?.items ?? []).map((it, idx) => ({ ...it, _rowIdx: idx })),
    [batchResult],
  );

  const batchColumns = useMemo(
    () => [
      {
        key: 'file',
        header: 'Candidate',
        sortValue: (r: IndexedBatchItem) => r.filename,
        render: (r: IndexedBatchItem) => (
          <span dir="auto" title={r.filename} className="font-medium">
            {truncateMiddle(r.filename, 28, 12)}
          </span>
        ),
      },
      {
        key: 'decision',
        header: 'Decision',
        sortValue: (r: IndexedBatchItem) => r.decision,
        render: (r: IndexedBatchItem) =>
          r.decision === 'allow' ? (
            <StatusBadge tone="verified" quiet>
              {humanizeStatus(r.decision)}
            </StatusBadge>
          ) : (
            <StatusBadge tone={r.decision === 'block' ? 'blocker' : 'warn'}>
              {humanizeStatus(r.decision)}
            </StatusBadge>
          ),
      },
      {
        key: 'counts',
        header: 'Flags',
        align: 'right' as const,
        sortValue: (r: IndexedBatchItem) => r.findings_count,
        render: (r: IndexedBatchItem) =>
          `${formatCount(r.blockers_count)} blockers, ${formatCount(r.warnings_count)} advisories`,
      },
      {
        key: 'inspect',
        header: 'Details',
        align: 'right' as const,
        render: (r: IndexedBatchItem) => {
          const open = expandedRowIdx === r._rowIdx;
          return r.findings.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              aria-expanded={open}
              onClick={() => setExpandedRowIdx(open ? null : r._rowIdx)}
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              )}
              {pluralize(r.findings.length, 'flag')}
            </Button>
          ) : (
            <span className="text-xs text-ink-muted">Clean</span>
          );
        },
      },
    ],
    [expandedRowIdx],
  );

  const sessionSearchText = useCallback(
    (r: SessionLogEntry) => `${r.candidate} ${r.passStatus} ${r.decision} ${r.channel}`,
    [],
  );

  const sessionColumns = useMemo(
    () => [
      {
        key: 'cand',
        header: 'Candidate',
        render: (r: SessionLogEntry) => (
          <span dir="auto" title={r.candidate} className="font-semibold text-ink">
            {truncateMiddle(r.candidate, 28, 12)}
          </span>
        ),
      },
      {
        key: 'time',
        header: 'Recorded',
        render: (r: SessionLogEntry) => (
          <span dir="ltr" className="text-xs text-ink-muted whitespace-nowrap tabular">
            {formatDateTime(r.timestamp)}
          </span>
        ),
      },
      {
        key: 'channel',
        header: 'Mode',
        render: (r: SessionLogEntry) => (
          <span className="text-xs text-ink-secondary">{r.channel}</span>
        ),
      },
      {
        key: 'pass',
        header: 'Credential',
        render: (r: SessionLogEntry) => <span className="text-xs text-ink">{r.passStatus}</span>,
      },
      {
        key: 'for',
        header: 'Forensics',
        render: (r: SessionLogEntry) => (
          <span className="text-xs text-ink-secondary">{r.forensics}</span>
        ),
      },
      {
        key: 'dec',
        header: 'Verdict',
        align: 'right' as const,
        render: (r: SessionLogEntry) =>
          r.decision === 'Approved' ? (
            <StatusBadge tone="verified" quiet>
              {r.decision}
            </StatusBadge>
          ) : (
            <StatusBadge tone={r.decision === 'Blocked' ? 'blocker' : 'warn'}>
              {r.decision}
            </StatusBadge>
          ),
      },
    ],
    [],
  );

  const activeFileDossier = useMemo(
    () => fileResult?.items.find((it) => it.item_id === expandedFileId) ?? null,
    [expandedFileId, fileResult],
  );

  const eligibilityActiveCount = [minCgpa, maxBacklogs, reqBatchYear].filter((v) => v.trim()).length;

  return (
    <div className="space-y-8 min-w-0">
      <header className="gazette-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Credential Verifier &amp; Candidate Screening
          </h1>
          <p className="text-sm text-ink-secondary">
            Verify signed student passes offline against the revocation register, scan resume PDFs
            for hidden prompt injections, and cross-check claims against signed credentials.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <StatusBadge
            tone={crlErr || revocations.length > 0 ? 'warn' : 'verified'}
            quiet={!crlErr && revocations.length === 0}
            icon={<ShieldCheck className="h-4 w-4" />}
          >
            {crlLoading
              ? 'Syncing revocation list…'
              : `Revoked passes: ${formatCount(revocations.length)}`}
          </StatusBadge>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh revocation list"
            disabled={crlLoading}
            onClick={() => void refreshCrl()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${crlLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <SegmentedTabs
        ariaLabel="Recruiter workspace sections"
        idPrefix="recruiter-tab"
        value={activeTab}
        onChange={(next) => {
          setActiveTab(next);
          setConfirmClearLog(false);
        }}
        options={[
          {
            id: 'verify',
            label: 'Verify Pass',
            panelId: 'recruiter-panel-verify',
          },
          {
            id: 'screen',
            label: 'Screen Resumes',
            panelId: 'recruiter-panel-screen',
          },
          {
            id: 'log',
            label: 'Session Log',
            panelId: 'recruiter-panel-log',
            badge:
              sessionLog.length > 0 ? (
                <span className="text-ink-secondary tabular">({formatCount(sessionLog.length)})</span>
              ) : undefined,
          },
        ]}
      />

      {crlErr && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-y border-warn-border bg-warn-bg px-4 py-2.5 text-sm font-medium text-warn"
        >
          <span className="min-w-0 flex-1 wrap-anywhere">{crlErr}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={crlLoading}
            onClick={() => void refreshCrl()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${crlLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* TAB 1: Verify Signed Student Pass + Revoked Passes Register */}
      {activeTab === 'verify' && (
        <div
          id="recruiter-panel-verify"
          role="tabpanel"
          aria-labelledby="recruiter-tab-verify"
          className="grid grid-cols-1 gap-9 xl:grid-cols-[7fr_5fr] items-start"
        >
          <Sheet
            tone="paper"
            title="Verify Signed Student Pass"
            subtitle="Paste a verification code or token, scan via camera, or upload a student’s QR pass PNG."
          >
            <div className="space-y-4">
              {verifyErr && (
                <div
                  role="alert"
                  className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-sm font-medium text-blocker wrap-anywhere"
                >
                  {verifyErr}
                </div>
              )}

              <div>
                <label htmlFor="qr-payload-input" className="block text-xs font-semibold text-ink">
                  Verification code or token
                </label>
                <textarea
                  id="qr-payload-input"
                  name="qr_payload"
                  rows={4}
                  maxLength={16384}
                  value={payloadInput}
                  onChange={(e) => setPayloadInput(e.target.value)}
                  placeholder="Paste verification code or token generated in Student Portal…"
                  className="mt-1.5 w-full rounded border border-rule bg-surface p-3 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={verifyBusy || payloadInput.trim().length < 4}
                  onClick={() => void handleVerifyPayload()}
                >
                  <QrCode className="h-4 w-4" aria-hidden="true" />
                  {verifyBusy ? 'Checking…' : 'Verify Pass'}
                </Button>

                <label
                  htmlFor="recruiter-qr-upload"
                  className="btn-interactive btn-secondary-tactile inline-flex min-h-11 lg:min-h-9 cursor-pointer items-center gap-2 rounded border border-rule bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-subtle hover:border-ink/30 focus-within:outline-2 focus-within:outline-action"
                >
                  <FileUp className="h-4 w-4 text-action" aria-hidden="true" />
                  <span>Upload QR PNG</span>
                  <input
                    id="recruiter-qr-upload"
                    name="qr_image"
                    type="file"
                    accept="image/png,image/*"
                    disabled={verifyBusy}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.currentTarget.value = '';
                      void handleUploadQrImage(f);
                    }}
                  />
                </label>

                <Button
                  variant="secondary"
                  disabled={verifyBusy}
                  onClick={() => setCameraOpen((v) => !v)}
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  {cameraOpen ? 'Hide Camera' : 'Scan Camera'}
                </Button>

                {recentQr && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={verifyBusy}
                      onClick={() => {
                        setPayloadInput(recentQr.base45);
                        void handleVerifyPayload(recentQr.base45);
                      }}
                    >
                      <span title={recentQr.holder} className="truncate max-w-[18ch]">
                        Load recent QR ({recentQr.holder.trim().split(/\s+/)[0] || 'pass'})
                      </span>
                    </Button>
                    {recentQr.sdJwt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={verifyBusy}
                        onClick={() => {
                          setPayloadInput(recentQr.sdJwt!);
                          void handleVerifyPayload(recentQr.sdJwt!);
                        }}
                      >
                        Load recent token
                      </Button>
                    )}
                  </>
                )}
              </div>

              {cameraOpen && (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="flex items-center gap-2 border-y border-rule py-4 text-xs text-ink-secondary"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-action" aria-hidden="true" />
                      <span>Starting camera scanner…</span>
                    </div>
                  }
                >
                  <RecruiterCameraScanner
                    busy={verifyBusy}
                    onDecodedToken={(tok) => {
                      setPayloadInput(tok);
                      void handleVerifyPayload(tok);
                    }}
                    onCaptureFile={(file) => void handleUploadQrImage(file)}
                    onClose={() => setCameraOpen(false)}
                  />
                </Suspense>
              )}

              {verified && (
                <div className="passport-stamp space-y-3 border-t border-rule pt-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <StatusBadge
                      tone={verified.valid && !verified.revoked ? 'verified' : 'blocker'}
                      icon={
                        verified.valid && !verified.revoked ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : (
                          <ShieldOff className="h-3.5 w-3.5" />
                        )
                      }
                    >
                      {verified.revoked
                        ? 'Pass Revoked'
                        : verified.valid
                          ? 'Authentic Signed Pass'
                          : 'Verification Failed'}
                    </StatusBadge>
                    <span className="text-xs text-ink-secondary tabular">
                      Issued {formatDateTime(verified.issued_at)}
                    </span>
                  </div>

                  {verified.reason && (
                    <p className="text-xs text-ink-secondary wrap-anywhere">{verified.reason}</p>
                  )}

                  <dl className="divide-y divide-rule-subtle border-y border-rule">
                    {orderDisclosedKeys(Object.keys(verified.disclosed_claims)).map((k) => (
                      <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                        <dt className="text-xs font-medium text-ink-secondary">
                          {humanizeClaimKey(k)}
                        </dt>
                        <dd
                          dir="auto"
                          title={verified.disclosed_claims[k]}
                          className="font-semibold text-ink text-end wrap-anywhere"
                        >
                          {formatClaimValue(k, verified.disclosed_claims[k])}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <DisclosureProof label="Cryptographic verification proof">
                    Pass ID:{' '}
                    <span title={verified.passport_id}>{verified.passport_id}</span> | Root:{' '}
                    <span title={verified.root_hash_hex}>
                      {truncateMiddle(verified.root_hash_hex, 14, 10)}
                    </span>{' '}
                    | Signature: {String(verified.signature_ok)} | Merkle proof:{' '}
                    {String(verified.merkle_proofs_ok)}
                  </DisclosureProof>
                </div>
              )}
            </div>
          </Sheet>

          {/* Revoked Passes Register */}
          <Sheet
            title="Revoked Passes Register"
            subtitle="Revoked passes issued by this institution fail offline verification immediately."
          >
            {revocations.length === 0 ? (
              <div className="border-y border-rule py-4 text-xs text-ink-secondary">
                <span className="font-semibold text-verified">0 revoked passes on record.</span> All
                active signed passes from this institution remain valid.
              </div>
            ) : (
              <DataTable
                rows={revocations}
                rowKey={(r) => r.passport_id}
                searchText={crlSearchText}
                searchPlaceholder="Search revoked pass ID or reason…"
                searchThreshold={5}
                dense
                emptyTitle="No revoked passes"
                emptyDescription="Revoked credentials appear here immediately."
                columns={crlColumns}
              />
            )}
          </Sheet>
        </div>
      )}

      {/* TAB 2: Multi-File Resume Screening Desk + Text/JSON Batch */}
      {activeTab === 'screen' && (
        <div
          id="recruiter-panel-screen"
          role="tabpanel"
          aria-labelledby="recruiter-tab-screen"
          className="space-y-6 min-w-0"
        >
          <Sheet
            tone="paper"
            title="Resume &amp; Cohort Screening Desk"
            subtitle="Drop candidate PDFs, DOCX, or text files to detect hidden prompt injections, auto-verify embedded Pramaan QR passes, and cross-check claims."
          >
            <div className="space-y-4">
              {fileErr && (
                <div
                  role="alert"
                  className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-sm font-medium text-blocker wrap-anywhere"
                >
                  {fileErr}
                </div>
              )}

              {/* Multi-file drag & drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!fileBusy) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!fileBusy) enqueueFiles(e.dataTransfer.files);
                }}
                className={`dropzone-instrument rounded-xs border border-dashed p-5 text-center ${
                  dragging
                    ? 'border-action bg-action-tint'
                    : 'border-rule-dashed'
                }`}
              >
                <FileUp className="mx-auto h-5 w-5 text-ink-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-ink">
                  Drop candidate resumes (.pdf, .docx, .txt, .md)
                </p>
                <p className="mt-1 text-xs text-ink-secondary">
                  Up to 25 files (10 MB each). Embedded Pramaan QR badges are extracted and
                  cross-verified automatically.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={fileBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Resume Files
                  </Button>
                  <input
                    ref={fileInputRef}
                    id="recruiter-resume-files"
                    name="candidate_resume_files"
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.md,application/pdf"
                    disabled={fileBusy}
                    className="sr-only"
                    onChange={(e) => {
                      enqueueFiles(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                </div>
              </div>

              {/* Queued files list with per-file optional pass attachment */}
              {queuedFiles.length > 0 && (
                <ul className="divide-y divide-rule-subtle border-y border-rule text-xs">
                  {queuedFiles.map((item) => {
                    const hasTok = Boolean(item.token.trim());
                    const editingTok = attachingFileId === item.id;
                    return (
                      <li key={item.id} className="py-2.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span
                              title={item.uploadName}
                              className="font-semibold text-ink wrap-anywhere"
                            >
                              {truncateMiddle(item.uploadName, 28, 12)}
                            </span>
                            <span className="ms-2 text-ink-muted tabular">
                              {(item.file.size / 1024).toFixed(1)} KB
                            </span>
                            {hasTok && (
                              <span className="ms-2 font-medium text-verified">Pass attached</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setAttachingFileId(editingTok ? null : item.id)}
                            >
                              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                              {hasTok ? 'Edit pass' : 'Attach pass'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${item.uploadName}`}
                              onClick={() => removeQueuedFile(item.id)}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                        {editingTok && (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              id={`attach-pass-${item.id}`}
                              name={`attach_pass_${item.id}`}
                              type="text"
                              aria-label={`Verification code or token for ${item.uploadName}`}
                              maxLength={16384}
                              value={item.token}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQueuedFiles((prev) =>
                                  prev.map((q) => (q.id === item.id ? { ...q, token: val } : q)),
                                );
                              }}
                              placeholder="Optional verification code or token if not embedded in PDF"
                              className="flex-1 rounded border border-rule bg-surface px-2.5 py-1.5 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setAttachingFileId(null)}
                            >
                              Done
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Compact Control Bar (<= 4 visible choices) */}
              <div className="flex flex-wrap items-end gap-2.5">
                <div className="min-w-[190px] flex-1">
                  <label htmlFor="recruiter-canon-select" className="block text-xs font-semibold text-ink">
                    Screening ordinance
                  </label>
                  <select
                    id="recruiter-canon-select"
                    name="screening_canon_id"
                    value={selectedCanonId}
                    onChange={(e) => setSelectedCanonId(e.target.value)}
                    className="mt-1 w-full rounded border border-rule bg-surface px-2.5 py-2 text-xs font-medium text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                  >
                    {canons.length > 0 ? (
                      canons.map((c) => (
                        <option key={c.id} value={c.id}>
                          {canonDisplayTitle(c)}
                        </option>
                      ))
                    ) : (
                      <option value="pramaan-campus-placement">
                        {humanizeCanonId('pramaan-campus-placement')}
                      </option>
                    )}
                  </select>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={showEligibility}
                  onClick={() => setShowEligibility((v) => !v)}
                >
                  <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                  Drive Eligibility
                  {eligibilityActiveCount > 0 ? ` (${formatCount(eligibilityActiveCount)})` : ''}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showTextBatch}
                  onClick={() => setShowTextBatch((v) => !v)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Text / JSON Batch
                </Button>
              </div>

              {/* Progressive Disclosure: Drive Eligibility Predicates */}
              <div
                className="disclosure-body"
                data-open={showEligibility}
                aria-hidden={!showEligibility}
                inert={!showEligibility || undefined}
              >
                <div>
                  <div className="grid grid-cols-1 gap-3 border-y border-rule bg-subtle/40 px-3.5 py-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="elig-cgpa" className="block text-xs font-semibold text-ink">
                        Min verified CGPA
                      </label>
                      <input
                        id="elig-cgpa"
                        name="min_cgpa"
                        type="number"
                        step="0.05"
                        min={0}
                        max={10}
                        value={minCgpa}
                        onChange={(e) => setMinCgpa(e.target.value)}
                        placeholder="e.g. 7.50"
                        className="mt-1 w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="elig-backlogs" className="block text-xs font-semibold text-ink">
                        Max active backlogs
                      </label>
                      <input
                        id="elig-backlogs"
                        name="max_backlogs"
                        type="number"
                        min={0}
                        max={50}
                        value={maxBacklogs}
                        onChange={(e) => setMaxBacklogs(e.target.value)}
                        placeholder="e.g. 0"
                        className="mt-1 w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="elig-batch" className="block text-xs font-semibold text-ink">
                        Required batch year
                      </label>
                      <input
                        id="elig-batch"
                        name="required_batch_year"
                        type="number"
                        min={1950}
                        max={2100}
                        value={reqBatchYear}
                        onChange={(e) => setReqBatchYear(e.target.value)}
                        placeholder="e.g. 2026"
                        className="mt-1 w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={fileBusy || queuedFiles.length === 0}
                  onClick={() => void handleScreenFiles()}
                >
                  {fileBusy
                    ? `Screening ${pluralize(queuedFiles.length, 'file')}…`
                    : queuedFiles.length > 0
                      ? `Screen ${pluralize(queuedFiles.length, 'Resume')}`
                      : 'Screen Resumes'}
                </Button>
                {queuedFiles.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={fileBusy}
                    onClick={() => {
                      setQueuedFiles([]);
                      setAttachingFileId(null);
                    }}
                  >
                    Clear queue
                  </Button>
                )}
              </div>

              <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {fileBusy
                  ? `Screening ${queuedFiles.length} candidate resumes`
                  : fileResult
                    ? `Screened ${pluralize(fileResult.items.length, 'resume')}`
                    : ''}
              </div>

              {/* Multi-File Screening Results + Flat Hairline Summary + Flat-Ruled Candidate Dossier */}
              {fileResult && (() => {
                const approvedCount = fileResult.items.filter((it) => it.decision === 'allow').length;
                const blockedCount = fileResult.items.filter((it) => it.decision === 'block').length;
                const qrDecodedCount = fileResult.items.filter(
                  (it) => it.embedded_pass && it.embedded_pass.valid && !it.embedded_pass.revoked,
                ).length;
                const hiddenLayersCount = fileResult.items.reduce(
                  (sum, it) => sum + (it.forensics.has_hidden_text ? Math.max(1, it.forensics.anomalies.length) : 0),
                  0,
                );
                return (
                <div className="border-t border-rule pt-4 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-secondary">
                    <span>
                      {pluralize(fileResult.items.length, 'resume')} screened against{' '}
                      <strong className="font-semibold text-ink">
                        {resolveCanonTitle(fileResult.canon_id, canons)}
                      </strong>
                    </span>
                  </div>

                  <dl className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-4 border-y border-rule text-xs tabular">
                    <div className="border-b border-rule-subtle py-2.5 pe-3 min-[380px]:border-e sm:border-b-0 sm:px-3 first:sm:ps-0">
                      <dt className="font-medium text-ink-secondary">Approved</dt>
                      <dd className="mt-0.5 font-display text-xl font-semibold text-ink">
                        {formatCount(approvedCount)}
                      </dd>
                    </div>
                    <div className="border-b border-rule-subtle py-2.5 min-[380px]:ps-3 sm:border-b-0 sm:border-e sm:px-3">
                      <dt
                        className={`font-medium ${
                          blockedCount > 0 ? 'text-blocker font-semibold' : 'text-ink-secondary'
                        }`}
                      >
                        Blocked
                      </dt>
                      <dd
                        className={`mt-0.5 font-display text-xl font-semibold ${
                          blockedCount > 0 ? 'text-blocker' : 'text-ink'
                        }`}
                      >
                        {formatCount(blockedCount)}
                      </dd>
                    </div>
                    <div className="border-b border-rule-subtle py-2.5 pe-3 min-[380px]:border-b-0 min-[380px]:border-e sm:px-3">
                      <dt className="font-medium text-ink-secondary">Verified Pass</dt>
                      <dd className="mt-0.5 font-display text-xl font-semibold text-ink">
                        {formatCount(qrDecodedCount)}
                      </dd>
                    </div>
                    <div className="py-2.5 min-[380px]:ps-3 sm:ps-3">
                      <dt
                        className={`font-medium ${
                          hiddenLayersCount > 0 ? 'text-warn font-semibold' : 'text-ink-secondary'
                        }`}
                      >
                        Hidden Layers
                      </dt>
                      <dd
                        className={`mt-0.5 font-display text-xl font-semibold ${
                          hiddenLayersCount > 0 ? 'text-warn' : 'text-ink'
                        }`}
                      >
                        {formatCount(hiddenLayersCount)}
                      </dd>
                    </div>
                  </dl>

                  <DataTable
                    rows={fileResult.items}
                    rowKey={(r) => r.item_id}
                    searchText={fileSearchText}
                    searchPlaceholder="Filter screened resumes…"
                    searchThreshold={5}
                    dense
                    emptyTitle="No resumes screened"
                    emptyDescription="Drop PDF, DOCX, or text files above and run screening."
                    columns={fileColumns}
                  />

                  {activeFileDossier && (
                    <div className="passport-stamp border-y border-rule bg-subtle/30 px-4 py-4 sm:px-5 space-y-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2.5">
                        <div className="min-w-0">
                          {(() => {
                            const displayName =
                              activeFileDossier.embedded_pass?.disclosed_claims?.full_name ||
                              activeFileDossier.filename;
                            const showFileMeta = displayName !== activeFileDossier.filename;
                            return (
                              <>
                                <strong dir="auto" className="font-display text-base font-semibold text-ink wrap-anywhere">
                                  {displayName}
                                </strong>
                                {showFileMeta && (
                                  <span className="ms-2 text-ink-muted wrap-anywhere">
                                    {activeFileDossier.filename}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedFileId(null)}
                        >
                          Hide
                        </Button>
                      </div>

                      {/* Embedded / Attached Signed Pass */}
                      {activeFileDossier.embedded_pass ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-ink">
                              {activeFileDossier.embedded_pass.source === 'embedded_pdf_qr'
                                ? 'Auto-Detected Embedded PDF QR Pass'
                                : 'Attached Signed Pass'}
                            </span>
                            <StatusBadge
                              tone={
                                activeFileDossier.embedded_pass.valid &&
                                !activeFileDossier.embedded_pass.revoked
                                  ? 'verified'
                                  : 'blocker'
                              }
                            >
                              {activeFileDossier.embedded_pass.revoked
                                ? 'Pass Revoked'
                                : activeFileDossier.embedded_pass.valid
                                  ? 'Verified Official Pass'
                                  : 'Verification Failed'}
                            </StatusBadge>
                          </div>
                          <p className="text-ink-secondary wrap-anywhere">
                            {activeFileDossier.embedded_pass.reason}
                          </p>
                        </div>
                      ) : (
                        <p className="text-ink-secondary">
                          No embedded Pramaan QR pass detected in this file. Attach a student’s pass
                          code or token to enable verified claim cross-checking.
                        </p>
                      )}

                      {/* Resume vs Signed Pass Cross-Checks */}
                      {activeFileDossier.cross_checks.length > 0 && (
                        <div className="space-y-1.5 border-t border-rule-subtle pt-3">
                          <h3 className="font-semibold text-ink">
                            Resume and Signed Pass Cross-Check
                          </h3>
                          <dl className="divide-y divide-rule-subtle border-t border-rule-subtle">
                            {activeFileDossier.cross_checks.map((c) => (
                              <div
                                key={c.field}
                                className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                              >
                                <dt className="font-semibold text-ink">
                                  {humanizeClaimKey(c.field)}
                                </dt>
                                <dd className="flex flex-wrap items-baseline gap-2 sm:justify-end wrap-anywhere">
                                  <span className="text-ink-secondary">{c.detail}</span>
                                  {c.status === 'match' ? (
                                    <StatusBadge tone="verified" quiet>
                                      Match
                                    </StatusBadge>
                                  ) : c.status === 'mismatch' ? (
                                    <StatusBadge tone="blocker">Contradiction</StatusBadge>
                                  ) : (
                                    <StatusBadge tone="neutral" quiet>
                                      Not stated
                                    </StatusBadge>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      {/* Channel-Separated Hidden Layer Quarantine */}
                      {activeFileDossier.forensics.has_hidden_text && (
                        <div className="space-y-2 border-y border-blocker-border bg-blocker-bg px-3.5 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 font-semibold text-blocker">
                              <StatusBadge tone="blocker">Quarantined</StatusBadge>
                              <span>Hidden Machine-Only Layer</span>
                            </span>
                            {activeFileDossier.forensics.sanitized_text && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void copySanitizedText(
                                    activeFileDossier.item_id,
                                    activeFileDossier.forensics.sanitized_text,
                                  )
                                }
                              >
                                {copiedSafeId === activeFileDossier.item_id ? (
                                  <Check className="h-3.5 w-3.5 text-verified" aria-hidden="true" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                {copiedSafeId === activeFileDossier.item_id
                                  ? 'Copied safe text'
                                  : 'Copy Safe Visible Text'}
                              </Button>
                            )}
                          </div>
                          <ul className="divide-y divide-blocker-border/60">
                            {activeFileDossier.forensics.anomalies.map((a, idx) => (
                              <li key={`${a.kind}-${idx}`} className="py-1.5 space-y-0.5">
                                <div className="font-semibold text-blocker">
                                  Page {formatCount(a.page + 1)} — {humanizeAnomalyKind(a.kind)}
                                  {a.effective_font_pt != null && (
                                    <span className="font-normal text-ink-secondary">
                                      {' '}
                                      ({a.effective_font_pt}pt)
                                    </span>
                                  )}
                                  {a.wcag_contrast != null && (
                                    <span className="font-normal text-ink-secondary">
                                      {' '}
                                      (contrast {a.wcag_contrast})
                                    </span>
                                  )}
                                </div>
                                <div className="text-ink wrap-anywhere">“{a.snippet}”</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Drive Eligibility Checks */}
                      {activeFileDossier.eligibility.active && (
                        <div className="space-y-1.5 border-t border-rule-subtle pt-3">
                          <h3 className="font-semibold text-ink">Drive Eligibility Criteria</h3>
                          <ul className="divide-y divide-rule-subtle border-t border-rule-subtle">
                            {activeFileDossier.eligibility.checks.map((ec) => (
                              <li
                                key={ec.criterion}
                                className="flex items-center justify-between gap-3 py-2"
                              >
                                <span className="min-w-0 flex-1 text-ink wrap-anywhere">
                                  <strong>{ec.criterion}</strong> ({ec.required}) — {ec.detail}
                                </span>
                                <span className="shrink-0">
                                  {ec.status === 'passed' ? (
                                    <StatusBadge tone="verified" quiet className="whitespace-nowrap">
                                      Eligible
                                    </StatusBadge>
                                  ) : ec.status === 'failed' ? (
                                    <StatusBadge tone="warn" className="whitespace-nowrap">
                                      Below Cutoff
                                    </StatusBadge>
                                  ) : (
                                    <StatusBadge tone="neutral" quiet className="whitespace-nowrap">
                                      Undisclosed
                                    </StatusBadge>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Ordinance Findings */}
                      {activeFileDossier.findings.length > 0 && (
                        <div className="space-y-1.5 border-t border-rule-subtle pt-3">
                          <h3 className="font-semibold text-ink">
                            Ordinance Findings ({formatCount(activeFileDossier.findings.length)})
                          </h3>
                          <ul className="divide-y divide-rule-subtle border-t border-rule-subtle">
                            {activeFileDossier.findings.map((f) => (
                              <li key={f.id} className="py-2">
                                <p className="text-ink wrap-anywhere">{f.message}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <DisclosureProof label="Technical verification & rule references">
                        Ordinance: {fileResult.canon_id} | Screening duration:{' '}
                        {formatCount(activeFileDossier.elapsed_ms)} ms
                        {activeFileDossier.findings.length > 0 &&
                          ` | Rules: ${activeFileDossier.findings.map((f) => f.rule.rule_id).join(', ')}`}
                        {activeFileDossier.embedded_pass &&
                          ` | Pass ID: ${activeFileDossier.embedded_pass.passport_id} (Ed25519 signature: ${String(
                            activeFileDossier.embedded_pass.signature_ok,
                          )}, Merkle proofs: ${String(activeFileDossier.embedded_pass.merkle_proofs_ok)})`}
                      </DisclosureProof>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Progressive Disclosure: Legacy Text / JSON Batch Screening */}
              <div
                className="disclosure-body"
                data-open={showTextBatch}
                aria-hidden={!showTextBatch}
                inert={!showTextBatch || undefined}
              >
                <div>
                  <div className="space-y-3 border-t border-rule pt-4">
                    <div className="text-xs font-semibold text-ink">
                      Quick Text &amp; JSON Claim Batch
                    </div>
                    {batchErr && (
                      <div
                        role="alert"
                        className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-sm font-medium text-blocker"
                      >
                        {batchErr}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
                      <div>
                        <label
                          htmlFor="cand-name-input"
                          className="block text-xs font-semibold text-ink"
                        >
                          Candidate name
                        </label>
                        <input
                          id="cand-name-input"
                          name="candidate_name"
                          type="text"
                          maxLength={160}
                          value={candName}
                          onChange={(e) => setCandName(e.target.value)}
                          placeholder="Candidate full name"
                          className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="cand-claim-input"
                          className="block text-xs font-semibold text-ink"
                        >
                          Resume statement
                        </label>
                        <input
                          id="cand-claim-input"
                          name="candidate_claim"
                          type="text"
                          maxLength={50000}
                          value={candContent}
                          onChange={(e) => setCandContent(e.target.value)}
                          placeholder="Paste a resume summary or claim to check"
                          className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                        />
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!candName.trim() || !candContent.trim()}
                        onClick={handleAddCandidateRow}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add row
                      </Button>
                    </div>

                    <div>
                      <label htmlFor="batch-json" className="block text-xs font-semibold text-ink">
                        Candidate JSON batch
                      </label>
                      <textarea
                        id="batch-json"
                        name="candidate_batch_json"
                        dir="ltr"
                        rows={4}
                        maxLength={500000}
                        value={batchJson}
                        onChange={(e) => setBatchJson(e.target.value)}
                        placeholder={
                          '[\n  { "name": "Candidate Name", "content": "Resume claim text to verify" }\n]'
                        }
                        className="mt-1.5 w-full rounded border border-rule bg-surface p-3 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                      />
                    </div>

                    <Button
                      variant="secondary"
                      disabled={batchBusy || !batchJson.trim()}
                      onClick={() => void handleBatchAudit()}
                    >
                      {batchBusy ? 'Auditing batch…' : 'Run Text Claim Batch'}
                    </Button>

                    {batchResult && (
                      <div className="border-t border-rule pt-4 space-y-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-secondary">
                          <span>
                            {pluralize(batchResult.items.length, 'candidate')} audited against{' '}
                            <strong className="font-semibold text-ink">
                              {resolveCanonTitle(batchResult.canon_id, canons)}
                            </strong>
                          </span>
                        </div>
                        <DataTable
                          rows={indexedBatchRows}
                          rowKey={(r) => r.item_id ?? `${r.filename}-${r._rowIdx}`}
                          dense
                          emptyTitle="No candidates submitted"
                          emptyDescription="Provide candidate JSON entries above and run the audit."
                          columns={batchColumns}
                        />
                        {expandedRowIdx !== null &&
                          (() => {
                            const target = indexedBatchRows[expandedRowIdx];
                            if (!target || target.findings.length === 0) return null;
                            return (
                              <div className="border-y border-rule bg-subtle/40 px-4 py-3.5 text-sm space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <strong dir="auto" className="text-ink wrap-anywhere">
                                    Flags for {target.filename} (Row #{formatCount(target._rowIdx + 1)})
                                  </strong>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpandedRowIdx(null)}
                                  >
                                    Hide
                                  </Button>
                                </div>
                                <ul className="divide-y divide-rule-subtle border-t border-rule">
                                  {target.findings.map((f) => (
                                    <li key={f.id} className="py-2.5 first:pt-2 last:pb-0">
                                      <p className="text-ink wrap-anywhere">{f.message}</p>
                                    </li>
                                  ))}
                                </ul>
                                <DisclosureProof label="Rule references & audit details">
                                  Ordinance: {batchResult.canon_id} | Batch duration:{' '}
                                  {formatCount(batchResult.elapsed_ms)} ms | Rules:{' '}
                                  {target.findings.map((f) => f.rule.rule_id).join(', ')}
                                </DisclosureProof>
                              </div>
                            );
                          })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Sheet>
        </div>
      )}

      {/* TAB 3: Session Verification & Screening Ledger */}
      {activeTab === 'log' && (
        <div
          id="recruiter-panel-log"
          role="tabpanel"
          aria-labelledby="recruiter-tab-log"
        >
          <Sheet
            tone="paper"
            title="Session Verification &amp; Screening Ledger"
            subtitle="Records every pass verified and resume screened during this hiring session for ATS export."
            actions={
              sessionLog.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" onClick={exportSessionCsv}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Export CSV ({formatCount(sessionLog.length)})
                  </Button>
                  {confirmClearLog ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setSessionLog([]);
                          setConfirmClearLog(false);
                        }}
                      >
                        Confirm clear
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmClearLog(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmClearLog(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Clear
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          >
            {sessionLog.length === 0 ? (
              <p className="border-y border-rule py-4 text-xs text-ink-secondary">
                Verified passes and screened resumes appear here automatically so you can review or
                export your campus drive shortlist as CSV.
              </p>
            ) : (
              <div className="space-y-2.5">
                {sessionLog.length >= 1000 && (
                  <p className="text-xs text-warn">
                    Showing the latest 1,000 session entries. Export CSV to archive older
                    verifications.
                  </p>
                )}
                <DataTable
                  rows={sessionLog}
                  rowKey={(r) => r.id}
                  searchText={sessionSearchText}
                  searchPlaceholder="Filter session ledger…"
                  searchThreshold={6}
                  dense
                  emptyTitle="No verifications recorded yet"
                  emptyDescription="Verify a student pass or screen resumes to populate this ledger."
                  columns={sessionColumns}
                />
              </div>
            )}
          </Sheet>
        </div>
      )}
    </div>
  );
}
