import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { setToken, scheduleProactiveRefresh } from '../lib/api';
import { supabaseAuth } from '../lib/supabase';

export function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
      <path style={{ fill: 'var(--google-red)' }} d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path style={{ fill: 'var(--google-blue)' }} d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path style={{ fill: 'var(--google-yellow)' }} d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path style={{ fill: 'var(--google-green)' }} d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const CHECKS = [
  { label: 'a–z', test: value => /[a-z]/.test(value) },
  { label: 'A–Z', test: value => /[A-Z]/.test(value) },
  { label: '0–9', test: value => /[0-9]/.test(value) },
  { label: 'Symbol', test: value => /[^A-Za-z0-9]/.test(value) },
];

// Every provider error becomes one short sentence; raw provider text is never shown.
export function authMessage(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.status || ''}`.toLowerCase();
  if (/invalid.?login|invalid.?credentials|invalid_grant/.test(text)) return 'Wrong email or password.';
  if (/not.?confirmed/.test(text)) return 'Confirm your email first.';
  if (/already.?(registered|exists)|user_already_exists/.test(text)) return 'That email has an account. Sign in.';
  if (/rate|too many|429|over_email_send/.test(text)) return 'Too many tries. Wait a minute.';
  if (/weak|password.*(characters|least|short|should)/.test(text)) return 'Use 8+ characters with a–z, A–Z, 0–9 and a symbol.';
  if (/email.*(invalid|valid)|invalid.*email/.test(text)) return 'Enter a valid email.';
  if (/fetch|network|failed to/.test(text)) return "Can't connect. Try again.";
  if (/signup.*disabled|not allowed/.test(text)) return 'Sign-up is closed right now.';
  return 'Something went wrong. Try again.';
}

// Sign in / Create account: Google first, then email and password.
export default function AuthCard({ mode: initialMode = 'signin', linkModes = false }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode); // signin | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const passed = CHECKS.map(check => check.test(password));

  function finishSession(session) {
    setToken(session.access_token, session.user?.email, session.refresh_token, session.user?.user_metadata?.name);
    scheduleProactiveRefresh();
    router.push('/dashboard');
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setNotice('');
    setSubmitted(false);
  }

  async function continueWithGoogle() {
    setError('');
    setBusy(true);
    const { error: oauthError } = await supabaseAuth().signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(authMessage(oauthError));
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitted(true);
    setError('');
    setNotice('');
    const address = email.trim().toLowerCase();
    if (mode === 'reset') {
      if (!address) { setError('Enter your email.'); return; }
      setBusy(true);
      await supabaseAuth().resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/reset-password` });
      setBusy(false);
      setNotice('Reset link sent.');
      return;
    }
    if (!address || !password) { setError('Enter your email and password.'); return; }
    if (signup && (password.length < 8 || passed.includes(false))) {
      setError(password.length < 8 ? 'Use 8 or more characters.' : '');
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        const { data, error: signUpError } = await supabaseAuth().signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) throw signUpError;
        if (data.session) finishSession(data.session);
        else setNotice('Check your email to confirm.');
      } else {
        const { data, error: signInError } = await supabaseAuth().signInWithPassword({ email: address, password });
        if (signInError) throw signInError;
        finishSession(data.session);
      }
    } catch (authError) {
      setError(authMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'reset' ? 'Reset password' : signup ? 'Create account' : 'Sign in';
  const Tab = ({ to, label }) => {
    const selected = (to === 'signup') === signup && mode !== 'reset';
    return linkModes
      ? <Link href={to === 'signup' ? '/signup' : '/login'} role="tab" aria-selected={selected} className={selected ? 'is-active' : ''}>{label}</Link>
      : <button type="button" role="tab" aria-selected={selected} className={selected ? 'is-active' : ''} onClick={() => switchMode(to)}>{label}</button>;
  };

  return (
    <section id="classroom-sign-in" className="auth" aria-labelledby="auth-title">
      <h2 id="auth-title" className="auth-title">{title}</h2>
      {mode !== 'reset' && (
        <div className="c-seg auth-tabs" role="tablist" aria-label="Account">
          <Tab to="signin" label="Sign in" />
          <Tab to="signup" label="Create account" />
        </div>
      )}

      {mode !== 'reset' && (
        <>
          <button type="button" className="auth-google" onClick={continueWithGoogle} disabled={busy}>
            <GoogleLogo />Continue with Google
          </button>
          <div className="auth-or" aria-hidden="true"><span>or</span></div>
        </>
      )}

      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" className="auth-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
        </div>

        {mode !== 'reset' && (
          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-password">
              <input
                id="auth-password"
                className="auth-input"
                type={show ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                aria-describedby={signup && password ? 'auth-checks' : undefined}
              />
              <button type="button" className="auth-eye" onClick={() => setShow(value => !value)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                {show ? <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={20} strokeWidth={1.75} aria-hidden="true" />}
              </button>
            </div>
            {signup && password && (
              <ul id="auth-checks" className="auth-checks" aria-label="Password needs">
                {CHECKS.map((check, index) => {
                  const state = passed[index] ? 'ok' : submitted ? 'bad' : 'todo';
                  return (
                    <li key={check.label} className={`is-${state}`}>
                      {state === 'bad' ? <X size={16} strokeWidth={2} aria-hidden="true" /> : <Check size={16} strokeWidth={2} aria-hidden="true" />}
                      <span>{check.label}</span>
                      <span className="sr-only">{passed[index] ? 'done' : 'missing'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {mode === 'signin' && <button type="button" className="auth-link auth-forgot" onClick={() => switchMode('reset')}>Forgot password?</button>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'reset' ? 'Send link' : signup ? 'Create account' : 'Sign in'}
        </button>
        {mode === 'reset' && <button type="button" className="auth-link" onClick={() => switchMode('signin')}>Back to sign in</button>}
      </form>

      <style jsx>{`
        .auth { display: grid; gap: 16px; width: min(400px, 100%); padding: 28px; border-radius:20px; background: var(--surface-card); border: 1px solid var(--hairline); box-shadow:var(--shadow-card); color: var(--ink); }
        .auth-title { margin: 0; font:600 28px/1.15 var(--font-display); letter-spacing:-0.015em; }
        .auth-tabs { width: 100%; }
        .auth-tabs :global(button), .auth-tabs :global(a) { flex: 1; }
        .auth-google { display: flex; align-items: center; justify-content: center; gap: 10px; height: 48px; border: 1px solid var(--hairline); border-radius:999px; background: var(--surface-card); color: var(--ink); font:600 15px/1 var(--font-sans); cursor: pointer; }
        .auth-google:hover:not(:disabled) { background: var(--surface-card); }
        .auth-or { display: flex; align-items: center; gap: 12px; color: var(--muted); font:500 13px/1 var(--font-sans); }
        .auth-or::before, .auth-or::after { content: ''; flex: 1; height: 1px; background: var(--olive-tint); }
        .auth-form { display: grid; gap: 14px; }
        .auth-field { display: grid; gap: 6px; }
        .auth-field label { font:600 13px/1.15 var(--font-sans); color: var(--ink); }
        .auth-input { width: 100%; height: 48px; padding: 0 14px; border: 1px solid var(--hairline); border-radius:12px; background: var(--surface-card); color: var(--ink); font:500 15px/1 var(--font-sans); outline: none; box-shadow: none; }
        .auth-input:focus-visible, .auth-input:focus { outline: 2px solid var(--olive); outline-offset: 0; border-color: transparent; border-radius:12px; box-shadow: none; }
        .auth-password { position: relative; }
        .auth-password .auth-input { padding-right: 52px; }
        .auth-eye { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius:50%; background: transparent; color: var(--ink); cursor: pointer; }
        .auth-eye:focus-visible { outline: 2px solid var(--olive); outline-offset: 0; }
        .auth-checks { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
        .auth-checks li { display: inline-flex; align-items: center; gap: 4px; font:600 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--muted); }
        .auth-checks li.is-ok { color: var(--olive-ink); }
        .auth-checks li.is-bad { color: var(--error); }
        .auth-link { justify-self: start; height: 32px; padding: 0; border: 0; background: none; color: var(--olive-ink); font:600 13px/1 var(--font-sans); cursor: pointer; }
        .auth-forgot { justify-self: end; margin-top: -6px; }
        .auth-error { margin: 0; color: var(--error); font:600 15px/1.5 var(--font-sans); }
        .auth-notice { margin: 0; color: var(--olive-ink); font:600 15px/1.5 var(--font-sans); }
        .auth-submit { height: 48px; border: 0; border-radius:999px; background: var(--olive); color: var(--on-olive); font:600 15px/1 var(--font-sans); cursor: pointer; }
        .auth-submit:hover:not(:disabled) { box-shadow:var(--shadow-card); }
        .auth-submit:disabled { opacity: .6; cursor: default; }
        .auth-submit:focus-visible, .auth-google:focus-visible, .auth-link:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        @media (max-width: 480px) { .auth { padding: 22px 18px; } }
      `}</style>
    </section>
  );
}
