import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  FileUp,
  GitMerge,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  AuthUser,
  ClaimGraphResult,
  ExtractedFact,
  FactCluster,
  StoredDocument,
} from '../api/types.ts';
import {
  formatCount,
  humanizeAnomalySummary,
  humanizeClaimKey,
  humanizeClusterExplanation,
  humanizeClusterSubject,
  humanizeDispute,
  humanizeDocumentName,
  pluralize,
} from '../utils/format.ts';
import { EvidencePdfModal } from './EvidencePdfModal.tsx';
import {
  Button,
  DataTable,
  DisclosureProof,
  EmptyState,
  ExpandableText,
  PaginationBar,
  Sheet,
  StatusBadge,
} from './ui/index.ts';

function clusterTone(c: FactCluster): 'verified' | 'blocker' | 'warn' {
  if (c.case_type === 'contradicted') return 'blocker';
  if (c.case_type === 'corroborated') return 'verified';
  return 'warn';
}

interface ClaimGraphWorkbenchProps {
  user: AuthUser;
  onOpenReviewStudio?: () => void;
}

export function ClaimGraphWorkbench({ user, onOpenReviewStudio }: ClaimGraphWorkbenchProps) {
  const canManageGraph = user.role === 'teacher' || user.role === 'admin';

  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [graph, setGraph] = useState<ClaimGraphResult | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [showAllClusterFacts, setShowAllClusterFacts] = useState(false);
  const [clusterPage, setClusterPage] = useState(0);
  const [docsPage, setDocsPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [evidenceModal, setEvidenceModal] = useState<{
    open: boolean;
    docId: string | null;
    filename?: string;
    hasStoredPdf: boolean;
    page: number;
    quote?: string;
  }>({ open: false, docId: null, hasStoredPdf: false, page: 0 });

  const refreshGraph = async () => {
    setErr('');
    try {
      const [docsRes, graphRes] = await Promise.all([
        api.listDocuments(),
        api.getLatestReconcile().catch(() => null),
      ]);
      setDocs(docsRes);
      setGraph(graphRes);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to load claim reconciler');
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const [docsRes, graphRes] = await Promise.all([
          api.listDocuments(),
          api.getLatestReconcile().catch(() => null),
        ]);
        if (!active) return;
        setDocs(docsRes);
        setGraph(graphRes);
        setErr('');
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load claim reconciler');
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  /* Lead with conflicts first so the most urgent discrepancy is immediately visible */
  const clusters = useMemo(() => {
    const raw = graph?.clusters ?? [];
    const priority = (c: FactCluster) =>
      c.case_type === 'contradicted' ? 0 : c.case_type === 'corroborated' ? 2 : 1;
    return [...raw].sort((a, b) => priority(a) - priority(b));
  }, [graph]);

  const activeCluster =
    clusters.find((c) => c.cluster_id === selectedClusterId) ?? clusters[0] ?? null;

  const openEvidence = useCallback(
    (docId: string, filename: string, page: number, quote?: string) => {
      const hasPdfFile = docs.some((d) => d.doc_id === docId);
      setEvidenceModal({
        open: true,
        docId,
        filename,
        hasStoredPdf: hasPdfFile,
        page: Math.max(0, page),
        quote,
      });
    },
    [docs],
  );

  const handleUploadPdf = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      await api.uploadPdf(file);
      await refreshGraph();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'PDF ingestion failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRunReconcile = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.runReconcile();
      setGraph(res);
      const firstConflict = res.clusters.find((c) => c.case_type === 'contradicted');
      setSelectedClusterId(firstConflict?.cluster_id ?? res.clusters[0]?.cluster_id ?? null);
      setClusterPage(0);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Reconciliation failed');
    } finally {
      setBusy(false);
    }
  };

  const allFacts = useMemo(() => {
    const docFacts = docs.flatMap((d) => d.facts);
    if (docFacts.length > 0) return docFacts;
    const seen = new Set<string>();
    const out: ExtractedFact[] = [];
    for (const c of clusters) {
      for (const f of c.facts) {
        if (!seen.has(f.fact_id)) {
          seen.add(f.fact_id);
          out.push(f);
        }
      }
    }
    return out;
  }, [docs, clusters]);

  const totalForensicFlags = useMemo(
    () => docs.reduce((sum, d) => sum + d.anomalies.length, 0),
    [docs],
  );
  const contradictedCount = graph?.summary_counts.contradicted ?? 0;
  const corroboratedCount = graph?.summary_counts.corroborated ?? 0;
  const hasFlags = totalForensicFlags > 0;

  const LIST_PAGE_SIZE = 25;
  const clusterTotalPages = Math.max(1, Math.ceil(clusters.length / LIST_PAGE_SIZE));
  const safeClusterPage = Math.min(clusterPage, clusterTotalPages - 1);
  const pagedClusters = clusters.slice(
    safeClusterPage * LIST_PAGE_SIZE,
    (safeClusterPage + 1) * LIST_PAGE_SIZE,
  );

  const docsTotalPages = Math.max(1, Math.ceil(docs.length / LIST_PAGE_SIZE));
  const safeDocsPage = Math.min(docsPage, docsTotalPages - 1);
  const pagedDocs = docs.slice(
    safeDocsPage * LIST_PAGE_SIZE,
    (safeDocsPage + 1) * LIST_PAGE_SIZE,
  );

  const factColumns = useMemo(
    () => [
      {
        key: 'subject',
        header: 'Claim & Attribute',
        sortValue: (f: ExtractedFact) => f.subject,
        render: (f: ExtractedFact) => (
          <div>
            <div dir="auto" className="font-semibold text-ink">
              {f.subject}
            </div>
            <div className="text-xs text-ink-secondary">{humanizeClaimKey(f.predicate)}</div>
          </div>
        ),
      },
      {
        key: 'val',
        header: 'Declared Value',
        sortValue: (f: ExtractedFact) => f.value,
        render: (f: ExtractedFact) => <span className="font-bold text-ink">{f.value}</span>,
      },
      {
        key: 'src',
        header: 'Source Document & Verbatim Quote',
        sortValue: (f: ExtractedFact) => f.provenance.filename,
        render: (f: ExtractedFact) => (
          <div className="space-y-1 max-w-xl">
            <div className="text-xs font-semibold text-ink">
              {humanizeDocumentName(f.provenance.filename)}{' '}
              <span className="font-normal text-ink-muted tabular">
                (p.{Math.max(1, f.provenance.page + 1)})
              </span>
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed wrap-anywhere">
              “{f.provenance.evidence_quote}”
            </p>
          </div>
        ),
      },
      {
        key: 'act',
        header: 'Source',
        align: 'right' as const,
        render: (f: ExtractedFact) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              openEvidence(
                f.provenance.doc_id,
                f.provenance.filename,
                f.provenance.page,
                f.provenance.evidence_quote,
              )
            }
          >
            Inspect p.{Math.max(1, f.provenance.page + 1)}
          </Button>
        ),
      },
    ],
    [openEvidence],
  );

  return (
    <div className="space-y-9 min-w-0">
      <header className="gazette-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Cross-Document Claim Reconciler
          </h1>
          <p className="text-sm text-ink-secondary">
            Compare statutory PDFs against brochures and ERP registers, catch microscopic footnotes,
            and route value conflicts for revision.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManageGraph ? (
            <>
              <label
                htmlFor="reconciler-pdf-upload"
                className="btn-interactive btn-secondary-tactile inline-flex min-h-11 lg:min-h-9 cursor-pointer items-center gap-2 rounded border border-rule bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-subtle hover:border-ink/30 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action"
              >
                <FileUp className="h-4 w-4 text-action" aria-hidden="true" />
                <span>Upload PDF</span>
                <input
                  id="reconciler-pdf-upload"
                  name="pdf_upload"
                  type="file"
                  accept="application/pdf"
                  disabled={busy}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.currentTarget.value = '';
                    void handleUploadPdf(f);
                  }}
                />
              </label>
              <Button
                variant="primary"
                disabled={busy || docs.length === 0}
                onClick={() => void handleRunReconcile()}
              >
                {busy ? (
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <GitMerge className="h-4 w-4" aria-hidden="true" />
                )}
                Reconcile Claims
              </Button>
            </>
          ) : (
            <StatusBadge tone="neutral" quiet>
              Read-only audit view
            </StatusBadge>
          )}
        </div>
      </header>

      {err && (
        <div
          role="alert"
          className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker"
        >
          {err}
        </div>
      )}

      {/* Elevated Gazette Summary Ledger */}
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-rule bg-rule-subtle shadow-[var(--shadow-sheet)] sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] tabular">
        <div className="min-w-0 bg-surface p-4">
          <dt className="text-xs font-medium text-ink-secondary">Source PDFs</dt>
          <dd className="mt-0.5 font-display text-2xl font-semibold text-ink">{formatCount(docs.length)}</dd>
        </div>
        <div className="min-w-0 bg-surface p-4">
          <dt className="text-xs font-medium text-ink-secondary">Extracted Claims</dt>
          <dd className="mt-0.5 font-display text-2xl font-semibold text-ink">{formatCount(allFacts.length)}</dd>
        </div>
        <div className="min-w-0 bg-surface p-4">
          <dt className="text-xs font-medium text-ink-secondary">Agreed Clusters</dt>
          <dd className="mt-0.5 font-display text-2xl font-semibold text-verified">{formatCount(corroboratedCount)}</dd>
        </div>
        <div className="min-w-0 bg-surface p-4">
          <dt className={`text-xs font-medium ${contradictedCount > 0 ? 'text-blocker font-semibold' : 'text-ink-secondary'}`}>
            Direct Conflict{contradictedCount === 1 ? '' : 's'}
          </dt>
          <dd className={`mt-0.5 font-display text-2xl font-semibold ${contradictedCount > 0 ? 'text-blocker' : 'text-ink'}`}>
            {formatCount(contradictedCount)}
          </dd>
        </div>
        {hasFlags && (
          <div className="min-w-0 bg-surface p-4">
            <dt className="text-xs font-semibold text-warn">
              Footnote Flag{totalForensicFlags === 1 ? '' : 's'}
            </dt>
            <dd className="mt-0.5 font-display text-2xl font-semibold text-warn">
              {formatCount(totalForensicFlags)}
            </dd>
          </div>
        )}
      </dl>

      {/* Signature Move: Split-Pane Archival Evidence Reconciler (Untruncated Side-by-Side Excerpts) */}
      {clusters.length > 0 && activeCluster && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.78fr_1.22fr] items-start border-t border-rule pt-7">
          <div className="space-y-3 min-w-0">
            <h2 className="font-display text-xl font-semibold text-ink">Reconciled Claim Groups</h2>
            <ul className="divide-y divide-rule border-y border-rule">
              {pagedClusters.map((c) => {
                const selected = c.cluster_id === activeCluster.cluster_id;
                const heading = humanizeClusterSubject(c.subject, c.predicate);
                const tone = clusterTone(c);
                return (
                  <li key={c.cluster_id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedClusterId(c.cluster_id);
                        setShowAllClusterFacts(false);
                      }}
                      className={`btn-interactive w-full px-3.5 py-3.5 text-start transition-none focus-visible:outline-2 focus-visible:outline-action ${
                        selected ? 'bg-action-tint' : 'row-hoverable'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span dir="auto" className="text-sm font-bold text-ink wrap-anywhere">
                          {heading.title}
                        </span>
                        <StatusBadge tone={tone} quiet={tone === 'verified'}>
                          {humanizeDispute(c.case_type)}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary leading-relaxed line-clamp-2 wrap-anywhere">
                        {humanizeClusterExplanation(c.explanation)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
            <PaginationBar
              page={safeClusterPage}
              totalPages={clusterTotalPages}
              onPageChange={setClusterPage}
            />
          </div>

          {/* Focal Paper Reconciliation Docket */}
          <Sheet
            tone="paper"
            title={humanizeClusterSubject(activeCluster.subject, activeCluster.predicate).title}
            subtitle={
              <ExpandableText
                text={humanizeClusterExplanation(activeCluster.explanation)}
                maxChars={280}
              />
            }
            actions={
              <StatusBadge
                tone={clusterTone(activeCluster)}
                quiet={activeCluster.case_type === 'corroborated'}
              >
                {humanizeDispute(activeCluster.dispute_code)}
              </StatusBadge>
            }
          >
            <div className="space-y-5">
              {/* Side-by-Side Competing Excerpts on Crisp Paper */}
              <div
                className={`grid grid-cols-1 gap-6 ${
                  activeCluster.facts.length >= 2 ? 'md:grid-cols-2' : ''
                }`}
              >
                {(showAllClusterFacts
                  ? activeCluster.facts
                  : activeCluster.facts.slice(0, 4)
                ).map((fact, idx) => {
                  const displayPg = Math.max(1, fact.provenance.page + 1);
                  const cred = activeCluster.credibility_scores?.[fact.fact_id];
                  const isContradicted = activeCluster.case_type === 'contradicted';
                  const credValues = Object.values(activeCluster.credibility_scores ?? {});
                  const maxCred = credValues.length > 0 ? Math.max(...credValues) : null;
                  const minCred = credValues.length > 0 ? Math.min(...credValues) : null;
                  const isHigherTrust =
                    typeof cred === 'number' &&
                    minCred !== null &&
                    maxCred !== null &&
                    maxCred > minCred + 0.01 &&
                    cred >= maxCred - 0.01;
                  const accentTop = 'border-t border-rule-subtle pt-3.5';
                  return (
                    <div
                      key={fact.fact_id}
                      className={`space-y-3 min-w-0 ${accentTop} ${
                        idx % 2 === 1 && activeCluster.facts.length >= 2
                          ? 'md:border-s md:border-rule md:ps-6'
                          : ''
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-ink wrap-anywhere">
                          {humanizeDocumentName(fact.provenance.filename)}
                        </span>
                        <span className="text-xs text-ink-muted shrink-0 tabular">
                          Page {displayPg}
                          {typeof cred === 'number' ? `, Trust ${Math.round(cred * 100)}%` : ''}
                        </span>
                      </div>

                      <div
                        className={`font-display text-3xl font-semibold tabular wrap-anywhere ${
                          isContradicted && !isHigherTrust ? 'text-blocker' : 'text-ink'
                        }`}
                      >
                        {fact.value}
                      </div>

                      {typeof cred === 'number' && (
                        <div className="h-1 w-full overflow-hidden rounded-full bg-trough">
                          <div
                            className={`gauge-fill h-full w-full ${
                              isContradicted && !isHigherTrust ? 'bg-blocker-strong' : 'bg-ink'
                            }`}
                            style={{ transform: `scaleX(${Math.min(1, Math.max(0, cred))})` }}
                          />
                        </div>
                      )}

                      <blockquote className="font-display text-base italic text-ink-body leading-relaxed wrap-anywhere">
                        “{fact.provenance.evidence_quote}”
                      </blockquote>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        {fact.temporal ? (
                          <span className="text-xs text-ink-secondary">{fact.temporal}</span>
                        ) : (
                          <span className="font-mono text-xs text-ink-muted wrap-anywhere">
                            {fact.provenance.filename}
                          </span>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            openEvidence(
                              fact.provenance.doc_id,
                              fact.provenance.filename,
                              fact.provenance.page,
                              fact.provenance.evidence_quote,
                            )
                          }
                        >
                          <Eye className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                          Inspect p.{displayPg}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeCluster.facts.length > 4 && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllClusterFacts((v) => !v)}
                  >
                    {showAllClusterFacts
                      ? 'Show fewer sources'
                      : `Show ${formatCount(activeCluster.facts.length - 4)} more sources`}
                  </Button>
                </div>
              )}

              {/* Executable Adjudication Bar for Conflicts */}
              {activeCluster.case_type === 'contradicted' && onOpenReviewStudio && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                  <p className="text-sm text-ink-secondary">
                    Route this contradiction directly to Review Studio to amend draft language
                    before publication.
                  </p>
                  <Button variant="primary" size="sm" onClick={onOpenReviewStudio}>
                    Open in Review Studio
                    <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                  </Button>
                </div>
              )}

              {activeCluster.edges.length > 0 && (
                <DisclosureProof label="Provenance comparison edges & detection scores">
                  <ul className="space-y-1.5">
                    {activeCluster.edges.map((edge, i) => (
                      <li key={i}>
                        <strong>{humanizeDispute(edge.edge_type)}</strong> ({edge.detection_method}
                        , {Math.round(edge.confidence * 100)}%): {edge.explanation}
                      </li>
                    ))}
                  </ul>
                </DisclosureProof>
              )}
            </div>
          </Sheet>
        </div>
      )}

      {/* Compact Source Filings Index (Replaces 60%-Empty 2x2 PDF Cards) */}
      <Sheet
        title="Ingested Source Filings"
        subtitle={`${pluralize(docs.length, 'PDF document')} indexed with layout & footnote forensics`}
      >
        {docs.length === 0 ? (
          <EmptyState
            title="No source PDFs ingested yet"
            description="Upload a prospectus, NAAC SSR, or statutory disclosure PDF to extract claims and audit footnotes."
          />
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-rule-subtle border-y border-rule">
              {pagedDocs.map((doc) => (
                <li
                  key={doc.doc_id}
                  className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <span className="text-sm font-bold text-ink wrap-anywhere">
                        {humanizeDocumentName(doc.filename)}
                      </span>
                      <span className="font-mono text-xs text-ink-muted wrap-anywhere">
                        {doc.filename}
                      </span>
                      <span className="text-xs text-ink-secondary tabular">
                        {pluralize(doc.page_count, 'page')}, {pluralize(doc.facts.length, 'claim')}
                      </span>
                    </div>

                    {doc.anomalies.map((anom, i) => (
                      <div
                        key={i}
                        className="inline-flex items-start gap-2 text-xs font-medium text-warn"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="wrap-anywhere">
                          {humanizeAnomalySummary(anom.page, anom.kind, anom.detail)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {doc.anomalies.length === 0 && (
                      <StatusBadge tone="verified" quiet>
                        Clean layout
                      </StatusBadge>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEvidenceModal({
                          open: true,
                          docId: doc.doc_id,
                          filename: doc.filename,
                          hasStoredPdf: true,
                          page: doc.anomalies[0]?.page ?? 0,
                        })
                      }
                    >
                      <Eye className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                      Inspect PDF
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <PaginationBar
              page={safeDocsPage}
              totalPages={docsTotalPages}
              onPageChange={setDocsPage}
            />
          </div>
        )}
      </Sheet>

      {/* Flat Unified Claims Register */}
      <Sheet
        title="Unified Claims Register"
        subtitle={`${pluralize(allFacts.length, 'extracted claim')} across source filings`}
      >
        <DataTable
          rows={allFacts}
          rowKey={(f, i) => `${f.fact_id}-${i}`}
          searchText={(f) =>
            `${f.subject} ${f.predicate} ${f.value} ${f.provenance.filename} ${f.provenance.evidence_quote}`
          }
          searchPlaceholder="Filter claims, source PDFs, or exact quotes…"
          emptyTitle="No claims extracted"
          emptyDescription="Ingest an institutional PDF to populate verifiable claims."
          columns={factColumns}
        />
      </Sheet>

      <EvidencePdfModal
        open={evidenceModal.open}
        docId={evidenceModal.docId}
        filename={evidenceModal.filename}
        hasStoredPdf={evidenceModal.hasStoredPdf}
        initialPage={evidenceModal.page}
        highlightQuote={evidenceModal.quote}
        onClose={() =>
          setEvidenceModal({ open: false, docId: null, hasStoredPdf: false, page: 0 })
        }
      />
    </div>
  );
}
