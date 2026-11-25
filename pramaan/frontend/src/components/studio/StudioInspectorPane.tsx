import { useMemo, useState } from 'react';
import { FilePenLine, MessageSquarePlus } from 'lucide-react';
import type {
  AuthUser,
  FindingRow,
  SubmissionComment,
  SubmissionVersion,
} from '../../api/types.ts';
import {
  findingTone,
  formatCount,
  formatDateTime,
  humanizeFindingMessage,
  humanizeSeverity,
  humanizeStatus,
  humanizeTier,
  truncateMiddle,
} from '../../utils/format.ts';
import {
  Button,
  DataTable,
  DisclosureProof,
  EmptyState,
  ExpandableText,
  PaginationBar,
  SegmentedTabs,
  StatusBadge,
} from '../ui/index.ts';

const COMMENT_ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  parent: 'Parent / Guardian',
  teacher: 'Faculty',
  recruiter: 'Recruiter',
  admin: 'Registrar / Admin',
};

interface StudioInspectorPaneProps {
  user: AuthUser;
  isAuthorRole: boolean;
  isReviewerRole: boolean;
  canEdit: boolean;
  canMutateFindings: boolean;
  inspectorTab: 'findings' | 'versions' | 'comments';
  onSelectTab: (tab: 'findings' | 'versions' | 'comments') => void;
  findings: FindingRow[];
  displayFindings: FindingRow[];
  hasMoreFindings: boolean;
  onShowMoreFindings: () => void;
  versions: SubmissionVersion[];
  comments: SubmissionComment[];
  activeFindingId: number | null;
  onSelectFinding: (rowId: number | null) => void;
  resolvingRowId: number | null;
  rewriteLoading: boolean;
  onResolve: (rowId: number, resolution: 'accepted' | 'dismissed' | 'overridden') => void;
  onOpenRewrite: (finding: FindingRow) => void;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  commentBusy: boolean;
  onAddComment: (e: React.FormEvent) => void;
}

