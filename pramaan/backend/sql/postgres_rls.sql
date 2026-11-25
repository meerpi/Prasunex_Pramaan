-- PostgreSQL 16+ Multi-Tenant Schema & Row-Level Security (RLS) Policy Suite for Pramaan (VeriCampus)
-- Follows Supabase/Postgres RLS performance best practices:
-- 1. Wraps `current_setting('app.current_tenant', true)` in a scalar `(SELECT ...)` subquery so the
--    PostgreSQL planner caches the initPlan once per statement instead of evaluating per row.
-- 2. Applies both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
-- 3. Indexes `tenant_id` (and composite foreign keys) on every multi-tenant table.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    username VARCHAR(80) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'student',
    password_hash VARCHAR(256) NOT NULL,
    linked_prn VARCHAR(40) NOT NULL DEFAULT '',
    linked_faculty_id VARCHAR(40) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    title VARCHAR(256) NOT NULL,
    raw_content TEXT NOT NULL DEFAULT '',
    content_hash VARCHAR(64) NOT NULL,
    canon_id VARCHAR(128) NOT NULL,
    canon_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    portal_scope VARCHAR(32) NOT NULL DEFAULT 'student',
    creator_id INTEGER NOT NULL REFERENCES users(id),
    c2pa_manifest_json TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submission_versions (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    raw_content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    canon_hash VARCHAR(64) NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    change_note VARCHAR(256) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS findings (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    finding_id VARCHAR(64) NOT NULL,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    check_id VARCHAR(80) NOT NULL,
    node_id VARCHAR(128) NOT NULL,
    severity INTEGER NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    resolution VARCHAR(32) NOT NULL DEFAULT 'open',
    resolution_reason TEXT NOT NULL DEFAULT '',
    resolved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submission_comments (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    finding_id INTEGER,
    author_id INTEGER NOT NULL REFERENCES users(id),
    author_name VARCHAR(160) NOT NULL,
    role VARCHAR(32) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_events (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    actor_name VARCHAR(160) NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    prev_hash VARCHAR(64) NOT NULL,
    event_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, prev_hash)
);

CREATE TABLE IF NOT EXISTS stored_documents (
    doc_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    filename VARCHAR(256) NOT NULL,
    filepath VARCHAR(512) NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 1,
    scanned_pages_json TEXT NOT NULL DEFAULT '[]',
    anomalies_json TEXT NOT NULL DEFAULT '[]',
    facts_json TEXT NOT NULL DEFAULT '[]',
    page_texts_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_graphs (
    graph_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    payload_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compiled_canons (
    id SERIAL PRIMARY KEY,
    canon_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    yaml_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, canon_id)
);

-- Unified ERP, DPDP Consent, CRL, PKCE, MCP Batch & Signing Key Ring tables
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(32) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    prn TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (tenant_id, prn)
);

CREATE TABLE IF NOT EXISTS faculty (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    faculty_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (tenant_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS placements (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    academic_year TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (tenant_id, academic_year)
);

CREATE TABLE IF NOT EXISTS institutional_metrics (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    academic_year TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (tenant_id, academic_year)
);

CREATE TABLE IF NOT EXISTS k12_schools (
    tenant_id TEXT NOT NULL DEFAULT 'default',
    affiliation_qc_code TEXT NOT NULL,
    payload TEXT NOT NULL,
    qc_report_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (tenant_id, affiliation_qc_code)
);

CREATE TABLE IF NOT EXISTS dpdp_consents (
    consent_id TEXT PRIMARY KEY,
    student_prn TEXT NOT NULL,
    guardian_username TEXT NOT NULL,
    grantee_name TEXT NOT NULL,
    allowed_claims_json TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    digilocker_verified BOOLEAN NOT NULL DEFAULT FALSE,
    digilocker_tx_id TEXT NOT NULL DEFAULT '',
    verified_at TEXT NOT NULL DEFAULT '',
    verification_mode TEXT NOT NULL DEFAULT 'local_erp'
);

CREATE TABLE IF NOT EXISTS crl_revocations (
    passport_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    reason TEXT NOT NULL,
    revoked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issued_passports (
    passport_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    holder_prn TEXT NOT NULL,
    grantee_name TEXT NOT NULL DEFAULT '',
    issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pkce_verifiers (
    state TEXT PRIMARY KEY,
    expires_at DOUBLE PRECISION NOT NULL,
    code_verifier TEXT NOT NULL,
    consent_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_batch_jobs (
    job_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signing_keys (
    kid TEXT PRIMARY KEY,
    secret_material TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    retired_at TEXT NOT NULL DEFAULT ''
);

-- Indexes for RLS predicate & foreign key join performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_updated ON submissions (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_submission_versions_tenant_sub ON submission_versions (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_findings_tenant_sub ON findings (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_comments_tenant_sub ON submission_comments (tenant_id, submission_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_tenant_id ON workflow_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_stored_documents_tenant_created ON stored_documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_graphs_tenant_created ON claim_graphs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compiled_canons_tenant_id ON compiled_canons (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dpdp_consents_tenant_prn ON dpdp_consents (tenant_id, student_prn);
CREATE INDEX IF NOT EXISTS idx_crl_revocations_tenant_at ON crl_revocations (tenant_id, revoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_passports_tenant_prn ON issued_passports (tenant_id, holder_prn);
CREATE INDEX IF NOT EXISTS idx_pkce_verifiers_expires ON pkce_verifiers (expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_batch_jobs_tenant_created ON mcp_batch_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signing_keys_status ON signing_keys (status);

-- Enable and force Row-Level Security on all multi-tenant tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings FORCE ROW LEVEL SECURITY;
ALTER TABLE submission_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_events FORCE ROW LEVEL SECURITY;
ALTER TABLE stored_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE claim_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_graphs FORCE ROW LEVEL SECURITY;
ALTER TABLE compiled_canons ENABLE ROW LEVEL SECURITY;
ALTER TABLE compiled_canons FORCE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty FORCE ROW LEVEL SECURITY;
ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE placements FORCE ROW LEVEL SECURITY;
ALTER TABLE institutional_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE institutional_metrics FORCE ROW LEVEL SECURITY;
ALTER TABLE k12_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE k12_schools FORCE ROW LEVEL SECURITY;
ALTER TABLE dpdp_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpdp_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE crl_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crl_revocations FORCE ROW LEVEL SECURITY;
ALTER TABLE issued_passports ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_passports FORCE ROW LEVEL SECURITY;
ALTER TABLE pkce_verifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pkce_verifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_batch_jobs FORCE ROW LEVEL SECURITY;

-- Fail-closed RLS policies: unset or empty `app.current_tenant` yields NULL so zero rows leak.
-- Wrapping `current_setting(...)` in a scalar `(SELECT ...)` lets PostgreSQL cache it once per query (initPlan).
DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_submissions ON submissions;
CREATE POLICY tenant_isolation_submissions ON submissions
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_submission_versions ON submission_versions;
CREATE POLICY tenant_isolation_submission_versions ON submission_versions
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_findings ON findings;
CREATE POLICY tenant_isolation_findings ON findings
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_submission_comments ON submission_comments;
CREATE POLICY tenant_isolation_submission_comments ON submission_comments
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_workflow_events ON workflow_events;
CREATE POLICY tenant_isolation_workflow_events ON workflow_events
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_stored_documents ON stored_documents;
CREATE POLICY tenant_isolation_stored_documents ON stored_documents
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_claim_graphs ON claim_graphs;
CREATE POLICY tenant_isolation_claim_graphs ON claim_graphs
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_compiled_canons ON compiled_canons;
CREATE POLICY tenant_isolation_compiled_canons ON compiled_canons
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_students ON students;
CREATE POLICY tenant_isolation_students ON students
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_faculty ON faculty;
CREATE POLICY tenant_isolation_faculty ON faculty
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_placements ON placements;
CREATE POLICY tenant_isolation_placements ON placements
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_institutional_metrics ON institutional_metrics;
CREATE POLICY tenant_isolation_institutional_metrics ON institutional_metrics
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_k12_schools ON k12_schools;
CREATE POLICY tenant_isolation_k12_schools ON k12_schools
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_dpdp_consents ON dpdp_consents;
CREATE POLICY tenant_isolation_dpdp_consents ON dpdp_consents
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_crl_revocations ON crl_revocations;
CREATE POLICY tenant_isolation_crl_revocations ON crl_revocations
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_issued_passports ON issued_passports;
CREATE POLICY tenant_isolation_issued_passports ON issued_passports
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_pkce_verifiers ON pkce_verifiers;
CREATE POLICY tenant_isolation_pkce_verifiers ON pkce_verifiers
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

DROP POLICY IF EXISTS tenant_isolation_mcp_batch_jobs ON mcp_batch_jobs;
CREATE POLICY tenant_isolation_mcp_batch_jobs ON mcp_batch_jobs
    FOR ALL
    USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant', true), '')));

-- Dedicated non-superuser application role so PostgreSQL actually enforces RLS policies.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pramaan_app') THEN
        CREATE ROLE pramaan_app LOGIN PASSWORD 'pramaan_app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pramaan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pramaan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pramaan_app;

-- Controlled SECURITY DEFINER auth bootstrap/lookup helpers so unauthenticated login & setup-status
-- work under fail-closed RLS without granting broad BYPASSRLS to `pramaan_app`.
CREATE OR REPLACE FUNCTION pramaan_auth_count_users()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*) FROM users;
$$;

CREATE OR REPLACE FUNCTION pramaan_auth_distinct_tenants(p_limit INTEGER DEFAULT 2)
RETURNS TABLE(tenant_id VARCHAR(64))
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT u.tenant_id FROM users u LIMIT GREATEST(1, LEAST(p_limit, 20));
$$;

CREATE OR REPLACE FUNCTION pramaan_auth_lookup_users(p_username TEXT)
RETURNS TABLE(
    id INTEGER,
    tenant_id VARCHAR(64),
    username VARCHAR(80),
    display_name VARCHAR(160),
    role VARCHAR(32),
    password_hash VARCHAR(256),
    linked_prn VARCHAR(40),
    linked_faculty_id VARCHAR(40),
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.tenant_id, u.username, u.display_name, u.role, u.password_hash,
           u.linked_prn, u.linked_faculty_id, u.created_at
    FROM users u
    WHERE u.username = p_username
    ORDER BY u.id;
$$;

CREATE OR REPLACE FUNCTION pramaan_crl_check(p_passport_id TEXT)
RETURNS TABLE(reason TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.reason FROM crl_revocations c WHERE c.passport_id = p_passport_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION pramaan_pkce_pop(p_state TEXT, p_now DOUBLE PRECISION)
RETURNS TABLE(
    expires_at DOUBLE PRECISION,
    code_verifier TEXT,
    consent_id TEXT,
    tenant_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM pkce_verifiers WHERE pkce_verifiers.expires_at <= p_now;
    RETURN QUERY
    DELETE FROM pkce_verifiers
    WHERE pkce_verifiers.state = p_state
    RETURNING pkce_verifiers.expires_at, pkce_verifiers.code_verifier, pkce_verifiers.consent_id, pkce_verifiers.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION pramaan_auth_count_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION pramaan_auth_distinct_tenants(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION pramaan_auth_lookup_users(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION pramaan_crl_check(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION pramaan_pkce_pop(TEXT, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pramaan_auth_count_users() TO pramaan_app;
GRANT EXECUTE ON FUNCTION pramaan_auth_distinct_tenants(INTEGER) TO pramaan_app;
GRANT EXECUTE ON FUNCTION pramaan_auth_lookup_users(TEXT) TO pramaan_app;
GRANT EXECUTE ON FUNCTION pramaan_crl_check(TEXT) TO pramaan_app;
GRANT EXECUTE ON FUNCTION pramaan_pkce_pop(TEXT, DOUBLE PRECISION) TO pramaan_app;

-- Pre-seed versioned schema_migrations so non-superuser `pramaan_app` skips DDL at startup.
INSERT INTO schema_migrations (version, name, checksum, applied_at)
VALUES
    ('0001', 'initial_governance_schema', '7f9c00766bff56e9', 'bootstrap'),
    ('0002', 'unified_erp_crl_consent_schema', 'f3c0855eb7cd9672', 'bootstrap'),
    ('0003', 'signing_key_ring_registry', '04cbbf12d14c35cc', 'bootstrap')
ON CONFLICT (version) DO NOTHING;
