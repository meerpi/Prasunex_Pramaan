import type {
  AdminInstitutionalData,
  AppendixIxCertificate,
  AuditChainData,
  AuthUser,
  CanonFrictionPrData,
  CanonLintResult,
  CanonSummary,
  ClaimGraphResult,
  CondonationAuditResult,
  DpdpConsentRecord,
  ExtractedFact,
  FactCluster,
  FacultyErpRecord,
  FindingRow,
  GateCheckResult,
  IssuedPassportSummary,
  K12SchoolDisclosure,
  MintedQrPassport,
  ParentPortalData,
  RecruiterFileScreenResult,
  RevocationEntry,
  RoleName,
  SigningKeyRingSummary,
  StoredDocument,
  StudentErpRecord,
  StudentPortalData,
  Submission,
  SubmissionComment,
  SubmissionVersion,
  TeacherPortalData,
  VerifiedQrPassport,
} from '../api/types.ts';

export type BreakUiMode = 'live' | 'demo' | 'worst' | 'empty' | 'one' | 'huge';
export type BreakUiRole = 'public' | RoleName;

// Minimal crisp 1x1 dark-indigo placeholder PNG (valid PNG base64) and real-looking crisp SVG QR data for offline demo/worst tests
const SAMPLE_QR_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAXIAAAFyAQAAAADAX2ykAAAC3ElEQVR4nO1bXYrjMAyWlMA8OtAD5CjODeZMe6S5QX2UOUAhfiw4aJHy004WnMwsDclE30Owo48grEqWJRcZvoNA36IDGD8PWpDPYfw8aEE+h/HzoAX5HMbPgxbkcxj/DOuDA0rA5osYmzjKmh3rvx50Tr5nQftsVQhVh3yFQkW8b/1Xg07Kj4OH8p9Kpi7Js2B9p469sT5rQauZ5+SXszn6FoAhXhj9Z5k214eM/1L7MsQKGKBDBrjjf3+fjL+L9XHMfJVBqBNg45ghYAn6jpknRzZ75UH79N/Qe2oB6D/fGCFeEvpWHh8d7ll/Mn4e/BWjJxcySnMpX20986Cd8aG3qmZVGov7gNwWQ7j2OpJ0Wo9QZt+Dxuc6lei5k2mRIDQg+VUh2+4dwbfdVvqQ8V9gXw6N7rrVdEiq5HEBCO+tbsdW3ziyfRHcDSHUYkUnVSzH8u6ODLFMEGoZbaIPGf8l59+o/lsmBNeVEFBCcxR3dq0eh3/6fTL+LvIrlq3WDZnWkG65h8Dyq2PbF6ZcWVLn3qqek6TTmkkPTQbLnw9cn2SABGPqLDkXaqZ1kYmWK7fQh4z/svpzaPRAVKShYuVuJYcK5Hx0GQuUtv550M74MMTdca/VWrNOh3dPO7HF56PaF/o0SutXbuz0e92Jx/qV7b9Hrm+AdAXD+61E33Yl+A8J0u6OHKpCCFKO3kQfMv5L6pPvLK0jmamla2n9Rtl7QfpH7sffJ+PvrH8E2jrSSeq7Ck886y8c/P7kA4j4xgCx7Msddn/yd9yf9G2HOuq7glq6CtXe9V8NgrPfn6wlIMfxJnRAxEeQ3q/+a0Fnvz8JIE0GmIpYzVDJsvrVb+F3vcP2l9yHo9FwE/oQ+mdBJ/VfJ1aMo5v2Dhu1MdzKnlzhTvUn4+fBT38+EV+dmkh9VXK6bmfno0P+3tD+330oe5Hxs6C8+B8YPw9akM9h/DxoQT6H8fM4+vr8BUP2tFr7ataGAAAAAElFTkSuQmCC';

const DEMO_CERTS: AppendixIxCertificate[] = [
  { doc_code: 'B1', title: 'Affiliation Extension Letter', section: 'Section B', issuing_authority: 'CBSE Regional Office Pune', valid_until: '2030-03-31', status: 'VALID' },
  { doc_code: 'B2', title: 'Society / Trust Registration Certificate', section: 'Section B', issuing_authority: 'Charity Commissioner Maharashtra', valid_until: 'PERMANENT', status: 'VALID' },
  { doc_code: 'B3', title: 'No Objection Certificate (NOC)', section: 'Section B', issuing_authority: 'Dept. of School Education, Maharashtra', valid_until: 'PERMANENT', status: 'VALID' },
  { doc_code: 'B4', title: 'Recognition Certificate under RTE Act 2009', section: 'Section B', issuing_authority: 'District Education Officer, Pune', valid_until: '2029-05-31', status: 'VALID' },
  { doc_code: 'B5', title: 'Building Safety Certificate', section: 'Section B', issuing_authority: 'PWD Executive Engineer, Pune', valid_until: '2028-06-30', status: 'VALID' },
  { doc_code: 'B6', title: 'Fire Safety Certificate (NBC Part IV)', section: 'Section B', issuing_authority: 'Pune Municipal Fire Brigade', valid_until: '2028-03-31', status: 'VALID' },
  { doc_code: 'B7', title: 'DEO Self-Certification Proforma', section: 'Section B', issuing_authority: 'District Education Officer', valid_until: '2029-03-31', status: 'VALID' },
  { doc_code: 'B8', title: 'Safe Drinking Water & Sanitary Certificate', section: 'Section B', issuing_authority: 'Municipal Health Officer, Pune', valid_until: '2028-04-30', status: 'VALID' },
];

const WORST_CERTS: AppendixIxCertificate[] = [
  {
    doc_code: 'B1-EXT-2026-REGIONAL',
    title: 'CBSE Senior Secondary Provisional Affiliation Extension & Benachrichtigungseinstellungen Compliance Dossier',
    section: 'Section B — Statutory Filings',
    issuing_authority: '',
    valid_until: '2021-01-01',
    status: 'VALID',
  },
  {
    doc_code: 'B2',
    title: '<script>alert(1)</script> &amp; **Trust Registration** — Đặng Thị Ngọc Hân Memorial Society',
    section: 'Section B',
    issuing_authority: 'Office of the Charity Commissioner, Sub-Division Northwind-Holdings-Maharashtra',
    valid_until: 'PERMANENT',
    status: 'VALID',
  },
  {
    doc_code: 'B4',
    title: 'RTE Recognition Certificate with Disallowed Permanent Token',
    section: 'Section B',
    issuing_authority: 'DEO',
    valid_until: 'PERMANENT',
    status: 'VALID',
  },
  {
    doc_code: 'B5',
    title: 'Building Structural Stability Certificate (Unparseable Date)',
    section: 'Section B',
    issuing_authority: 'Public Works Department',
    valid_until: 'TBD / Pending Renewal',
    status: 'VALID',
  },
  {
    doc_code: 'B6',
    title: 'Fire Safety Clearance — نور الهدى عبد الرحمن Wing',
    section: 'Section B',
    issuing_authority: 'Municipal Fire Service',
    valid_until: '2031-12-31',
    status: 'REVOKED',
  },
];

const DEMO_K12: K12SchoolDisclosure = {
  affiliation_qc_code: '1130482',
  udise_qc_code: '27251403912',
  school_name: 'Savitribai Phule Vidya Niketan',
  board: 'CBSE',
  academic_year: 'AY 2026-27',
  classes_offered: 'Class I to XII (Science, Commerce, Humanities)',
  management_type: 'Private Unaided Trust',
  city_state: 'Pune, Maharashtra',
  enrolled_students: 1260,
  sections_count: 36,
  max_section_size: 38,
  classroom_count: 42,
  classroom_area_sqft: 540,
  classroom_area_sqm: 50.17,
  core_teaching_staff: 54,
  staff_breakdown: { PGT: 16, TGT: 20, PRT: 18, Counsellor: 2 },
  class_x_3yr_pass_pct: [99.1, 98.8, 99.4],
  class_xii_3yr_pass_pct: [97.8, 98.4, 98.9],
  appendix_ix_certificates: DEMO_CERTS,
};

const WORST_K12: K12SchoolDisclosure = {
  affiliation_qc_code: 'CBSE-AFF-999999999999999999999999999999999999999',
  udise_qc_code: 'UDISE-2725140391200000000000000000000000000000',
  school_name: 'Konstantin Oberhauser-Wettstein & Đặng Thị Ngọc Hân International Academy of Paramètres de Confidentialité',
  board: 'CBSE / International Baccalaureate Dual Affiliation',
  academic_year: 'AY 2026-27 (Extended Provisional Cycle)',
  classes_offered: 'Nursery to Class XII — Benachrichtigungseinstellungen Track',
  management_type: 'Multi-State Charitable Educational Trust & Foundation',
  city_state: 'Thiruvananthapuram, Kerala / Bengaluru Metropolitan Region',
  enrolled_students: 128400,
  sections_count: 2568,
  max_section_size: 52,
  classroom_count: 1900,
  classroom_area_sqft: 412.5,
  classroom_area_sqm: 38.32,
  core_teaching_staff: 3120,
  staff_breakdown: {
    'Post-Graduate_Teachers_STEM_and_Humanities': 1284,
    'customer-feedback-from-enterprise-onboarding': 1,
    'PRT': 0,
  },
  class_x_3yr_pass_pct: [100, 99.95, 0.30000000000000004],
  class_xii_3yr_pass_pct: [142, -3, 98.123456],
  appendix_ix_certificates: WORST_CERTS,
};

const DEMO_STUDENT: StudentErpRecord = {
  prn: '2026CS001',
  full_name: 'Aarav Deshmukh',
  program: 'B.Tech Computer Science & Engineering',
  batch_year: 2026,
  department: 'Computer Science & Engineering',
  education_level: 'HEI',
  age_years: 21,
  is_minor: false,
  declared_cgpa: 8.94,
  active_backlogs: 0,
  degree_status: 'Enrolled',
  parent_username: 'parent_d',
  disciplinary_standing: 'Good Standing — No Infractions',
  courses: [
    { course_code: 'CS301', course_title: 'Operating Systems & Kernel Design', credits: 4, grade_point: 9.0, semester: 5 },
    { course_code: 'CS304', course_title: 'Formal Verification & Logic', credits: 4, grade_point: 9.5, semester: 5 },
    { course_code: 'CS308', course_title: 'Distributed Systems & Consensus', credits: 4, grade_point: 8.5, semester: 6 },
    { course_code: 'CS312', course_title: 'Database Internals & Storage Engines', credits: 3, grade_point: 8.75, semester: 6 },
  ],
  attendance: [
    { course_code: 'CS301', course_title: 'Operating Systems & Kernel Design', attended_classes: 38, total_classes: 44, medical_condonation_pct: 0, approved_by_medical_board: false, raw_pct: 86.4, effective_pct: 86.4 },
    { course_code: 'CS304', course_title: 'Formal Verification & Logic', attended_classes: 31, total_classes: 44, medical_condonation_pct: 6.5, approved_by_medical_board: true, raw_pct: 70.5, effective_pct: 77.0 },
    { course_code: 'CS308', course_title: 'Distributed Systems & Consensus', attended_classes: 28, total_classes: 40, medical_condonation_pct: 0, approved_by_medical_board: false, raw_pct: 70.0, effective_pct: 70.0 },
  ],
};

