import { useRef, useState } from 'react';
import {
  ChevronDown,
  FileUp,
  Landmark,
  LogIn,
  QrCode,
  ShieldCheck,
  ShieldOff,
  UserPlus,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type { AuthUser, VerifiedQrPassport } from '../api/types.ts';
import {
  formatClaimValue,
  formatDateTime,
  humanizeClaimKey,
  orderDisclosedKeys,
  truncateMiddle,
} from '../utils/format.ts';
import {
  Button,
  DisclosureProof,
  PramaanSeal,
  SegmentedTabs,
  Sheet,
  StatusBadge,
} from './ui/index.ts';

interface PublicHomeProps {
  initialized: boolean;
  initialError?: string;
  onAuthenticated: (user: AuthUser) => void;
}

export function PublicHome({ initialized, initialError = '', onAuthenticated }: PublicHomeProps) {
  const [authTab, setAuthTab] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [institutionCode, setInstitutionCode] = useState('');
  const [showCampusCode, setShowCampusCode] = useState(false);
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(initialError);

  const switchAuthTab = (next: 'signin' | 'register') => {
    if (next === authTab) return;
    setAuthTab(next);
    setAuthError('');
    setInstitutionCode('');
    setShowCampusCode(false);
  };

  // Public offline credential verifier (no account required)
  const [payloadInput, setPayloadInput] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyErr, setVerifyErr] = useState('');
  const [verified, setVerified] = useState<VerifiedQrPassport | null>(null);
  const verifyReqRef = useRef(0);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      if (!initialized) {
        const res = await api.setupAdmin({
          username: username.trim(),
          display_name: displayName.trim(),
          password,
          institution_code: institutionCode.trim(),
        });
        onAuthenticated(res.user);
      } else if (authTab === 'signin') {
        const res = await api.login(username.trim(), password, institutionCode.trim());
        onAuthenticated(res.user);
      } else {
        const res = await api.register(
          username.trim(),
          displayName.trim(),
          password,
          institutionCode.trim(),
        );
        onAuthenticated(res.user);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyPayload = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = payloadInput.trim();
    if (raw.length < 4) {
      setVerifyErr('Enter at least 4 characters of a student verification code.');
      return;
    }
    const seq = ++verifyReqRef.current;
    setVerifyBusy(true);
    setVerifyErr('');
    try {
      const res = await api.verifyPassport(raw);
      if (seq === verifyReqRef.current) setVerified(res);
    } catch (err: unknown) {
      if (seq === verifyReqRef.current) {
        setVerifyErr(err instanceof Error ? err.message : 'Unable to verify pass payload');
      }
    } finally {
      if (seq === verifyReqRef.current) setVerifyBusy(false);
    }
  };

  const handleVerifyQrImage = async (file: File | null) => {
    if (!file) return;
    const seq = ++verifyReqRef.current;
    setVerifyBusy(true);
    setVerifyErr('');
    try {
      const res = await api.verifyPassportImage(file);
      if (seq === verifyReqRef.current) setVerified(res);
    } catch (err: unknown) {
      if (seq === verifyReqRef.current) {
        setVerifyErr(err instanceof Error ? err.message : 'Unable to decode uploaded QR image');
      }
    } finally {
      if (seq === verifyReqRef.current) setVerifyBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <a
        href="#public-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[60] focus:rounded focus:bg-rail focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-surface"
      >
        Skip to main content
      </a>

      <header className="border-t-2 border-t-action border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <PramaanSeal size={30} tone="light" />
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span lang="hi" className="text-2xl font-bold leading-none text-ink shrink-0">
                प्रमाण
              </span>
              <span className="text-base font-bold tracking-tight text-ink shrink-0">Pramaan</span>
              <span className="hidden sm:inline text-rule" aria-hidden="true">
                |
              </span>
              <span className="hidden sm:inline text-xs font-medium text-ink-secondary truncate">
                Institutional Academic Ledger &amp; Statutory Compliance
              </span>
            </div>
          </div>

          <nav aria-label="Primary" className="flex items-center gap-5 text-xs font-semibold">
            <a
              href="#public-verifier"
              className="nav-underline-link inline-flex min-h-11 lg:min-h-8 items-center text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
            >
              Verify a Pass
            </a>
            <a
              href="#account-access"
              className="nav-underline-link inline-flex min-h-11 lg:min-h-8 items-center text-ink hover:text-action focus-visible:outline-2 focus-visible:outline-action"
            >
              {initialized ? 'Sign in' : 'Initialize Institution'}
            </a>
          </nav>
        </div>
      </header>

      <main
        id="public-main"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 sm:py-12 space-y-12"
      >
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
          {/* Left Column: Institutional Value Proposition + Public Credential Verifier */}
          <div className="space-y-8 min-w-0">
            <section className="gazette-header space-y-4">
              <h1 className="font-display text-4xl font-semibold text-ink leading-[1.08] sm:text-5xl">
                Verify student credentials and institutional filings in seconds.
              </h1>
              <p className="max-w-xl text-base text-ink-body leading-relaxed">
                Issue selective-disclosure academic QR passes, verify admissions brochures and
                accreditation drafts against official CBSE, UGC, and NAAC records, and maintain a
                tamper-evident governance ledger for your institution.
              </p>
            </section>

            {/* Real Public Verifier: Works Immediately With Zero Account Needed */}
            <section id="public-verifier" className="scroll-mt-8">
              <Sheet
                className="border-t-0 pt-0"
                title="Public Credential Verifier"
                subtitle="Check a student's official QR pass image or verification code without signing in."
              >
                <form onSubmit={handleVerifyPayload} className="space-y-4">
                  {verifyErr && (
                    <div
                      role="alert"
                      aria-atomic="true"
                      className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2 text-sm font-medium text-blocker"
                    >
                      {verifyErr}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="public-qr-input"
                      className="block text-xs font-semibold text-ink"
                    >
                      Verification code
                    </label>
                    <textarea
                      id="public-qr-input"
                      name="public_qr_payload"
                      rows={3}
                      minLength={4}
                      maxLength={16384}
                      value={payloadInput}
                      onChange={(e) => setPayloadInput(e.target.value)}
                      placeholder="Paste a student's verification code..."
                      className="mt-1.5 w-full rounded border border-rule bg-surface p-3 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      type="submit"
                      variant={payloadInput.trim().length >= 4 ? 'primary' : 'secondary'}
                      disabled={verifyBusy || payloadInput.trim().length < 4}
                    >
                      <QrCode className="h-4 w-4" aria-hidden="true" />
                      {verifyBusy ? 'Verifying…' : 'Verify Credential'}
                    </Button>

                    <label
                      htmlFor="public-qr-upload"
                      className="btn-interactive btn-secondary-tactile inline-flex min-h-11 lg:min-h-9 cursor-pointer items-center gap-2 rounded border border-rule bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-subtle hover:border-ink/30 focus-within:outline-2 focus-within:outline-action"
                    >
                      <FileUp className="h-4 w-4 text-action" aria-hidden="true" />
                      <span>Upload QR image</span>
                      <input
                        id="public-qr-upload"
                        name="public_qr_image"
                        type="file"
                        accept="image/png,image/*"
                        disabled={verifyBusy}
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          e.currentTarget.value = '';
                          void handleVerifyQrImage(f);
                        }}
                      />
                    </label>
                  </div>

                  {verified && (
                    <div className="space-y-3 border-t border-rule pt-4 text-sm">
                      <div
                        role="status"
                        aria-atomic="true"
                        className="flex flex-wrap items-baseline justify-between gap-2"
                      >
                        <StatusBadge
                          tone={verified.valid && !verified.revoked ? 'verified' : 'blocker'}
                          icon={
                            verified.valid && !verified.revoked ? (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            ) : (
                              <ShieldOff className="h-3.5 w-3.5" />
                            )
                          }
                        >
                          {verified.revoked
                            ? 'Pass Revoked'
                            : verified.valid
                              ? 'Authentic Signed Pass'
                              : 'Verification Failed'}
                        </StatusBadge>
                        {verified.issued_at && (
                          <span className="text-xs text-ink-secondary">
                            Issued {formatDateTime(verified.issued_at)}
                          </span>
                        )}
                      </div>

                      {verified.reason && (
                        <p className="text-xs text-ink-secondary wrap-anywhere">
                          {verified.reason}
                        </p>
                      )}

                      {Object.keys(verified.disclosed_claims).length > 0 && (
                        <dl className="divide-y divide-rule-subtle border-y border-rule">
                          {orderDisclosedKeys(Object.keys(verified.disclosed_claims)).map((k) => (
                            <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                              <dt className="text-xs font-medium text-ink-secondary">
                                {humanizeClaimKey(k)}
                              </dt>
                              <dd
                                dir="auto"
                                className="font-semibold text-ink text-end wrap-anywhere"
                              >
                                {formatClaimValue(k, verified.disclosed_claims[k])}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      <DisclosureProof label="Cryptographic verification proof">
                        Pass ID: {verified.passport_id || '—'} | Root:{' '}
                        {truncateMiddle(verified.root_hash_hex, 14, 10)} | Signature:{' '}
                        {String(verified.signature_ok)} | Merkle proof:{' '}
                        {String(verified.merkle_proofs_ok)}
                      </DisclosureProof>
                    </div>
                  )}
                </form>
              </Sheet>
            </section>
          </div>

          {/* Right Column: Institutional First-Run Setup OR Sign In / Register Folio */}
          <div id="account-access" className="min-w-0 scroll-mt-8">
            <Sheet
              tone="paper"
              title={
                !initialized
                  ? 'Initialize Institution Registrar'
                  : authTab === 'signin'
                    ? 'Sign in to Pramaan'
                    : 'Create Student Account'
              }
              subtitle={
                !initialized
                  ? 'No accounts exist yet. Create the first Registrar / IQAC Administrator account to configure your institution.'
                  : authTab === 'signin'
                    ? 'Enter your institutional username and password to open your ledger.'
                    : 'Self-register a student account. Your institution registrar links your official roll number (PRN).'
              }
              actions={
                initialized && (
                  <SegmentedTabs
                    ariaLabel="Account access mode"
                    idPrefix="auth-tab"
                    tone="light"
                    value={authTab}
                    onChange={switchAuthTab}
                    options={[
                      { id: 'signin', label: 'Sign in', panelId: 'auth-form-panel' },
                      { id: 'register', label: 'Register', panelId: 'auth-form-panel' },
                    ]}
                  />
                )
              }
            >
              <div
                id="auth-form-panel"
                role={initialized ? 'tabpanel' : undefined}
                aria-labelledby={initialized ? `auth-tab-${authTab}` : undefined}
              >
                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  {authError && (
                    <div
                      role="alert"
                      aria-atomic="true"
                      className="border-y border-blocker-border bg-blocker-bg px-3.5 py-2.5 text-sm font-medium text-blocker wrap-anywhere"
                    >
                      {authError}
                    </div>
                  )}

                  {(!initialized || authTab === 'register') && (
                    <div>
                      <label
                        htmlFor="auth-display-name"
                        className="block text-xs font-semibold text-ink"
                      >
                        {!initialized ? 'Registrar / Administrator full name' : 'Full name'}
                      </label>
                      <input
                        id="auth-display-name"
                        name="display_name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={120}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={
                          !initialized ? 'Enter administrator full name' : 'Enter your full name'
                        }
                        className="mt-1 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="auth-username" className="block text-xs font-semibold text-ink">
                      Username
                    </label>
                    <input
                      id="auth-username"
                      name="username"
                      type="text"
                      required
                      minLength={initialized && authTab === 'signin' ? 1 : 3}
                      maxLength={initialized && authTab === 'signin' ? 80 : 64}
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={!initialized ? 'Choose registrar username' : 'Enter your username'}
                      className="mt-1 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>

                  <div>
                    <label htmlFor="auth-password" className="block text-xs font-semibold text-ink">
                      Password
                    </label>
                    <input
                      id="auth-password"
                      name="password"
                      type="password"
                      required
                      minLength={!initialized || authTab === 'register' ? 8 : 1}
                      maxLength={128}
                      autoComplete={
                        !initialized || authTab === 'register' ? 'new-password' : 'current-password'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        !initialized || authTab === 'register'
                          ? 'Minimum 8 characters'
                          : 'Enter your password'
                      }
                      className="mt-1 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                    />
                  </div>

                  {initialized ? (
                    <div>
                      <button
                        type="button"
                        aria-expanded={showCampusCode}
                        aria-controls="auth-inst-code-panel"
                        onClick={() => setShowCampusCode((v) => !v)}
                        className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-ink-secondary hover:text-action focus-visible:outline-2 focus-visible:outline-action cursor-pointer"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            showCampusCode ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                        <span>
                          {authTab === 'signin'
                            ? 'Sign in to a specific campus code'
                            : 'Use a specific campus code'}
                        </span>
                      </button>
                      {showCampusCode && (
                        <div id="auth-inst-code-panel" className="mt-2">
                          <label
                            htmlFor="auth-inst-code"
                            className="block text-xs font-semibold text-ink"
                          >
                            Campus code (optional)
                          </label>
                          <input
                            id="auth-inst-code"
                            name="institution_code"
                            type="text"
                            maxLength={64}
                            value={institutionCode}
                            onChange={(e) => setInstitutionCode(e.target.value)}
                            placeholder="Leave blank for your default institution"
                            className="mt-1 w-full rounded border border-rule bg-surface px-3 py-2 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label
                        htmlFor="auth-inst-code"
                        className="block text-xs font-semibold text-ink"
                      >
                        Campus code (optional)
                      </label>
                      <input
                        id="auth-inst-code"
                        name="institution_code"
                        type="text"
                        maxLength={64}
                        value={institutionCode}
                        onChange={(e) => setInstitutionCode(e.target.value)}
                        placeholder="e.g., main-campus"
                        className="mt-1 w-full rounded border border-rule bg-surface px-3 py-2 font-mono text-xs text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
                      />
                    </div>
                  )}

                  <Button type="submit" variant="primary" disabled={authBusy} className="w-full">
                    {!initialized ? (
                      <>
                        <Landmark className="h-4 w-4" aria-hidden="true" />
                        {authBusy ? 'Initializing institution…' : 'Create Registrar Admin Account'}
                      </>
                    ) : authTab === 'signin' ? (
                      <>
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        {authBusy ? 'Signing in…' : 'Sign in'}
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        {authBusy ? 'Creating account…' : 'Create Student Account'}
                      </>
                    )}
                  </Button>

                  {initialized && authTab === 'signin' && (
                    <p className="text-xs text-ink-secondary leading-relaxed">
                      Faculty, Parent, Recruiter, and Administrator accounts are provisioned by your
                      institution’s Registrar office.
                    </p>
                  )}
                </form>
              </div>
            </Sheet>
          </div>
        </div>
      </main>

      <footer className="border-t border-rule bg-canvas">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-secondary sm:px-8">
          <span className="inline-flex items-center gap-2">
            <PramaanSeal size={18} tone="light" />
            <span>
              <span lang="hi">प्रमाण</span> Pramaan | Institutional Academic &amp; Statutory Governance
            </span>
          </span>
          <span>Offline-verifiable academic credentials and institutional compliance records</span>
        </div>
      </footer>
    </div>
  );
}
