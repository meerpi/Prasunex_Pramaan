import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { FilePlus2, Play, SlidersHorizontal } from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  AuthUser,
  CanonSummary,
  FindingRow,
  RewriteResponse,
  RoleName,
  Submission,
  SubmissionComment,
  SubmissionVersion,
  WorkflowResponse,
} from '../api/types.ts';
import {
  formatCount,
  formatPercent,
  humanizeStatus,
  paragraphsToHtml,
  pluralize,
  truncateMiddle,
} from '../utils/format.ts';
import { FindingHighlightsExtension, findingHighlightsKey } from './FindingHighlightsExtension.ts';
import { StudioEditorPane } from './studio/StudioEditorPane.tsx';
import { StudioInspectorPane } from './studio/StudioInspectorPane.tsx';
import { StudioModals } from './studio/StudioModals.tsx';
import { Button, EmptyState, StatusBadge } from './ui/index.ts';

const ROLE_LABELS: Record<RoleName, string> = {
  student: 'Student',
  parent: 'Parent / Guardian',
  teacher: 'Faculty',
  recruiter: 'Recruiter',
  admin: 'Registrar / Admin',
};

function editorToRawText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  if (editor.state.doc.childCount === 1 && !editor.state.doc.firstChild?.textContent) {
    return '';
  }
  const blocks: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.isTextblock) {
      blocks.push(node.textContent);
    } else {
      const subLines: string[] = [];
      node.descendants((child) => {
        if (child.isTextblock && child.textContent.trim()) {
          subLines.push(child.textContent);
          return false;
        }
        return true;
      });
      if (subLines.length > 0) blocks.push(subLines.join('\n'));
    }
  });
  return blocks.join('\n\n');
}

