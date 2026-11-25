import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  FileUp,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { StudentPreflightResult } from '../../api/types.ts';
import {
  formatCount,
  humanizeAnomalyKind,
  humanizeClaimKey,
  pluralize,
} from '../../utils/format.ts';
import { useCopyFeedback } from '../../utils/useCopyFeedback.ts';
import { Button, DisclosureProof, Sheet, StatusBadge } from '../ui/index.ts';

interface StudentPreFlightPanelProps {
  studentPrn: string;
  draftFile: File | null;
  onDraftFileChange: (file: File | null) => void;
}

export function StudentPreFlightPanel({
  studentPrn,
  draftFile,
  onDraftFileChange,
}: StudentPreFlightPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqIdRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<StudentPreflightResult | null>(null);
  const { copiedKey, copy: copyWithFeedback } = useCopyFeedback<'sanitized'>();
  const copiedSafe = copiedKey === 'sanitized';
  const contextKey = `${studentPrn}:${draftFile?.name ?? ''}:${draftFile?.size ?? 0}`;
  const [prevContextKey, setPrevContextKey] = useState(contextKey);

  if (contextKey !== prevContextKey) {
    setPrevContextKey(contextKey);
    if (!draftFile || (result && result.filename !== draftFile.name)) {
      setResult(null);
      setErr('');
    }
  }

  const runCheck = async (file: File) => {
    const seq = ++reqIdRef.current;
    onDraftFileChange(file);
    setBusy(true);
    setErr('');
    try {
      const res = await api.studentPreflight(file, 'pramaan-campus-placement', studentPrn);
      if (seq === reqIdRef.current) setResult(res);
    } catch (e: unknown) {
      if (seq === reqIdRef.current) {
        setErr(e instanceof Error ? e.message : 'Unable to run pre-flight check on this resume.');
        setResult(null);
      }
    } finally {
      if (seq === reqIdRef.current) setBusy(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (busy) return;
    const first = files?.[0];
    if (!first) return;
    void runCheck(first);
  };

  const copySanitizedText = async () => {
    if (!result?.forensics.sanitized_text) return;
    const ok = await copyWithFeedback('sanitized', result.forensics.sanitized_text);
    if (!ok) {
      setErr('Clipboard write was blocked by your browser.');
    }
  };

  return (
    <Sheet
      title="Pre-Flight Resume Self-Check"
      subtitle="Check your draft resume against your official transcript and scan for accidental hidden template text before submitting to placement drives."
      actions={
        result ? (
          result.ready_for_placement ? (
            <StatusBadge tone="verified" quiet icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
              Ready for Placement
            </StatusBadge>
          ) : (
            <StatusBadge tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {pluralize(result.issues_count, 'item')} to review
            </StatusBadge>
          )
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr] items-start">
        <div className="space-y-3 min-w-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) handleFiles(e.dataTransfer.files);
            }}
            className={`dropzone-instrument rounded-xs border border-dashed p-5 text-center ${
              dragging
                ? 'border-action bg-action-tint'
                : 'border-rule-dashed'
            }`}
          >
            <FileUp className="mx-auto h-5 w-5 text-ink-muted" aria-hidden="true" />
            <p className="mt-2.5 text-sm font-semibold text-ink">
              Drop your draft resume here
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              PDF, DOCX, TXT, or Markdown (up to 10 MB). Checked privately against your own
              verified record and never auto-rejects.
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                {busy ? 'Checking draft…' : draftFile ? 'Choose another file' : 'Select Resume File'}
              </Button>
              <input
                ref={inputRef}
                id="student-preflight-file"
                name="student_preflight_resume"
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf"
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </div>
            {draftFile && (
              <p className="mt-3 font-mono text-xs text-ink-secondary wrap-anywhere">
                Loaded: <span className="text-ink">{draftFile.name}</span> (
                {(draftFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {err && (
            <div
              role="alert"
              aria-atomic="true"
              className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-sm font-medium text-blocker wrap-anywhere"
            >
              {err}
            </div>
          )}

          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {busy ? 'Running pre-flight check on draft resume' : result ? result.coaching_summary : ''}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {!result ? (
            <div className="border-y border-rule py-5 text-sm text-ink-secondary space-y-2">
              <p className="font-semibold text-ink">What Pre-Flight catches before recruiters do</p>
              <ul className="list-disc ps-5 space-y-1 text-xs leading-relaxed">
                <li>CGPA, active backlog, or graduation batch typos compared against your official Registrar transcript.</li>
                <li>Accidental invisible text, micro-fonts, or metadata artifacts left behind by Canva/LaTeX templates.</li>
                <li>Prohibited placement phrasing or missing statutory qualifiers.</li>
              </ul>
            </div>
          ) : (
            <div className="passport-stamp space-y-4">
              <div
                className={`border-y px-4 py-3 text-sm ${
                  result.ready_for_placement
                    ? 'border-verified-border bg-verified-bg text-verified-ink'
                    : 'border-warn-border bg-warn-bg text-warn'
                }`}
              >
                <strong className="font-semibold">
                  {result.ready_for_placement
                    ? 'Your resume is ready to stamp and submit'
                    : 'Review these items before applying'}
                </strong>
                <p className="mt-1 text-xs leading-relaxed">{result.coaching_summary}</p>
              </div>

              {result.erp_checks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-ink">
                    Transcript Parity vs. Your Official Record
                  </h3>
                  <dl className="divide-y divide-rule-subtle border-y border-rule text-xs">
                    {result.erp_checks.map((chk) => (
                      <div
                        key={chk.field}
                        className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                      >
                        <dt className="font-semibold text-ink shrink-0">
                          {humanizeClaimKey(chk.field)}
                        </dt>
                        <dd className="flex flex-wrap items-baseline gap-2 sm:justify-end text-ink-secondary wrap-anywhere">
                          <span>{chk.detail}</span>
                          {chk.status === 'match' ? (
                            <StatusBadge tone="verified" quiet>
                              Matches ERP
                            </StatusBadge>
                          ) : chk.status === 'mismatch' ? (
                            <StatusBadge tone="blocker">Mismatch</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral" quiet>
                              Not listed
                            </StatusBadge>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {result.forensics.has_hidden_text && (
                <div className="space-y-2 border border-blocker-border bg-blocker-bg px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-blocker">
                      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Hidden text or metadata detected ({pluralize(result.forensics.anomalies.length, 'layer')})
                      </span>
                    </div>
                    {result.forensics.sanitized_text && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void copySanitizedText()}
                      >
                        {copiedSafe ? (
                          <Check className="h-3.5 w-3.5 text-verified" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {copiedSafe ? 'Copied clean text' : 'Copy clean visible text'}
                      </Button>
                    )}
                  </div>
                  <p className="text-blocker-deep leading-relaxed">
                    Recruiter security scanners flag invisible text, micro-fonts, or stuffed PDF
                    metadata as prompt injection. Remove these layers from your template before
                    exporting your final PDF:
                  </p>
                  <ul className="divide-y divide-blocker-border/60">
                    {result.forensics.anomalies.map((anom, i) => (
                      <li key={`${anom.kind}-${i}`} className="py-1.5 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-medium text-blocker">
                          <span>Page {formatCount(anom.page + 1)}</span>
                          <span>{humanizeAnomalyKind(anom.kind)}</span>
                          {anom.effective_font_pt != null && (
                            <span className="tabular">{anom.effective_font_pt}pt</span>
                          )}
                          {anom.wcag_contrast != null && (
                            <span className="tabular">contrast {anom.wcag_contrast}</span>
                          )}
                        </div>
                        <div className="text-ink wrap-anywhere">“{anom.snippet}”</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.canon_findings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-ink">
                    Placement Policy Advisories ({formatCount(result.canon_findings.length)})
                  </h3>
                  <ul className="divide-y divide-rule-subtle border-y border-rule text-xs">
                    {result.canon_findings.map((f) => (
                      <li key={f.id} className="py-2 space-y-0.5">
                        <p className="text-ink wrap-anywhere">{f.message}</p>
                        {f.suggestion?.summary && (
                          <p className="text-ink-secondary">{f.suggestion.summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.writing_tips.length > 0 && (
                <DisclosureProof
                  label={`Optional readability tips (${formatCount(result.writing_tips.length)})`}
                >
                  <ul className="space-y-1.5 font-sans text-xs">
                    {result.writing_tips.map((tip) => (
                      <li key={tip.id} className="wrap-anywhere">
                        {tip.message}
                      </li>
                    ))}
                  </ul>
                </DisclosureProof>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
