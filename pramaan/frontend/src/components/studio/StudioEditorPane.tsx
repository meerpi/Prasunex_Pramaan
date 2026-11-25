import { EditorContent, type Editor } from '@tiptap/react';
import { Check, CheckCircle2, Save, Send, ShieldCheck, XCircle } from 'lucide-react';
import type { Submission, WorkflowResponse } from '../../api/types.ts';
import { formatCount, formatDateTime, pluralize, truncateMiddle } from '../../utils/format.ts';
import { Button, DisclosureProof, Sheet, StatusBadge } from '../ui/index.ts';

const WORKFLOW_STEPS = [
  { id: 'draft', label: 'Draft' },
  { id: 'in_review', label: 'In Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'published', label: 'Published' },
] as const;

function stepIndexForStatus(status: Submission['status']): number {
  if (status === 'published') return 3;
  if (status === 'approved') return 2;
  if (status === 'in_review') return 1;
  return 0;
}

interface StudioEditorPaneProps {
  editor: Editor | null;
  activeSub: Submission;
  openFindingsCount: number;
  isDirty: boolean;
  nearLimitChars?: number | null;
  activeFindingId: number | null;
  onClearActiveFinding: () => void;
  saving: boolean;
  canEdit: boolean;
  isAuthorRole: boolean;
  isReviewerRole: boolean;
  unresolvedBlockers: boolean;
  workflowBusy: boolean;
  canSubmit: boolean;
  canRequestChanges: boolean;
  canApprove: boolean;
  canPublish: boolean;
  workflowRes: WorkflowResponse | null;
  onSave: () => void;
  onWorkflow: (action: string) => void;
}

export function StudioEditorPane({
  editor,
  activeSub,
  openFindingsCount,
  isDirty,
  nearLimitChars = null,
  activeFindingId,
  onClearActiveFinding,
  saving,
  canEdit,
  isAuthorRole,
  isReviewerRole,
  unresolvedBlockers,
  workflowBusy,
  canSubmit,
  canRequestChanges,
  canApprove,
  canPublish,
  workflowRes,
  onSave,
  onWorkflow,
}: StudioEditorPaneProps) {
  const manifest = workflowRes?.c2pa_manifest ?? activeSub.c2pa_manifest;

  return (
    <div className="space-y-6 min-w-0 xl:sticky xl:top-16">
      <Sheet
        tone="paper"
        title={activeSub.title}
        subtitle={`Ordinance ${activeSub.canon_id} — Updated ${formatDateTime(
          activeSub.updated_at,
        )} (${pluralize(openFindingsCount, 'open flag')})`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isDirty && <StatusBadge tone="warn">Unsaved edits</StatusBadge>}
            {activeFindingId !== null && (
              <Button variant="ghost" size="sm" onClick={onClearActiveFinding}>
                Clear focus
              </Button>
            )}
          </div>
        }
      >
        {/* Integrated Statutory Approval Progression */}
        <ol
          aria-label="Publication approval lifecycle"
          className="mb-5 grid grid-cols-2 gap-2.5 2xl:grid-cols-4 2xl:gap-3 border-b border-rule-subtle pb-4 text-xs"
        >
          {WORKFLOW_STEPS.map((st, idx) => {
            const cur = stepIndexForStatus(activeSub.status);
            const done = idx < cur || (activeSub.status === 'published' && idx === 3);
            const current = idx === cur && activeSub.status !== 'published';
            const isReturned = activeSub.status === 'changes_requested' && idx === 0;
            return (
              <li key={st.id} className="space-y-1.5">
                <div className="h-[3px] w-full overflow-hidden bg-trough">
                  <div
                    className={`gauge-fill h-full w-full ${
                      isReturned
                        ? 'bg-blocker-strong'
                        : done
                          ? 'bg-verified'
                          : current
                            ? 'bg-action'
                            : 'bg-transparent'
                    }`}
                    style={{ transform: `scaleX(${done || current || isReturned ? 1 : 0})` }}
                  />
                </div>
                <div className="flex items-center gap-1.5 font-medium">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                      isReturned
                        ? 'bg-blocker text-surface'
                        : done
                          ? 'bg-verified text-surface'
                          : current
                            ? 'bg-action text-surface'
                            : 'border border-rule bg-surface text-ink-muted'
                    }`}
                  >
                    {done ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : idx + 1}
                  </span>
                  <span
                    className={
                      isReturned
                        ? 'text-blocker font-semibold'
                        : done
                          ? 'text-verified'
                          : current
                            ? 'text-ink font-semibold'
                            : 'text-ink-muted'
                    }
                  >
                    {isReturned ? 'Changes Req.' : st.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Clean Archival Manuscript Surface (Zero Nested Bordered Box) */}
        <div
          className={`min-h-[240px] py-1 ${
            activeFindingId !== null ? 'studio-has-active-finding' : ''
          }`}
        >
          <EditorContent editor={editor} />
        </div>

        {nearLimitChars !== null && (
          <div
            role="status"
            aria-atomic="true"
            className={`mt-3 border-y px-3 py-2 text-xs font-medium tabular ${
              nearLimitChars > 200_000
                ? 'border-blocker-border bg-blocker-bg text-blocker'
                : 'border-warn-border bg-warn-bg text-warn'
            }`}
          >
            Draft length: {formatCount(nearLimitChars)} / 200,000 characters
            {nearLimitChars > 200_000
              ? ' — exceeds maximum submission size; shorten before saving.'
              : ' — approaching the 200,000-character submission limit.'}
          </div>
        )}

        {/* Highlight Legend & Keyboard Hint */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule-subtle pt-3.5 text-xs text-ink-secondary">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 border-b-2 border-blocker-strong bg-blocker/10" />
              Statutory Blocker
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 border-b border-dashed border-warn-accent bg-warn/10" />
              Advisory Drift
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-4 border-b border-dotted border-smt bg-smt/10" />
              Ordinance Conflict
            </span>
          </div>
          <span
            title={activeSub.content_hash}
            className="font-mono text-xs text-ink-muted"
          >
            {truncateMiddle(activeSub.content_hash, 8, 6)} — Ctrl/Cmd+S
          </span>
        </div>

        {/* Contextual Workflow Actions (No Row of 5 Competing/Disabled Buttons) */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
          <Button
            variant={isDirty ? 'primary' : 'secondary'}
            size="sm"
            disabled={saving || !canEdit}
            title={
              !isAuthorRole
                ? 'Read-only for this account'
                : !canEdit
                  ? 'Editing is locked while in review or approved'
                  : 'Save edits (Ctrl/Cmd+S)'
            }
            onClick={onSave}
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? 'Saving & Re-scanning…' : isDirty ? 'Save Edits' : 'Saved'}
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            {canRequestChanges && (
              <Button
                variant="secondary"
                size="sm"
                disabled={workflowBusy}
                onClick={() => onWorkflow('request_changes')}
              >
                <XCircle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                Request Changes
              </Button>
            )}

            {activeSub.status === 'draft' || activeSub.status === 'changes_requested' ? (
              <Button
                variant={!isDirty ? 'primary' : 'secondary'}
                size="sm"
                disabled={!canSubmit || workflowBusy}
                onClick={() => onWorkflow('submit')}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Submit for Review
              </Button>
            ) : activeSub.status === 'in_review' ? (
              <Button
                variant={canApprove ? 'primary' : 'secondary'}
                size="sm"
                disabled={!canApprove || workflowBusy}
                title={
                  !isReviewerRole
                    ? 'Requires Teacher or IQAC Admin role'
                    : unresolvedBlockers
                      ? 'Resolve all open statutory blockers before approving'
                      : 'Approve disclosure for publication'
                }
                onClick={() => onWorkflow('approve')}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {unresolvedBlockers ? 'Resolve blockers to approve' : 'Approve Disclosure'}
              </Button>
            ) : activeSub.status === 'approved' ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!canPublish || workflowBusy}
                onClick={() => onWorkflow('publish')}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Sign &amp; Publish
              </Button>
            ) : (
              <StatusBadge tone="verified" quiet>
                Published &amp; signed
              </StatusBadge>
            )}
          </div>
        </div>
      </Sheet>

      {manifest && (
        <Sheet
          tone="paper"
          darkHeader
          title="Signed Publication Seal"
          subtitle={`Issued by ${manifest.issuer}`}
          actions={<StatusBadge tone="verified">Signed &amp; Bound</StatusBadge>}
        >
          <dl className="divide-y divide-rule-subtle text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0">
              <dt className="text-xs font-medium text-ink-secondary shrink-0">Seal Reference</dt>
              <dd
                dir="ltr"
                title={manifest.manifest_id}
                className="min-w-0 font-mono text-xs text-ink text-end wrap-anywhere"
              >
                {truncateMiddle(manifest.manifest_id, 14, 10)}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <dt className="text-xs font-medium text-ink-secondary shrink-0">Audit Chain Tip</dt>
              <dd
                dir="ltr"
                title={manifest.audit_chain_tip_hash}
                className="min-w-0 font-mono text-xs text-verified text-end wrap-anywhere"
              >
                {truncateMiddle(manifest.audit_chain_tip_hash, 16, 12)}
              </dd>
            </div>
          </dl>
          <div className="mt-2">
            <DisclosureProof label="Signature & publication proof metadata">
              C2PA Manifest | Algorithm: {manifest.algorithm} | Content hash:{' '}
              {manifest.content_hash} | Canon: {manifest.canon_id}
            </DisclosureProof>
          </div>
        </Sheet>
      )}
    </div>
  );
}
