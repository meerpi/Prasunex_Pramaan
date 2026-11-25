import type {
  AdminInstitutionalData,
  AuditChainData,
  AuthTokenResponse,
  AuthUser,
  BulkCsvImportResult,
  CanonFrictionPrData,
  CanonLintResult,
  CanonSummary,
  ClaimGraphResult,
  CondonationAuditResult,
  DocumentBBoxesResponse,
  DpdpConsentRecord,
  FacultyErpRecord,
  FindingPayload,
  FindingRow,
  GateCheckResult,
  InstitutionalMetricsRecord,
  K12QcReport,
  K12SchoolDisclosure,
  MintedQrPassport,
  ParentPortalData,
  PlacementBatchRecord,
  RecruiterBatchResult,
  RecruiterFileScreenResult,
  RevocationEntry,
  RewriteResponse,
  RoleName,
  SetupStatusResponse,
  SigningKeyRingSummary,
  StoredDocument,
  StudentErpRecord,
  StudentPortalData,
  StudentPreflightResult,
  Submission,
  SubmissionComment,
  SubmissionVersion,
  TeacherPortalData,
  VerifiedQrPassport,
  WorkflowResponse,
} from './types.ts';

const LEGACY_TOKEN_KEY = 'pramaan_jwt';

export function clearLegacyStoredToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore restricted storage contexts
  }
}

interface FastApiValidationIssue {
  loc?: Array<string | number>;
  msg?: string;
}

function formatApiErrorDetail(rawDetail: unknown, status: number): string {
  if (typeof rawDetail === 'string' && rawDetail.trim()) {
    return rawDetail.trim();
  }
  if (Array.isArray(rawDetail) && rawDetail.length > 0) {
    const parts = rawDetail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const issue = item as FastApiValidationIssue;
          const field = Array.isArray(issue.loc)
            ? issue.loc
                .filter((seg) => seg !== 'body' && seg !== 'query' && seg !== 'path')
                .map((seg) => String(seg).replace(/_/g, ' '))
                .join(' · ')
            : '';
          const msg = typeof issue.msg === 'string' ? issue.msg.replace(/^Value error,\s*/i, '') : '';
          if (field && msg) return `${field}: ${msg}`;
          if (msg) return msg;
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }
  return `Request failed (HTTP ${status})`;
}

async function extractErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { detail?: unknown };
    if (payload.detail !== undefined && payload.detail !== null) {
      return formatApiErrorDetail(payload.detail, res.status);
    }
  } catch {
    // Ignore non-JSON error bodies
  }
  return fallback;
}

export interface SseScanHandlers {
  onFinding: (f: FindingPayload) => void;
  onDone: (meta: { total: number; alpha: number; conformal_threshold: number }) => void;
  onStage?: (stage: { stage: string; label: string }) => void;
}

function dispatchSseFrame(frame: string, handlers: SseScanHandlers): void {
  let ev = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) ev = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  const rawData = dataLines.join('\n').trim();
  if (!rawData) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  if (ev === 'stage' && handlers.onStage) {
    handlers.onStage(parsed as { stage: string; label: string });
  } else if (ev === 'finding') {
    handlers.onFinding(parsed as FindingPayload);
  } else if (ev === 'done') {
    handlers.onDone(parsed as { total: number; alpha: number; conformal_threshold: number });
  }
}

export async function consumeSseScanStream(
  body: ReadableStream<Uint8Array>,
  handlers: SseScanHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      dispatchSseFrame(frame, handlers);
    }
  }
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const frame of buffer.split('\n\n')) {
    if (frame.trim()) dispatchSseFrame(frame, handlers);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  if (!res.ok) {
    throw new Error(await extractErrorDetail(res, `Request failed (HTTP ${res.status})`));
  }
  return (await res.json()) as T;
}