export function StudioInspectorPane({
  user,
  isAuthorRole,
  isReviewerRole,
  canEdit,
  canMutateFindings,
  inspectorTab,
  onSelectTab,
  findings,
  displayFindings,
  hasMoreFindings,
  onShowMoreFindings,
  versions,
  comments,
  activeFindingId,
  onSelectFinding,
  resolvingRowId,
  rewriteLoading,
  onResolve,
  onOpenRewrite,
  commentBody,
  onCommentBodyChange,
  commentBusy,
  onAddComment,
}: StudioInspectorPaneProps) {
  const [commentsPage, setCommentsPage] = useState(0);
  const COMMENTS_PAGE_SIZE = 25;
  const commentsTotalPages = Math.max(1, Math.ceil(comments.length / COMMENTS_PAGE_SIZE));
  const safeCommentsPage = Math.min(commentsPage, commentsTotalPages - 1);
  const pagedComments = comments.slice(
    safeCommentsPage * COMMENTS_PAGE_SIZE,
    (safeCommentsPage + 1) * COMMENTS_PAGE_SIZE,
  );

  const versionColumns = useMemo(
    () => [
      {
        key: 'ver',
        header: 'Rev',
        render: (v: SubmissionVersion) => (
          <span className="font-mono text-xs">v{v.version_number}</span>
        ),
      },
      {
        key: 'note',
        header: 'Change Note & Hash',
        render: (v: SubmissionVersion) => (
          <div>
            <div className="font-medium text-ink">{v.change_note}</div>
            <div className="font-mono text-xs text-ink-secondary">
              <span title={v.content_hash}>{truncateMiddle(v.content_hash, 10, 6)}</span> ·{' '}
              {formatDateTime(v.created_at)}
            </div>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <section className="min-w-0 space-y-4">
      <SegmentedTabs
        ariaLabel="Review inspector sections"
        idPrefix="studio-tab"
        value={inspectorTab}
        onChange={onSelectTab}
        options={[
          {
            id: 'findings',
            label: `Findings (${formatCount(findings.length)})`,
            panelId: 'studio-panel-findings',
          },
          {
            id: 'versions',
            label: `Revisions (${formatCount(versions.length)})`,
            panelId: 'studio-panel-versions',
          },
          {
            id: 'comments',
            label: `Notes (${formatCount(comments.length)})`,
            panelId: 'studio-panel-comments',
          },
        ]}
      />

      {inspectorTab === 'findings' && (() => {
        const openList = findings.filter((f) => f.resolution === 'open');
        const openBlockers = openList.filter((f) => f.severity >= 50).length;
        const openAdvisories = openList.length - openBlockers;
        return (
          <div
            id="studio-panel-findings"
            role="tabpanel"
            aria-labelledby="studio-tab-findings"
            className="space-y-3"
          >
            {findings.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className={openBlockers > 0 ? 'text-blocker' : 'text-verified'}>
                    {formatCount(openBlockers)} blocker{openBlockers === 1 ? '' : 's'}
                  </span>
                  <span className="text-rule" aria-hidden="true">·</span>
                  <span className="text-warn">
                    {formatCount(openAdvisories)} advisor{openAdvisories === 1 ? 'y' : 'ies'}
                  </span>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 text-ink-muted">
                  <kbd className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">
                    J
                  </kbd>
                  <kbd className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">
                    K
                  </kbd>
                  <span>triage</span>
                </span>
              </div>
            )}

            {findings.length === 0 ? (
              <EmptyState
                title="No compliance findings flagged"
                description="Run a compliance scan to check this draft against active institutional ordinances."
              />
            ) : (
              <>
                {hasMoreFindings && (
                  <p className="text-xs text-ink-secondary">
                    Showing {formatCount(displayFindings.length)} of {formatCount(findings.length)}{' '}
                    flagged exceptions (open blockers listed first).
                  </p>
                )}
                <ul className="divide-y divide-rule border-y border-rule">
                  {displayFindings.map((f) => {
                    const isSelected = activeFindingId === f.row_id;
                    const tone = findingTone(f);
                    const isResolved = f.resolution !== 'open';
                    return (
                      <li
                        key={f.row_id}
                        className={`py-4 px-3 transition-none ${
                          isSelected
                            ? 'bg-action-tint'
                            : isResolved
                              ? 'bg-resolved/70 opacity-80'
                              : 'bg-transparent'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectFinding(isSelected ? null : f.row_id)}
                          aria-pressed={isSelected}
                          className="w-full text-start focus-visible:outline-2 focus-visible:outline-action"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <StatusBadge tone={isResolved ? 'neutral' : tone} quiet={isResolved}>
                              {humanizeSeverity(f.severity)}
                            </StatusBadge>
                            <span className="text-xs text-ink-secondary">
                              {humanizeStatus(f.resolution)} · {humanizeTier(f.payload.trace?.tier)}
                            </span>
                          </div>
                          <p
                            dir="auto"
                            className="mt-2 text-sm font-medium text-ink leading-relaxed"
                          >
                            <ExpandableText text={humanizeFindingMessage(f.message)} maxChars={280} />
                          </p>
                        </button>

                        {f.payload.suggestion?.summary && (
                          <p className="mt-2 border-s border-rule ps-3 text-sm text-ink-secondary wrap-anywhere leading-relaxed">
                            <strong className="text-ink">Suggested edit:</strong>{' '}
                            {humanizeFindingMessage(f.payload.suggestion.summary)}
                          </p>
                        )}

                        {f.resolution === 'open' &&
                          canMutateFindings &&
                          (canEdit || isReviewerRole) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {canEdit && f.payload.suggestion?.patch && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={resolvingRowId !== null}
                                  onClick={() => onResolve(f.row_id, 'accepted')}
                                >
                                  {resolvingRowId === f.row_id
                                    ? 'Applying…'
                                    : 'Apply suggested edit'}
                                </Button>
                              )}
                              {canEdit && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={rewriteLoading}
                                  onClick={() => onOpenRewrite(f)}
                                >
                                  <FilePenLine
                                    className="h-3.5 w-3.5 text-action"
                                    aria-hidden="true"
                                  />
                                  Draft Compliant Phrasing
                                </Button>
                              )}
                              {isReviewerRole && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={resolvingRowId !== null}
                                  onClick={() => onResolve(f.row_id, 'dismissed')}
                                >
                                  Dismiss
                                </Button>
                              )}
                            </div>
                          )}

                        <div className="mt-2.5">
                          <DisclosureProof label="Rule ID & verification trace">
                            Check: {f.check_id} | Rule: {f.payload.rule.rule_id} (
                            {f.payload.rule.rule_type}) | Severity score: {formatCount(f.severity)}
                            {f.payload.trace?.latency_ms != null &&
                              ` | ${f.payload.trace.latency_ms} ms`}
                          </DisclosureProof>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {hasMoreFindings && (
                  <div className="pt-2">
                    <Button variant="secondary" size="sm" onClick={onShowMoreFindings}>
                      Show more findings ({formatCount(findings.length - displayFindings.length)}{' '}
                      remaining)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {inspectorTab === 'versions' && (
        <div
          id="studio-panel-versions"
          role="tabpanel"
          aria-labelledby="studio-tab-versions"
        >
          <DataTable
            rows={versions}
            rowKey={(v) => String(v.version_number)}
            dense
            emptyTitle="No recorded revisions"
            emptyDescription="Saving edits creates immutable version snapshots."
            columns={versionColumns}
          />
        </div>
      )}

      {inspectorTab === 'comments' && (
        <div
          id="studio-panel-comments"
          role="tabpanel"
          aria-labelledby="studio-tab-comments"
          className="space-y-4"
        >
          <form onSubmit={onAddComment} className="space-y-2.5">
            <label htmlFor="review-note-input" className="block text-xs font-semibold text-ink">
              Add reviewer note ({user.display_name})
            </label>
            <textarea
              id="review-note-input"
              rows={2}
              maxLength={4000}
              value={commentBody}
              onChange={(e) => onCommentBodyChange(e.target.value)}
              placeholder="Record ordinance justification or edit request…"
              className="w-full rounded border border-rule bg-surface p-2.5 text-sm text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={!isAuthorRole || !commentBody.trim() || commentBusy}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
              {commentBusy ? 'Posting…' : 'Post note'}
            </Button>
          </form>

          {comments.length === 0 ? (
            <EmptyState
              title="No discussion notes yet"
              description="Post review context or audit sign-off notes tied to this draft."
            />
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-rule-subtle border-t border-rule">
                {pagedComments.map((c) => (
                  <li key={c.id} className="py-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span dir="auto" className="font-bold text-ink">
                        {c.author_name}{' '}
                        <span className="font-normal text-xs text-ink-secondary">
                          ({COMMENT_ROLE_LABELS[c.role] ?? c.role})
                        </span>
                      </span>
                      <span className="text-xs text-ink-secondary tabular">
                        {formatDateTime(c.created_at)}
                      </span>
                    </div>
                    <p dir="auto" className="text-ink-body leading-relaxed">
                      <ExpandableText text={c.body} maxChars={320} preserveLines />
                    </p>
                  </li>
                ))}
              </ul>
              <PaginationBar
                page={safeCommentsPage}
                totalPages={commentsTotalPages}
                onPageChange={setCommentsPage}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