const WORST_STUDENTS: StudentErpRecord[] = [
  {
    prn: 'PRN-9F8E7D6C-5B4A-4C3D-8E2F-1A0B9C8D7E6F',
    full_name: 'Aleksandra Wiśniewska-Kowalczyk',
    program: 'Integrated Dual-Degree B.Tech & M.Tech in Computational Linguistics and Benachrichtigungseinstellungen',
    batch_year: 2026,
    department: 'Department of Paramètres de Confidentialité et de Sécurité',
    education_level: 'HEI',
    age_years: 17,
    is_minor: true,
    declared_cgpa: 9.123456789,
    active_backlogs: 1,
    degree_status: 'Invitation expired 12 days ago',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    disciplinary_standing: '<script>alert(1)</script> &amp; **Cleared** — Line one\nLine two',
    courses: [
      { course_code: 'CS-999-BENACHRICHTIGUNG', course_title: 'Đặng Thị Ngọc Hân Memorial Seminar on Formal Semantics & Unicode Normalization', credits: 4, grade_point: 9.5, semester: 1 },
      { course_code: 'AR-101', course_title: 'نور الهدى عبد الرحمن — Arabic & Bidirectional Script Layout', credits: 3, grade_point: 8.75, semester: 2 },
      { course_code: 'ZH-202', course_title: '王秀英 分布式一致性算法与密码学证明 (No-Space CJK Title)', credits: 4, grade_point: 10.0, semester: 3 },
      { course_code: 'XX-001', course_title: 'J', credits: 1, grade_point: 0.30000000000000004, semester: 4 },
    ],
    attendance: [
      { course_code: 'CS-999-BENACHRICHTIGUNG', course_title: 'Đặng Thị Ngọc Hân Memorial Seminar on Formal Semantics', attended_classes: 142, total_classes: 100, medical_condonation_pct: 12.5, approved_by_medical_board: true, raw_pct: 142.0, effective_pct: 142.0 },
      { course_code: 'AR-101', course_title: 'نور الهدى عبد الرحمن — Arabic & Bidirectional Layout', attended_classes: 0, total_classes: 40, medical_condonation_pct: 0, approved_by_medical_board: false, raw_pct: -3.0, effective_pct: -3.0 },
      { course_code: 'ZH-202', course_title: '王秀英 分布式一致性算法', attended_classes: 29, total_classes: 40, medical_condonation_pct: 5.0, approved_by_medical_board: true, raw_pct: 72.5, effective_pct: 77.5 },
    ],
  },
  {
    prn: '2026-JO-02',
    full_name: 'Jo',
    program: 'B.Sc Data Science',
    batch_year: 0,
    department: 'Mathematics',
    education_level: 'K12',
    age_years: 16,
    is_minor: true,
    declared_cgpa: 0,
    active_backlogs: 0,
    degree_status: 'Enrolled',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
  {
    prn: '2026-J-03',
    full_name: 'J',
    program: 'B.A.',
    batch_year: 2027,
    department: 'Arts',
    education_level: 'HEI',
    age_years: 22,
    is_minor: false,
    declared_cgpa: 10,
    active_backlogs: 12,
    degree_status: 'Suspended',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
  {
    prn: '2026-EMOJI-04',
    full_name: '👩🏽‍💻 Priya',
    program: 'B.Tech AI',
    batch_year: 2026,
    department: 'AI',
    education_level: 'HEI',
    age_years: 20,
    is_minor: false,
    declared_cgpa: 8.5,
    active_backlogs: 0,
    degree_status: 'Enrolled',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
  {
    prn: '2026-RTL-05',
    full_name: 'نور الهدى عبد الرحمن',
    program: 'M.Tech Cryptography & Privacy',
    batch_year: 2026,
    department: 'Security',
    education_level: 'HEI',
    age_years: 23,
    is_minor: false,
    declared_cgpa: 9.4,
    active_backlogs: 0,
    degree_status: 'Graduated',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
  {
    prn: '2026-CJK-06',
    full_name: '王秀英',
    program: 'B.Tech Robotics',
    batch_year: 2026,
    department: 'Robotics',
    education_level: 'HEI',
    age_years: 21,
    is_minor: false,
    declared_cgpa: 9.1,
    active_backlogs: 1,
    degree_status: 'Enrolled',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
  {
    prn: '2026-GAELIC-07',
    full_name: "Seán O'Brien-Ó Súilleabháin",
    program: 'B.Tech Civil Engineering',
    batch_year: 2025,
    department: 'Civil',
    education_level: 'HEI',
    age_years: 22,
    is_minor: false,
    declared_cgpa: 7.8,
    active_backlogs: 2,
    degree_status: 'Enrolled',
    parent_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    courses: [],
    attendance: [],
  },
];

const DEMO_FACULTY: FacultyErpRecord[] = [
  {
    faculty_id: 'FAC101',
    full_name: 'Prof. Meenakshi Iyer',
    designation: 'Professor & Head of Department',
    department: 'Computer Science & Engineering',
    biometric_days_present: 212,
    working_days_total: 220,
    sponsored_grant_inr_lakhs: 84.5,
    publications: [
      {
        doi: '10.1145/3613904.3642181',
        title: 'Formal Verification of Multi-Tenant Statutory Disclosures Using Z3 SMT Solvers',
        venue: 'ACM CCS Proceedings',
        indexing: 'Scopus / IEEE',
        year: 2025,
        faculty_id: 'FAC101',
        verified: true,
      },
      {
        doi: '10.1109/SP46215.2026.00042',
        title: 'Offline Selective-Disclosure Academic Passports Over Base45 Merkle Proofs',
        venue: 'IEEE Symposium on Security & Privacy',
        indexing: 'IEEE',
        year: 2026,
        faculty_id: 'FAC101',
        verified: true,
      },
    ],
  },
  {
    faculty_id: 'FAC104',
    full_name: 'Dr. Siddharth Kulkarni',
    designation: 'Associate Professor',
    department: 'Electronics & Communication',
    biometric_days_present: 198,
    working_days_total: 220,
    sponsored_grant_inr_lakhs: 42.0,
    publications: [
      {
        doi: '10.1007/s10703-025-00419-2',
        title: 'Conformal Calibration for Automated Institutional Compliance Auditing',
        venue: 'Formal Methods in System Design',
        indexing: 'UGC-CARE',
        year: 2025,
        faculty_id: 'FAC104',
        verified: false,
      },
    ],
  },
];

const WORST_FACULTY: FacultyErpRecord[] = [
  {
    faculty_id: 'FAC-9F8E7D6C-5B4A-4C3D',
    full_name: 'Christopher Alexander Montgomery III',
    designation: 'Senior Product Design Engineer, Platform Infrastructure & Chair of Benachrichtigungseinstellungen',
    department: 'Paramètres de confidentialité et de sécurité',
    biometric_days_present: 1284,
    working_days_total: 1284,
    sponsored_grant_inr_lakhs: 12345678.9,
    publications: [
      {
        doi: 'https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved',
        title: 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf — <script>alert(1)</script> &amp; **bold**',
        venue: 'International Conference on bartholomew.fitzgerald@northwind-industries-holdings.example.com',
        indexing: 'customer-feedback-from-enterprise-onboarding',
        year: 2026,
        faculty_id: 'FAC-9F8E7D6C-5B4A-4C3D',
        verified: true,
      },
    ],
  },
  {
    faculty_id: 'FAC-02',
    full_name: 'Đặng Thị Ngọc Hân',
    designation: 'Assistant Professor',
    department: 'Linguistics',
    biometric_days_present: 0,
    working_days_total: 220,
    sponsored_grant_inr_lakhs: 0.30000000000000004,
    publications: [
      {
        doi: '10.1000/a',
        title: 'J',
        venue: 'a@b.co',
        indexing: 'Unverified',
        year: 1970,
        faculty_id: 'FAC-02',
        verified: false,
      },
    ],
  },
  {
    faculty_id: 'FAC-03',
    full_name: '🦊 Fox',
    designation: 'Visiting Fellow',
    department: 'Design',
    biometric_days_present: 1,
    working_days_total: 1,
    sponsored_grant_inr_lakhs: -42.5,
    publications: [],
  },
  {
    faculty_id: 'FAC-04',
    full_name: '  Sam   Lee ',
    designation: '',
    department: 'CS',
    biometric_days_present: 180,
    working_days_total: 200,
    sponsored_grant_inr_lakhs: 1000000,
    publications: [],
  },
  {
    faculty_id: 'FAC-05',
    full_name: 'Ólafur Darri Ólafsson',
    designation: 'Professor',
    department: 'Nordic Studies',
    biometric_days_present: 200,
    working_days_total: 200,
    sponsored_grant_inr_lakhs: 12.5,
    publications: [],
  },
  {
    faculty_id: 'FAC-06',
    full_name: 'María José de la Cruz y Fernández',
    designation: 'Professor',
    department: 'Law',
    biometric_days_present: 195,
    working_days_total: 200,
    sponsored_grant_inr_lakhs: 5.25,
    publications: [],
  },
];

const DEMO_CONSENTS: DpdpConsentRecord[] = [
  {
    consent_id: 'consent-a1b2c3d4e5',
    student_prn: '2026CS001',
    guardian_username: 'parent_d',
    grantee_name: 'Tata Consultancy Services — Campus Hiring Desk',
    allowed_claims: ['full_name', 'program', 'batch_year', 'cgpa', 'active_backlogs'],
    purpose: 'Final-year campus placement eligibility verification for Digital cadre interviews.',
    expires_at: '2027-06-30',
    revoked: false,
    digilocker_verified: true,
    digilocker_tx_id: 'DL-VPC-2026-98412',
  },
  {
    consent_id: 'consent-f6e5d4c3b2',
    student_prn: '2026CS001',
    guardian_username: 'parent_d',
    grantee_name: 'National Merit Scholarship Portal',
    allowed_claims: ['full_name', 'program', 'cgpa'],
    purpose: 'Annual state-level engineering merit scholarship renewal.',
    expires_at: '2026-01-15',
    revoked: false,
  },
];

const LONG_2000_TEXT =
  'Pursuant to Section 9 of the Digital Personal Data Protection Act and institutional ordinance circular 2026/REG/118, this third-party verification request covers official transcript authentication, attendance condonation validation, and cross-document brochure consistency checks across academic sessions. '.repeat(
    7,
  );

const WORST_CONSENTS: DpdpConsentRecord[] = [
  {
    consent_id: 'consent-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f',
    student_prn: 'PRN-9F8E7D6C-5B4A-4C3D-8E2F-1A0B9C8D7E6F',
    guardian_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    grantee_name: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com — Global Verification & Benachrichtigungseinstellungen Desk',
    allowed_claims: ['full_name', 'program', 'batch_year', 'cgpa', 'active_backlogs', 'attendance_pct', 'degree_status', 'disciplinary_standing', 'school_name', 'board', 'udise_qc_code', 'customer-feedback-from-enterprise-onboarding'],
    purpose: `<script>alert(1)</script> &amp; **bold** — ${LONG_2000_TEXT}`,
    expires_at: '2031-12-31',
    revoked: false,
    digilocker_verified: true,
    digilocker_tx_id: 'https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved',
  },
  {
    consent_id: 'consent-expired-02',
    student_prn: '2026-JO-02',
    guardian_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    grantee_name: 'a@b.co',
    allowed_claims: ['full_name'],
    purpose: 'Line one\nLine two',
    expires_at: '2021-01-01',
    revoked: false,
  },
  {
    consent_id: 'consent-revoked-03',
    student_prn: '2026-RTL-05',
    guardian_username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    grantee_name: 'نور الهدى عبد الرحمن — International Scholarship Committee',
    allowed_claims: ['full_name', 'cgpa'],
    purpose: 'Paramètres de confidentialité et de sécurité',
    expires_at: '2030-05-01',
    revoked: true,
  },
];

const DEMO_CANONS: CanonSummary[] = [
  {
    id: 'pramaan-campus-placement',
    version: '2.4.0',
    hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f1122334455667788',
    term_count: 14,
    color_count: 2,
    fact_count: 18,
    trigger_count: 6,
    yaml: `id: pramaan-campus-placement\nversion: "2.4.0"\ntitle: Campus Placement & Career Claims\nrules:\n  - id: PLACEMENT_DENOMINATOR_TRUTH\n    severity: 90\n    require_denominator: opting_in_eligible\n  - id: CTC_MEDIAN_DOMESTIC_ONLY\n    severity: 80\n    forbid_outlier_substitution: true\n  - id: HIDDEN_PROMPT_INJECTION\n    severity: 95\n    block_microtext_pt_below: 3.0\n`,
  },
  {
    id: 'pramaan-naac-aishe-ssr',
    version: '1.9.1',
    hash: '3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f',
    term_count: 22,
    color_count: 0,
    fact_count: 31,
    trigger_count: 9,
    yaml: `id: pramaan-naac-aishe-ssr\nversion: "1.9.1"\ntitle: NAAC / AISHE Statutory Disclosure\nrules:\n  - id: CRITERION_IV_CROSSFOOT\n    severity: 95\n    tolerance_crores: 0.01\n  - id: SFR_CEILING_15_1\n    severity: 85\n    max_ratio: 15.0\n`,
  },
];

export function getBreakUiUser(mode: BreakUiMode, role: BreakUiRole): AuthUser | null {
  if (role === 'public') return null;
  if (mode === 'worst') {
    const map: Record<RoleName, AuthUser> = {
      admin: {
        id: 1,
        username: 'thisisaverylongusernamethatisallowed_registrar_northwind_2026',
        display_name: 'Aleksandra Wiśniewska-Kowalczyk',
        role: 'admin',
        tenant_id: 'northwind-industries-holdings-university-campus-01',
        linked_prn: '',
        linked_faculty_id: '',
      },
      student: {
        id: 2,
        username: 'thisisaverylongusernamethatisallowed_student',
        display_name: 'Aleksandra Wiśniewska-Kowalczyk',
        role: 'student',
        tenant_id: 'northwind-industries-holdings-university-campus-01',
        linked_prn: WORST_STUDENTS[0].prn,
        linked_faculty_id: '',
      },
      parent: {
        id: 3,
        username: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
        display_name: 'Đặng Thị Ngọc Hân — Christopher Alexander Montgomery III',
        role: 'parent',
        tenant_id: 'northwind-industries-holdings-university-campus-01',
        linked_prn: '',
        linked_faculty_id: '',
      },
      teacher: {
        id: 4,
        username: 'dana',
        display_name: '👩🏽‍💻 Priya',
        role: 'teacher',
        tenant_id: 'northwind-industries-holdings-university-campus-01',
        linked_prn: '',
        linked_faculty_id: 'FAC-9F8E7D6C-5B4A-4C3D',
      },
      recruiter: {
        id: 5,
        username: 'a',
        display_name: '🦊 Fox',
        role: 'recruiter',
        tenant_id: 'northwind-industries-holdings-university-campus-01',
        linked_prn: '',
        linked_faculty_id: '',
      },
    };
    return map[role];
  }

  const demoMap: Record<RoleName, AuthUser> = {
    admin: {
      id: 1,
      username: 'reg_admin',
      display_name: 'Dr. Vikramaditya Rao',
      role: 'admin',
      tenant_id: 'pramaan-univ',
      linked_prn: '',
      linked_faculty_id: '',
    },
    student: {
      id: 2,
      username: 'stu_aarav',
      display_name: 'Aarav Deshmukh',
      role: 'student',
      tenant_id: 'pramaan-univ',
      linked_prn: '2026CS001',
      linked_faculty_id: '',
    },
    parent: {
      id: 3,
      username: 'parent_d',
      display_name: 'Rajesh Deshmukh',
      role: 'parent',
      tenant_id: 'pramaan-univ',
      linked_prn: '',
      linked_faculty_id: '',
    },
    teacher: {
      id: 4,
      username: 'prof_iyer',
      display_name: 'Prof. Meenakshi Iyer',
      role: 'teacher',
      tenant_id: 'pramaan-univ',
      linked_prn: '',
      linked_faculty_id: 'FAC101',
    },
    recruiter: {
      id: 5,
      username: 'rec_tcs',
      display_name: 'Ananya Krishnan',
      role: 'recruiter',
      tenant_id: 'pramaan-univ',
      linked_prn: '',
      linked_faculty_id: '',
    },
  };
  return demoMap[role];
}

export function buildAdminData(mode: BreakUiMode): AdminInstitutionalData {
  if (mode === 'empty') {
    return {
      metrics: null,
      placement: null,
      z3_proofs: null,
      k12_disclosure: null,
      z3_k12_proofs: null,
      k12_qc_report: null,
      revocations_count: 0,
      students_count: 0,
      faculty_count: 0,
    };
  }
  if (mode === 'one') {
    return {
      metrics: {
        academic_year: 'AY 2026-27',
        fiscal_year: 'FY 2026-27',
        naac_grade: 'A',
        naac_cycle_valid_until: '2030-06-30',
        enrolled_learners: 1,
        regular_faculty_count: 1,
        criterion4_infra_spend_crores: 1.0,
        budget_heads: { smart_labs_upgradation: 1.0 },
        min_attendance_pct: 75,
        max_medical_condonation_pct: 10,
        cgpa_exemption_threshold: 9.0,
      },
      placement: {
        academic_year: 'AY 2025-26',
        department: 'Computer Science',
        batch_total: 1,
        opting_in_eligible: 1,
        placed_students: 1,
        highest_ctc_lakhs: 14.0,
        median_ctc_lakhs: 14.0,
        top_recruiters: ['TCS'],
      },
      z3_proofs: {
        criterion4_heads_sum_crores: 1.0,
        criterion4_declared_crores: 1.0,
        criterion4_balanced: true,
        computed_sfr: 1.0,
        sfr_within_15_to_1: true,
        total_faculty_grants_lakhs: 1.0,
      },
      k12_disclosure: {
        ...DEMO_K12,
        enrolled_students: 1,
        sections_count: 1,
        max_section_size: 1,
        classroom_count: 1,
        core_teaching_staff: 1,
        appendix_ix_certificates: [DEMO_CERTS[0]],
      },
      z3_k12_proofs: {
        computed_ptr: 1.0,
        avg_section_size: 1.0,
        sqm_per_student: 50.17,
        classroom_area_sqft: 540,
        all_compliant: true,
        solver_id: 'Z3-4.13',
        ptr_within_30_to_1: true,
        section_cap_within_40: true,
        classroom_area_min_500_sqft: true,
        floor_space_min_1_sqm: true,
      },
      k12_qc_report: {
        seed_id: 1,
        macro_prior_source: 'CBSE Appendix IX',
        passed_all_gates: true,
        validated_at: '2026-11-24T09:00:00Z',
        gates: [{ gate_id: 'GATE-1', name: 'Statutory Certificates', passed: true, detail: '1 verified certificate.' }],
      },
      revocations_count: 1,
      students_count: 1,
      faculty_count: 1,
    };
  }
  if (mode === 'worst') {
    return {
      metrics: {
        academic_year: 'AY 2026-27 (Provisional Statutory Reconciliation Cycle)',
        fiscal_year: 'FY 2026-27',
        naac_grade: 'A++ (Pending Appeal)',
        naac_cycle_valid_until: '2025-12-31T23:30:00-08:00',
        enrolled_learners: 1000000,
        regular_faculty_count: 1284,
        criterion4_infra_spend_crores: 12345678.9,
        budget_heads: {
          'customer-feedback-from-enterprise-onboarding-benachrichtigungseinstellungen': 9876543.21,
          'smart_labs_upgradation_paramètres_de_confidentialité': 2469135.69,
          'floating_point_drift_check': 0.30000000000000004,
          '<script>alert(1)</script>_&amp;_**bold**': 1284,
        },
        min_attendance_pct: 75,
        max_medical_condonation_pct: 10,
        cgpa_exemption_threshold: 9.0,
      },
      placement: {
        academic_year: 'AY 2025-26',
        department: 'Interdisciplinary Computer Science & Benachrichtigungseinstellungen',
        batch_total: 12840,
        opting_in_eligible: 9420,
        placed_students: 6102,
        highest_ctc_lakhs: 9850.75,
        median_ctc_lakhs: 14.300000000000001,
        top_recruiters: [
          'Northwind Industries Holdings International Pvt. Ltd.',
          'customer-feedback-from-enterprise-onboarding',
          'Benachrichtigungseinstellungen GmbH',
          'Đặng Thị Ngọc Hân Research Labs',
          'نور الهدى عبد الرحمن Technologies',
          '王秀英 Semiconductor Corp',
          '<script>alert(1)</script>',
          'Tata Consultancy Services',
          'Infosys',
          'Wipro',
          'Atlassian',
          'Stripe',
          'Linear',
          'Figma',
        ],
      },
      z3_proofs: {
        criterion4_heads_sum_crores: 12346962.9,
        criterion4_declared_crores: 12345678.9,
        criterion4_balanced: false,
        computed_sfr: 778.82,
        sfr_within_15_to_1: false,
        total_faculty_grants_lakhs: 12345678.9,
      },
      k12_disclosure: WORST_K12,
      z3_k12_proofs: {
        computed_ptr: 41.15,
        avg_section_size: 50.0,
        sqm_per_student: 0.74,
        classroom_area_sqft: 412.5,
        all_compliant: false,
        unsat_core: ['PTR > 30:1', 'max_section_size > 40', 'classroom_area_sqft < 500', 'sqm_per_student < 1.0'],
        solver_id: 'Z3-4.13.0-SMT',
        ptr_within_30_to_1: false,
        section_cap_within_40: false,
        classroom_area_min_500_sqft: false,
        floor_space_min_1_sqm: false,
      },
      k12_qc_report: {
        seed_id: 99,
        macro_prior_source: 'CBSE Affiliation Bye-Laws Chapter 4 Clause 4.1 & Appendix IX',
        passed_all_gates: false,
        validated_at: '1970-01-01T00:00:00Z',
        gates: [
          { gate_id: 'GATE-1', name: 'Appendix IX Mandatory Certificates', passed: false, detail: '4 of 5 certificates expired, revoked, or malformed (<script>alert(1)</script>).' },
          { gate_id: 'GATE-2', name: 'CBSE Clause 4.1 Physical Norms', passed: false, detail: 'PTR 41.15:1 exceeds 30:1; room area 412.5 sq ft below 500 sq ft minimum.' },
        ],
      },
      revocations_count: 1000000,
      students_count: 1000000,
      faculty_count: 1284,
    };
  }
  if (mode === 'huge') {
    const budgetHeads: Record<string, number> = {};
    for (let i = 1; i <= 120; i += 1) {
      budgetHeads[`capital_infrastructure_head_${String(i).padStart(3, '0')}`] = Number((1.25 + (i % 7) * 0.35).toFixed(2));
    }
    return {
      ...buildAdminData('demo'),
      metrics: {
        ...buildAdminData('demo').metrics!,
        enrolled_learners: 48500,
        regular_faculty_count: 3420,
        criterion4_infra_spend_crores: 285.4,
        budget_heads: budgetHeads,
      },
      revocations_count: 1284,
      students_count: 48500,
      faculty_count: 3420,
    };
  }
  return {
    metrics: {
      academic_year: 'AY 2026-27',
      fiscal_year: 'FY 2026-27',
      naac_grade: 'A+',
      naac_cycle_valid_until: '2030-06-30',
      enrolled_learners: 3200,
      regular_faculty_count: 220,
      criterion4_infra_spend_crores: 18.5,
      budget_heads: {
        smart_labs_upgradation: 10.5,
        library_ejournals_ieee_acm: 5.0,
        campus_wifi_6_backbone: 3.0,
      },
      min_attendance_pct: 75,
      max_medical_condonation_pct: 10,
      cgpa_exemption_threshold: 9.0,
    },
    placement: {
      academic_year: 'AY 2025-26',
      department: 'Computer Science & Engineering',
      batch_total: 420,
      opting_in_eligible: 360,
      placed_students: 298,
      highest_ctc_lakhs: 38.5,
      median_ctc_lakhs: 11.4,
      top_recruiters: ['Tata Consultancy Services', 'Infosys', 'Zoho', 'Razorpay', 'Atlassian'],
    },
    z3_proofs: {
      criterion4_heads_sum_crores: 18.5,
      criterion4_declared_crores: 18.5,
      criterion4_balanced: true,
      computed_sfr: 14.55,
      sfr_within_15_to_1: true,
      total_faculty_grants_lakhs: 126.5,
    },
    k12_disclosure: DEMO_K12,
    z3_k12_proofs: {
      computed_ptr: 23.33,
      avg_section_size: 35.0,
      sqm_per_student: 1.32,
      classroom_area_sqft: 540,
      all_compliant: true,
      solver_id: 'Z3-4.13.0',
      ptr_within_30_to_1: true,
      section_cap_within_40: true,
      classroom_area_min_500_sqft: true,
      floor_space_min_1_sqm: true,
    },
    k12_qc_report: {
      seed_id: 1,
      macro_prior_source: 'CBSE Mandatory Disclosure Appendix IX & UDISE+ DCF',
      passed_all_gates: true,
      validated_at: '2026-11-24T09:15:00Z',
      gates: [
        { gate_id: 'GATE-1', name: 'Appendix IX Section B Certificates', passed: true, detail: 'All 8 mandatory certificates verified & current.' },
        { gate_id: 'GATE-2', name: 'CBSE Clause 4.1 Physical Norms', passed: true, detail: 'PTR 23.33:1 ≤ 30:1, max section 38 ≤ 40, room 540 sq ft ≥ 500 sq ft.' },
        { gate_id: 'GATE-3', name: 'UDISE+ & Staff Conservation', passed: true, detail: 'PGT/TGT/PRT breakdown reconciles with 54 core teachers.' },
        { gate_id: 'GATE-4', name: 'DPDP Minor Privacy Guard', passed: true, detail: 'No raw Aadhaar/PAN identifiers present in disclosure.' },
      ],
    },
    revocations_count: 2,
    students_count: 3200,
    faculty_count: 220,
  };
}

export function buildStudentData(mode: BreakUiMode): StudentPortalData {
  if (mode === 'empty') {
    return {
      student: null,
      z3_cgpa_proof: null,
      consents: [],
      minor_consent_locked: false,
      placement_benchmark: null,
      school_benchmark: null,
      z3_k12_proofs: null,
      k12_qc_report: null,
      issued_passports: [],
      attendance_policy: { min_attendance_pct: 75, max_medical_condonation_pct: 10, cgpa_exemption_threshold: null, student_exempt_by_cgpa: false },
    };
  }
  if (mode === 'one') {
    const oneStu: StudentErpRecord = {
      ...DEMO_STUDENT,
      active_backlogs: 1,
      courses: [DEMO_STUDENT.courses[0]],
      attendance: [DEMO_STUDENT.attendance[0]],
    };
    return {
      student: oneStu,
      z3_cgpa_proof: { verified: true, declared_cgpa: 8.94, weighted_exact_cgpa: 8.94, solver_id: 'Z3-4.13' },
      consents: [DEMO_CONSENTS[0]],
      minor_consent_locked: false,
      placement_benchmark: buildAdminData('one').placement,
      issued_passports: [
        {
          passport_id: 'pass-0001-abcd',
          grantee_name: 'TCS',
          issued_at: '2026-11-24T09:10:00Z',
          revoked: false,
          revoked_reason: '',
          revoked_at: '',
        },
      ],
      attendance_policy: { min_attendance_pct: 75, max_medical_condonation_pct: 10, cgpa_exemption_threshold: 9.0, student_exempt_by_cgpa: false },
    };
  }
  if (mode === 'worst') {
    return {
      student: WORST_STUDENTS[0],
      z3_cgpa_proof: {
        verified: false,
        declared_cgpa: 9.123456789,
        weighted_exact_cgpa: 8.41,
        solver_id: 'Z3-4.13.0-SMT',
      },
      consents: WORST_CONSENTS,
      minor_consent_locked: false,
      placement_benchmark: buildAdminData('worst').placement,
      school_benchmark: WORST_K12,
      z3_k12_proofs: buildAdminData('worst').z3_k12_proofs,
      k12_qc_report: buildAdminData('worst').k12_qc_report,
      issued_passports: [
        {
          passport_id: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f',
          grantee_name: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com — Benachrichtigungseinstellungen',
          issued_at: '2025-12-31T23:30:00-08:00',
          revoked: false,
          revoked_reason: '',
          revoked_at: '',
        },
        {
          passport_id: 'pass-revoked-epoch',
          grantee_name: 'a@b.co',
          issued_at: '1970-01-01T00:00:00Z',
          revoked: true,
          revoked_reason: '<script>alert(1)</script> &amp; **Superseded**',
          revoked_at: '2026-11-24T08:00:00Z',
        },
      ],
      attendance_policy: {
        min_attendance_pct: 75,
        max_medical_condonation_pct: 10,
        cgpa_exemption_threshold: 9.0,
        student_exempt_by_cgpa: true,
      },
    };
  }
  if (mode === 'huge') {
    const issued: IssuedPassportSummary[] = Array.from({ length: 1000 }, (_, i) => ({
      passport_id: `pass-2026-${String(i + 1).padStart(5, '0')}-9f8e7d6c`,
      grantee_name: i % 3 === 0 ? 'Northwind Campus Hiring Desk' : i % 3 === 1 ? 'National Merit Scholarship Board' : 'Global Verification Consortium',
      issued_at: new Date(Date.UTC(2026, 10, 24, 9, 0) - i * 3600_000).toISOString(),
      revoked: i % 11 === 0,
      revoked_reason: i % 11 === 0 ? 'Superseded by updated semester transcript' : '',
      revoked_at: i % 11 === 0 ? '2026-11-24T10:00:00Z' : '',
    }));
    const courses = Array.from({ length: 120 }, (_, i) => ({
      course_code: `CS${101 + i}`,
      course_title: `Core Computer Science Module ${i + 1}`,
      credits: 3 + (i % 2),
      grade_point: Number((7.5 + (i % 5) * 0.5).toFixed(2)),
      semester: (i % 8) + 1,
    }));
    const attendance = Array.from({ length: 120 }, (_, i) => ({
      course_code: `CS${101 + i}`,
      course_title: `Core Computer Science Module ${i + 1}`,
      attended_classes: 30 + (i % 12),
      total_classes: 44,
      medical_condonation_pct: i % 4 === 0 ? 5 : 0,
      approved_by_medical_board: i % 4 === 0,
      raw_pct: Number((((30 + (i % 12)) / 44) * 100).toFixed(1)),
      effective_pct: Number((Math.min(100, ((30 + (i % 12)) / 44) * 100 + (i % 4 === 0 ? 5 : 0))).toFixed(1)),
    }));
    return {
      ...buildStudentData('demo'),
      student: { ...DEMO_STUDENT, courses, attendance },
      issued_passports: issued,
    };
  }
  return {
    student: DEMO_STUDENT,
    z3_cgpa_proof: { verified: true, declared_cgpa: 8.94, weighted_exact_cgpa: 8.94, solver_id: 'Z3-4.13.0' },
    consents: DEMO_CONSENTS,
    minor_consent_locked: false,
    placement_benchmark: buildAdminData('demo').placement,
    school_benchmark: null,
    z3_k12_proofs: null,
    k12_qc_report: null,
    issued_passports: [
      {
        passport_id: 'prm-2026-a8f4c190b32e',
        grantee_name: 'Tata Consultancy Services — Campus Hiring Desk',
        issued_at: '2026-11-24T08:45:00Z',
        revoked: false,
        revoked_reason: '',
        revoked_at: '',
      },
    ],
    attendance_policy: {
      min_attendance_pct: 75,
      max_medical_condonation_pct: 10,
      cgpa_exemption_threshold: 9.0,
      student_exempt_by_cgpa: false,
    },
  };
}

export function buildParentData(mode: BreakUiMode): ParentPortalData {
  if (mode === 'empty') {
    return {
      guardian: 'Rajesh Deshmukh',
      digilocker_configured: false,
      children: [],
      consents: [],
      placement_truth: null,
      school_disclosure: null,
      k12_qc_report: null,
      brochure_vs_erp_discrepancy: null,
    };
  }
  if (mode === 'one') {
    return {
      guardian: 'Rajesh Deshmukh',
      digilocker_configured: false,
      children: [DEMO_STUDENT],
      consents: [DEMO_CONSENTS[0]],
      placement_truth: buildAdminData('one').placement,
      school_disclosure: null,
      k12_qc_report: null,
      brochure_vs_erp_discrepancy: null,
    };
  }
  if (mode === 'worst') {
    return {
      guardian: 'Đặng Thị Ngọc Hân — Christopher Alexander Montgomery III (bartholomew.fitzgerald@northwind-industries-holdings.example.com)',
      digilocker_configured: true,
      children: WORST_STUDENTS,
      consents: WORST_CONSENTS,
      placement_truth: buildAdminData('worst').placement,
      school_disclosure: WORST_K12,
      k12_qc_report: buildAdminData('worst').k12_qc_report,
      brochure_vs_erp_discrepancy: {
        brochure_claim: '100% guaranteed campus placement with Rs. 99.95 Lakhs average package across all departments — <script>alert(1)</script> &amp; **bold**',
        brochure_filename: 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf',
        erp_verified: '64.8% placed (6,102/9,420 opting-in of 12,840 batch), median domestic CTC Rs. 14.30 Lakhs',
      },
    };
  }
  if (mode === 'huge') {
    const children: StudentErpRecord[] = Array.from({ length: 120 }, (_, i) => ({
      ...DEMO_STUDENT,
      prn: `2026WARD${String(i + 1).padStart(4, '0')}`,
      full_name: `Student Ward ${i + 1} Deshmukh`,
      is_minor: i % 3 === 0,
      age_years: i % 3 === 0 ? 16 : 20,
    }));
    const consents: DpdpConsentRecord[] = Array.from({ length: 1000 }, (_, i) => ({
      consent_id: `consent-huge-${String(i + 1).padStart(4, '0')}`,
      student_prn: children[i % children.length].prn,
      guardian_username: 'parent_d',
      grantee_name: `Verifier Organization #${i + 1}`,
      allowed_claims: ['full_name', 'program', 'cgpa'],
      purpose: `Automated scholarship & campus verification audit #${i + 1}`,
      expires_at: i % 5 === 0 ? '2024-01-01' : '2028-12-31',
      revoked: i % 7 === 0,
    }));
    return {
      ...buildParentData('demo'),
      children,
      consents,
    };
  }
  return {
    guardian: 'Rajesh Deshmukh',
    digilocker_configured: false,
    children: [
      DEMO_STUDENT,
      {
        ...DEMO_STUDENT,
        prn: '2026K12042',
        full_name: 'Anika Deshmukh',
        program: 'Class XI — Science (CBSE)',
        education_level: 'K12',
        age_years: 16,
        is_minor: true,
        declared_cgpa: 9.4,
        active_backlogs: 0,
        courses: DEMO_STUDENT.courses.slice(0, 2),
      },
    ],
    consents: DEMO_CONSENTS,
    placement_truth: buildAdminData('demo').placement,
    school_disclosure: DEMO_K12,
    k12_qc_report: buildAdminData('demo').k12_qc_report,
    brochure_vs_erp_discrepancy: {
      brochure_claim: '99.4% placement rate with Rs. 24.00 Lakhs average CSE package in AY 2025-26.',
      brochure_filename: 'Admissions_Prospectus_2026.pdf',
      erp_verified: '82.8% placed (298/360 opting-in of 420 batch), median domestic CTC Rs. 11.40 Lakhs',
    },
  };
}

export function buildTeacherData(mode: BreakUiMode): TeacherPortalData {
  if (mode === 'empty') {
    return { faculty: [], students: [], min_attendance_pct: 75, max_medical_condonation_pct: 10, cgpa_exemption_threshold: null };
  }
  if (mode === 'one') {
    return {
      faculty: [{ ...DEMO_FACULTY[0], publications: [DEMO_FACULTY[0].publications[0]] }],
      students: [{ ...DEMO_STUDENT, attendance: [DEMO_STUDENT.attendance[0]] }],
      min_attendance_pct: 75,
      max_medical_condonation_pct: 10,
      cgpa_exemption_threshold: 9.0,
    };
  }
  if (mode === 'worst') {
    return {
      faculty: WORST_FACULTY,
      students: WORST_STUDENTS,
      min_attendance_pct: 75,
      max_medical_condonation_pct: 10,
      cgpa_exemption_threshold: 9.0,
    };
  }
  if (mode === 'huge') {
    const faculty = Array.from({ length: 1000 }, (_, i) => ({
      ...DEMO_FACULTY[i % DEMO_FACULTY.length],
      faculty_id: `FAC${String(i + 1).padStart(4, '0')}`,
      full_name: `Prof. Faculty Member ${i + 1}`,
      publications:
        i < 200
          ? [
              {
                doi: `10.1145/2026.${String(i + 1).padStart(5, '0')}`,
                title: `Verified Statutory Compliance Paper #${i + 1}`,
                venue: 'IEEE Transactions on Dependable Systems',
                indexing: i % 2 === 0 ? 'IEEE' : 'Scopus',
                year: 2025 + (i % 2),
                faculty_id: `FAC${String(i + 1).padStart(4, '0')}`,
                verified: i % 3 !== 0,
              },
            ]
          : [],
    }));
    const students = Array.from({ length: 1000 }, (_, i) => ({
      ...DEMO_STUDENT,
      prn: `2026CS${String(i + 1).padStart(4, '0')}`,
      full_name: `Student Learner ${i + 1}`,
    }));
    return {
      faculty,
      students,
      min_attendance_pct: 75,
      max_medical_condonation_pct: 10,
      cgpa_exemption_threshold: 9.0,
    };
  }
  return {
    faculty: DEMO_FACULTY,
    students: [DEMO_STUDENT],
    min_attendance_pct: 75,
    max_medical_condonation_pct: 10,
    cgpa_exemption_threshold: 9.0,
  };
}

export function buildRevocations(mode: BreakUiMode): { revocations: RevocationEntry[] } {
  if (mode === 'empty') return { revocations: [] };
  if (mode === 'one') {
    return {
      revocations: [
        {
          passport_id: 'prm-2026-rev-0001',
          reason: 'Student re-issued updated pass after Semester 6 result',
          revoked_at: '2026-11-24T09:00:00Z',
        },
      ],
    };
  }
  if (mode === 'worst') {
    return {
      revocations: [
        {
          passport_id: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f-super-long-passport-identifier-2026',
          reason: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com — <script>alert(1)</script> &amp; **bold** — Benachrichtigungseinstellungen',
          revoked_at: '2025-12-31T23:30:00-08:00',
        },
        {
          passport_id: 'a',
          reason: '',
          revoked_at: '1970-01-01T00:00:00Z',
        },
      ],
    };
  }
  if (mode === 'huge') {
    return {
      revocations: Array.from({ length: 1000 }, (_, i) => ({
        passport_id: `prm-2026-rev-${String(i + 1).padStart(5, '0')}-9f8e7d6c`,
        reason: `Revoked by student or registrar audit batch #${i + 1}`,
        revoked_at: new Date(Date.UTC(2026, 10, 24, 9, 0) - i * 600_000).toISOString(),
      })),
    };
  }
  return {
    revocations: [
      {
        passport_id: 'prm-2026-7c1d9e4012ab',
        reason: 'Superseded by Semester 6 transcript update',
        revoked_at: '2026-11-23T14:20:00Z',
      },
      {
        passport_id: 'prm-2026-4f2a8b1930cd',
        reason: 'Guardian revoked minor consent scope',
        revoked_at: '2026-11-22T11:05:00Z',
      },
    ],
  };
}

export function buildSubmissions(mode: BreakUiMode): Submission[] {
  if (mode === 'empty') return [];
  if (mode === 'one') {
    return [
      {
        id: 1,
        title: 'AY 2026-27 Placement Brochure Draft',
        status: 'draft',
        portal_scope: 'admin',
        content_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        canon_id: 'pramaan-campus-placement',
        canon_hash: '9f8e7d6c5b4a4c3d',
        creator_id: 1,
        raw_content: 'Our Computer Science department achieved 82.8% placement with Rs. 11.40 Lakhs median domestic CTC.',
        paragraph_node_ids: ['p-0'],
        text_blocks: ['Our Computer Science department achieved 82.8% placement with Rs. 11.40 Lakhs median domestic CTC.'],
        created_at: '2026-11-24T08:00:00Z',
        updated_at: '2026-11-24T09:30:00Z',
      },
    ];
  }
  if (mode === 'worst') {
    return [
      {
        id: 101,
        title: 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf — Aleksandra Wiśniewska-Kowalczyk & Benachrichtigungseinstellungen',
        status: 'changes_requested',
        portal_scope: 'admin',
        content_hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
        canon_id: 'pramaan-campus-placement-benachrichtigungseinstellungen-v12',
        canon_hash: '9f8e7d6c5b4a4c3d',
        creator_id: 1,
        raw_content: `<script>alert(1)</script> &amp; **100% Placement Guarantee** — Contact bartholomew.fitzgerald@northwind-industries-holdings.example.com or https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved\n\nĐặng Thị Ngọc Hân · نور الهدى عبد الرحمن · 王秀英 — ${LONG_2000_TEXT}`,
        paragraph_node_ids: ['p-0', 'p-1'],
        text_blocks: ['<script>alert(1)</script>', 'Đặng Thị Ngọc Hân'],
        c2pa_manifest: {
          manifest_id: 'urn:c2pa:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f-super-long-seal',
          submission_id: 101,
          content_hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
          canon_id: 'pramaan-campus-placement-benachrichtigungseinstellungen-v12',
          canon_hash: '9f8e7d6c5b4a4c3d',
          issuer: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com — Registrar Office',
          issued_at: '2025-12-31T23:30:00-08:00',
          audit_chain_tip_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          chain_verified: true,
          algorithm: 'Ed25519 + SHA-256 Merkle Seal',
          signature_b64: 'AAAABBBBCCCC',
          public_key_pem: '-----BEGIN PUBLIC KEY-----',
        },
        created_at: '1970-01-01T00:00:00Z',
        updated_at: '2025-12-31T23:30:00-08:00',
      },
      {
        id: 102,
        title: 'J',
        status: 'published',
        portal_scope: 'admin',
        content_hash: 'bbbb2222',
        canon_id: 'pramaan-naac-aishe-ssr',
        canon_hash: '3a4b5c6d',
        creator_id: 1,
        raw_content: 'Short draft.',
        paragraph_node_ids: ['p-0'],
        text_blocks: ['Short draft.'],
        created_at: '2026-11-24T08:00:00Z',
        updated_at: '2026-11-24T08:00:00Z',
      },
      {
        id: 103,
        title: '   ',
        status: 'in_review',
        portal_scope: 'admin',
        content_hash: 'cccc3333',
        canon_id: 'pramaan-campus-placement',
        canon_hash: '9f8e7d6c',
        creator_id: 1,
        raw_content: '',
        paragraph_node_ids: [],
        text_blocks: [],
        created_at: '2026-11-24T08:00:00Z',
        updated_at: '2026-11-24T08:00:00Z',
      },
    ];
  }
  if (mode === 'huge') {
    return Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      title: `Statutory Prospectus & Ordinance Filing Draft #${i + 1}`,
      status: (['draft', 'in_review', 'changes_requested', 'approved', 'published'] as const)[i % 5],
      portal_scope: 'admin',
      content_hash: `hash${String(i + 1).padStart(12, '0')}abcdef123456`,
      canon_id: 'pramaan-campus-placement',
      canon_hash: '9f8e7d6c5b4a4c3d',
      creator_id: 1,
      raw_content: `Draft #${i + 1}: Verified institutional disclosure paragraph with 82.8% placement rate and ₹18.50 Cr infrastructure spend.`,
      paragraph_node_ids: ['p-0'],
      text_blocks: [`Draft #${i + 1}`],
      created_at: '2026-11-24T08:00:00Z',
      updated_at: '2026-11-24T09:00:00Z',
    }));
  }
  return [
    {
      id: 1,
      title: 'Admissions Prospectus — AY 2026-27 (CSE & Placement Highlights)',
      status: 'draft',
      portal_scope: 'admin',
      content_hash: '8e2f1a0b9c8d7e6f1122334455667788',
      canon_id: 'pramaan-campus-placement',
      canon_hash: '9f8e7d6c5b4a4c3d',
      creator_id: 1,
      raw_content:
        'Our B.Tech Computer Science cohort achieved 99.4% placement in AY 2025-26 with an average domestic package of Rs. 24.00 Lakhs.\n\nTotal NAAC Criterion IV infrastructure expenditure stood at Rs. 18.50 Crores across Smart Labs, Library e-Journals, and Campus Wi-Fi 6.',
      paragraph_node_ids: ['p-0', 'p-1'],
      text_blocks: [
        'Our B.Tech Computer Science cohort achieved 99.4% placement in AY 2025-26 with an average domestic package of Rs. 24.00 Lakhs.',
        'Total NAAC Criterion IV infrastructure expenditure stood at Rs. 18.50 Crores across Smart Labs, Library e-Journals, and Campus Wi-Fi 6.',
      ],
      created_at: '2026-11-24T08:15:00Z',
      updated_at: '2026-11-24T09:42:00Z',
    },
    {
      id: 2,
      title: 'NAAC SSR Criterion IV Audited Expenditure Note',
      status: 'published',
      portal_scope: 'admin',
      content_hash: '4c3d8e2f1a0b9c8d7e6f5a4b3c2d1e0f',
      canon_id: 'pramaan-naac-aishe-ssr',
      canon_hash: '3a4b5c6d7e8f9a0b',
      creator_id: 1,
      raw_content: 'Criterion IV capital expenditure totals Rs. 18.50 Crores and reconciles exactly across three audited budget heads.',
      paragraph_node_ids: ['p-0'],
      text_blocks: ['Criterion IV capital expenditure totals Rs. 18.50 Crores and reconciles exactly across three audited budget heads.'],
      created_at: '2026-11-20T10:00:00Z',
      updated_at: '2026-11-22T15:30:00Z',
    },
  ];
}

export function buildFindings(mode: BreakUiMode): FindingRow[] {
  if (mode === 'empty') return [];
  const demoFindings: FindingRow[] = [
    {
      row_id: 1,
      finding_id: 'f-placement-01',
      check_id: 'claim_algebra_z3',
      node_id: 'p-0',
      severity: 90,
      message: 'Declared placement rate (99.4%) exceeds audited ERP opting-in placement rate (82.8%, 298 of 360 eligible students).',
      resolution: 'open',
      resolution_reason: '',
      payload: {
        id: 'f-placement-01',
        check_id: 'claim_algebra_z3',
        severity: 90,
        message: 'Declared placement rate (99.4%) exceeds audited ERP opting-in placement rate (82.8%, 298 of 360 eligible students).',
        node_id: 'p-0',
        rule: { rule_id: 'PLACEMENT_DENOMINATOR_TRUTH', rule_type: 'smt_invariant' },
        trace: { check_id: 'claim_algebra_z3', tier: 'tier_1_5_smt', canon_id: 'pramaan-campus-placement', canon_hash: '9f8e7d6c', latency_ms: 14 },
        locator: { kind: 'span', start: 44, end: 59 },
        evidence: { claimed: 99.4, verified: 82.8 },
        suggestion: {
          summary: 'Replace "99.4% placement" with "82.8% placement (298 of 360 opting-in students)".',
          patch: { kind: 'replace', start: 44, end: 59, new_text: '82.8% placement (298 of 360 opting-in students)' },
        },
      },
    },
    {
      row_id: 2,
      finding_id: 'f-ctc-02',
      check_id: 'claim_algebra_z3',
      node_id: 'p-0',
      severity: 40,
      message: 'Quoted compensation figure (Rs. 24.00 Lakhs) differs from audited median domestic CTC (Rs. 11.40 Lakhs).',
      resolution: 'open',
      resolution_reason: '',
      payload: {
        id: 'f-ctc-02',
        check_id: 'claim_algebra_z3',
        severity: 40,
        message: 'Quoted compensation figure (Rs. 24.00 Lakhs) differs from audited median domestic CTC (Rs. 11.40 Lakhs).',
        node_id: 'p-0',
        rule: { rule_id: 'CTC_MEDIAN_DOMESTIC_ONLY', rule_type: 'statutory_term' },
        trace: { check_id: 'claim_algebra_z3', tier: 'tier_2_conformal', canon_id: 'pramaan-campus-placement', canon_hash: '9f8e7d6c', latency_ms: 28 },
        locator: { kind: 'span', start: 98, end: 114 },
        evidence: {},
        suggestion: { summary: 'Clarify median domestic CTC as Rs. 11.40 Lakhs alongside highest offer Rs. 38.50 Lakhs.' },
      },
    },
  ];
  if (mode === 'one') return [demoFindings[0]];
  if (mode === 'worst') {
    return [
      {
        ...demoFindings[0],
        message: `<script>alert(1)</script> &amp; **bold** — bartholomew.fitzgerald@northwind-industries-holdings.example.com — ${LONG_2000_TEXT}`,
        payload: {
          ...demoFindings[0].payload,
          rule: { rule_id: 'RULE_BENACHRICHTIGUNGSEINSTELLUNGEN_SUPER_LONG_STATUTORY_CODE_2026', rule_type: 'smt_invariant' },
          suggestion: {
            summary: 'Replace with https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved',
            patch: demoFindings[0].payload.suggestion?.patch ?? null,
          },
        },
      },
      { ...demoFindings[1], resolution: 'accepted' },
      { ...demoFindings[1], row_id: 3, finding_id: 'f-3', resolution: 'dismissed' },
      { ...demoFindings[1], row_id: 4, finding_id: 'f-4', resolution: 'overridden' },
    ];
  }
  if (mode === 'huge') {
    return Array.from({ length: 1000 }, (_, i) => ({
      ...demoFindings[i % 2],
      row_id: i + 1,
      finding_id: `f-huge-${i + 1}`,
      severity: i % 3 === 0 ? 90 : 35,
      resolution: i % 5 === 0 ? 'accepted' : 'open',
      message: `Compliance finding #${i + 1}: Verify institutional figure reconciliation against audited ERP ledger.`,
    }));
  }
  return demoFindings;
}

export function buildVersions(mode: BreakUiMode): SubmissionVersion[] {
  if (mode === 'empty') return [];
  if (mode === 'one') {
    return [
      {
        version_number: 1,
        content_hash: '8e2f1a0b9c8d7e6f11223344',
        canon_hash: '9f8e7d6c',
        raw_content: 'Initial draft.',
        change_note: 'Initial draft',
        created_at: '2026-11-24T08:15:00Z',
      },
    ];
  }
  if (mode === 'huge') {
    return Array.from({ length: 120 }, (_, i) => ({
      version_number: 120 - i,
      content_hash: `rev${String(120 - i).padStart(6, '0')}9f8e7d6c5b4a`,
      canon_hash: '9f8e7d6c',
      raw_content: 'Snapshot',
      change_note: `Automated compliance revision #${120 - i}`,
      created_at: new Date(Date.UTC(2026, 10, 24, 9, 0) - i * 3600_000).toISOString(),
    }));
  }
  return [
    {
      version_number: 2,
      content_hash: '8e2f1a0b9c8d7e6f11223344',
      canon_hash: '9f8e7d6c',
      raw_content: 'Updated draft.',
      change_note: mode === 'worst' ? 'Benachrichtigungseinstellungen — <script>alert(1)</script>' : 'Added Criterion IV expenditure paragraph',
      created_at: mode === 'worst' ? '2025-12-31T23:30:00-08:00' : '2026-11-24T09:42:00Z',
    },
    {
      version_number: 1,
      content_hash: '11223344556677889900aabb',
      canon_hash: '9f8e7d6c',
      raw_content: 'Initial draft.',
      change_note: 'Initial prospectus import',
      created_at: mode === 'worst' ? '1970-01-01T00:00:00Z' : '2026-11-24T08:15:00Z',
    },
  ];
}

export function buildComments(mode: BreakUiMode): SubmissionComment[] {
  if (mode === 'empty') return [];
  if (mode === 'one') {
    return [
      {
        id: 1,
        submission_id: 1,
        finding_id: null,
        author_name: 'Dr. Vikramaditya Rao',
        role: 'admin',
        body: 'Please align placement denominator with the audited Placement Cell register before submission.',
        created_at: '2026-11-24T09:50:00Z',
      },
    ];
  }
  if (mode === 'worst') {
    return [
      {
        id: 1,
        submission_id: 101,
        finding_id: null,
        author_name: 'Aleksandra Wiśniewska-Kowalczyk',
        role: 'admin',
        body: `<script>alert(1)</script> &amp; **bold** — bartholomew.fitzgerald@northwind-industries-holdings.example.com — ${LONG_2000_TEXT}`,
        created_at: '2025-12-31T23:30:00-08:00',
      },
      {
        id: 2,
        submission_id: 101,
        finding_id: null,
        author_name: 'نور الهدى عبد الرحمن',
        role: 'teacher',
        body: 'مراجعة مستندات الاعتماد قبل النشر الرسمي — Line one\nLine two',
        created_at: '1970-01-01T00:00:00Z',
      },
    ];
  }
  if (mode === 'huge') {
    return Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      submission_id: 1,
      finding_id: null,
      author_name: i % 2 === 0 ? 'Dr. Vikramaditya Rao' : 'Prof. Meenakshi Iyer',
      role: i % 2 === 0 ? 'admin' : 'teacher',
      body: `Reviewer sign-off note #${i + 1}: Verified against institutional ordinance.`,
      created_at: new Date(Date.UTC(2026, 10, 24, 9, 0) - i * 300_000).toISOString(),
    }));
  }
  return [
    {
      id: 1,
      submission_id: 1,
      finding_id: null,
      author_name: 'Dr. Vikramaditya Rao',
      role: 'admin',
      body: 'Please align placement denominator with the audited Placement Cell register before approval.',
      created_at: '2026-11-24T09:50:00Z',
    },
  ];
}

