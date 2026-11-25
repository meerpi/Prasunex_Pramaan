export type RoleName = 'student' | 'parent' | 'teacher' | 'recruiter' | 'admin';

export interface SetupStatusResponse {
  initialized: boolean;
  digilocker_configured: boolean;
}

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: RoleName;
  tenant_id: string;
  linked_prn: string;
  linked_faculty_id: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface CourseCreditRecord {
  course_code: string;
  course_title: string;
  credits: number;
  grade_point: number;
  semester: number;
}

export interface AttendanceRecord {
  course_code: string;
  course_title: string;
  attended_classes: number;
  total_classes: number;
  medical_condonation_pct: number;
  approved_by_medical_board: boolean;
  raw_pct: number;
  effective_pct: number;
}

export interface StudentErpRecord {
  prn: string;
  full_name: string;
  program: string;
  batch_year: number;
  department: string;
  education_level: 'HEI' | 'K12' | string;
  age_years: number;
  is_minor: boolean;
  declared_cgpa: number;
  active_backlogs: number;
  degree_status: string;
  parent_username: string;
  disciplinary_standing?: string;
  courses: CourseCreditRecord[];
  attendance: AttendanceRecord[];
}

export interface DpdpConsentRecord {
  consent_id: string;
  student_prn: string;
  guardian_username: string;
  grantee_name: string;
  allowed_claims: string[];
  purpose: string;
  expires_at: string;
  revoked: boolean;
  tenant_id?: string;
  digilocker_verified?: boolean;
  digilocker_tx_id?: string;
  verified_at?: string;
  verification_mode?: string;
}

export interface PlacementBatchRecord {
  academic_year: string;
  department: string;
  batch_total: number;
  opting_in_eligible: number;
  placed_students: number;
  highest_ctc_lakhs: number;
  median_ctc_lakhs: number;
  top_recruiters: string[];
}

export interface AppendixIxCertificate {
  doc_code: string;
  title: string;
  section: string;
  issuing_authority: string;
  valid_until: string;
  status: string;
}

export interface K12SchoolDisclosure {
  affiliation_qc_code: string;
  udise_qc_code: string;
  school_name: string;
  board: string;
  academic_year: string;
  classes_offered: string;
  management_type: string;
  city_state: string;
  enrolled_students: number;
  sections_count: number;
  max_section_size: number;
  classroom_count: number;
  classroom_area_sqft: number;
  classroom_area_sqm: number;
  core_teaching_staff: number;
  staff_breakdown: Record<string, number>;
  class_x_3yr_pass_pct: number[];
  class_xii_3yr_pass_pct: number[];
  appendix_ix_certificates: AppendixIxCertificate[];
}

export interface K12Z3Proofs {
  computed_ptr: number;
  avg_section_size: number;
  sqm_per_student: number;
  classroom_area_sqft: number;
  all_compliant: boolean;
  unsat_core?: string[];
  solver_id: string;
  ptr_within_30_to_1: boolean;
  section_cap_within_40: boolean;
  classroom_area_min_500_sqft: boolean;
  floor_space_min_1_sqm: boolean;
}

