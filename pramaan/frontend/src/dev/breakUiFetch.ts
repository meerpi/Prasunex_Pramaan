import {
  buildAdminData,
  buildAuditChain,
  buildCanons,
  buildComments,
  buildCondonationResult,
  buildDocumentsAndGraph,
  buildFindings,
  buildFrictionPr,
  buildGateResult,
  buildKeyRing,
  buildLint,
  buildMintedPassport,
  buildParentData,
  buildRecruiterFileScreen,
  buildRevocations,
  buildStudentData,
  buildSubmissions,
  buildTeacherData,
  buildUsers,
  buildVerifiedPassport,
  buildVersions,
  getBreakUiUser,
  type BreakUiMode,
  type BreakUiRole,
} from './breakUiFixtures.ts';

const VALID_MODES = new Set<BreakUiMode>(['live', 'demo', 'worst', 'empty', 'one', 'huge']);
const VALID_ROLES = new Set<BreakUiRole>(['public', 'admin', 'student', 'parent', 'teacher', 'recruiter']);

export function readBreakUiState(): {
  mode: BreakUiMode;
  role: BreakUiRole;
  rtl: boolean;
  hideToggle: boolean;
} {
  if (typeof window === 'undefined') {
    return { mode: 'live', role: 'public', rtl: false, hideToggle: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawMode = (params.get('data') ?? 'live').toLowerCase() as BreakUiMode;
  const rawRole = (params.get('role') ?? 'admin').toLowerCase() as BreakUiRole;
  const mode: BreakUiMode = VALID_MODES.has(rawMode) ? rawMode : 'live';
  const role: BreakUiRole = VALID_ROLES.has(rawRole) ? rawRole : 'admin';
  const rtl = params.get('dir') === 'rtl';
  const hideToggle = params.get('toggle') === '0';
  return { mode, role, rtl, hideToggle };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let installed = false;

export function installBreakUiFetchStub(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const { rtl } = readBreakUiState();
  if (rtl) {
    document.documentElement.dir = 'rtl';
  }

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { mode, role } = readBreakUiState();
    if (mode === 'live') {
      return origFetch(input, init);
    }

    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let pathname = rawUrl;
    try {
      pathname = new URL(rawUrl, window.location.origin).pathname;
    } catch {
      // Keep relative path
    }

    if (!pathname.startsWith('/api/')) {
      return origFetch(input, init);
    }

    const apiPath = pathname.slice(4); // starts with '/'
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Auth & session
    if (apiPath === '/auth/setup-status') {
      return jsonResponse({ initialized: mode !== 'empty', digilocker_configured: mode === 'worst' });
    }
    if (apiPath === '/auth/session') {
      const user = getBreakUiUser(mode, role);
      return jsonResponse({ authenticated: Boolean(user), user });
    }
    if (apiPath === '/auth/logout' && method === 'POST') {
      return jsonResponse({ logged_out: true });
    }
    if (apiPath === '/auth/users') {
      return jsonResponse(buildUsers(mode));
    }

    // Portals
    if (apiPath === '/portals/admin/institutional') {
      return jsonResponse(buildAdminData(mode));
    }
    if (apiPath === '/portals/student') {
      return jsonResponse(buildStudentData(mode));
    }
    if (apiPath === '/portals/parent') {
      return jsonResponse(buildParentData(mode));
    }
    if (apiPath === '/portals/teacher') {
      return jsonResponse(buildTeacherData(mode));
    }
    if (apiPath === '/portals/teacher/audit-condonation' && method === 'POST') {
      return jsonResponse(buildCondonationResult(mode));
    }
    if (apiPath === '/portals/recruiter/screen-files' && method === 'POST') {
      return jsonResponse(buildRecruiterFileScreen(mode));
    }

    // Passports & Keys
    if (apiPath === '/passport/revocations') {
      return jsonResponse(buildRevocations(mode));
    }
    if (apiPath === '/passport/mint' && method === 'POST') {
      return jsonResponse(buildMintedPassport(mode));
    }
    if ((apiPath === '/passport/verify' || apiPath === '/passport/verify-image') && method === 'POST') {
      return jsonResponse(buildVerifiedPassport(mode));
    }
    if (apiPath === '/passport/revoke' && method === 'POST') {
      return jsonResponse({ revoked: true, passport_id: 'revoked' });
    }
    if (apiPath === '/passport/keys' || apiPath === '/passport/keys/rotate') {
      return jsonResponse(buildKeyRing(mode));
    }

    // Submissions / Review Studio
    if (apiPath === '/submissions/audit-chain') {
      return jsonResponse(buildAuditChain(mode));
    }
    if (apiPath === '/submissions' && method === 'GET') {
      return jsonResponse(buildSubmissions(mode));
    }
    const subDetailMatch = apiPath.match(/^\/submissions\/(\d+)$/);
    if (subDetailMatch) {
      const subs = buildSubmissions(mode);
      const found = subs.find((s) => s.id === Number(subDetailMatch[1])) ?? subs[0] ?? null;
      return found ? jsonResponse(found) : jsonResponse({ detail: 'Not found' }, 404);
    }
    if (/^\/submissions\/\d+\/findings$/.test(apiPath)) {
      return jsonResponse(buildFindings(mode));
    }
    if (/^\/submissions\/\d+\/versions$/.test(apiPath)) {
      return jsonResponse(buildVersions(mode));
    }
    if (/^\/submissions\/\d+\/comments$/.test(apiPath)) {
      return jsonResponse(buildComments(mode));
    }

    // Documents & Claim Graph
    if (apiPath === '/documents') {
      return jsonResponse(buildDocumentsAndGraph(mode).docs);
    }
    if (apiPath === '/reconcile/latest' || apiPath === '/reconcile/run') {
      return jsonResponse(buildDocumentsAndGraph(mode).graph);
    }

    // Canons, Gate & MCP
    if (apiPath === '/canons') {
      return jsonResponse(buildCanons(mode));
    }
    const lintMatch = apiPath.match(/^\/canons\/([^/]+)\/lint$/);
    if (lintMatch) {
      return jsonResponse(buildLint(mode, decodeURIComponent(lintMatch[1])));
    }
    const prMatch = apiPath.match(/^\/canons\/([^/]+)\/friction-pr$/);
    if (prMatch) {
      return jsonResponse(buildFrictionPr(mode, decodeURIComponent(prMatch[1])));
    }
    if (apiPath === '/gate/check' && method === 'POST') {
      return jsonResponse(buildGateResult(mode));
    }
    if (apiPath === '/mcp' && method === 'POST') {
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_canon_rules' }] } });
    }

    return origFetch(input, init);
  };
}