export function buildDocumentsAndGraph(mode: BreakUiMode): {
  docs: StoredDocument[];
  graph: ClaimGraphResult | null;
} {
  if (mode === 'empty') return { docs: [], graph: null };
  const demoFacts: ExtractedFact[] = [
    {
      fact_id: 'fact-1',
      subject: 'CSE Placement Cohort',
      predicate: 'placement_percentage',
      value: '99.4%',
      canonical_value: 99.4,
      canonical_unit: '%',
      temporal: 'AY 2025-26',
      scope: 'B.Tech CSE',
      confidence: 0.96,
      provenance: {
        doc_id: 'doc-brochure',
        filename: 'Admissions_Prospectus_2026.pdf',
        page: 2,
        evidence_quote: 'B.Tech CSE achieved 99.4% placement in AY 2025-26.',
        verified: true,
        match_type: 'exact',
      },
    },
    {
      fact_id: 'fact-2',
      subject: 'CSE Placement Cohort',
      predicate: 'placement_percentage',
      value: '82.8%',
      canonical_value: 82.8,
      canonical_unit: '%',
      temporal: 'AY 2025-26',
      scope: 'B.Tech CSE',
      confidence: 0.99,
      provenance: {
        doc_id: 'doc-nirf',
        filename: 'NIRF_2026_Statutory_Filing.pdf',
        page: 5,
        evidence_quote: '298 of 360 opting-in students (82.8%) were placed in AY 2025-26.',
        verified: true,
        match_type: 'exact',
      },
    },
    {
      fact_id: 'fact-3',
      subject: 'NAAC Criterion IV',
      predicate: 'infra_spend',
      value: '₹18.50 Cr',
      canonical_value: 18.5,
      canonical_unit: 'Cr',
      temporal: 'FY 2026-27',
      scope: 'Institution-wide',
      confidence: 0.98,
      provenance: {
        doc_id: 'doc-nirf',
        filename: 'NIRF_2026_Statutory_Filing.pdf',
        page: 8,
        evidence_quote: 'Total capital infrastructure allocation verified at Rs. 18.50 Crores.',
        verified: true,
        match_type: 'exact',
      },
    },
  ];
  const demoDocs: StoredDocument[] = [
    {
      doc_id: 'doc-brochure',
      filename: 'Admissions_Prospectus_2026.pdf',
      page_count: 16,
      scanned_pages: [],
      anomalies: [
        {
          kind: 'micro_font',
          page: 2,
          snippet: '*Excludes 60 students opting for higher studies and unplaced backlog pool.',
          wcag_contrast: 2.1,
          effective_font_pt: 2.4,
          detail: 'Microtext footnote rendered at 2.4pt below 3.0pt legibility floor.',
        },
      ],
      facts: [demoFacts[0]],
    },
    {
      doc_id: 'doc-nirf',
      filename: 'NIRF_2026_Statutory_Filing.pdf',
      page_count: 24,
      scanned_pages: [],
      anomalies: [],
      facts: [demoFacts[1], demoFacts[2]],
    },
  ];
  const demoClusters: FactCluster[] = [
    {
      cluster_id: 'cl-1',
      subject: 'CSE Placement Cohort',
      predicate: 'placement_percentage',
      case_type: 'contradicted',
      dispute_code: 'value_contradiction',
      explanation: 'Admissions Prospectus declares 99.4% placement while NIRF Statutory Filing records 82.8% (16.6 percentage-point discrepancy).',
      facts: [demoFacts[0], demoFacts[1]],
      edges: [
        {
          source_fact_id: 'fact-1',
          target_fact_id: 'fact-2',
          edge_type: 'contradicts',
          detection_method: 'Z3 + NLI',
          confidence: 0.98,
          explanation: 'Direct numeric conflict on identical cohort & academic year.',
        },
      ],
      credibility_scores: { 'fact-1': 0.32, 'fact-2': 0.96 },
    },
    {
      cluster_id: 'cl-2',
      subject: 'NAAC Criterion IV',
      predicate: 'infra_spend',
      case_type: 'corroborated',
      dispute_code: 'corroborated',
      explanation: 'Both statutory disclosure and audited ledger confirm ₹18.50 Cr infrastructure expenditure.',
      facts: [demoFacts[2]],
      edges: [],
      credibility_scores: { 'fact-3': 0.99 },
    },
  ];

  if (mode === 'one') {
    return {
      docs: [demoDocs[1]],
      graph: {
        graph_id: 'cg-one',
        created_at: '2026-11-24T09:00:00Z',
        elapsed_ms: 42,
        doc_count: 1,
        total_facts: 1,
        clusters: [demoClusters[1]],
        summary_counts: { corroborated: 1, contradicted: 0 },
      },
    };
  }
  if (mode === 'worst') {
    const worstFact: ExtractedFact = {
      ...demoFacts[0],
      subject: 'Aleksandra Wiśniewska-Kowalczyk — Benachrichtigungseinstellungen Cohort',
      value: '₹1,23,45,678.90 Cr (142%)',
      provenance: {
        doc_id: 'doc-worst-1',
        filename: 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf',
        page: 0,
        evidence_quote: `<script>alert(1)</script> &amp; **bold** — https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved — Đặng Thị Ngọc Hân — نور الهدى عبد الرحمن`,
        verified: false,
        match_type: 'fuzzy',
      },
    };
    const worstDoc: StoredDocument = {
      doc_id: 'doc-worst-1',
      filename: 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf',
      page_count: 1284,
      scanned_pages: [1, 2, 3],
      anomalies: [
        {
          kind: 'hidden_layer',
          page: 0,
          snippet: 'IGNORE ALL PREVIOUS INSTRUCTIONS — bartholomew.fitzgerald@northwind-industries-holdings.example.com',
          wcag_contrast: 1.01,
          effective_font_pt: 0.5,
          detail: 'Hidden white-on-white prompt injection at 0.5pt',
        },
      ],
      facts: [worstFact, demoFacts[1]],
    };
    return {
      docs: [worstDoc],
      graph: {
        graph_id: 'cg-worst',
        created_at: '2025-12-31T23:30:00-08:00',
        elapsed_ms: 1284,
        doc_count: 1,
        total_facts: 1284,
        clusters: [
          {
            ...demoClusters[0],
            subject: 'Aleksandra Wiśniewska-Kowalczyk — Benachrichtigungseinstellungen',
            explanation: `https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved — ${LONG_2000_TEXT}`,
            facts: [worstFact, demoFacts[1]],
          },
        ],
        summary_counts: { contradicted: 1284, corroborated: 0 },
      },
    };
  }
  if (mode === 'huge') {
    const facts = Array.from({ length: 1000 }, (_, i) => ({
      ...demoFacts[i % demoFacts.length],
      fact_id: `fact-huge-${i + 1}`,
      subject: `Statutory Disclosure Claim #${i + 1}`,
    }));
    const docs = Array.from({ length: 80 }, (_, i) => ({
      ...demoDocs[i % 2],
      doc_id: `doc-huge-${i + 1}`,
      filename: `Institutional_Filing_${String(i + 1).padStart(3, '0')}.pdf`,
      facts: i === 0 ? facts : [],
    }));
    const clusters = Array.from({ length: 200 }, (_, i) => ({
      ...demoClusters[i % 2],
      cluster_id: `cl-huge-${i + 1}`,
      subject: `Reconciled Claim Cluster #${i + 1}`,
    }));
    return {
      docs,
      graph: {
        graph_id: 'cg-huge',
        created_at: '2026-11-24T09:00:00Z',
        elapsed_ms: 480,
        doc_count: docs.length,
        total_facts: facts.length,
        clusters,
        summary_counts: { contradicted: 100, corroborated: 100 },
      },
    };
  }
  return {
    docs: demoDocs,
    graph: {
      graph_id: 'cg-demo',
      created_at: '2026-11-24T09:30:00Z',
      elapsed_ms: 68,
      doc_count: demoDocs.length,
      total_facts: demoFacts.length,
      clusters: demoClusters,
      summary_counts: { contradicted: 1, corroborated: 1 },
    },
  };
}

