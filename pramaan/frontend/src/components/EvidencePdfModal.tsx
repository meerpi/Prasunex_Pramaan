import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type { DocumentBBoxesResponse, StoredDocument } from '../api/types.ts';
import { formatCount, humanizeAnomalyKind } from '../utils/format.ts';
import { AccessibleModal, Button, StatusBadge } from './ui/index.ts';

const PAGE_CACHE_LIMIT = 8;

interface EvidencePdfModalProps {
  open: boolean;
  docId: string | null;
  filename?: string;
  hasStoredPdf?: boolean;
  initialPage?: number;
  highlightQuote?: string;
  onClose: () => void;
}

interface CachedPageEntry {
  bboxes: DocumentBBoxesResponse;
  imageUrl: string;
}

export function EvidencePdfModal({
  open,
  docId,
  filename,
  hasStoredPdf = false,
  initialPage = 0,
  highlightQuote,
  onClose,
}: EvidencePdfModalProps) {
  const initKey = `${docId ?? ''}:${initialPage}:${hasStoredPdf}:${highlightQuote ?? ''}`;
  const [prevInitKey, setPrevInitKey] = useState(initKey);
  const [wasOpen, setWasOpen] = useState(open);
  const [pageIdx, setPageIdx] = useState(Math.max(0, initialPage));
  const [forensics, setForensics] = useState<StoredDocument | null>(null);
  const [bboxes, setBboxes] = useState<DocumentBBoxesResponse | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [err, setErr] = useState('');
  const pageCacheRef = useRef<Map<string, CachedPageEntry>>(new Map());

  if ((open && !wasOpen) || initKey !== prevInitKey) {
    const keyChanged = initKey !== prevInitKey;
    setWasOpen(open);
    setPrevInitKey(initKey);
    if (open) {
      setPageIdx(Math.max(0, initialPage));
      setReloadNonce(0);
      setErr('');
      if (keyChanged) {
        setForensics(null);
        setBboxes(null);
        setImageUrl(null);
        setLoadedKey('');
      }
    }
  } else if (open !== wasOpen) {
    setWasOpen(open);
  }

  // Revoke cached object URLs whenever doc changes or component unmounts
  useEffect(() => {
    const cache = pageCacheRef.current;
    return () => {
      for (const entry of cache.values()) {
        URL.revokeObjectURL(entry.imageUrl);
      }
      cache.clear();
    };
  }, [docId]);

  // Fetch document-level forensics only when modal opens or docId changes
  useEffect(() => {
    if (!open || !docId || !hasStoredPdf) return;
    let active = true;
    api
      .getDocumentForensics(docId)
      .then((docRes) => {
        if (!active) return;
        setForensics(docRes);
        setPageIdx((prev) =>
          docRes.page_count > 0 ? Math.max(0, Math.min(docRes.page_count - 1, prev)) : 0,
        );
      })
      .catch((e: unknown) => {
        if (!active) return;
        setErr(e instanceof Error ? e.message : 'Unable to load document forensics.');
      });
    return () => {
      active = false;
    };
  }, [open, docId, hasStoredPdf, reloadNonce]);

  const isQuotedPage = Boolean(highlightQuote) && pageIdx === Math.max(0, initialPage);
  const activeQuote = isQuotedPage ? highlightQuote : undefined;
  const cacheKey = `${docId ?? ''}:${pageIdx}:${activeQuote ?? ''}`;
  const targetKey = `${cacheKey}:${reloadNonce}`;
  const loading = Boolean(open && docId && hasStoredPdf && loadedKey !== targetKey && !err);

  // Fetch (or reuse cached) page bboxes & authenticated page PNG blob when active page/quote changes
  useEffect(() => {
    if (!open || !docId || !hasStoredPdf) return;
    const cache = pageCacheRef.current;
    const cached = cache.get(cacheKey);
    if (cached && reloadNonce === 0) {
      // Refresh LRU recency
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      setBboxes(cached.bboxes);
      setImageUrl(cached.imageUrl);
      setLoadedKey(targetKey);
      setErr('');
      return;
    }

    const ctrl = new AbortController();
    Promise.all([
      api.getPageBboxes(docId, pageIdx, activeQuote, ctrl.signal),
      api.fetchDocumentPageImageBlob(docId, pageIdx, ctrl.signal),
    ])
      .then(([bboxRes, imgBlob]) => {
        if (ctrl.signal.aborted) return;
        const createdUrl = URL.createObjectURL(imgBlob);
        const prev = cache.get(cacheKey);
        if (prev) {
          URL.revokeObjectURL(prev.imageUrl);
          cache.delete(cacheKey);
        }
        cache.set(cacheKey, { bboxes: bboxRes, imageUrl: createdUrl });
        while (cache.size > PAGE_CACHE_LIMIT) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey === undefined) break;
          const evicted = cache.get(oldestKey);
          if (evicted) URL.revokeObjectURL(evicted.imageUrl);
          cache.delete(oldestKey);
        }
        setBboxes(bboxRes);
        setImageUrl(createdUrl);
        setLoadedKey(targetKey);
        setErr('');
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setErr(e instanceof Error ? e.message : 'Unable to load PDF evidence page.');
      });

    return () => {
      ctrl.abort();
    };
  }, [open, docId, pageIdx, activeQuote, hasStoredPdf, cacheKey, targetKey, reloadNonce]);

  const goToPage = (nextPage: number) => {
    setErr('');
    setReloadNonce(0);
    setPageIdx(nextPage);
  };

  const totalPages = Math.max(1, forensics?.page_count ?? 1);
  const displayPage = pageIdx + 1;
  const pageAnomalies = (forensics?.anomalies ?? []).filter((a) => a.page === pageIdx);
  const gq = !loading && isQuotedPage ? bboxes?.grounded_quote : null;
  const viewW = bboxes?.page_width || 612;
  const viewH = bboxes?.page_height || 792;
  const resolvedFilename = forensics?.filename ?? filename;

  // Allow Left/Right arrow keyboard page turning inside the evidence modal
  useEffect(() => {
    if (!open || !hasStoredPdf || loading) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
      const goNext = isRtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      if (goNext && pageIdx < totalPages - 1) {
        e.preventDefault();
        setErr('');
        setReloadNonce(0);
        setPageIdx(pageIdx + 1);
      } else if (!goNext && pageIdx > 0) {
        e.preventDefault();
        setErr('');
        setReloadNonce(0);
        setPageIdx(pageIdx - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, hasStoredPdf, loading, pageIdx, totalPages]);

  return (
    <AccessibleModal
      open={open}
      onClose={onClose}
      title={resolvedFilename ? `Source Evidence — ${resolvedFilename}` : 'Source Document Evidence'}
      subtitle={
        docId
          ? hasStoredPdf
            ? `Page ${formatCount(displayPage)} of ${formatCount(totalPages)}${
                highlightQuote ? ' — Highlighting grounded quote region' : ''
              }`
            : `Pre-indexed provenance reference, Page ${formatCount(displayPage)}`
          : undefined
      }
      maxWidthClass="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {hasStoredPdf ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={pageIdx <= 0 || loading}
                onClick={() => goToPage(Math.max(0, pageIdx - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                Previous page
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pageIdx >= totalPages - 1 || loading}
                onClick={() => goToPage(Math.min(totalPages - 1, pageIdx + 1))}
              >
                Next page
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <span className="text-xs text-ink-secondary">
              Upload this PDF via Claim Reconciler to inspect full-page word coordinates.
            </span>
          )}
          <Button variant="primary" size="sm" onClick={onClose}>
            Done inspecting
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {highlightQuote && (
          <div className="rounded border border-rule bg-subtle px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                {isQuotedPage
                  ? 'Target claim quote'
                  : `Target claim quote (cited on Page ${formatCount(Math.max(0, initialPage) + 1)})`}
              </span>
              {isQuotedPage ? (
                gq && (
                  <StatusBadge tone={gq.found ? 'verified' : 'warn'}>
                    {gq.found
                      ? `Coordinate Match (${formatCount(Math.min(100, Math.round(gq.score > 1 ? gq.score : gq.score * 100)))}%)`
                      : 'Exact Span Pending'}
                  </StatusBadge>
                )
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => goToPage(Math.max(0, initialPage))}
                >
                  Jump to Page {formatCount(Math.max(0, initialPage) + 1)}
                </Button>
              )}
            </div>
            <p className="mt-1 text-ink-secondary wrap-anywhere">“{highlightQuote}”</p>
          </div>
        )}

        {pageAnomalies.length > 0 && (
          <div
            role="status"
            aria-atomic="true"
            className="border-y border-warn-border bg-warn-bg px-3.5 py-2.5 text-xs text-warn space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Document Forensics Alert on Page {formatCount(displayPage)}</span>
            </div>
            {pageAnomalies.map((a, i) => (
              <div key={i} className="wrap-anywhere">
                <strong>{humanizeAnomalyKind(a.kind)}:</strong> {a.detail}{' '}
                {a.wcag_contrast !== null && `(contrast ${a.wcag_contrast.toFixed(1)}:1)`}{' '}
                {a.effective_font_pt !== null && `(${a.effective_font_pt.toFixed(1)} pt)`}
              </div>
            ))}
          </div>
        )}

        {err && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-y border-blocker-border bg-blocker-bg px-3 py-2 text-xs font-medium text-blocker"
          >
            <span>{err}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setErr('');
                setReloadNonce((n) => n + 1);
              }}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-action" aria-hidden="true" />
            <span>Rendering PDF page raster and word coordinates…</span>
          </div>
        ) : docId && hasStoredPdf && imageUrl && loadedKey === targetKey ? (
          <div className="max-h-[58vh] overflow-auto rounded border border-rule bg-trough p-2">
            <div className="relative mx-auto w-fit max-w-full bg-surface shadow-sm">
              <img
                src={imageUrl}
                alt={`Document page ${displayPage}`}
                className="block max-w-full h-auto"
              />
              <svg
                viewBox={`0 0 ${viewW} ${viewH}`}
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {gq?.bbox && (
                  <rect
                    x={gq.bbox[0]}
                    y={gq.bbox[1]}
                    width={Math.max(4, gq.bbox[2] - gq.bbox[0])}
                    height={Math.max(4, gq.bbox[3] - gq.bbox[1])}
                    fill="rgba(27, 59, 111, 0.16)"
                    stroke="#1B3B6F"
                    strokeWidth={2}
                    rx={2}
                  />
                )}
                {(gq?.matched_words ?? []).map((w, idx) => (
                  <rect
                    key={`${w.word}-${idx}`}
                    x={w.x0}
                    y={w.y0}
                    width={Math.max(2, w.x1 - w.x0)}
                    height={Math.max(2, w.y1 - w.y0)}
                    fill="rgba(158, 34, 29, 0.16)"
                    stroke="#9E221D"
                    strokeWidth={1}
                  />
                ))}
              </svg>
            </div>
          </div>
        ) : docId ? (
          <div className="space-y-3 border-y border-rule bg-subtle p-5 text-xs">
            <div className="flex items-center gap-2 font-bold text-ink">
              <FileText className="h-4 w-4 text-action" aria-hidden="true" />
              <span>Pre-Indexed Provenance Citation</span>
            </div>
            <dl className="divide-y divide-rule-subtle border-y border-rule-subtle bg-surface px-3.5">
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-secondary">Source Reference</dt>
                <dd className="font-mono font-semibold text-ink wrap-anywhere">
                  {resolvedFilename ?? docId}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-secondary">Document Key</dt>
                <dd className="font-mono text-ink-secondary wrap-anywhere">{docId}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-secondary">Cited Page</dt>
                <dd className="font-semibold text-ink tabular">Page {formatCount(displayPage)}</dd>
              </div>
            </dl>
            <p className="text-ink-secondary leading-relaxed">
              The original PDF binary for this citation is not stored on this server yet. Upload the
              source PDF via <strong>Upload PDF</strong> in the Claim Reconciler to render full-page
              rasters and exact word bounding boxes.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-secondary">
            <FileText className="h-4 w-4" />
            <span>Select a document claim to inspect its source coordinates.</span>
          </div>
        )}
      </div>
    </AccessibleModal>
  );
}
