import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  AuditChainData,
  AuthUser,
  CanonFrictionPrData,
  CanonLintResult,
  CanonSummary,
  GateCheckResult,
  SigningKeyRingSummary,
} from '../api/types.ts';
import {
  formatCount,
  formatDateTime,
  formatPercent,
  humanizeAuditAction,
  humanizeStatus,
  pluralize,
  truncateMiddle,
} from '../utils/format.ts';
import { useCopyFeedback } from '../utils/useCopyFeedback.ts';
import {
  Button,
  DataTable,
  EmptyState,
  ExpandableText,
  PaginationBar,
  SegmentedTabs,
  Sheet,
  StatusBadge,
} from './ui/index.ts';

function renderYamlLines(yaml: string, hideNulls: boolean) {
  const lines = yaml
    .split('\n')
    .filter((line) => !(hideNulls && /:\s*null\s*$/.test(line)));
  return lines.map((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
      return (
        <span key={i} className="block text-code-comment">
          {line}
        </span>
      );
    }
    const kv = line.match(/^(\s*-?\s*)([A-Za-z0-9_-]+)(:)(.*)$/);
    if (kv) {
      const [, indent, key, colon, rest] = kv;
      const valTrim = rest.trim();
      const valClass =
        /^-?\d+(?:\.\d+)?$/.test(valTrim) || valTrim === 'true' || valTrim === 'false'
          ? 'text-code-num'
          : valTrim.length > 0
            ? 'text-code-str'
            : 'text-rail-ink';
      return (
        <span key={i} className="block">
          <span className="text-rail-muted">{indent}</span>
          <span className="text-code-key font-semibold">{key}</span>
          <span className="text-rail-muted">{colon}</span>
          <span className={valClass}>{rest}</span>
        </span>
      );
    }
    return (
      <span key={i} className="block text-rail-ink">
        {line || ' '}
      </span>
    );
  });
}