export function buildAuditChain(mode: BreakUiMode): AuditChainData {
  if (mode === 'empty') return { valid: true, broken_index: null, count: 0, events: [] };
  if (mode === 'one') {
    return {
      valid: true,
      broken_index: null,
      count: 1,
      events: [
        {
          id: 1,
          submission_id: 1,
          action: 'publish',
          actor_id: 1,
          actor_name: 'Dr. Vikramaditya Rao',
          comment: 'Signed and published verified statutory filing.',
          prev_hash: '0000000000000000',
          event_hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
          created_at: '2026-11-24T09:30:00Z',
        },
      ],
    };
  }
  if (mode === 'worst') {
    return {
      valid: false,
      broken_index: 1,
      count: 1284,
      events: [
        {
          id: 1,
          submission_id: 101,
          action: 'publish',
          actor_id: 1,
          actor_name: 'Aleksandra Wiśniewska-Kowalczyk (bartholomew.fitzgerald@northwind-industries-holdings.example.com)',
          comment: `<script>alert(1)</script> &amp; **Tampered chain entry** — ${LONG_2000_TEXT}`,
          prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          event_hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
          created_at: '2025-12-31T23:30:00-08:00',
        },
        {
          id: 2,
          submission_id: 102,
          action: 'create',
          actor_id: 2,
          actor_name: 'J',
          comment: '',
          prev_hash: 'bad-hash',
          event_hash: '1111',
          created_at: '1970-01-01T00:00:00Z',
        },
      ],
    };
  }
  if (mode === 'huge') {
    return {
      valid: true,
      broken_index: null,
      count: 1000,
      events: Array.from({ length: 1000 }, (_, i) => ({
        id: 1000 - i,
        submission_id: (i % 50) + 1,
        action: (['create', 'edit', 'submit', 'approve', 'publish'] as const)[i % 5],
        actor_id: 1,
        actor_name: i % 2 === 0 ? 'Dr. Vikramaditya Rao' : 'Prof. Meenakshi Iyer',
        comment: `Audit chain entry #${1000 - i}: Hash-linked compliance transition.`,
        prev_hash: `prev${String(1000 - i).padStart(12, '0')}abcdef`,
        event_hash: `evnt${String(1000 - i).padStart(12, '0')}9f8e7d`,
        created_at: new Date(Date.UTC(2026, 10, 24, 9, 0) - i * 180_000).toISOString(),
      })),
    };
  }
  return {
    valid: true,
    broken_index: null,
    count: 3,
    events: [
      {
        id: 3,
        submission_id: 2,
        action: 'publish',
        actor_id: 1,
        actor_name: 'Dr. Vikramaditya Rao',
        comment: 'Published NAAC Criterion IV expenditure ledger with C2PA seal.',
        prev_hash: '2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
        event_hash: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
        created_at: '2026-11-24T09:30:00Z',
      },
      {
        id: 2,
        submission_id: 2,
        action: 'approve',
        actor_id: 4,
        actor_name: 'Prof. Meenakshi Iyer',
        comment: 'Verified cross-foot balance across all three capital budget heads.',
        prev_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
        event_hash: '2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
        created_at: '2026-11-24T09:10:00Z',
      },
      {
        id: 1,
        submission_id: 1,
        action: 'create',
        actor_id: 1,
        actor_name: 'Dr. Vikramaditya Rao',
        comment: 'Imported AY 2026-27 admissions prospectus for pre-publish review.',
        prev_hash: '00000000000000000000000000000000',
        event_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
        created_at: '2026-11-24T08:15:00Z',
      },
    ],
  };
}