export function ReviewStudioPanel({ user }: { user: AuthUser }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [draftQuery, setDraftQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeSub, setActiveSub] = useState<Submission | null>(null);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [versions, setVersions] = useState<SubmissionVersion[]>([]);
  const [comments, setComments] = useState<SubmissionComment[]>([]);
  const [canons, setCanons] = useState<CanonSummary[]>([]);

  const [alpha, setAlpha] = useState(0.1);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [resolvingRowId, setResolvingRowId] = useState<number | null>(null);
  const [applyingRewrite, setApplyingRewrite] = useState(false);
  const [scanSummary, setScanSummary] = useState('');
  const [scanStages, setScanStages] = useState<Array<{ stage: string; label: string }>>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingSwitchId, setPendingSwitchId] = useState<number | null>(null);
  const [nearLimitChars, setNearLimitChars] = useState<number | null>(null);
  const [prevSubSig, setPrevSubSig] = useState('');
  const [activeFindingId, setActiveFindingId] = useState<number | null>(null);
  const [visibleFindingLimit, setVisibleFindingLimit] = useState(60);
  const [inspectorTab, setInspectorTab] = useState<'findings' | 'versions' | 'comments'>('findings');
  const [workflowRes, setWorkflowRes] = useState<WorkflowResponse | null>(null);
  const [err, setErr] = useState('');
  const scanAbortRef = useRef<AbortController | null>(null);
  const savedRawContentRef = useRef('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCanon, setNewCanon] = useState('pramaan-campus-placement');

  const [rewriteModal, setRewriteModal] = useState<{
    open: boolean;
    submissionId: number | null;
    finding: FindingRow | null;
    result: RewriteResponse | null;
    loading: boolean;
  }>({ open: false, submissionId: null, finding: null, result: null, loading: false });
  const activeSubIdRef = useRef<number | null>(null);

  const [commentBody, setCommentBody] = useState('');

  const isAuthorRole = user.role === 'student' || user.role === 'teacher' || user.role === 'admin';
  const isReviewerRole = user.role === 'teacher' || user.role === 'admin';
  const isEditableStatus =
    activeSub?.status === 'draft' || activeSub?.status === 'changes_requested';
  const isMutableStatus = Boolean(
    activeSub && activeSub.status !== 'approved' && activeSub.status !== 'published',
  );
  const canEdit = isAuthorRole && Boolean(activeSub) && Boolean(isEditableStatus);
  const canScan = Boolean(activeSub) && (canEdit || (isReviewerRole && activeSub?.status === 'in_review'));

  useEffect(() => {
    activeSubIdRef.current = activeSub?.id ?? null;
    savedRawContentRef.current = activeSub?.raw_content ?? '';
  }, [activeSub?.id, activeSub?.raw_content]);

  const subSig = activeSub ? `${activeSub.id}:${activeSub.content_hash}` : '';
  if (subSig !== prevSubSig) {
    setPrevSubSig(subSig);
    setIsDirty(false);
    setPendingSwitchId(null);
    setNearLimitChars(
      activeSub && activeSub.raw_content.length >= 180_000 ? activeSub.raw_content.length : null,
    );
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      FindingHighlightsExtension.configure({
        onSelectFinding: (rowId) => {
          setActiveFindingId(rowId);
          setInspectorTab('findings');
        },
      }),
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Compliance draft manuscript',
      },
    },
    content: '<p></p>',
    onUpdate: ({ editor: ed }) => {
      const nextRaw = editorToRawText(ed);
      const nextDirty = activeSubIdRef.current !== null && nextRaw !== savedRawContentRef.current;
      setIsDirty((prev) => (prev === nextDirty ? prev : nextDirty));
      const nextWarn = nextRaw.length >= 180_000 ? nextRaw.length : null;
      setNearLimitChars((prev) => (prev === nextWarn ? prev : nextWarn));
    },
  });

  const loadList = useCallback(async () => {
    try {
      const list = await api.listSubmissions();
      setSubmissions(list);
      if (list.length > 0 && selectedId === null) {
        setSelectedId(list[0].id);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to load submissions');
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const [sub, fList, vList, cList] = await Promise.all([
        api.getSubmission(id),
        api.listFindings(id),
        api.listVersions(id),
        api.listComments(id),
      ]);
      if (activeSubIdRef.current !== null && activeSubIdRef.current !== id) return;
      setActiveSub(sub);
      setFindings(fList);
      setVersions(vList);
      setComments(cList);
      setErr('');
    } catch (e: unknown) {
      if (activeSubIdRef.current !== null && activeSubIdRef.current !== id) return;
      setErr(e instanceof Error ? e.message : 'Unable to load draft detail');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const [list, canonList] = await Promise.all([
          api.listSubmissions(),
          api.listCanons().catch(() => [] as CanonSummary[]),
        ]);
        if (!active) return;
        setSubmissions(list);
        if (list.length > 0) {
          setSelectedId((prev) => prev ?? list[0].id);
        }
        setCanons(canonList);
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load submissions');
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    const fetchSub = async () => {
      try {
        const [sub, fList, vList, cList] = await Promise.all([
          api.getSubmission(selectedId),
          api.listFindings(selectedId),
          api.listVersions(selectedId),
          api.listComments(selectedId),
        ]);
        if (!active) return;
        setActiveSub(sub);
        setFindings(fList);
        setVersions(vList);
        setComments(cList);
        setErr('');
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load draft detail');
      }
    };
    void fetchSub();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const lastLoadedDocRef = useRef('');
  useEffect(() => {
    if (!editor) return;
    if (!activeSub) {
      if (lastLoadedDocRef.current !== 'EMPTY') {
        lastLoadedDocRef.current = 'EMPTY';
        editor.commands.setContent('<p></p>', false);
      }
      return;
    }
    const docSig = `${activeSub.id}:${activeSub.content_hash}`;
    if (lastLoadedDocRef.current === docSig) return;
    lastLoadedDocRef.current = docSig;
    const targetHtml = paragraphsToHtml(activeSub.raw_content);
    if (editorToRawText(editor) !== activeSub.raw_content) {
      editor.commands.setContent(targetHtml, false);
    }
  }, [editor, activeSub]);

  useEffect(() => {
    if (editor && editor.isEditable !== canEdit) {
      editor.setEditable(canEdit);
    }
  }, [editor, canEdit]);

  const lastHlSigRef = useRef('');
  useEffect(() => {
    if (!editor || !activeSub) return;
    const hlSig = JSON.stringify({
      id: activeSub.id,
      pids: activeSub.paragraph_node_ids,
      activeFindingId,
      rows: findings.map((f) => [f.row_id, f.resolution, f.severity, f.payload.trace?.tier]),
    });
    if (lastHlSigRef.current === hlSig) return;
    lastHlSigRef.current = hlSig;
    const tr = editor.state.tr.setMeta(findingHighlightsKey, {
      findings,
      paragraphIds: activeSub.paragraph_node_ids,
      activeFindingId,
    });
    editor.view.dispatch(tr);
  }, [editor, activeSub, findings, activeFindingId]);

  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
    };
  }, [selectedId]);

  const handleSaveContent = useCallback(async () => {
    if (!activeSub || !editor || !canEdit) return;
    setSaving(true);
    setErr('');
    try {
      const raw = editorToRawText(editor);
      await api.updateSubmissionContent(activeSub.id, raw, alpha);
      setPendingSwitchId(null);
      await loadDetail(activeSub.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [activeSub, editor, canEdit, alpha, loadDetail]);

  const commitSwitchDraft = useCallback((nextId: number) => {
    setPendingSwitchId(null);
    setSelectedId(nextId);
    setActiveFindingId(null);
    setVisibleFindingLimit(60);
    setWorkflowRes(null);
    setScanStages([]);
    setScanSummary('');
    setRewriteModal({
      open: false,
      submissionId: null,
      finding: null,
      result: null,
      loading: false,
    });
  }, []);

  const handleScan = useCallback(async () => {
    if (!activeSub || !canScan) return;
    scanAbortRef.current?.abort();
    const ctrl = new AbortController();
    scanAbortRef.current = ctrl;
    setScanning(true);
    setScanStages([]);
    setScanSummary('Running multi-tier verification scan…');
    setErr('');
    try {
      const currentDraft = editor ? editorToRawText(editor) : activeSub.raw_content;
      if (canEdit && editor && currentDraft !== activeSub.raw_content) {
        setScanStages([{ stage: 'save', label: 'Saving draft changes' }]);
        const saved = await api.updateSubmissionContent(activeSub.id, currentDraft, alpha, true);
        if (ctrl.signal.aborted) return;
        setActiveSub(saved);
        setSubmissions((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      }
      let liveCount = 0;
      await api.streamScan(
        activeSub.id,
        alpha,
        () => {
          liveCount += 1;
        },
        (meta) => {
          setScanSummary(
            `Completed with ${pluralize(meta.total, 'flag')} (confidence threshold ${(
              (1 - meta.alpha) *
              100
            ).toFixed(0)}%).`,
          );
        },
        (st) => {
          setScanStages((prev) =>
            prev.some((p) => p.stage === st.stage) ? prev : [...prev, st],
          );
          setScanSummary(
            liveCount > 0
              ? `${st.label} · ${pluralize(liveCount, 'flag')} detected so far…`
              : `${st.label}…`,
          );
        },
        ctrl.signal,
      );
      if (!ctrl.signal.aborted) {
        const refreshedFindings = await api.listFindings(activeSub.id);
        if (!ctrl.signal.aborted) {
          setFindings(refreshedFindings);
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setErr(e instanceof Error ? e.message : 'Scan stream error');
    } finally {
      if (scanAbortRef.current === ctrl) {
        scanAbortRef.current = null;
      }
      setScanning(false);
    }
  }, [activeSub, editor, canEdit, canScan, alpha]);

  const sortedFindings = useMemo(() => {
    return [...findings].sort((a, b) => {
      const aOpen = a.resolution === 'open' ? 0 : 1;
      const bOpen = b.resolution === 'open' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      if (b.severity !== a.severity) return b.severity - a.severity;
      return a.row_id - b.row_id;
    });
  }, [findings]);

  const triageList = useMemo(
    () => sortedFindings.slice(0, visibleFindingLimit),
    [sortedFindings, visibleFindingLimit],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeSub) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (!saving && canEdit) void handleSaveContent();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (!scanning && canScan) void handleScan();
        }
        return;
      }
      if (e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) {
        return;
      }
      if (inspectorTab !== 'findings' || triageList.length === 0) return;
      const key = e.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        e.preventDefault();
        const curIdx = triageList.findIndex((f) => f.row_id === activeFindingId);
        const nextIdx =
          curIdx < 0
            ? key === 'j'
              ? 0
              : triageList.length - 1
            : key === 'j'
              ? (curIdx + 1) % triageList.length
              : (curIdx - 1 + triageList.length) % triageList.length;
        setActiveFindingId(triageList[nextIdx].row_id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSub,
    saving,
    scanning,
    canEdit,
    canScan,
    handleSaveContent,
    handleScan,
    inspectorTab,
    triageList,
    activeFindingId,
  ]);

  const handleResolve = async (
    rowId: number,
    resolution: 'accepted' | 'dismissed' | 'overridden',
  ) => {
    if (!activeSub || resolvingRowId !== null) return;
    setResolvingRowId(rowId);
    try {
      await api.resolveFinding(activeSub.id, rowId, resolution, resolution === 'accepted');
      setScanSummary('');
      setScanStages([]);
      await loadDetail(activeSub.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to update finding');
    } finally {
      setResolvingRowId(null);
    }
  };

  const openRewrite = async (f: FindingRow) => {
    if (!activeSub || !canEdit) return;
    const targetSubId = activeSub.id;
    setRewriteModal({
      open: true,
      submissionId: targetSubId,
      finding: f,
      result: null,
      loading: true,
    });
    try {
      const res = await api.rewriteFinding(targetSubId, f.row_id);
      if (activeSubIdRef.current !== targetSubId) return;
      setRewriteModal({
        open: true,
        submissionId: targetSubId,
        finding: f,
        result: res,
        loading: false,
      });
    } catch (e: unknown) {
      if (activeSubIdRef.current !== targetSubId) return;
      setErr(e instanceof Error ? e.message : 'Rewrite generator error');
      setRewriteModal({
        open: false,
        submissionId: null,
        finding: null,
        result: null,
        loading: false,
      });
    }
  };

  const applyRewrite = async () => {
    if (
      !activeSub ||
      !canEdit ||
      rewriteModal.submissionId !== activeSub.id ||
      !rewriteModal.finding ||
      !rewriteModal.result ||
      applyingRewrite
    ) {
      return;
    }
    setApplyingRewrite(true);
    const targetFinding = rewriteModal.finding;
    const orig = rewriteModal.result.original_text;
    const rewritten = rewriteModal.result.rewritten_text;
    const baseText = editor ? editorToRawText(editor) : activeSub.raw_content;
    const blocks = baseText.split(/\n{2,}/);
    const blockIdx = activeSub.paragraph_node_ids.indexOf(targetFinding.node_id);
    let updated: string;
    if (blockIdx >= 0 && blockIdx < blocks.length && blocks[blockIdx].includes(orig)) {
      blocks[blockIdx] = blocks[blockIdx].replace(orig, () => rewritten);
      updated = blocks.join('\n\n');
    } else {
      updated = baseText.replace(orig, () => rewritten);
    }
    if (updated === baseText) {
      setErr(
        'Could not apply the suggested revision because this paragraph has changed since the last scan. Re-run the scan or copy the revision manually.',
      );
      setApplyingRewrite(false);
      return;
    }
    try {
      await api.updateSubmissionContent(activeSub.id, updated, alpha);
      setScanSummary('');
      setScanStages([]);
      setRewriteModal({
        open: false,
        submissionId: null,
        finding: null,
        result: null,
        loading: false,
      });
      await loadDetail(activeSub.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Applying rewrite failed');
    } finally {
      setApplyingRewrite(false);
    }
  };

  const handleWorkflow = async (action: string) => {
    if (!activeSub || workflowBusy) return;
    setWorkflowBusy(true);
    setErr('');
    try {
      if (action === 'submit' && isDirty && canEdit && editor) {
        const currentDraft = editorToRawText(editor);
        const saved = await api.updateSubmissionContent(activeSub.id, currentDraft, alpha, true);
        setActiveSub(saved);
        setIsDirty(false);
        setSubmissions((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      }
      const res = await api.workflowAction(activeSub.id, action, '');
      setWorkflowRes(res);
      setScanSummary('');
      setScanStages([]);
      const nextStatus = res.status as Submission['status'];
      setActiveSub((prev) =>
        prev && prev.id === res.submission_id
          ? { ...prev, status: nextStatus, c2pa_manifest: res.c2pa_manifest ?? prev.c2pa_manifest }
          : prev,
      );
      setSubmissions((prev) =>
        prev.map((s) => (s.id === res.submission_id ? { ...s, status: nextStatus } : s)),
      );
      await loadDetail(activeSub.id);
      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Workflow transition failed');
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim() || creatingDraft) return;
    setCreatingDraft(true);
    setCreateErr('');
    try {
      const created = await api.createSubmission({
        title: newTitle.trim(),
        raw_content: newContent.trim(),
        canon_id: newCanon,
        portal_scope: 'public',
      });
      setCreateOpen(false);
      setCreateErr('');
      setNewTitle('');
      setNewContent('');
      setWorkflowRes(null);
      setActiveFindingId(null);
      setScanStages([]);
      setScanSummary('');
      setSubmissions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setActiveSub(created);
      setSelectedId(created.id);
      await loadList();
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : 'Create draft failed');
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSub || !commentBody.trim() || commentBusy) return;
    setCommentBusy(true);
    try {
      await api.addComment(activeSub.id, commentBody.trim(), activeFindingId);
      setCommentBody('');
      await loadDetail(activeSub.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unable to post comment');
    } finally {
      setCommentBusy(false);
    }
  };

  const openFindings = findings.filter((f) => f.resolution === 'open');
  const unresolvedBlockers = openFindings.some((f) => f.severity >= 50);
  const canSubmit =
    canEdit && (activeSub?.status === 'draft' || activeSub?.status === 'changes_requested');
  const canRequestChanges = isReviewerRole && activeSub?.status === 'in_review';
  const canApprove =
    isReviewerRole && activeSub?.status === 'in_review' && !unresolvedBlockers;
  const canPublish =
    isReviewerRole && activeSub?.status === 'approved' && !unresolvedBlockers;

  return (
    <div className="space-y-7 min-w-0">
      <header className="gazette-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Pre-Publish Disclosure Studio
          </h1>
          <p className="text-sm text-ink-secondary">
            Verify brochures, circulars, and notices against institutional ordinances before
            approval and publication.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {activeSub && (
            <StatusBadge
              tone={
                activeSub.status === 'published' || activeSub.status === 'approved'
                  ? 'verified'
                  : activeSub.status === 'changes_requested'
                    ? 'blocker'
                    : 'warn'
              }
              quiet={activeSub.status === 'published' || activeSub.status === 'approved'}
            >
              {humanizeStatus(activeSub.status)}
            </StatusBadge>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={!isAuthorRole}
            title={!isAuthorRole ? 'Requires Student, Teacher, or Admin role' : undefined}
            onClick={() => {
              setCreateErr('');
              setCreateOpen(true);
            }}
          >
            <FilePlus2 className="h-3.5 w-3.5 text-action" aria-hidden="true" />
            New Draft
          </Button>
        </div>
      </header>

      {!isAuthorRole && (
        <div
          role="status"
          aria-atomic="true"
          className="border-y border-rule bg-subtle px-4 py-2.5 text-sm text-ink-secondary"
        >
          Signed in as <strong className="text-ink">{user.display_name}</strong> (
          {ROLE_LABELS[user.role] ?? user.role}). Only staff and student authors can edit or
          transition drafts; approved disclosures remain viewable below.
        </div>
      )}

      {err && (
        <div
          role="alert"
          className="border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker wrap-anywhere"
        >
          {err}
        </div>
      )}

      {submissions.length > 0 && (
        <div className="space-y-3 border-b border-rule pb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 w-full sm:flex-1 max-w-2xl space-y-1.5">
              <label
                htmlFor="studio-sub-select"
                className="block text-xs font-semibold text-ink-secondary"
              >
                Active draft or circular
              </label>
              {submissions.length > 25 && (
                <input
                  id="studio-sub-filter"
                  name="draft_filter"
                  type="search"
                  aria-label="Filter drafts by title, ID, or status"
                  value={draftQuery}
                  onChange={(e) => setDraftQuery(e.target.value)}
                  placeholder={`Filter ${formatCount(submissions.length)} drafts by title or #ID…`}
                  className="w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                />
              )}
              <select
                id="studio-sub-select"
                name="active_submission"
                value={activeSub?.id ?? ''}
                onChange={(e) => {
                  const nextId = Number(e.target.value);
                  if (nextId === activeSub?.id) return;
                  if (isDirty) {
                    setPendingSwitchId(nextId);
                    return;
                  }
                  commitSwitchDraft(nextId);
                }}
                className="min-h-11 lg:min-h-9 w-full max-w-full rounded border border-rule bg-surface px-3 py-1.5 text-sm font-semibold text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
              >
                {(() => {
                  const q = draftQuery.trim().toLowerCase();
                  const filtered = q
                    ? submissions.filter((s) =>
                        `#${s.id} ${s.title} ${s.status}`.toLowerCase().includes(q),
                      )
                    : submissions;
                  const MAX_VISIBLE = 50;
                  const slice = filtered.slice(0, MAX_VISIBLE);
                  const visible =
                    activeSub && !slice.some((s) => s.id === activeSub.id)
                      ? [activeSub, ...slice.slice(0, MAX_VISIBLE - 1)]
                      : slice;
                  return (
                    <>
                      {visible.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} — {truncateMiddle(s.title, 44, 20)} [{humanizeStatus(s.status)}]
                        </option>
                      ))}
                      {filtered.length > MAX_VISIBLE && (
                        <option value="" disabled>
                          — Showing first {MAX_VISIBLE} of {formatCount(filtered.length)} drafts;
                          type above to filter —
                        </option>
                      )}
                    </>
                  );
                })()}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={calibrationOpen}
                onClick={() => setCalibrationOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Sensitivity ({formatPercent((1 - alpha) * 100, 0)})
              </Button>

              <Button
                variant="primary"
                disabled={scanning || !canScan}
                title={
                  !isAuthorRole
                    ? 'Requires Student, Teacher, or Admin role'
                    : !canScan
                      ? 'Scanning is locked once approved or published'
                      : isDirty && canEdit
                        ? 'Auto-saves your draft edits and runs compliance scan (Ctrl/Cmd+Enter)'
                        : 'Run compliance scan (Ctrl/Cmd+Enter)'
                }
                onClick={() => void handleScan()}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {scanning
                  ? 'Scanning…'
                  : isDirty && canEdit
                    ? 'Save & Run Scan'
                    : 'Run Compliance Scan'}
              </Button>
            </div>
          </div>

          {pendingSwitchId !== null && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border-y border-warn-border bg-warn-bg px-4 py-2.5 text-xs text-warn"
            >
              <span className="font-medium">
                You have unsaved edits. Discard and switch draft?
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => commitSwitchDraft(pendingSwitchId)}
                >
                  Discard &amp; switch
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingSwitchId(null)}
                >
                  Keep editing
                </Button>
              </div>
            </div>
          )}

          {calibrationOpen && (
            <div className="flex flex-wrap items-center justify-between gap-4 bg-subtle px-4 py-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-ink">Detection sensitivity</div>
                <p className="text-ink-secondary">
                  Higher sensitivity increases scrutiny on cross-source claims (currently{' '}
                  {formatPercent((1 - alpha) * 100, 0)} confidence floor, α = {alpha.toFixed(2)}).
                </p>
              </div>
              <input
                id="alpha-slider"
                aria-label="Detection sensitivity threshold"
                type="range"
                min={0.05}
                max={0.3}
                step={0.05}
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
                className="w-48 accent-action"
              />
            </div>
          )}

          {(scanSummary || scanStages.length > 0) && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-ink-secondary"
            >
              <span>{scanSummary}</span>
              {scanStages.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  {scanStages.map((st, idx) => (
                    <span
                      key={st.stage}
                      className={`font-medium ${
                        scanning && idx === scanStages.length - 1 ? 'text-action' : 'text-verified'
                      }`}
                    >
                      {st.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!activeSub ? (
        <EmptyState
          title="No draft disclosures available"
          description="Create a new prospectus, syllabus notice, or statutory circular to run compliance checks."
          action={
            <Button
              variant="primary"
              disabled={!isAuthorRole}
              onClick={() => {
                setCreateErr('');
                setCreateOpen(true);
              }}
            >
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              Create First Draft
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.12fr_0.88fr] items-start">
          <StudioEditorPane
            editor={editor}
            activeSub={activeSub}
            openFindingsCount={openFindings.length}
            isDirty={isDirty}
            nearLimitChars={nearLimitChars}
            activeFindingId={activeFindingId}
            onClearActiveFinding={() => setActiveFindingId(null)}
            saving={saving}
            canEdit={canEdit}
            isAuthorRole={isAuthorRole}
            isReviewerRole={isReviewerRole}
            unresolvedBlockers={unresolvedBlockers}
            workflowBusy={workflowBusy}
            canSubmit={canSubmit}
            canRequestChanges={canRequestChanges}
            canApprove={canApprove}
            canPublish={canPublish}
            workflowRes={workflowRes}
            onSave={() => void handleSaveContent()}
            onWorkflow={(action) => void handleWorkflow(action)}
          />

          <StudioInspectorPane
            key={activeSub.id}
            user={user}
            isAuthorRole={isAuthorRole}
            isReviewerRole={isReviewerRole}
            canEdit={canEdit}
            canMutateFindings={isMutableStatus}
            inspectorTab={inspectorTab}
            onSelectTab={setInspectorTab}
            findings={sortedFindings}
            displayFindings={triageList}
            hasMoreFindings={sortedFindings.length > triageList.length}
            onShowMoreFindings={() => setVisibleFindingLimit((n) => n + 60)}
            versions={versions}
            comments={comments}
            activeFindingId={activeFindingId}
            onSelectFinding={setActiveFindingId}
            resolvingRowId={resolvingRowId}
            rewriteLoading={rewriteModal.loading}
            onResolve={(rowId, res) => void handleResolve(rowId, res)}
            onOpenRewrite={(f) => void openRewrite(f)}
            commentBody={commentBody}
            onCommentBodyChange={setCommentBody}
            commentBusy={commentBusy}
            onAddComment={(e) => void handleAddComment(e)}
          />
        </div>
      )}

      <StudioModals
        createOpen={createOpen}
        createErr={createErr}
        onCloseCreate={() => {
          setCreateErr('');
          setCreateOpen(false);
        }}
        newTitle={newTitle}
        onNewTitleChange={setNewTitle}
        newCanon={newCanon}
        onNewCanonChange={setNewCanon}
        newContent={newContent}
        onNewContentChange={setNewContent}
        canons={canons}
        creatingDraft={creatingDraft}
        onCreateDraft={(e) => void handleCreateDraft(e)}
        rewriteModal={rewriteModal}
        onCloseRewrite={() =>
          setRewriteModal({
            open: false,
            submissionId: null,
            finding: null,
            result: null,
            loading: false,
          })
        }
        applyingRewrite={applyingRewrite}
        onApplyRewrite={() => void applyRewrite()}
      />
    </div>
  );
}