export function GovernanceMcpHub({ user }: { user: AuthUser }) {
  const [canons, setCanons] = useState<CanonSummary[]>([]);
  const [selectedCanonId, setSelectedCanonId] = useState('pramaan-campus-placement');
  const [globalNonce, setGlobalNonce] = useState(0);
  const [canonNonce, setCanonNonce] = useState(0);
  const [loadedGlobalNonce, setLoadedGlobalNonce] = useState(-1);
  const [hubTab, setHubTab] = useState<'ordinances' | 'gate' | 'keys'>('ordinances');
  const [runnerTab, setRunnerTab] = useState<'gate' | 'mcp'>('gate');
  const [compileBusy, setCompileBusy] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [lint, setLint] = useState<CanonLintResult | null>(null);
  const [pr, setPr] = useState<CanonFrictionPrData | null>(null);
  const [audit, setAudit] = useState<AuditChainData | null>(null);

  const [nlCanonId, setNlCanonId] = useState('');
  const [nlPolicyText, setNlPolicyText] = useState('');
  const [compiledNotice, setCompiledNotice] = useState('');

  const [gateTitle, setGateTitle] = useState('');
  const [gateBody, setGateBody] = useState('');
  const [gateResult, setGateResult] = useState<GateCheckResult | null>(null);
  const [wrapYaml, setWrapYaml] = useState(true);
  const [hideNulls, setHideNulls] = useState(true);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const [keysPage, setKeysPage] = useState(0);
  const [mcpOutput, setMcpOutput] = useState('');
  const { copiedKey: copiedCode, copy: copyWithFeedback } = useCopyFeedback<'yaml' | 'mcp' | 'jwks'>();
  const [keyRing, setKeyRing] = useState<SigningKeyRingSummary | null>(null);
  const [customKid, setCustomKid] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [keyNotice, setKeyNotice] = useState('');
  const [err, setErr] = useState('');

  const copyCodeBlock = async (kind: 'yaml' | 'mcp' | 'jwks', content: string) => {
    if (!content) return;
    const ok = await copyWithFeedback(kind, content);
    if (!ok) {
      setErr('Unable to copy to clipboard in this browser context.');
    }
  };

  const loading = loadedGlobalNonce !== globalNonce && !err;

  // Global fetch: canons, audit chain, and signing key ring (only on mount or explicit reload)
  useEffect(() => {
    let active = true;
    const fetchGlobal = async () => {
      try {
        const [cList, auditRes, keyRes] = await Promise.all([
          api.listCanons(),
          api.auditChain().catch(() => null),
          user.role === 'admin' ? api.listSigningKeys().catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        setCanons(cList);
        setAudit(auditRes);
        setKeyRing(keyRes);
        setLoadedGlobalNonce(globalNonce);
        setErr('');
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : 'Unable to load ordinance register');
      }
    };
    void fetchGlobal();
    return () => {
      active = false;
    };
  }, [globalNonce, user.role]);

  // Canon-scoped fetch: lint & friction calibration PR (runs when canon selection changes)
  useEffect(() => {
    let active = true;
    const fetchCanonMeta = async () => {
      const [lintRes, prRes] = await Promise.all([
        api.lintCanon(selectedCanonId).catch(() => null),
        api.canonFrictionPr(selectedCanonId).catch(() => null),
      ]);
      if (!active) return;
      setLint(lintRes);
      setPr(prRes);
    };
    void fetchCanonMeta();
    return () => {
      active = false;
    };
  }, [selectedCanonId, canonNonce]);

  const executeRotateKey = async () => {
    if (user.role !== 'admin' || rotatingKey) return;
    setRotatingKey(true);
    setErr('');
    setKeyNotice('');
    try {
      const updated = await api.rotateSigningKey(customKid.trim());
      setKeyRing(updated);
      setCustomKid('');
      setConfirmRotate(false);
      setKeyNotice(
        `Activated signing key ${updated.active_kid}. Previous keys remain retired in /.well-known/jwks.json for zero-downtime verification.`,
      );
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : 'Key rotation failed');
    } finally {
      setRotatingKey(false);
    }
  };

  const handleRotateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (user.role !== 'admin' || rotatingKey) return;
    if (!confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    void executeRotateKey();
  };

  const activeCanon = canons.find((c) => c.id === selectedCanonId) ?? canons[0] ?? null;
  const renderedYaml = useMemo(
    () => (activeCanon ? renderYamlLines(activeCanon.yaml, hideNulls) : null),
    [activeCanon, hideNulls],
  );

  const canCompileCanon = user.role === 'teacher' || user.role === 'admin';

  const handleCompileNl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCompileCanon || compileBusy || !nlPolicyText.trim()) return;
    setCompileBusy(true);
    setErr('');
    const targetId =
      nlCanonId.trim() ||
      (selectedCanonId.endsWith('-custom') ? selectedCanonId : `${selectedCanonId}-custom`);
    try {
      const res = await api.compileCanon(targetId, nlPolicyText.trim(), '1.0');
      setCompiledNotice(
        `Compiled ${pluralize(res.grounded_rules_count, 'grounded rule')} into ${targetId}; rejected ${formatCount(
          res.rejected_hallucinations,
        )} unsupported assertions.`,
      );
      setGlobalNonce((n) => n + 1);
      if (res.canon.id === selectedCanonId) {
        setCanonNonce((n) => n + 1);
      } else {
        setSelectedCanonId(res.canon.id);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Policy compile error');
    } finally {
      setCompileBusy(false);
    }
  };

  const handleGateCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gateBusy || !gateBody.trim()) return;
    const canonId = activeCanon?.id ?? selectedCanonId;
    if (!canonId) return;
    setGateBusy(true);
    setErr('');
    try {
      const res = await api.gateCheck(
        canonId,
        gateTitle.trim() || 'Pre-Publish Gate Check',
        gateBody.trim(),
        0.1,
      );
      setGateResult(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Webhook gate error');
    } finally {
      setGateBusy(false);
    }
  };

  const runMcp = async (method: 'tools/list' | 'tools/call', toolName?: string) => {
    if (mcpBusy) return;
    setMcpBusy(true);
    setErr('');
    try {
      const params =
        method === 'tools/list'
          ? {}
          : toolName === 'approve'
            ? {
                name: 'approve',
                arguments: { submission_id: 1, actor_role: user.role },
              }
            : {
                name: toolName ?? 'get_canon_rules',
                arguments: { canon_id: activeCanon?.id ?? selectedCanonId },
              };
      const res = await api.mcpCall(method, params);
      setMcpOutput(JSON.stringify(res, null, 2));
    } catch (e: unknown) {
      setMcpOutput(`Blocked by MCP security policy: ${e instanceof Error ? e.message : 'Denied'}`);
    } finally {
      setMcpBusy(false);
    }
  };

  const prColumns = useMemo(
    () => [
      {
        key: 'id',
        header: 'Ordinance Rule',
        sortValue: (r: CanonFrictionPrData['rule_metrics'][number]) => r.rule_id,
        render: (r: CanonFrictionPrData['rule_metrics'][number]) => (
          <span className="font-mono text-xs font-semibold text-ink">{r.rule_id}</span>
        ),
      },
      {
        key: 'flags',
        header: 'Flags',
        align: 'right' as const,
        sortValue: (r: CanonFrictionPrData['rule_metrics'][number]) => r.total_flags,
        render: (r: CanonFrictionPrData['rule_metrics'][number]) => formatCount(r.total_flags),
      },
      {
        key: 'ov',
        header: 'Overrides',
        align: 'right' as const,
        sortValue: (r: CanonFrictionPrData['rule_metrics'][number]) => r.overrides,
        render: (r: CanonFrictionPrData['rule_metrics'][number]) => formatCount(r.overrides),
      },
      {
        key: 'post',
        header: 'Smoothed Rate (Prior)',
        align: 'right' as const,
        sortValue: (r: CanonFrictionPrData['rule_metrics'][number]) => r.posterior_friction,
        render: (r: CanonFrictionPrData['rule_metrics'][number]) =>
          formatPercent(r.posterior_friction * 100, 1),
      },
      {
        key: 'rev',
        header: 'Calibration',
        align: 'right' as const,
        render: (r: CanonFrictionPrData['rule_metrics'][number]) =>
          r.needs_revision ? (
            <StatusBadge tone="warn">Review wording</StatusBadge>
          ) : (
            <StatusBadge tone="verified" quiet>
              Calibrated
            </StatusBadge>
          ),
      },
    ],
    [],
  );

  const allAuditEvents = useMemo(() => audit?.events ?? [], [audit]);
  const filteredAuditEvents = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    if (!q) return allAuditEvents;
    return allAuditEvents.filter((ev) =>
      `${ev.id} ${ev.actor_name} ${ev.action} ${ev.event_hash} ${ev.prev_hash} ${ev.comment}`
        .toLowerCase()
        .includes(q),
    );
  }, [allAuditEvents, auditQuery]);

  const AUDIT_PAGE_SIZE = 25;
  const auditTotalPages = Math.max(1, Math.ceil(filteredAuditEvents.length / AUDIT_PAGE_SIZE));
  const safeAuditPage = Math.min(auditPage, auditTotalPages - 1);
  const pageAuditEvents = filteredAuditEvents.slice(
    safeAuditPage * AUDIT_PAGE_SIZE,
    (safeAuditPage + 1) * AUDIT_PAGE_SIZE,
  );
  const showAuditSearch = allAuditEvents.length > 10 || auditQuery.trim().length > 0;

  const KEYS_PAGE_SIZE = 10;
  const allKeys = keyRing?.keys ?? [];
  const keysTotalPages = Math.max(1, Math.ceil(allKeys.length / KEYS_PAGE_SIZE));
  const safeKeysPage = Math.min(keysPage, keysTotalPages - 1);
  const pageKeys = allKeys.slice(safeKeysPage * KEYS_PAGE_SIZE, (safeKeysPage + 1) * KEYS_PAGE_SIZE);

  return (
    <div className="space-y-9 min-w-0">
      <header className="gazette-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
            Ordinances, Gate &amp; Audit Chain
          </h1>
          <p className="text-sm text-ink-secondary">
            Inspect active statutory canons, test pre-publish CI/CMS checks, query the read-only MCP
            gateway, and verify the SHA-256 workflow chain.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0 max-w-full">
          <select
            aria-label="Select ordinance canon"
            value={activeCanon?.id ?? selectedCanonId}
            onChange={(e) => setSelectedCanonId(e.target.value)}
            className="min-h-11 lg:min-h-9 min-w-0 max-w-full sm:max-w-[26rem] rounded border border-rule bg-surface px-3 py-1.5 text-sm font-semibold text-ink focus:border-action focus-visible:outline-2 focus-visible:outline-action"
          >
            {canons.length === 0 ? (
              <option value="pramaan-campus-placement">No canons registered</option>
            ) : (
              canons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} (v{c.version})
                </option>
              ))
            )}
          </select>
          {lint &&
            (lint.is_valid ? (
              <StatusBadge tone="verified" quiet>
                Canon consistent
              </StatusBadge>
            ) : (
              <StatusBadge tone="blocker">
                {pluralize(lint.issues.length, 'canon conflict')}
              </StatusBadge>
            ))}
        </div>
      </header>

      <SegmentedTabs
        ariaLabel="Governance workspace sections"
        idPrefix="gov-tab"
        value={hubTab}
        onChange={(next) => {
          setHubTab(next);
          setConfirmRotate(false);
        }}
        options={[
          {
            id: 'ordinances',
            label: 'Ordinances & Compiler',
            panelId: 'gov-panel-ordinances',
          },
          {
            id: 'gate',
            label: 'Gate & MCP',
            panelId: 'gov-panel-gate',
          },
          {
            id: 'keys',
            label: 'Keys & Audit Chain',
            panelId: 'gov-panel-keys',
          },
        ]}
      />

      {err && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-y border-blocker-border bg-blocker-bg px-4 py-2.5 text-sm font-medium text-blocker"
        >
          <span className="min-w-0 flex-1 wrap-anywhere">{err}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setErr('');
              setGlobalNonce((n) => n + 1);
              setCanonNonce((n) => n + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Tab 1: Ordinances & Policy Compiler */}
      {hubTab === 'ordinances' && (
        <div
          id="gov-panel-ordinances"
          role="tabpanel"
          aria-labelledby="gov-tab-ordinances"
          className="space-y-9"
        >
          <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 items-start">
            <Sheet
              title="Active Ordinance Specification"
              subtitle={
                activeCanon
                  ? `${pluralize(activeCanon.fact_count, 'rule fact')}, ${pluralize(
                      activeCanon.trigger_count,
                      'trigger',
                    )} — Hash ${truncateMiddle(activeCanon.hash, 10, 8)}`
                  : 'No canon selected'
              }
              actions={
                activeCanon && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={hideNulls}
                      onClick={() => setHideNulls((v) => !v)}
                    >
                      {hideNulls ? 'Compact' : 'Full YAML'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={wrapYaml}
                      onClick={() => setWrapYaml((v) => !v)}
                    >
                      {wrapYaml ? 'Wrap: On' : 'Wrap: Off'}
                    </Button>
                  </div>
                )
              }
            >
              {!activeCanon ? (
                <EmptyState
                  title="No ordinance canon loaded"
                  description="Select or compile a statutory policy canon to verify rule consistency."
                />
              ) : (
                <div className="space-y-3">
                  {lint && lint.issues.length > 0 && (
                    <div className="space-y-2">
                      {lint.issues.map((iss, idx) => (
                        <div
                          key={idx}
                          className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-sm text-blocker wrap-anywhere"
                        >
                          <strong>{iss.kind}:</strong> {iss.message} ({iss.rule_ids.join(', ')})
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="overflow-hidden rounded-xs border border-rail-border bg-rail">
                    <div className="flex items-center justify-between gap-2 border-b border-rail-border bg-rail-hover px-3.5 py-2 text-xs text-rail-sub">
                      <span
                        title={`${activeCanon.id}.yaml (v${activeCanon.version})`}
                        className="font-mono truncate"
                      >
                        {activeCanon.id}.yaml (v{activeCanon.version})
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyCodeBlock('yaml', activeCanon.yaml)}
                        className="btn-interactive inline-flex min-h-11 lg:min-h-8 shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-rail-ink hover:bg-rail-hover-strong focus-visible:outline-2 focus-visible:outline-code-key"
                      >
                        {copiedCode === 'yaml' ? (
                          <Check className="h-3.5 w-3.5 text-signal-ok" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-rail-muted" aria-hidden="true" />
                        )}
                        <span>{copiedCode === 'yaml' ? 'Copied' : 'Copy YAML'}</span>
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className={`max-h-72 overflow-auto bg-rail p-4 font-mono text-xs leading-relaxed text-left ${
                        wrapYaml ? 'whitespace-pre-wrap wrap-anywhere' : ''
                      }`}
                    >
                      <code>{renderedYaml}</code>
                    </pre>
                  </div>
                </div>
              )}
            </Sheet>

            <Sheet
              tone="paper"
              title="Compile Policy Text into Rules"
              subtitle="Translates institutional regulations into typed checks while rejecting ungrounded assertions."
            >
              <form onSubmit={handleCompileNl} className="space-y-3">
                <div>
                  <label htmlFor="custom-canon-id" className="block text-xs font-semibold text-ink">
                    Custom ordinance slug
                  </label>
                  <input
                    id="custom-canon-id"
                    name="custom_canon_id"
                    type="text"
                    minLength={2}
                    maxLength={120}
                    value={nlCanonId}
                    onChange={(e) => setNlCanonId(e.target.value)}
                    placeholder="Enter custom ordinance slug"
                    className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                  />
                </div>
                <textarea
                  id="nl-policy-text"
                  name="policy_text"
                  rows={4}
                  minLength={5}
                  maxLength={200000}
                  value={nlPolicyText}
                  onChange={(e) => setNlPolicyText(e.target.value)}
                  aria-label="Plain-English institutional policy text"
                  placeholder="Write institutional policy prose (e.g., banned marketing phrases, attendance caps, or audited numeric baselines)…"
                  className="w-full rounded border border-rule bg-surface p-3 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!canCompileCanon || compileBusy || !nlPolicyText.trim()}
                    title={!canCompileCanon ? 'Requires Teacher or Admin role' : undefined}
                  >
                    <Scale className="h-4 w-4" aria-hidden="true" />
                    {compileBusy ? 'Compiling…' : 'Compile Policy Rules'}
                  </Button>
                  {compiledNotice && (
                    <span
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="text-xs font-medium text-verified wrap-anywhere"
                    >
                      {compiledNotice}
                    </span>
                  )}
                </div>
              </form>
            </Sheet>
          </div>

          {/* Ordinance Calibration Review */}
          {pr && pr.rule_metrics.length > 0 && (
            <Sheet
              title="Ordinance Override & Calibration"
              subtitle={
                pr.base_version === pr.proposed_version
                  ? `Active canon v${pr.base_version} — ${pluralize(
                      pr.impact_simulation.bundles_evaluated,
                      'audited bundle',
                    )} evaluated (Empirical Bayes smoothing uses a small prior when override counts are zero)`
                  : `Comparing v${pr.base_version} to v${pr.proposed_version} across ${pluralize(
                      pr.impact_simulation.bundles_evaluated,
                      'audited bundle',
                    )}`
              }
              actions={
                pr.has_changes ? (
                  <StatusBadge tone="warn">
                    {pluralize(pr.revisions.length, 'proposed relaxation')}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="verified" quiet>
                    All rules calibrated
                  </StatusBadge>
                )
              }
            >
              <DataTable
                rows={pr.rule_metrics}
                rowKey={(r) => r.rule_id}
                dense
                columns={prColumns}
              />
            </Sheet>
          )}
        </div>
      )}

      {/* Tab 2: Pre-Publish Webhook Gate & MCP Gateway */}
      {hubTab === 'gate' && (
        <div
          id="gov-panel-gate"
          role="tabpanel"
          aria-labelledby="gov-tab-gate"
        >
          <Sheet
            tone="paper"
            title={
              runnerTab === 'gate' ? 'Pre-Publish Webhook Gate' : 'Prerana AI MCP Gateway'
            }
            subtitle={
              runnerTab === 'gate'
                ? 'Check whether outgoing CMS copy clears or blocks publication.'
                : 'Read-only JSON-RPC tool gateway enforcing <4 KB payloads and OWASP LLM06 write blocks.'
            }
            actions={
              <SegmentedTabs
                ariaLabel="Verification runner mode"
                idPrefix="gov-runner-tab"
                value={runnerTab}
                onChange={setRunnerTab}
                options={[
                  {
                    id: 'gate',
                    label: 'Webhook Gate',
                    panelId: 'gov-runner-panel-gate',
                  },
                  {
                    id: 'mcp',
                    label: 'MCP Gateway',
                    panelId: 'gov-runner-panel-mcp',
                  },
                ]}
              />
            }
          >
            {runnerTab === 'gate' ? (
              <div
                id="gov-runner-panel-gate"
                role="tabpanel"
                aria-labelledby="gov-runner-tab-gate"
              >
                <form onSubmit={handleGateCheck} className="space-y-4">
                  <div>
                    <label htmlFor="gate-title" className="block text-xs font-semibold text-ink">
                      Publication title
                    </label>
                    <input
                      id="gate-title"
                      name="gate_title"
                      type="text"
                      maxLength={256}
                      value={gateTitle}
                      onChange={(e) => setGateTitle(e.target.value)}
                      placeholder="Enter publication or circular title"
                      className="mt-1.5 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>
                  <div>
                    <label htmlFor="gate-body" className="block text-xs font-semibold text-ink">
                      Claim excerpt to test
                    </label>
                    <textarea
                      id="gate-body"
                      name="gate_body"
                      rows={4}
                      maxLength={200000}
                      value={gateBody}
                      onChange={(e) => setGateBody(e.target.value)}
                      placeholder="Paste outgoing brochure, website, or circular copy to check against the active canon…"
                      className="mt-1.5 w-full rounded border border-rule bg-surface p-3 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>
                  <Button type="submit" variant="primary" disabled={gateBusy || !gateBody.trim()}>
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {gateBusy ? 'Testing gate…' : 'Run Gate Check'}
                  </Button>

                  {gateResult && (
                    <div className="space-y-3 border-t border-rule pt-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <StatusBadge
                          tone={
                            gateResult.decision === 'allow'
                              ? 'verified'
                              : gateResult.decision === 'block'
                                ? 'blocker'
                                : 'warn'
                          }
                          quiet={gateResult.decision === 'allow'}
                        >
                          {humanizeStatus(gateResult.decision)}
                        </StatusBadge>
                        <span className="text-xs text-ink-secondary tabular">
                          {pluralize(gateResult.blockers_count, 'blocker')},{' '}
                          {pluralize(gateResult.warnings_count, 'advisory', 'advisories')} (
                          {formatCount(gateResult.elapsed_ms)} ms)
                        </span>
                      </div>
                      {gateResult.findings.length > 0 && (
                        <ul className="divide-y divide-rule-subtle border-y border-rule text-sm">
                          {gateResult.findings.map((f) => (
                            <li key={f.id} className="py-2.5">
                              <p className="text-ink wrap-anywhere">{f.message}</p>
                              <span className="mt-1 block font-mono text-xs text-ink-muted">
                                {f.rule.rule_id}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </form>
              </div>
            ) : (
              <div
                id="gov-runner-panel-mcp"
                role="tabpanel"
                aria-labelledby="gov-runner-tab-mcp"
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={mcpBusy}
                    onClick={() => void runMcp('tools/call', 'get_canon_rules')}
                  >
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                    Query verified rules
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={mcpBusy}
                    onClick={() => void runMcp('tools/list')}
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                    List tools
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={mcpBusy}
                    onClick={() => void runMcp('tools/call', 'approve')}
                  >
                    Test write-block guard
                  </Button>
                </div>
                {mcpOutput ? (
                  <div className="overflow-hidden rounded-xs border border-rail-border bg-rail">
                    <div className="flex items-center justify-between gap-2 border-b border-rail-border bg-rail-hover px-3.5 py-2 text-xs text-rail-sub">
                      <span className="font-mono">json-rpc 2.0 response</span>
                      <button
                        type="button"
                        onClick={() => void copyCodeBlock('mcp', mcpOutput)}
                        className="btn-interactive inline-flex min-h-11 lg:min-h-8 shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-rail-ink hover:bg-rail-hover-strong focus-visible:outline-2 focus-visible:outline-code-key"
                      >
                        {copiedCode === 'mcp' ? (
                          <Check className="h-3.5 w-3.5 text-signal-ok" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-rail-muted" aria-hidden="true" />
                        )}
                        <span>{copiedCode === 'mcp' ? 'Copied' : 'Copy JSON'}</span>
                      </button>
                    </div>
                    <pre
                      dir="ltr"
                      className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere bg-rail p-4 font-mono text-xs text-code-str text-left"
                    >
                      {mcpOutput}
                    </pre>
                  </div>
                ) : (
                  <p className="border-t border-rule-subtle pt-3 text-sm text-ink-secondary leading-relaxed">
                    Select an RPC call above to inspect bounded JSON-RPC 2.0 output or verify that
                    autonomous write calls (`approve`) are rejected under OWASP LLM06.
                  </p>
                )}
              </div>
            )}
          </Sheet>
        </div>
      )}

      {/* Tab 3: Signing Key Ring & Immutable SHA-256 Workflow Audit Chain */}
      {hubTab === 'keys' && (
        <div
          id="gov-panel-keys"
          role="tabpanel"
          aria-labelledby="gov-tab-keys"
          className="space-y-9"
        >
          {user.role === 'admin' && keyRing && (
            <Sheet
              title="Institutional Signing Key Ring & Public JWKS"
              subtitle="Versioned Ed25519 (QR / SD-JWT) and ECDSA P-256 (Publication Seal) keys with zero-downtime rotation."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void copyCodeBlock('jwks', `${window.location.origin}${keyRing.jwks_url}`)
                    }
                  >
                    {copiedCode === 'jwks' ? (
                      <Check className="h-3.5 w-3.5 text-verified" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                    )}
                    {copiedCode === 'jwks' ? 'JWKS URL Copied' : 'Copy JWKS URL'}
                  </Button>
                  <a
                    href={keyRing.jwks_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-interactive inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 rounded border border-rule bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-action"
                  >
                    <span>Open JWKS</span>
                    <ExternalLink className="h-3.5 w-3.5 text-action" aria-hidden="true" />
                  </a>
                </div>
              }
            >
              <div className="space-y-4">
                {keyNotice && (
                  <div
                    role="status"
                    aria-atomic="true"
                    className="flex items-center gap-2 border-y border-verified-border bg-verified-bg px-4 py-2.5 text-sm font-medium text-verified-ink"
                  >
                    <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="wrap-anywhere">{keyNotice}</span>
                  </div>
                )}

                <form
                  onSubmit={handleRotateKey}
                  className="space-y-3 border-b border-rule pb-4"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[200px] flex-1 max-w-xs">
                      <label htmlFor="rotate-kid-input" className="block text-xs font-semibold text-ink">
                        Optional new key ID (kid)
                      </label>
                      <input
                        id="rotate-kid-input"
                        name="custom_kid"
                        type="text"
                        minLength={2}
                        maxLength={64}
                        value={customKid}
                        onChange={(e) => setCustomKid(e.target.value)}
                        placeholder="Auto-generated if blank (e.g., 2026-q4)"
                        className="mt-1 w-full rounded border border-rule bg-surface px-3 py-1.5 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                      />
                    </div>
                    {!confirmRotate && (
                      <Button type="submit" variant="primary" size="sm" disabled={rotatingKey}>
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${rotatingKey ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        Rotate Active Signing Key
                      </Button>
                    )}
                  </div>

                  {confirmRotate && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-3 border-y border-warn-border bg-warn-bg px-3.5 py-2.5 text-xs text-warn"
                    >
                      <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                        Confirm key rotation? Active key{' '}
                        <code className="font-mono font-semibold">{keyRing.active_kid}</code> will
                        move to retired verify-only status while existing passes remain verifiable.
                      </span>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          disabled={rotatingKey}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${rotatingKey ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          {rotatingKey ? 'Rotating Key…' : 'Confirm key rotation'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={rotatingKey}
                          onClick={() => setConfirmRotate(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </form>

                {allKeys.length === 0 ? (
                  <EmptyState
                    title="No signing keys registered"
                    description="Rotate or initialize an institutional Ed25519 / ECDSA P-256 signing key above to publish a live JWKS ring."
                  />
                ) : (
                  <div className="space-y-3">
                    <ul className="divide-y divide-rule-subtle border-y border-rule text-xs">
                      {pageKeys.map((k) => (
                        <li
                          key={k.kid}
                          className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span dir="ltr" className="font-mono font-bold text-ink wrap-anywhere">
                                {k.kid}
                              </span>
                              <StatusBadge
                                tone={k.status === 'active' ? 'verified' : 'neutral'}
                                quiet={k.status !== 'active'}
                              >
                                {k.status === 'active' ? 'Active Signing' : 'Retired (Verify Only)'}
                              </StatusBadge>
                            </div>
                            <div dir="ltr" className="font-mono text-ink-muted wrap-anywhere">
                              ECDSA: {k.ec_kid} | Ed25519 SHA-256: {k.ed25519_thumbprint}
                            </div>
                          </div>
                          <span className="text-ink-secondary shrink-0 tabular">
                            {k.created_at ? formatDateTime(k.created_at) : 'Environment root key'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <PaginationBar
                      page={safeKeysPage}
                      totalPages={keysTotalPages}
                      onPageChange={setKeysPage}
                    />
                  </div>
                )}
              </div>
            </Sheet>
          )}

          {/* Immutable SHA-256 Workflow Audit Chain Spine */}
          <Sheet
            title="Immutable SHA-256 Workflow Audit Chain"
            subtitle={
              loading
                ? 'Loading cryptographic audit chain…'
                : audit
                  ? audit.valid
                    ? `${pluralize(audit.count, 'linked hash block')} verified end-to-end`
                    : `Integrity break detected at block #${audit.broken_index ?? 0} of ${formatCount(audit.count)}`
                  : 'Audit chain unavailable for current account'
            }
            actions={
              audit &&
              (audit.valid ? (
                <StatusBadge tone="verified" quiet icon={<ShieldCheck className="h-4 w-4" />}>
                  Hash chain intact
                </StatusBadge>
              ) : (
                <StatusBadge tone="blocker">Tamper detected at #{audit.broken_index}</StatusBadge>
              ))
            }
          >
            <div className="space-y-4">
              {showAuditSearch && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search
                      className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
                      aria-hidden="true"
                    />
                    <input
                      id="audit-chain-search"
                      name="audit_query"
                      type="search"
                      aria-label="Filter audit blocks by actor, action, or hash"
                      value={auditQuery}
                      onChange={(e) => {
                        setAuditQuery(e.target.value);
                        setAuditPage(0);
                      }}
                      placeholder="Filter audit blocks by actor, action, or hash…"
                      className="w-full min-h-11 lg:min-h-9 rounded border border-rule bg-surface py-1.5 ps-9 pe-3 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>
                  <span className="text-xs text-ink-secondary tabular">
                    Showing {formatCount(pageAuditEvents.length)} of{' '}
                    {formatCount(filteredAuditEvents.length)}
                  </span>
                </div>
              )}

              {filteredAuditEvents.length === 0 ? (
                <EmptyState
                  title="No audit events logged yet"
                  description="Draft scans, edits, approvals, and publications append linked SHA-256 records here."
                />
              ) : (
                <>
                  <ol className="relative divide-y divide-rule-subtle border-y border-rule ps-8 before:absolute before:start-3 before:top-4 before:bottom-4 before:w-px before:bg-rule">
                    {pageAuditEvents.map((ev) => (
                      <li key={ev.id} className="row-hoverable relative rounded-xs px-2 py-3.5 text-sm">
                        <span
                          aria-hidden="true"
                          className="absolute -start-[25px] top-4 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-verified bg-surface text-verified shadow-[0_1px_2px_rgba(17,94,72,0.18)]"
                        >
                          <Link2 className="h-2.5 w-2.5" />
                        </span>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex flex-wrap items-baseline gap-2.5 min-w-0">
                            <span className="font-mono text-xs font-bold text-ink-secondary tabular">
                              #{ev.id}
                            </span>
                            <span className="font-bold text-ink">{humanizeAuditAction(ev.action)}</span>
                            <span dir="auto" className="text-ink-secondary">
                              {ev.actor_name} — Submission #{ev.submission_id}
                            </span>
                          </div>
                          <span className="text-xs text-ink-muted tabular shrink-0">
                            {formatDateTime(ev.created_at)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span dir="ltr" className="inline-flex flex-wrap items-center gap-2">
                            <span title={ev.prev_hash} className="font-mono text-ink-muted">
                              prev {truncateMiddle(ev.prev_hash, 8, 6)}
                            </span>
                            <span className="text-verified font-bold" aria-hidden="true">→</span>
                            <span title={ev.event_hash} className="font-mono font-semibold text-verified">
                              sha256 {truncateMiddle(ev.event_hash, 12, 8)}
                            </span>
                          </span>
                          {ev.comment.trim() && (
                            <span className="text-ink-secondary">
                              — <ExpandableText text={ev.comment.trim()} maxChars={240} />
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>

                  <PaginationBar
                    page={safeAuditPage}
                    totalPages={auditTotalPages}
                    onPageChange={setAuditPage}
                  />
                </>
              )}
            </div>
          </Sheet>
        </div>
      )}
    </div>
  );
}