export function buildKeyRing(mode: BreakUiMode): SigningKeyRingSummary {
  if (mode === 'empty') {
    return { active_kid: '', jwks_url: '/.well-known/jwks.json', keys: [] };
  }
  if (mode === 'one') {
    return {
      active_kid: 'pramaan-2026-v1',
      jwks_url: '/.well-known/jwks.json',
      keys: [
        {
          kid: 'pramaan-2026-v1',
          ec_kid: 'pramaan-2026-v1-ec',
          status: 'active',
          source: 'env_seed',
          created_at: '2026-01-01T00:00:00Z',
          retired_at: '',
          ed25519_thumbprint: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
        },
      ],
    };
  }
  if (mode === 'worst') {
    return {
      active_kid: 'pramaan-benachrichtigungseinstellungen-2026-9f8e7d6c-5b4a-4c3d-8e2f',
      jwks_url: 'https://example.com/workspaces/acme/projects/q3-launch/.well-known/jwks.json',
      keys: [
        {
          kid: 'pramaan-benachrichtigungseinstellungen-2026-9f8e7d6c-5b4a-4c3d-8e2f',
          ec_kid: 'pramaan-benachrichtigungseinstellungen-2026-ec',
          status: 'active',
          source: 'manual_rotation',
          created_at: '2025-12-31T23:30:00-08:00',
          retired_at: '',
          ed25519_thumbprint: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f9f8e7d6c5b4a4c3d8e2f',
        },
        {
          kid: 'k',
          ec_kid: 'k-ec',
          status: 'retired',
          source: 'bootstrap',
          created_at: '1970-01-01T00:00:00Z',
          retired_at: '2026-11-24T08:00:00Z',
          ed25519_thumbprint: 'a',
        },
      ],
    };
  }
  if (mode === 'huge') {
    return {
      active_kid: 'pramaan-2026-v120',
      jwks_url: '/.well-known/jwks.json',
      keys: Array.from({ length: 120 }, (_, i) => ({
        kid: `pramaan-2026-v${120 - i}`,
        ec_kid: `pramaan-2026-v${120 - i}-ec`,
        status: i === 0 ? 'active' : 'retired',
        source: i === 0 ? 'rotation' : 'historical',
        created_at: new Date(Date.UTC(2026, 10, 24) - i * 86400_000).toISOString(),
        retired_at: i === 0 ? '' : new Date(Date.UTC(2026, 10, 24) - (i - 1) * 86400_000).toISOString(),
        ed25519_thumbprint: `thumb${String(120 - i).padStart(6, '0')}9f8e7d6c5b4a4c3d`,
      })),
    };
  }
  return {
    active_kid: 'pramaan-2026-q4',
    jwks_url: '/.well-known/jwks.json',
    keys: [
      {
        kid: 'pramaan-2026-q4',
        ec_kid: 'pramaan-2026-q4-ec',
        status: 'active',
        source: 'registrar_rotation',
        created_at: '2026-10-01T00:00:00Z',
        retired_at: '',
        ed25519_thumbprint: '7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c',
      },
      {
        kid: 'pramaan-2026-q1',
        ec_kid: 'pramaan-2026-q1-ec',
        status: 'retired',
        source: 'initial_bootstrap',
        created_at: '2026-01-01T00:00:00Z',
        retired_at: '2026-10-01T00:00:00Z',
        ed25519_thumbprint: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
      },
    ],
  };
}

