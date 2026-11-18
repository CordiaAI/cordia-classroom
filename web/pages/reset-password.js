import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabaseAuth } from '../lib/supabase';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [recovery, setRecovery] = useState(null);
  const [tokenError, setTokenError] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash fragment (client-side only)
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const refresh = params.get('refresh_token');
    const type = params.get('type');
    if (!token || !refresh || type !== 'recovery') {
      setTokenError(true);
      return;
    }
    setRecovery({ access_token: token, refresh_token: refresh });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    const auth = supabaseAuth();
    const { error: sessionError } = await auth.setSession(recovery);
    const { error: updateError } = sessionError ? { error: sessionError } : await auth.updateUser({ password: newPassword });
    await auth.signOut({ scope: 'local' });
    setBusy(false);
    if (updateError) {
      setError(updateError.message || 'Reset failed. The link may have expired.');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/'), 3000);
  }

  return (
    <PublicPage path="/reset-password">
      <section className="rp">
        <h1 className="rp-title">Set new password</h1>
        <div className="rp-card">
          {tokenError ? (
            <p className="rp-line rp-error" role="alert">This reset link is invalid or has expired. Request a new one from the sign-in page.</p>
          ) : success ? (
            <p className="rp-line" role="status">Password updated. Taking you to sign in…</p>
          ) : (
            <form className="rp-form" onSubmit={handleSubmit}>
              <label className="rp-field">
                <span>New password</span>
                <span className="rp-pw">
                  <input className="c-input" type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" autoFocus />
                  <button type="button" className="rp-eye" onClick={() => setShowNew(p => !p)} aria-label={showNew ? 'Hide password' : 'Show password'}>{showNew ? <EyeOff {...ICON} /> : <Eye {...ICON} />}</button>
                </span>
              </label>
              <label className="rp-field">
                <span>Confirm new password</span>
                <span className="rp-pw">
                  <input className="c-input" type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                  <button type="button" className="rp-eye" onClick={() => setShowConfirm(p => !p)} aria-label={showConfirm ? 'Hide password' : 'Show password'}>{showConfirm ? <EyeOff {...ICON} /> : <Eye {...ICON} />}</button>
                </span>
              </label>
              {/* The message's line is always there, so the button doesn't jump when it appears. */}
              <p className="rp-line rp-error" role="alert">{error}</p>
              <button type="submit" className="c-btn c-btn--primary" disabled={busy}>Update password</button>
            </form>
          )}
          <Link href="/login" className="rp-back">Back to sign in</Link>
        </div>
      </section>

      <style jsx>{`
        .rp { width: min(440px, 100%); margin: 0 auto; display: grid; gap: 24px; }
        .rp-title { margin: 0; text-wrap: balance; }
        .rp-card { display: grid; gap: 16px; padding: 28px; border-radius: var(--r-panel); background: var(--surface-card); border: 1px solid var(--hairline); box-shadow: var(--shadow-float); -webkit-backdrop-filter: blur(28px) saturate(170%); backdrop-filter: blur(28px) saturate(170%); }
        .rp-form { display: grid; gap: 16px; }
        .rp-field { display: grid; gap: 8px; font: 600 var(--fs-13)/1 var(--font-sans); }
        .rp-pw { position: relative; display: block; }
        .rp-pw :global(.c-input) { width: 100%; padding-right: 48px; }
        .rp-eye { position: absolute; top: 50%; right: 4px; translate: 0 -50%; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--r-pill); background: none; color: var(--muted); cursor: pointer; }
        .rp-line { margin: 0; font: 500 var(--fs-15)/1.5 var(--font-sans); }
        .rp-form .rp-line { min-height: 20px; font-size: var(--fs-13); line-height: 1.25rem; }
        .rp-error { color: var(--error); }
        .rp-card :global(.rp-back) { justify-self: center; color: var(--muted); font: 600 var(--fs-13)/1.5 var(--font-sans); }
        @media (hover: hover) and (pointer: fine) { .rp-eye:hover { color: var(--ink); } }
      `}</style>
    </PublicPage>
  );
}