export interface K12QcGateResult {
  gate_id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface K12QcReport {
  seed_id: number;
  macro_prior_source: string;
  passed_all_gates: boolean;
  validated_at: string;
  gates: K12QcGateResult[];
}

export interface IssuedPassportSummary {
  passport_id: string;
  grantee_name: string;
  issued_at: string;
  revoked: boolean;
  revoked_reason: string;
  revoked_at: string;
}

export interface AttendancePolicy {
  min_attendance_pct: number;
  max_medical_condonation_pct: number;
  cgpa_exemption_threshold: number | null;
  student_exempt_by_cgpa?: boolean;
}

export interface StudentPortalData {
  student: StudentErpRecord | null;
  z3_cgpa_proof: {
    verified: boolean;
    declared_cgpa: number;
    weighted_exact_cgpa: number;
    solver_id: string;
  } | null;
  consents: DpdpConsentRecord[];
  minor_consent_locked?: boolean;
  placement_benchmark: PlacementBatchRecord | null;
  school_benchmark?: K12SchoolDisclosure | null;
  z3_k12_proofs?: K12Z3Proofs | null;
  k12_qc_report?: K12QcReport | null;
  issued_passports?: IssuedPassportSummary[];
  attendance_policy?: AttendancePolicy;
}

export interface ParentPortalData {
  guardian: string;
  digilocker_configured?: boolean;
  children: StudentErpRecord[];
  consents: DpdpConsentRecord[];
  placement_truth: PlacementBatchRecord | null;
  school_disclosure?: K12SchoolDisclosure | null;
  k12_qc_report?: K12QcReport | null;
  brochure_vs_erp_discrepancy: {
    brochure_claim: string;
    brochure_filename?: string;
    erp_verified: string;
  } | null;
}

export interface PublicationRecord {
  doi: string;
  title: string;
  venue: string;
  indexing: string;
  year: number;
  faculty_id: string;
  verified: boolean;
}

export interface FacultyErpRecord {
  faculty_id: string;
  full_name: string;
  designation: string;
  department: string;
  biometric_days_present: number;
  working_days_total: number;
  sponsored_grant_inr_lakhs: number;
  publications: PublicationRecord[];
}

export interface TeacherPortalData {
  faculty: FacultyErpRecord[];
  students: StudentErpRecord[];
  min_attendance_pct?: number;
  max_medical_condonation_pct: number;
  cgpa_exemption_threshold?: number | null;
}

export interface CondonationAuditResult {
  student_prn: string;
  course_code: string;
  raw_attendance_pct: number;
  proposed_condonation_pct: number;
  effective_capped_pct: number;
  compliant: boolean;
  exempt_by_cgpa?: boolean;
  meets_attendance_floor?: boolean;
  min_attendance_pct?: number;
  max_medical_condonation_pct?: number;
  cgpa_exemption_threshold?: number | null;
  solver_id: string;
  witness: string | null;
  verdict: string;
}

export interface RecruiterBatchItem {
  item_id?: string;
  filename: string;
  decision: string;
  findings_count: number;
  blockers_count: number;
  warnings_count: number;
  findings: FindingPayload[];
}

export interface RecruiterBatchResult {
  job_id: string;
  canon_id: string;
  elapsed_ms: number;
  items: RecruiterBatchItem[];
}

export interface ResumeCrossCheck {
  field: string;
  resume_value: string;
  verified_value: string;
  status: 'match' | 'mismatch' | 'not_mentioned';
  detail: string;
}

export interface DriveEligibilityCheck {
  criterion: string;
  required: string;
  verified_value: string;
  status: 'passed' | 'failed' | 'undisclosed';
  detail: string;
}

export interface DriveEligibilityResult {
  active: boolean;
  passed: boolean | null;
  checks: DriveEligibilityCheck[];
}

export interface CandidateForensicsSummary {
  has_hidden_text: boolean;
  anomalies: PdfAnomaly[];
  visible_preview: string;
  sanitized_text: string;
}

export interface EmbeddedPassVerification extends VerifiedQrPassport {
  source: 'embedded_pdf_qr' | 'attached_token' | null;
}

export interface RecruiterFileScreenItem {
  item_id: string;
  filename: string;
  decision: 'allow' | 'needs_review' | 'block';
  elapsed_ms: number;
  forensics: CandidateForensicsSummary;
  embedded_pass: EmbeddedPassVerification | null;
  cross_checks: ResumeCrossCheck[];
  eligibility: DriveEligibilityResult;
  blockers_count: number;
  warnings_count: number;
  findings_count: number;
  findings: FindingPayload[];
  writing_tips: FindingPayload[];
}

export interface RecruiterFileScreenResult {
  job_id: string;
  canon_id: string;
  elapsed_ms: number;
  items: RecruiterFileScreenItem[];
}

export interface StudentPreflightResult {
  filename: string;
  ready_for_placement: boolean;
  issues_count: number;
  coaching_summary: string;
  elapsed_ms: number;
  forensics: CandidateForensicsSummary;
  erp_checks: ResumeCrossCheck[];
  canon_findings: FindingPayload[];
  writing_tips: FindingPayload[];
}

export interface RevocationEntry {
  passport_id: string;
  reason: string;
  revoked_at: string;
}

export interface InstitutionalMetricsRecord {
  academic_year: string;
  fiscal_year: string;
  naac_grade: string;
  naac_cycle_valid_until: string;
  enrolled_learners: number;
  regular_faculty_count: number;
  criterion4_infra_spend_crores: number;
  budget_heads: Record<string, number>;
  min_attendance_pct?: number;
  max_medical_condonation_pct?: number;
  cgpa_exemption_threshold?: number | null;
}

export interface AdminInstitutionalData {
  metrics: InstitutionalMetricsRecord | null;
  placement: PlacementBatchRecord | null;
  z3_proofs: {
    criterion4_heads_sum_crores: number;
    criterion4_declared_crores: number;
    criterion4_balanced: boolean;
    computed_sfr: number;
    sfr_within_15_to_1: boolean;
    total_faculty_grants_lakhs: number;
  } | null;
  k12_disclosure?: K12SchoolDisclosure | null;
  z3_k12_proofs?: K12Z3Proofs | null;
  k12_qc_report?: K12QcReport | null;
  revocations_count: number;
  students_count?: number;
  faculty_count?: number;
}

export interface MintedQrPassport {
  passport_id: string;
  holder_prn: string;
  disclosed_claims: Record<string, string>;
  hidden_claims: string[];
  root_hash_hex: string;
  base45_payload: string;
  payload_bytes_len: number;
  qr_version: number;
  qr_png_b64: string;
  issued_at: string;
  portability?: {
    sd_jwt: string;
    w3c_vc_2_0: Record<string, unknown>;
  };
}

export interface VerifiedQrPassport {
  valid: boolean;
  revoked: boolean;
  reason: string;
  passport_id: string;
  holder_prn: string;
  root_hash_hex: string;
  disclosed_claims: Record<string, string>;
  signature_ok: boolean;
  merkle_proofs_ok: boolean;
  issued_at: string;
}

export interface Submission {
  id: number;
  title: string;
  status: 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published';
  portal_scope: string;
  content_hash: string;
  canon_id: string;
  canon_hash: string;
  creator_id: number;
  raw_content: string;
  paragraph_node_ids: string[];
  text_blocks: string[];
  c2pa_manifest?: WorkflowResponse['c2pa_manifest'];
  created_at: string;
  updated_at: string;
}

export interface FindingPayload {
  id: string;
  check_id: string;
  severity: number;
  message: string;
  node_id: string;
  rule: {
    rule_id: string;
    rule_type: string;
    source_text?: string;
  };
  trace: {
    check_id: string;
    tier: string;
    canon_id: string;
    canon_hash: string;
    latency_ms?: number | null;
    model_used?: string | null;
    notes?: string[];
  };
  locator:
    | { kind: 'span'; start: number; end: number }
    | { kind: 'bbox'; x0: number; y0: number; x1: number; y1: number; page: number };
  evidence: Record<string, unknown>;
  suggestion?: {
    summary: string;
    patch?: {
      kind: 'replace' | 'delete' | 'insert_after';
      start: number;
      end: number;
      new_text: string;
    } | null;
  } | null;
}

export interface FindingRow {
  row_id: number;
  finding_id: string;
  check_id: string;
  node_id: string;
  severity: number;
  message: string;
  resolution: 'open' | 'accepted' | 'dismissed' | 'overridden';
  resolution_reason: string;
  payload: FindingPayload;
}

export interface RewriteResponse {
  row_id: number;
  finding_id: string;
  original_text: string;
  rewritten_text: string;
  masked_prompt_preview: string;
  edit_distance_ratio: number;
  max_edit_distance_ratio: number;
  reverified: boolean;
  remaining_findings_count: number;
  pii_masked_count: number;
  used_provider: string;
  api_key_configured: boolean;
  provider_notice: string;
  quality_gates: Record<string, boolean>;
}

export interface WorkflowResponse {
  submission_id: number;
  status: string;
  event_hash: string;
  c2pa_manifest: {
    manifest_id: string;
    submission_id: number;
    content_hash: string;
    canon_id: string;
    canon_hash: string;
    issuer: string;
    issued_at: string;
    audit_chain_tip_hash: string;
    chain_verified?: boolean;
    algorithm: string;
    signature_alg?: string;
    signature_b64: string;
    public_key_pem: string;
  } | null;
}

export interface SubmissionVersion {
  version_number: number;
  content_hash: string;
  canon_hash: string;
  raw_content: string;
  change_note: string;
  created_at: string;
}

export interface SubmissionComment {
  id: number;
  submission_id: number;
  finding_id: number | null;
  author_name: string;
  role: string;
  body: string;
  created_at: string;
}

export interface AuditChainData {
  valid: boolean;
  broken_index: number | null;
  count: number;
  events: Array<{
    id: number;
    submission_id: number;
    action: string;
    actor_id: number;
    actor_name: string;
    comment: string;
    prev_hash: string;
    event_hash: string;
    created_at: string;
  }>;
}

export interface PdfAnomaly {
  kind: string;
  page: number;
  snippet: string;
  wcag_contrast: number | null;
  effective_font_pt: number | null;
  detail: string;
}

export interface FactProvenance {
  doc_id: string;
  filename: string;
  page: number;
  evidence_quote: string;
  verified: boolean;
  match_type: string;
}

export interface ExtractedFact {
  fact_id: string;
  subject: string;
  predicate: string;
  value: string;
  canonical_value: number | null;
  canonical_unit: string | null;
  temporal: string | null;
  scope: string | null;
  confidence: number;
  provenance: FactProvenance;
}

export interface StoredDocument {
  doc_id: string;
  filename: string;
  page_count: number;
  scanned_pages: number[];
  anomalies: PdfAnomaly[];
  facts: ExtractedFact[];
  created_at?: string;
}

export interface WordBBox {
  word: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  page: number;
}

export interface DocumentBBoxesResponse {
  doc_id: string;
  page_num: number;
  page_width: number;
  page_height: number;
  words: WordBBox[];
  grounded_quote: {
    found: boolean;
    match_type: string;
    score: number;
    bbox: [number, number, number, number] | null;
    matched_words: WordBBox[];
  } | null;
}

export interface ClaimEdge {
  source_fact_id: string;
  target_fact_id: string;
  edge_type: 'corroborates' | 'contradicts' | 'supersedes' | 'refines';
  detection_method: string;
  confidence: number;
  explanation: string;
}

export interface FactCluster {
  cluster_id: string;
  subject: string;
  predicate: string;
  case_type:
    | 'corroborated'
    | 'contradicted'
    | 'reconciled_temporal'
    | 'reconciled_scope'
    | 'reconciled_rounding';
  dispute_code: string;
  explanation: string;
  facts: ExtractedFact[];
  edges: ClaimEdge[];
  credibility_scores: Record<string, number>;
}

export interface ClaimGraphResult {
  graph_id: string;
  created_at: string;
  elapsed_ms: number;
  doc_count: number;
  total_facts: number;
  clusters: FactCluster[];
  summary_counts: Record<string, number>;
}

export interface CanonSummary {
  id: string;
  version: string;
  hash: string;
  term_count: number;
  color_count: number;
  fact_count: number;
  trigger_count: number;
  yaml: string;
}

export interface CanonLintResult {
  canon_id: string;
  canon_version: string;
  is_valid: boolean;
  issues: Array<{
    rule_ids: string[];
    kind: string;
    message: string;
  }>;
}

export interface CanonFrictionPrData {
  canon_id: string;
  base_version: string;
  proposed_version: string;
  has_changes: boolean;
  rule_metrics: Array<{
    rule_id: string;
    total_flags: number;
    overrides: number;
    raw_friction: number;
    posterior_friction: number;
    needs_revision: boolean;
  }>;
  revisions: Array<{
    rule_id: string;
    posterior_friction: number;
    action: string;
    before_summary: string;
    after_summary: string;
    rationale: string;
  }>;
  yaml_diff: string;
  impact_simulation: {
    bundles_evaluated: number;
    before_findings: number;
    after_findings: number;
    before_blockers: number;
    after_blockers: number;
    resolved_rule_ids: string[];
  };
}

export interface GateCheckResult {
  decision: 'allow' | 'needs_review' | 'block';
  canon_id: string;
  alpha: number;
  blockers_count: number;
  warnings_count: number;
  elapsed_ms: number;
  findings: FindingPayload[];
}

export interface BulkImportRowError {
  row: number;
  identifier: string;
  error: string;
}

export interface BulkCsvImportResult {
  kind: 'students' | 'faculty';
  dry_run: boolean;
  committed: boolean;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported_count: number;
  created_count: number;
  updated_count: number;
  preview: Array<Record<string, unknown>>;
  errors: BulkImportRowError[];
}

export interface SigningKeyMetadata {
  kid: string;
  ec_kid: string;
  status: 'active' | 'retired' | string;
  source: string;
  created_at: string;
  retired_at: string;
  ed25519_thumbprint: string;
}

export interface SigningKeyRingSummary {
  active_kid: string;
  jwks_url: string;
  keys: SigningKeyMetadata[];
}