export function buildMintedPassport(mode: BreakUiMode): MintedQrPassport {
  if (mode === 'worst') {
    return {
      passport_id: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f',
      holder_prn: WORST_STUDENTS[0].prn,
      disclosed_claims: {
        full_name: WORST_STUDENTS[0].full_name,
        program: WORST_STUDENTS[0].program,
        batch_year: '2026',
        cgpa: '9.123456789',
        active_backlogs: '1',
        disciplinary_standing: WORST_STUDENTS[0].disciplinary_standing ?? '',
      },
      hidden_claims: ['attendance_pct'],
      root_hash_hex: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f',
      base45_payload: 'PR1:6BF9V8E7D6C5B4A4C3D8E2F1A0B9C8D7E6F9F8E7D6C5B4A4C3D8E2F1A0B9C8D7E6F',
      payload_bytes_len: 412,
      qr_version: 14,
      qr_png_b64: SAMPLE_QR_PNG_B64,
      issued_at: '2025-12-31T23:30:00-08:00',
      portability: {
        sd_jwt: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJQUk4tOUY4RTdENkMifQ.SIG~disclosure1~',
        w3c_vc_2_0: { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'] },
      },
    };
  }
  return {
    passport_id: 'prm-2026-a8f4c190b32e',
    holder_prn: '2026CS001',
    disclosed_claims: {
      full_name: 'Aarav Deshmukh',
      program: 'B.Tech Computer Science & Engineering',
      batch_year: '2026',
      cgpa: '8.94',
      active_backlogs: '0',
    },
    hidden_claims: ['attendance_pct', 'degree_status', 'disciplinary_standing'],
    root_hash_hex: '7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e',
    base45_payload: 'PR1:6BF9A8F4C190B32E7F8E9D0C1B2A3F4E5D6C7B8A9F0E1D2C',
    payload_bytes_len: 298,
    qr_version: 9,
    qr_png_b64: SAMPLE_QR_PNG_B64,
    issued_at: '2026-11-24T09:45:00Z',
    portability: {
      sd_jwt: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIyMDI2Q1MwMDEifQ.SIG~full_name~cgpa~',
      w3c_vc_2_0: { '@context': ['https://www.w3.org/ns/credentials/v2'], id: 'urn:pramaan:prm-2026-a8f4c190b32e' },
    },
  };
}

export function buildVerifiedPassport(mode: BreakUiMode): VerifiedQrPassport {
  const m = buildMintedPassport(mode);
  return {
    valid: true,
    revoked: false,
    reason: mode === 'worst' ? 'Signature & Merkle inclusion proofs valid — Đặng Thị Ngọc Hân / <script>alert(1)</script>' : 'Cryptographic signature and selective-disclosure Merkle proofs verified.',
    passport_id: m.passport_id,
    holder_prn: m.holder_prn,
    root_hash_hex: m.root_hash_hex,
    disclosed_claims: m.disclosed_claims,
    signature_ok: true,
    merkle_proofs_ok: true,
    issued_at: m.issued_at,
  };
}

export function buildUsers(mode: BreakUiMode): AuthUser[] {
  if (mode === 'empty') return [];
  if (mode === 'one') return [getBreakUiUser('demo', 'admin')!];
  if (mode === 'worst') {
    return (['admin', 'student', 'parent', 'teacher', 'recruiter'] as const).map(
      (r) => getBreakUiUser('worst', r)!,
    );
  }
  if (mode === 'huge') {
    return Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      username: `user_${String(i + 1).padStart(4, '0')}`,
      display_name: `Institutional User ${i + 1}`,
      role: (['student', 'teacher', 'parent', 'recruiter', 'admin'] as const)[i % 5],
      tenant_id: 'pramaan-univ',
      linked_prn: i % 5 === 0 ? `2026CS${String(i + 1).padStart(4, '0')}` : '',
      linked_faculty_id: i % 5 === 1 ? `FAC${String(i + 1).padStart(4, '0')}` : '',
    }));
  }
  return (['admin', 'student', 'parent', 'teacher', 'recruiter'] as const).map(
    (r) => getBreakUiUser('demo', r)!,
  );
}

