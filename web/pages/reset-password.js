import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabaseAuth } from '../lib/supabase';

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
    const auth = supabaseAuth();
    const { error: sessionError } = await auth.setSession(recovery);
    const { error: updateError } = sessionError ? { error: sessionError } : await auth.updateUser({ password: newPassword });
    await auth.signOut({ scope: 'local' });
    if (updateError) {
      setError(updateError.message || 'Reset failed. The link may have expired.');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/'), 3000);
  }

  const EyeOpen = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
  const EyeOff = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );

  return (
    <>
      <Head>
        <title>Reset Password — CordiaClassroom</title>
      </Head>
      <div className="login-page">
        <h1 className="login-title">CordiaClassroom</h1>
        <div className="login-box">
          <h2>Set New Password</h2>
          {tokenError ? (
            <p style={{ color: 'var(--error)', fontSize: '0.9em', marginBottom: 16 }}>
              This reset link is invalid or has expired. Please request a new one.
            </p>
          ) : success ? (
            <p style={{ color: 'var(--accent)', fontSize: '0.9em', marginBottom: 16 }}>
              Password updated! Redirecting to login...
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="password-wrapper">
                <input
                  type={showNew ? 'text' : 'password'}
                  placeholder="New password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{ marginBottom: 0 }}
                />
                <button type="button" className="toggle-pw-btn" onClick={() => setShowNew(p => !p)} aria-label={showNew ? 'Hide password' : 'Show password'}>
                  {showNew ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
              <div className="password-wrapper">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{ marginBottom: 0 }}
                />
                <button type="button" className="toggle-pw-btn" onClick={() => setShowConfirm(p => !p)} aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                  {showConfirm ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
              {error && <p style={{ color: 'var(--error)', marginBottom: 10, fontSize: '0.9em' }}>{error}</p>}
              <button type="submit" className="btn" style={{ width: '100%', padding: 12, marginTop: 4 }}>
                Update Password
              </button>
            </form>
          )}
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.9em', color: 'var(--text-secondary)' }}>
            <a href="/">Back to login</a>
          </p>
        </div>
      </div>

      <style jsx>{`
        .password-wrapper {
          position: relative;
          margin-bottom: 10px;
        }
        .toggle-pw-btn {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
        }
        .toggle-pw-btn:hover {
          color: var(--text-primary);
        }
      `}</style>
    </>
  );
}
