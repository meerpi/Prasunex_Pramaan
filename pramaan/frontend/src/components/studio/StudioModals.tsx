import type { CanonSummary, FindingRow, RewriteResponse } from '../../api/types.ts';
import { formatPercent, pluralize } from '../../utils/format.ts';
import { AccessibleModal, Button, DisclosureProof, StatusBadge } from '../ui/index.ts';

const DEFAULT_CANONS = [
  'pramaan-campus-placement',
  'pramaan-faculty-academic-audit',
  'pramaan-naac-aishe-ssr',
  'pramaan-cbse-k12-disclosure',
];

interface StudioModalsProps {
  createOpen: boolean;
  createErr?: string;
  onCloseCreate: () => void;
  newTitle: string;
  onNewTitleChange: (v: string) => void;
  newCanon: string;
  onNewCanonChange: (v: string) => void;
  newContent: string;
  onNewContentChange: (v: string) => void;
  canons: CanonSummary[];
  creatingDraft: boolean;
  onCreateDraft: (e: React.FormEvent) => void;
  rewriteModal: {
    open: boolean;
    finding: FindingRow | null;
    result: RewriteResponse | null;
    loading: boolean;
  };
  onCloseRewrite: () => void;
  applyingRewrite: boolean;
  onApplyRewrite: () => void;
}

export function StudioModals({
  createOpen,
  createErr,
  onCloseCreate,
  newTitle,
  onNewTitleChange,
  newCanon,
  onNewCanonChange,
  newContent,
  onNewContentChange,
  canons,
  creatingDraft,
  onCreateDraft,
  rewriteModal,
  onCloseRewrite,
  applyingRewrite,
  onApplyRewrite,
}: StudioModalsProps) {
  return (
    <>
      <AccessibleModal
        open={createOpen}
        onClose={onCloseCreate}
        title="New Compliance Draft"
        subtitle="Create an institutional notice or prospectus section bound to an active ordinance."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={onCreateDraft} className="space-y-4">
          {createErr && (
            <div
              role="alert"
              className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-xs font-medium text-blocker wrap-anywhere"
            >
              {createErr}
            </div>
          )}
          <div>
            <label htmlFor="new-draft-title" className="block text-xs font-semibold text-ink">
              Document title
            </label>
            <input
              id="new-draft-title"
              name="draft_title"
              type="text"
              required
              maxLength={256}
              value={newTitle}
              onChange={(e) => onNewTitleChange(e.target.value)}
              placeholder="Enter notice, prospectus, or circular title"
              className="mt-1.5 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
            />
          </div>
          <div>
            <label htmlFor="new-draft-canon" className="block text-xs font-semibold text-ink">
              Target ordinance canon
            </label>
            <select
              id="new-draft-canon"
              value={newCanon}
              onChange={(e) => onNewCanonChange(e.target.value)}
              className="mt-1.5 min-h-11 lg:min-h-9 w-full rounded border border-rule bg-surface px-3 py-2 font-mono text-xs text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
            >
              {(canons.length > 0
                ? canons.map((c) => ({ id: c.id, label: `${c.id} (v${c.version})` }))
                : DEFAULT_CANONS.map((id) => ({ id, label: id }))
              ).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-draft-body" className="block text-xs font-semibold text-ink">
              Draft copy
            </label>
            <textarea
              id="new-draft-body"
              name="draft_content"
              rows={5}
              required
              maxLength={200000}
              value={newContent}
              onChange={(e) => onNewContentChange(e.target.value)}
              placeholder="Paste circular or brochure paragraphs for statutory verification…"
              className="mt-1.5 w-full rounded border border-rule bg-surface p-3 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onCloseCreate}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={creatingDraft}>
              {creatingDraft ? 'Creating…' : 'Create Draft'}
            </Button>
          </div>
        </form>
      </AccessibleModal>

      <AccessibleModal
        open={rewriteModal.open}
        onClose={onCloseRewrite}
        title="Compliant Phrasing Suggestion"
        subtitle="Personal identifiers are masked before generating ordinance-compliant replacement language."
        maxWidthClass="max-w-2xl"
        footer={
          !rewriteModal.loading && rewriteModal.result ? (
            <>
              <Button variant="secondary" onClick={onCloseRewrite}>
                Close
              </Button>
              <Button variant="primary" disabled={applyingRewrite} onClick={onApplyRewrite}>
                {applyingRewrite ? 'Applying…' : 'Apply Revision to Draft'}
              </Button>
            </>
          ) : undefined
        }
      >
        {rewriteModal.loading ? (
          <p className="py-8 text-center text-sm text-ink-secondary">
            Drafting compliant phrasing and re-running ordinance check…
          </p>
        ) : rewriteModal.result ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                tone={
                  rewriteModal.result.reverified &&
                  rewriteModal.result.remaining_findings_count === 0
                    ? 'verified'
                    : 'warn'
                }
              >
                {rewriteModal.result.reverified
                  ? rewriteModal.result.remaining_findings_count === 0
                    ? 'Verified · 0 findings remaining'
                    : `Target resolved · ${pluralize(
                        rewriteModal.result.remaining_findings_count,
                        'other flag',
                      )} in draft`
                  : `${pluralize(rewriteModal.result.remaining_findings_count, 'finding')} remaining`}
              </StatusBadge>
              <span className="text-xs text-ink-secondary tabular">
                {pluralize(rewriteModal.result.pii_masked_count, 'identifier')} masked · Edit delta{' '}
                {formatPercent(rewriteModal.result.edit_distance_ratio * 100, 1)}
              </span>
            </div>

            {rewriteModal.result.provider_notice?.trim() && (
              <p
                role="status"
                aria-atomic="true"
                className="border-y border-rule-subtle bg-subtle/50 px-3 py-2 text-xs text-ink-secondary wrap-anywhere"
              >
                {rewriteModal.result.provider_notice.trim()}
              </p>
            )}

            <div className="grid grid-cols-1 divide-y divide-rule border-y border-rule sm:grid-cols-2 sm:divide-y-0 sm:divide-x rtl:divide-x-reverse">
              <div className="min-w-0 py-3.5 sm:pe-4">
                <div className="text-xs font-bold text-blocker mb-1.5">Original phrasing</div>
                <p dir="auto" className="text-ink wrap-anywhere leading-relaxed">
                  {rewriteModal.result.original_text}
                </p>
              </div>
              <div className="min-w-0 py-3.5 sm:ps-4">
                <div className="text-xs font-bold text-verified mb-1.5">
                  Proposed compliant revision
                </div>
                <p dir="auto" className="text-ink wrap-anywhere leading-relaxed">
                  {rewriteModal.result.rewritten_text}
                </p>
              </div>
            </div>

            <DisclosureProof label="Masked prompt & audit details">
              <div className="wrap-anywhere">{rewriteModal.result.masked_prompt_preview}</div>
            </DisclosureProof>
          </div>
        ) : null}
      </AccessibleModal>
    </>
  );
}