export function buildCanons(mode: BreakUiMode): CanonSummary[] {
  if (mode === 'empty') return [];
  if (mode === 'one') return [DEMO_CANONS[0]];
  if (mode === 'worst') {
    return [
      {
        ...DEMO_CANONS[0],
        id: 'pramaan-benachrichtigungseinstellungen-paramètres-de-confidentialité-v12',
        version: '99.1284.0-rc1',
        term_count: 1000000,
        fact_count: 1284,
      },
      ...DEMO_CANONS,
    ];
  }
  return DEMO_CANONS;
}

export function buildLint(mode: BreakUiMode, canonId: string): CanonLintResult {
  if (mode === 'worst') {
    return {
      canon_id: canonId,
      canon_version: '99.1284.0-rc1',
      is_valid: false,
      issues: [
        {
          rule_ids: ['RULE_BENACHRICHTIGUNGSEINSTELLUNGEN_1', 'RULE_2'],
          kind: 'contradiction',
          message: '<script>alert(1)</script> — Conflicting threshold between 75% floor and 142% override.',
        },
      ],
    };
  }
  return { canon_id: canonId, canon_version: '2.4.0', is_valid: true, issues: [] };
}

export function buildFrictionPr(mode: BreakUiMode, canonId: string): CanonFrictionPrData {
  if (mode === 'empty') {
    return {
      canon_id: canonId,
      base_version: '1.0',
      proposed_version: '1.0',
      has_changes: false,
      rule_metrics: [],
      revisions: [],
      yaml_diff: '',
      impact_simulation: { bundles_evaluated: 0, before_findings: 0, after_findings: 0, before_blockers: 0, after_blockers: 0, resolved_rule_ids: [] },
    };
  }
  return {
    canon_id: canonId,
    base_version: '2.4.0',
    proposed_version: '2.4.1',
    has_changes: mode === 'worst',
    rule_metrics:
      mode === 'one'
        ? [{ rule_id: 'PLACEMENT_DENOMINATOR_TRUTH', total_flags: 1, overrides: 1, raw_friction: 1.0, posterior_friction: 0.42, needs_revision: false }]
        : [
            { rule_id: 'PLACEMENT_DENOMINATOR_TRUTH', total_flags: mode === 'worst' ? 1000000 : 18, overrides: mode === 'worst' ? 1284 : 1, raw_friction: 0.055, posterior_friction: 0.09, needs_revision: false },
            { rule_id: 'CTC_MEDIAN_DOMESTIC_ONLY', total_flags: 12, overrides: 4, raw_friction: 0.333, posterior_friction: 0.28, needs_revision: mode === 'worst' },
          ],
    revisions: [],
    yaml_diff: '',
    impact_simulation: { bundles_evaluated: 12, before_findings: 8, after_findings: 6, before_blockers: 3, after_blockers: 3, resolved_rule_ids: [] },
  };
}

