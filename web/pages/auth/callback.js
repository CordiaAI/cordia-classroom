import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, setToken, scheduleProactiveRefresh } from '../../lib/api';

function tokenEmail(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return payload.email || '';
  } catch {
    return '';
  }
}

export default function OAuthCallback() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const failure = hash.get('error_description') || query.get('error_description');
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (failure) {
      setError(failure);
      return;
    }
    if (!accessToken || !refreshToken) {
      setError('Sign-in did not return a Classroom session. Please try again.');
      return;
    }
    setToken(accessToken, tokenEmail(accessToken), refreshToken);
    scheduleProactiveRefresh();
    window.history.replaceState({}, document.title, '/auth/callback');

    // School details entered before "Sign up with Google" (Google can't carry them).
    let pending = null;
    try {
      pending = sessionStorage.getItem('pendingProfile');
      sessionStorage.removeItem('pendingProfile');
    } catch {}
    const saveProfile = pending
      ? apiFetch('/auth/profile', { method: 'PATCH', body: pending }).catch(() => null)
      : Promise.resolve();
    saveProfile.finally(() => router.replace('/dashboard'));
  }, [router]);

  return (
    <main className="oauth-callback-page">
      <div className="oauth-callback-card">
        <h1>{error ? 'Sign-in interrupted' : 'Signing you in…'}</h1>
        <p>{error || 'Connecting your secure Classroom session.'}</p>
        {error && <button type="button" className="btn" onClick={() => router.replace('/')}>Back to sign in</button>}
      </div>
    </main>
  );
}
