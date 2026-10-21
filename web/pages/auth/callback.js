import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { setToken, scheduleProactiveRefresh } from '../../lib/api';
import { authMessage } from '../../components/AuthCard';
import { takeReturnTo } from '../../lib/returnTo.mjs';

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
      setError(authMessage({ message: failure }));
      return;
    }
    if (!accessToken || !refreshToken) {
      setError('Sign-in did not finish. Try again.');
      return;
    }
    setToken(accessToken, tokenEmail(accessToken), refreshToken);
    scheduleProactiveRefresh();
    window.history.replaceState({}, document.title, '/auth/callback');

    const back = takeReturnTo();
    if (back) window.location.assign(back);
    else router.replace('/dashboard');
  }, [router]);

  return (
    <main className="oauth-callback-page">
      <div className="oauth-callback-card">
        <h1>{error ? 'Sign-in stopped' : 'Signing in…'}</h1>
        {error && <p role="alert">{error}</p>}
        {error && <button type="button" className="c-btn c-btn--primary" onClick={() => router.replace('/login')}>Sign in</button>}
      </div>
    </main>
  );
}