export function buildCondonationResult(mode: BreakUiMode): CondonationAuditResult {
  return {
    student_prn: mode === 'worst' ? WORST_STUDENTS[0].prn : '2026CS001',
    course_code: mode === 'worst' ? 'CS-999-BENACHRICHTIGUNG' : 'CS308',
    raw_attendance_pct: mode === 'worst' ? 62.5 : 70.0,
    proposed_condonation_pct: mode === 'worst' ? 15.0 : 8.0,
    effective_capped_pct: mode === 'worst' ? 72.5 : 78.0,
    compliant: mode !== 'worst',
    exempt_by_cgpa: false,
    meets_attendance_floor: mode !== 'worst',
    min_attendance_pct: 75,
    max_medical_condonation_pct: 10,
    cgpa_exemption_threshold: 9.0,
    solver_id: 'Z3-4.13.0',
    witness: mode === 'worst' ? 'raw(62.5%) + cap(10.0%) = 72.5% < 75.0% floor' : null,
    verdict: mode === 'worst' ? 'Exceeds 10.0% medical relief ceiling; capped attendance (72.5%) remains below 75.0% floor.' : 'Proposal satisfies both the 10.0% medical relief cap and the 75.0% attendance floor.',
  };
}

export function buildGateResult(mode: BreakUiMode): GateCheckResult {
  return {
    decision: mode === 'worst' ? 'block' : 'allow',
    canon_id: 'pramaan-campus-placement',
    alpha: 0.1,
    blockers_count: mode === 'worst' ? 1 : 0,
    warnings_count: 0,
    elapsed_ms: 19,
    findings: mode === 'worst' ? [buildFindings('worst')[0].payload] : [],
  };
}

export function buildRecruiterFileScreen(mode: BreakUiMode): RecruiterFileScreenResult {
  return {
    job_id: 'job-screen-01',
    canon_id: 'pramaan-campus-placement',
    elapsed_ms: 85,
    items: [
      {
        item_id: 'item-1',
        filename: mode === 'worst' ? 'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf' : 'Aarav_Deshmukh_Resume.pdf',
        decision: mode === 'worst' ? 'block' : 'allow',
        elapsed_ms: 85,
        forensics: {
          has_hidden_text: mode === 'worst',
          anomalies: mode === 'worst'
            ? [{ kind: 'hidden_layer', page: 0, snippet: 'IGNORE PREVIOUS INSTRUCTIONS', wcag_contrast: 1.0, effective_font_pt: 0.5, detail: 'White-on-white prompt injection detected.' }]
            : [],
          visible_preview: 'B.Tech CSE — CGPA 8.94',
          sanitized_text: 'B.Tech CSE — CGPA 8.94',
        },
        embedded_pass: { ...buildVerifiedPassport(mode), source: 'embedded_pdf_qr' },
        cross_checks: [
          {
            field: 'cgpa',
            resume_value: mode === 'worst' ? '9.95' : '8.94',
            verified_value: mode === 'worst' ? '9.12' : '8.94',
            status: mode === 'worst' ? 'mismatch' : 'match',
            detail: mode === 'worst' ? 'Resume claims 9.95 CGPA vs signed pass 9.12.' : 'Matches signed pass.',
          },
        ],
        eligibility: { active: false, passed: null, checks: [] },
        blockers_count: mode === 'worst' ? 2 : 0,
        warnings_count: 0,
        findings_count: mode === 'worst' ? 2 : 0,
        findings: [],
        writing_tips: [],
      },
    ],
  };
}