export const api = {
  // Auth & Institutional Onboarding (HttpOnly session cookie — never persists JWT in localStorage)
  setupStatus: (): Promise<SetupStatusResponse> => apiFetch<SetupStatusResponse>('/auth/setup-status'),
  session: (): Promise<{ authenticated: boolean; user: AuthUser | null }> =>
    apiFetch<{ authenticated: boolean; user: AuthUser | null }>('/auth/session'),
  setupAdmin: async (payload: {
    username: string;
    display_name: string;
    password: string;
    institution_code?: string;
  }): Promise<AuthTokenResponse> => {
    clearLegacyStoredToken();
    return apiFetch<AuthTokenResponse>('/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  login: async (
    username: string,
    password: string,
    institution_code = '',
  ): Promise<AuthTokenResponse> => {
    clearLegacyStoredToken();
    return apiFetch<AuthTokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, institution_code }),
    });
  },
  register: async (
    username: string,
    display_name: string,
    password: string,
    institution_code = '',
  ): Promise<AuthTokenResponse> => {
    clearLegacyStoredToken();
    return apiFetch<AuthTokenResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, display_name, password, institution_code }),
    });
  },
  logout: async (): Promise<{ logged_out: boolean }> => {
    clearLegacyStoredToken();
    return apiFetch<{ logged_out: boolean }>('/auth/logout', { method: 'POST' });
  },
  listUsers: (): Promise<AuthUser[]> => apiFetch<AuthUser[]>('/auth/users'),
  adminCreateUser: (payload: {
    username: string;
    display_name: string;
    password: string;
    role: RoleName;
    linked_prn?: string;
    linked_faculty_id?: string;
  }): Promise<AuthUser> =>
    apiFetch<AuthUser>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpdateUser: (
    userId: number,
    payload: { role?: RoleName; linked_prn?: string; linked_faculty_id?: string },
  ): Promise<AuthUser> =>
    apiFetch<AuthUser>(`/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // 5 Role Portals & Real Registrar Write Endpoints
  studentPortal: (prn?: string): Promise<StudentPortalData> =>
    apiFetch<StudentPortalData>(prn ? `/portals/student?prn=${encodeURIComponent(prn)}` : '/portals/student'),
  parentPortal: (): Promise<ParentPortalData> => apiFetch<ParentPortalData>('/portals/parent'),
  createConsent: (payload: {
    student_prn: string;
    guardian_username?: string;
    grantee_name: string;
    allowed_claims: string[];
    purpose: string;
    expires_at: string;
    revoked?: boolean;
  }): Promise<DpdpConsentRecord> =>
    apiFetch<DpdpConsentRecord>('/portals/consents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  toggleConsent: (consentId: string, revoked: boolean): Promise<DpdpConsentRecord> =>
    apiFetch<DpdpConsentRecord>(`/portals/consents/${encodeURIComponent(consentId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ revoked }),
    }),
  initDigiLockerConsent: (
    consentId: string,
  ): Promise<{ authorize_url: string; state: string; mode: string }> =>
    apiFetch<{ authorize_url: string; state: string; mode: string }>(
      `/portals/consents/${encodeURIComponent(consentId)}/digilocker-init`,
      { method: 'POST' },
    ),
  teacherPortal: (): Promise<TeacherPortalData> => apiFetch<TeacherPortalData>('/portals/teacher'),
  auditCondonation: (
    student_prn: string,
    course_code: string,
    proposed_condonation_pct: number,
  ): Promise<CondonationAuditResult> =>
    apiFetch<CondonationAuditResult>('/portals/teacher/audit-condonation', {
      method: 'POST',
      body: JSON.stringify({ student_prn, course_code, proposed_condonation_pct }),
    }),
  recruiterBatchAudit: (
    canon_id: string,
    alpha: number,
    candidates: Array<{ name: string; content: string }>,
  ): Promise<RecruiterBatchResult> =>
    apiFetch<RecruiterBatchResult>('/portals/recruiter/batch-audit', {
      method: 'POST',
      body: JSON.stringify({ canon_id, alpha, candidates }),
    }),
  recruiterScreenFiles: (payload: {
    files: File[];
    canon_id?: string;
    alpha?: number;
    attached_passports?: Record<string, string>;
    min_cgpa?: number | null;
    max_backlogs?: number | null;
    required_batch_year?: number | null;
  }): Promise<RecruiterFileScreenResult> => {
    const fd = new FormData();
    for (const f of payload.files) {
      fd.append('files', f);
    }
    if (payload.canon_id) fd.append('canon_id', payload.canon_id);
    if (payload.alpha !== undefined) fd.append('alpha', String(payload.alpha));
    if (payload.attached_passports && Object.keys(payload.attached_passports).length > 0) {
      fd.append('attached_passports_json', JSON.stringify(payload.attached_passports));
    }
    if (payload.min_cgpa !== undefined && payload.min_cgpa !== null) {
      fd.append('min_cgpa', String(payload.min_cgpa));
    }
    if (payload.max_backlogs !== undefined && payload.max_backlogs !== null) {
      fd.append('max_backlogs', String(payload.max_backlogs));
    }
    if (payload.required_batch_year !== undefined && payload.required_batch_year !== null) {
      fd.append('required_batch_year', String(payload.required_batch_year));
    }
    return apiFetch<RecruiterFileScreenResult>('/portals/recruiter/screen-files', {
      method: 'POST',
      body: fd,
    });
  },
  studentPreflight: (
    file: File,
    canon_id = 'pramaan-campus-placement',
    student_prn = '',
  ): Promise<StudentPreflightResult> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('canon_id', canon_id);
    if (student_prn) fd.append('student_prn', student_prn);
    return apiFetch<StudentPreflightResult>('/portals/student/preflight', {
      method: 'POST',
      body: fd,
    });
  },
  stampPassportPdf: async (file: File, base45_payload: string): Promise<Blob> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('base45_payload', base45_payload);
    const res = await fetch('/api/passport/stamp-pdf', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    if (!res.ok) {
      throw new Error(await extractErrorDetail(res, `Unable to stamp PDF (HTTP ${res.status})`));
    }
    return await res.blob();
  },
  adminInstitutional: (): Promise<AdminInstitutionalData> =>
    apiFetch<AdminInstitutionalData>('/portals/admin/institutional'),
  adminUpsertStudent: (payload: StudentErpRecord): Promise<StudentErpRecord> =>
    apiFetch<StudentErpRecord>('/portals/admin/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpsertFaculty: (payload: FacultyErpRecord): Promise<FacultyErpRecord> =>
    apiFetch<FacultyErpRecord>('/portals/admin/faculty', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpsertInstitutional: (
    payload: InstitutionalMetricsRecord,
  ): Promise<InstitutionalMetricsRecord> =>
    apiFetch<InstitutionalMetricsRecord>('/portals/admin/institutional', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpsertPlacement: (payload: PlacementBatchRecord): Promise<PlacementBatchRecord> =>
    apiFetch<PlacementBatchRecord>('/portals/admin/placements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpsertK12School: (
    payload: K12SchoolDisclosure,
  ): Promise<{ school: K12SchoolDisclosure; qc_report: K12QcReport }> =>
    apiFetch<{ school: K12SchoolDisclosure; qc_report: K12QcReport }>('/portals/admin/k12-school', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminBulkImportStudents: (
    file: File,
    dry_run = true,
    skip_invalid = false,
  ): Promise<BulkCsvImportResult> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('dry_run', String(dry_run));
    fd.append('skip_invalid', String(skip_invalid));
    return apiFetch<BulkCsvImportResult>('/portals/admin/students/bulk-csv', {
      method: 'POST',
      body: fd,
    });
  },
  adminBulkImportFaculty: (
    file: File,
    dry_run = true,
    skip_invalid = false,
  ): Promise<BulkCsvImportResult> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('dry_run', String(dry_run));
    fd.append('skip_invalid', String(skip_invalid));
    return apiFetch<BulkCsvImportResult>('/portals/admin/faculty/bulk-csv', {
      method: 'POST',
      body: fd,
    });
  },
  downloadBulkCsvTemplate: async (kind: 'students' | 'faculty'): Promise<Blob> => {
    const res = await fetch(`/api/portals/admin/bulk-templates/${encodeURIComponent(kind)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new Error(
        await extractErrorDetail(res, `Unable to download template (HTTP ${res.status})`),
      );
    }
    return await res.blob();
  },
  listSigningKeys: (): Promise<SigningKeyRingSummary> =>
    apiFetch<SigningKeyRingSummary>('/passport/keys'),
  rotateSigningKey: (custom_kid = ''): Promise<SigningKeyRingSummary> =>
    apiFetch<SigningKeyRingSummary>('/passport/keys/rotate', {
      method: 'POST',
      body: JSON.stringify({ custom_kid }),
    }),

  // Merkle QR Passports
  mintPassport: (
    student_prn: string,
    disclose_keys: string[],
    grantee_name: string,
  ): Promise<MintedQrPassport> =>
    apiFetch<MintedQrPassport>('/passport/mint', {
      method: 'POST',
      body: JSON.stringify({ student_prn, disclose_keys, grantee_name }),
    }),
  verifyPassport: (payload: string): Promise<VerifiedQrPassport> =>
    apiFetch<VerifiedQrPassport>('/passport/verify', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    }),
  verifyPassportImage: (file: File): Promise<VerifiedQrPassport> => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetch<VerifiedQrPassport>('/passport/verify-image', { method: 'POST', body: fd });
  },
  revokePassport: (passport_id: string, reason: string): Promise<{ revoked: boolean; passport_id: string }> =>
    apiFetch('/passport/revoke', {
      method: 'POST',
      body: JSON.stringify({ passport_id, reason }),
    }),
  listRevocations: (): Promise<{ revocations: RevocationEntry[] }> =>
    apiFetch('/passport/revocations'),

  // Review Studio & Governance
  listSubmissions: (): Promise<Submission[]> => apiFetch<Submission[]>('/submissions'),
  getSubmission: (id: number): Promise<Submission> => apiFetch<Submission>(`/submissions/${id}`),
  createSubmission: (payload: {
    title: string;
    raw_content: string;
    canon_id: string;
    portal_scope: string;
    attachments?: Array<{ filename: string; content_base64: string }>;
  }): Promise<Submission> =>
    apiFetch<Submission>('/submissions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSubmissionContent: (
    id: number,
    raw_content: string,
    alpha = 0.1,
    skip_scan = false,
  ): Promise<Submission> =>
    apiFetch<Submission>(`/submissions/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ raw_content, alpha, skip_scan }),
    }),
  listFindings: (id: number): Promise<FindingRow[]> => apiFetch<FindingRow[]>(`/submissions/${id}/findings`),
  resolveFinding: (
    submissionId: number,
    findingRowId: number,
    resolution: 'accepted' | 'dismissed' | 'overridden',
    apply_suggestion = true,
    reason = '',
  ): Promise<{ row_id: number; resolution: string }> =>
    apiFetch(`/submissions/${submissionId}/findings/${findingRowId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution, apply_suggestion, reason }),
    }),
  rewriteFinding: (submissionId: number, findingRowId: number): Promise<RewriteResponse> =>
    apiFetch<RewriteResponse>(`/submissions/${submissionId}/findings/${findingRowId}/rewrite`, {
      method: 'POST',
    }),
  workflowAction: (submissionId: number, action: string, comment = ''): Promise<WorkflowResponse> =>
    apiFetch<WorkflowResponse>(`/submissions/${submissionId}/workflow`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    }),
  listVersions: (id: number): Promise<SubmissionVersion[]> =>
    apiFetch<SubmissionVersion[]>(`/submissions/${id}/versions`),
  listComments: (id: number): Promise<SubmissionComment[]> =>
    apiFetch<SubmissionComment[]>(`/submissions/${id}/comments`),
  addComment: (id: number, body: string, finding_id: number | null = null): Promise<SubmissionComment> =>
    apiFetch<SubmissionComment>(`/submissions/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, finding_id }),
    }),
  auditChain: (): Promise<AuditChainData> => apiFetch<AuditChainData>('/submissions/audit-chain'),

  streamScan: async (
    submissionId: number,
    alpha: number,
    onFinding: (f: FindingPayload) => void,
    onDone: (meta: { total: number; alpha: number; conformal_threshold: number }) => void,
    onStage?: (stage: { stage: string; label: string }) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`/api/submissions/${submissionId}/scan?alpha=${alpha}`, {
      method: 'POST',
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(await extractErrorDetail(res, `SSE Scan failed with HTTP ${res.status}`));
    }
    await consumeSseScanStream(res.body, { onFinding, onDone, onStage });
  },

  // SuperJoin Documents & Claim Graph
  uploadPdf: (file: File): Promise<StoredDocument & { facts_count: number }> => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetch('/documents/upload', { method: 'POST', body: fd });
  },
  listDocuments: (): Promise<StoredDocument[]> => apiFetch<StoredDocument[]>('/documents'),
  getDocumentForensics: (docId: string): Promise<StoredDocument> =>
    apiFetch<StoredDocument>(`/documents/${encodeURIComponent(docId)}/forensics`),
  getPageBboxes: (
    docId: string,
    pageNum: number,
    quote?: string,
    signal?: AbortSignal,
  ): Promise<DocumentBBoxesResponse> => {
    const qs = quote ? `?quote=${encodeURIComponent(quote)}` : '';
    return apiFetch<DocumentBBoxesResponse>(
      `/documents/${encodeURIComponent(docId)}/page/${pageNum}/bboxes${qs}`,
      { signal },
    );
  },
  fetchDocumentPageImageBlob: async (
    docId: string,
    pageNum: number,
    signal?: AbortSignal,
  ): Promise<Blob> => {
    const res = await fetch(
      `/api/documents/${encodeURIComponent(docId)}/page/${pageNum}/image`,
      {
        credentials: 'same-origin',
        signal,
      },
    );
    if (!res.ok) {
      throw new Error(
        await extractErrorDetail(res, `Unable to load page image (HTTP ${res.status})`),
      );
    }
    return await res.blob();
  },
  runReconcile: (doc_ids?: string[]): Promise<ClaimGraphResult> =>
    apiFetch<ClaimGraphResult>('/reconcile/run', {
      method: 'POST',
      body: JSON.stringify({ doc_ids: doc_ids ?? null }),
    }),
  getLatestReconcile: (): Promise<ClaimGraphResult | null> =>
    apiFetch<ClaimGraphResult | null>('/reconcile/latest'),

  // Canons, Webhook Gate & Prerana AI MCP
  listCanons: (): Promise<CanonSummary[]> => apiFetch<CanonSummary[]>('/canons'),
  compileCanon: (
    canon_id: string,
    raw_text: string,
    version = '1.0',
  ): Promise<{
    canon: CanonSummary;
    grounded_rules_count: number;
    rejected_hallucinations: number;
    warnings: string[];
  }> =>
    apiFetch('/canons/compile', {
      method: 'POST',
      body: JSON.stringify({ canon_id, raw_text, version }),
    }),
  lintCanon: (canonId: string): Promise<CanonLintResult> =>
    apiFetch<CanonLintResult>(`/canons/${encodeURIComponent(canonId)}/lint`),
  canonFrictionPr: (canonId: string): Promise<CanonFrictionPrData> =>
    apiFetch<CanonFrictionPrData>(`/canons/${encodeURIComponent(canonId)}/friction-pr`),
  gateCheck: (canon_id: string, title: string, raw_content: string, alpha = 0.1): Promise<GateCheckResult> =>
    apiFetch<GateCheckResult>('/gate/check', {
      method: 'POST',
      body: JSON.stringify({ canon_id, title, raw_content, alpha }),
    }),
  mcpCall: (method: string, params: Record<string, unknown> = {}, id = 1): Promise<Record<string, unknown>> =>
    apiFetch<Record<string, unknown>>('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
};
