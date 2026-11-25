import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { BulkCsvImportResult } from '../../api/types.ts';
import { downloadBlob, formatCount, formatDecimal, pluralize } from '../../utils/format.ts';
import { Button, SegmentedTabs, Sheet, StatusBadge } from '../ui/index.ts';

interface AdminBulkImportSheetProps {
  onImported: () => void;
}

export function AdminBulkImportSheet({ onImported }: AdminBulkImportSheetProps) {
  const [kind, setKind] = useState<'students' | 'faculty'>('students');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkCsvImportResult | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState<'' | 'validate' | 'commit' | 'template'>('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const reqIdRef = useRef(0);

  const runValidation = async (targetKind: 'students' | 'faculty', file: File) => {
    const reqId = ++reqIdRef.current;
    setSelectedFile(file);
    setResult(null);
    setSkipInvalid(false);
    setErr('');
    setNotice('');
    setBusy('validate');
    try {
      const res =
        targetKind === 'students'
          ? await api.adminBulkImportStudents(file, true, false)
          : await api.adminBulkImportFaculty(file, true, false);
      if (reqId !== reqIdRef.current) return;
      setResult(res);
    } catch (ex: unknown) {
      if (reqId !== reqIdRef.current) return;
      setErr(ex instanceof Error ? ex.message : 'Unable to validate CSV file');
    } finally {
      if (reqId === reqIdRef.current) {
        setBusy('');
      }
    }
  };

  const handleCommit = async () => {
    if (!selectedFile || !result || result.valid_rows === 0 || busy) return;
    const reqId = ++reqIdRef.current;
    setBusy('commit');
    setErr('');
    setNotice('');
    try {
      const res =
        kind === 'students'
          ? await api.adminBulkImportStudents(selectedFile, false, skipInvalid)
          : await api.adminBulkImportFaculty(selectedFile, false, skipInvalid);
      if (reqId !== reqIdRef.current) return;
      setResult(res);
      setNotice(
        `Imported ${pluralize(res.imported_count, kind === 'students' ? 'student record' : 'faculty record')} (${formatCount(res.created_count)} new, ${formatCount(res.updated_count)} updated).`,
      );
      onImported();
    } catch (ex: unknown) {
      if (reqId !== reqIdRef.current) return;
      setErr(ex instanceof Error ? ex.message : 'Bulk CSV import failed');
    } finally {
      if (reqId === reqIdRef.current) {
        setBusy('');
      }
    }
  };

  const handleDownloadTemplate = async () => {
    if (busy) return;
    setBusy('template');
    setErr('');
    try {
      const blob = await api.downloadBulkCsvTemplate(kind);
      downloadBlob(blob, `pramaan-${kind}-template.csv`);
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Unable to download CSV template');
    } finally {
      setBusy('');
    }
  };

  const switchKind = (next: 'students' | 'faculty') => {
    reqIdRef.current += 1;
    setKind(next);
    setSelectedFile(null);
    setResult(null);
    setSkipInvalid(false);
    setErr('');
    setNotice('');
    setBusy('');
  };

  const canCommit = Boolean(
    selectedFile &&
      result &&
      !result.committed &&
      result.valid_rows > 0 &&
      (result.error_rows === 0 || skipInvalid) &&
      !busy,
  );

  return (
    <Sheet
      tone="paper"
      title="Bulk CSV Roster Import (Students & Faculty)"
      subtitle="Upload UTF-8 CSV exports from your SIS or Excel (up to 5,000 rows, 5 MB). Every row is dry-run validated before committing."
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== ''}
          onClick={() => void handleDownloadTemplate()}
        >
          <Download className="h-3.5 w-3.5 text-action" aria-hidden="true" />
          {busy === 'template'
            ? 'Preparing…'
            : kind === 'students'
              ? 'Students CSV Template'
              : 'Faculty CSV Template'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs
            ariaLabel="Bulk import register type"
            idPrefix="bulk-kind-tab"
            value={kind}
            onChange={switchKind}
            options={[
              {
                id: 'students',
                label: 'Student Roster (.csv)',
                panelId: 'bulk-kind-panel-students',
              },
              {
                id: 'faculty',
                label: 'Faculty Roster (.csv)',
                panelId: 'bulk-kind-panel-faculty',
              },
            ]}
          />

          <label
            htmlFor="admin-bulk-csv-input"
            className="btn-interactive btn-secondary-tactile inline-flex min-h-11 lg:min-h-9 cursor-pointer items-center gap-2 rounded border border-rule bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action"
          >
            <Upload className="h-4 w-4 text-action" aria-hidden="true" />
            <span>
              {busy === 'validate'
                ? 'Validating CSV…'
                : selectedFile
                  ? 'Choose another CSV'
                  : `Select ${kind === 'students' ? 'Students' : 'Faculty'} CSV`}
            </span>
            <input
              id="admin-bulk-csv-input"
              name="bulk_csv_file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy !== ''}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                if (file) void runValidation(kind, file);
              }}
            />
          </label>
        </div>

        <div
          id={`bulk-kind-panel-${kind}`}
          role="tabpanel"
          aria-labelledby={`bulk-kind-tab-${kind}`}
          className="space-y-4"
        >
        <p className="text-xs text-ink-secondary leading-relaxed">
          {kind === 'students' ? (
            <>
              Required columns:{' '}
              <code className="font-mono text-ink">
                prn, full_name, program, department, batch_year, declared_cgpa
              </code>
              . Optional:{' '}
              <code className="font-mono">
                education_level, age_years, active_backlogs, degree_status, parent_username,
                course_code, course_title, attended_classes, total_classes
              </code>
              .
            </>
          ) : (
            <>
              Required columns:{' '}
              <code className="font-mono text-ink">
                faculty_id, full_name, designation, department, biometric_days_present,
                working_days_total
              </code>
              . Optional: <code className="font-mono">sponsored_grant_inr_lakhs</code>.
            </>
          )}
        </p>

        {err && (
          <div
            role="alert"
            className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker wrap-anywhere"
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

        {result && (
          <div className="space-y-4 border-t border-rule pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 text-xs font-semibold text-ink">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-action" aria-hidden="true" />
                <span className="wrap-anywhere">{selectedFile?.name}</span>
              </div>
              <StatusBadge
                tone={
                  result.committed
                    ? 'verified'
                    : result.error_rows > 0
                      ? 'warn'
                      : 'verified'
                }
                quiet={result.committed || result.error_rows === 0}
              >
                {result.committed
                  ? `Committed: ${pluralize(result.imported_count, 'row')}`
                  : result.error_rows > 0
                    ? `Dry Run: ${pluralize(result.error_rows, 'row error')}`
                    : 'Dry Run Passed — Ready to Commit'}
              </StatusBadge>
            </div>

            <dl className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-4 border-y border-rule tabular">
              <div className="min-w-0 wrap-anywhere border-b border-rule-subtle py-3 pe-3 min-[380px]:border-e sm:border-b-0 sm:px-3 first:sm:ps-0">
                <dt className="text-xs text-ink-secondary">Total Rows</dt>
                <dd className="mt-0.5 font-display text-xl font-semibold text-ink">
                  {formatCount(result.total_rows)}
                </dd>
              </div>
              <div className="min-w-0 wrap-anywhere border-b border-rule-subtle py-3 min-[380px]:ps-3 sm:border-b-0 sm:border-e sm:px-3">
                <dt className="text-xs text-ink-secondary">New Records</dt>
                <dd className="mt-0.5 font-display text-xl font-semibold text-ink">
                  {formatCount(result.created_count)}
                </dd>
              </div>
              <div className="min-w-0 wrap-anywhere border-b border-rule-subtle py-3 pe-3 min-[380px]:border-b-0 min-[380px]:border-e sm:px-3">
                <dt className="text-xs text-ink-secondary">Existing Updates</dt>
                <dd className="mt-0.5 font-display text-xl font-semibold text-ink">
                  {formatCount(result.updated_count)}
                </dd>
              </div>
              <div className="min-w-0 wrap-anywhere py-3 min-[380px]:ps-3 sm:ps-3">
                <dt className="text-xs text-ink-secondary">Validation Errors</dt>
                <dd
                  className={`mt-0.5 font-display text-xl font-semibold ${
                    result.error_rows > 0 ? 'text-blocker' : 'text-ink'
                  }`}
                >
                  {formatCount(result.error_rows)}
                </dd>
              </div>
            </dl>

            {result.errors.length > 0 && (
              <div className="space-y-2 border-y border-blocker-border bg-blocker-bg/60 px-3.5 py-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-blocker">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Row validation errors (showing {formatCount(result.errors.length)} of{' '}
                    {formatCount(result.error_rows)})
                  </span>
                </div>
                <ul className="max-h-64 space-y-1 overflow-auto font-mono text-ink">
                  {result.errors.map((e, idx) => (
                    <li key={`${e.row}-${idx}`} className="wrap-anywhere">
                      <span className="font-bold text-blocker">Row {formatCount(e.row)}</span>
                      {e.identifier ? ` (${e.identifier})` : ''}: {e.error}
                    </li>
                  ))}
                </ul>
                {!result.committed && result.valid_rows > 0 && (
                  <label className="inline-flex min-h-11 lg:min-h-8 cursor-pointer items-center gap-2 pt-1 font-sans text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={skipInvalid}
                      onChange={(e) => setSkipInvalid(e.target.checked)}
                      className="h-4 w-4 rounded border-ink-muted accent-action"
                    />
                    <span>
                      Skip {pluralize(result.error_rows, 'invalid row')} and import the{' '}
                      {pluralize(result.valid_rows, 'valid row')}
                    </span>
                  </label>
                )}
              </div>
            )}

            {result.preview.length > 0 && (() => {
              const previewRows = result.preview.slice(0, 10);
              return (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-ink-secondary">
                  Validated preview (first {formatCount(previewRows.length)} of{' '}
                  {formatCount(result.valid_rows)})
                </div>
                <div className="overflow-x-auto border-y border-rule">
                  <table className="w-full min-w-[520px] sm:min-w-0 text-start text-xs">
                    <thead className="border-b border-rule bg-subtle text-ink-secondary">
                      {kind === 'students' ? (
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">PRN</th>
                          <th className="px-3 py-2 text-start font-semibold">Full Name</th>
                          <th className="px-3 py-2 text-start font-semibold">Program</th>
                          <th className="px-3 py-2 text-start font-semibold">Batch</th>
                          <th className="px-3 py-2 text-end font-semibold">CGPA</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">Faculty ID</th>
                          <th className="px-3 py-2 text-start font-semibold">Full Name</th>
                          <th className="px-3 py-2 text-start font-semibold">Designation</th>
                          <th className="px-3 py-2 text-start font-semibold">Department</th>
                          <th className="px-3 py-2 text-end font-semibold">Presence</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-rule-subtle">
                      {previewRows.map((row, idx) => (
                        <tr key={idx}>
                          {kind === 'students' ? (
                            <>
                              <td className="px-3 py-2 font-mono text-ink whitespace-nowrap">
                                {String(row.prn ?? '')}
                              </td>
                              <td dir="auto" className="min-w-0 px-3 py-2 font-medium text-ink wrap-anywhere">
                                {String(row.full_name ?? '')}
                              </td>
                              <td className="min-w-0 px-3 py-2 text-ink-secondary wrap-anywhere">
                                {String(row.program ?? '')}
                              </td>
                              <td className="px-3 py-2 font-mono text-ink-secondary">
                                {String(row.batch_year ?? '')}
                              </td>
                              <td className="px-3 py-2 text-end font-mono font-semibold text-ink tabular">
                                {formatDecimal(Number(row.declared_cgpa), 2)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 font-mono text-ink whitespace-nowrap">
                                {String(row.faculty_id ?? '')}
                              </td>
                              <td dir="auto" className="min-w-0 px-3 py-2 font-medium text-ink wrap-anywhere">
                                {String(row.full_name ?? '')}
                              </td>
                              <td className="min-w-0 px-3 py-2 text-ink-secondary wrap-anywhere">
                                {String(row.designation ?? '')}
                              </td>
                              <td className="min-w-0 px-3 py-2 text-ink-secondary wrap-anywhere">
                                {String(row.department ?? '')}
                              </td>
                              <td
                                dir="ltr"
                                className="px-3 py-2 text-end font-mono text-ink tabular whitespace-nowrap"
                              >
                                {formatCount(Number(row.biometric_days_present))} /{' '}
                                {formatCount(Number(row.working_days_total))}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })()}

            {!result.committed && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!canCommit}
                  onClick={() => void handleCommit()}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  {busy === 'commit'
                    ? 'Committing Roster…'
                    : `Commit ${pluralize(result.valid_rows, 'Validated Record')}`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== ''}
                  onClick={() => {
                    setSelectedFile(null);
                    setResult(null);
                    setErr('');
                    setNotice('');
                  }}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </Sheet>
  );
}
