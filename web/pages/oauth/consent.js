import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import AcademicInfinityMark from '../../components/AcademicInfinityMark';
import { clearAuth, getToken, getUserEmail, tryRefreshToken } from '../../lib/api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../lib/supabase';
import { PRIVACY_PATH, SUPPORT_EMAIL } from '../../lib/mcp/config.mjs';
import { clientName, oauthApi, redirectAllowed, redirectHostOf, redirectHosts } from '../../lib/oauthConsent.mjs';

const HOSTS = redirectHosts({
  configured: process.env.NEXT_PUBLIC_OAUTH_REDIRECT_HOSTS,
  vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
});

// Where Supabase Auth's OAuth server sends a student when an app (Claude, say) asks to connect:
// /oauth/consent?authorization_id=... The student signs in if needed, sees what the app could do
// and where it sends them back to, and approves or denies. Apps that would send the student
// anywhere other than an allowed host can't be approved.
export default function OAuthConsent() {
  const [state, setState] = useState({ step: 'loading' });
  const [busy, setBusy] = useState('');
  const api = useMemo(() => oauthApi({ supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, getToken, refresh: tryRefreshToken }), []);

  function signIn(authorizationId) {
    clearAuth();
    window.location.replace(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  function goBack(redirectUrl) {
    if (redirectAllowed(redirectUrl, HOSTS)) window.location.assign(redirectUrl);
    else setState({ step: 'error', message: 'Cordia stopped this app from sending you to an address it doesn’t recognise.' });
  }

  useEffect(() => {
    const authorizationId = new URLSearchParams(window.location.search).get('authorization_id') || '';
    if (!/^[\w-]{1,128}$/.test(authorizationId)) {
      setState({ step: 'error', message: 'This link is missing its request. Go back to the app and connect again.' });
      return;
    }
    if (!getToken()) {
      signIn(authorizationId);
      return;
    }
    api.authorization(authorizationId).then(({ ok, status, data }) => {
      if (status === 401) return signIn(authorizationId);
      if (!ok || !data) {
        setState({ step: 'error', message: status === 404 || status === 400
          ? 'This request has expired or was already used. Go back to the app and connect again.'
          : 'Cordia couldn’t load this request. Try again in a moment.' });
        return;
      }
      // Already approved before: Supabase hands back the redirect straight away.
      if (data.redirect_url && !data.authorization_id) return goBack(data.redirect_url);
      setState({
        step: 'ask',
        authorizationId,
        name: clientName(data.client),
        host: redirectHostOf(data.redirect_uri),
        allowed: redirectAllowed(data.redirect_uri, HOSTS),
        email: data.user?.email || getUserEmail(),
      });
    }).catch(() => setState({ step: 'error', message: 'Cordia couldn’t be reached. Check your connection and try again.' }));
  }, [api]);

  async function decide(action) {
    if (busy || state.step !== 'ask') return;
    setBusy(action);
    const { ok, status, data } = await api.decide(state.authorizationId, action).catch(() => ({ ok: false }));
    if (status === 401) return signIn(state.authorizationId);
    if (ok && data?.redirect_url) return goBack(data.redirect_url);
    setBusy('');
    setState({ step: 'error', message: 'That didn’t go through. Go back to the app and connect again.' });
  }

  const name = state.name || 'This app';
  return (
    <main className="consent-page">
      <Head><meta name="robots" content="noindex" /></Head>
      <section className="consent" aria-labelledby="consent-title" aria-busy={state.step === 'loading'}>
        <div className="consent-brand" aria-hidden="true">
          <AcademicInfinityMark className="consent-mark" title="" />
          <span>cordia</span>
        </div>

        {state.step === 'loading' && <h1 id="consent-title" className="consent-title">Checking the request…</h1>}

        {state.step === 'error' && (
          <>
            <h1 id="consent-title" className="consent-title">Can’t connect this app</h1>
            <p className="consent-text" role="alert">{state.message}</p>
            <Link href="/dashboard" className="consent-link">Go to Cordia</Link>
          </>
        )}

        {state.step === 'ask' && (
          <>
            <h1 id="consent-title" className="consent-title">Connect {name} to Cordia?</h1>
            {state.email && <p className="consent-who">Signed in as <strong>{state.email}</strong>. <button type="button" className="consent-link" onClick={() => signIn(state.authorizationId)}>Not you?</button></p>}

            <div className="consent-lists">
              <div>
                <h2 className="consent-h2">{name} will be able to:</h2>
                <ul className="consent-list is-can">
                  <li><Check size={16} aria-hidden="true" />Read your study sets, notes, lecture notes, flashcards and progress</li>
                  <li><Check size={16} aria-hidden="true" />Record your flashcard and quiz answers</li>
                  <li><Check size={16} aria-hidden="true" />Create study sets, flashcards and notes in your Library</li>
                </ul>
              </div>
              <div>
                <h2 className="consent-h2">It can’t:</h2>
                <ul className="consent-list is-cant">
                  <li><X size={16} aria-hidden="true" />See your Canvas or other LMS data</li>
                  <li><X size={16} aria-hidden="true" />See your texts or your connected accounts</li>
                  <li><X size={16} aria-hidden="true" />Delete anything</li>
                </ul>
              </div>
            </div>

            {state.allowed
              ? <p className="consent-fine">After you choose, you’ll go back to <strong>{state.host}</strong>.</p>
              : <p className="consent-warn" role="alert">This app would send you to <strong>{state.host || 'an unknown address'}</strong>, which isn’t an app Cordia works with, so it can’t be approved.</p>}

            <div className="consent-actions">
              <button type="button" className="c-btn c-btn--secondary" onClick={() => decide('deny')} disabled={Boolean(busy)}>{busy === 'deny' ? 'Cancelling…' : 'Cancel'}</button>
              <button type="button" className="c-btn c-btn--primary" onClick={() => decide('approve')} disabled={Boolean(busy) || !state.allowed}>{busy === 'approve' ? 'Connecting…' : 'Allow'}</button>
            </div>
            <p className="consent-fine">You can disconnect {name} anytime in Settings › Connectors.</p>
          </>
        )}

        <p className="consent-foot">
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <span aria-hidden="true">·</span>
          <Link href={PRIVACY_PATH}>Privacy policy</Link>
        </p>
      </section>

      <style jsx>{`
        .consent-page { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; background: var(--canvas) url('/classroom-clouds.webp') center / cover no-repeat fixed; }
        :global([data-theme="dark"]) .consent-page { background-image: none; }
        .consent { display: grid; gap: 16px; width: min(460px, 100%); padding: 28px; border-radius: 20px; background: var(--surface-card); border: 1px solid var(--hairline); box-shadow: var(--shadow-card); color: var(--ink); -webkit-backdrop-filter: blur(20px) saturate(140%); backdrop-filter: blur(20px) saturate(140%); }
        .consent-brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); }
        .consent-brand :global(.consent-mark) { width: 30px; height: 26px; }
        .consent-brand span { padding-left: 12px; border-left: 1px solid var(--line); font: 400 20px/1 var(--font-sans); letter-spacing: 0.02em; }
        .consent-title { margin: 0; font: 600 26px/1.2 var(--font-display); letter-spacing: -0.015em; overflow-wrap: anywhere; }
        .consent-text, .consent-who { margin: 0; color: var(--text-secondary); font: 500 15px/1.5 var(--font-sans); overflow-wrap: anywhere; }
        .consent-who strong { color: var(--ink); font-weight: 600; }
        .consent-lists { display: grid; gap: 14px; padding: 16px; border-radius: 14px; background: var(--olive-tint); }
        .consent-h2 { margin: 0 0 8px; font: 600 14px/1.3 var(--font-sans); color: var(--ink); }
        .consent-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .consent-list li { display: grid; grid-template-columns: 16px 1fr; gap: 10px; align-items: start; font: 500 14px/1.45 var(--font-sans); color: var(--ink); }
        .consent-list li :global(svg) { margin-top: 2px; }
        .is-can li :global(svg) { color: var(--olive-ink); }
        .is-cant li :global(svg) { color: var(--muted); }
        .consent-fine { margin: 0; color: var(--muted); font: 500 13px/1.5 var(--font-sans); overflow-wrap: anywhere; }
        .consent-fine strong { color: var(--ink); }
        .consent-warn { margin: 0; color: var(--error); font: 600 14px/1.5 var(--font-sans); overflow-wrap: anywhere; }
        .consent-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .consent-actions .c-btn { height: 48px; justify-content: center; }
        .consent-link { padding: 0; border: 0; background: none; color: var(--olive-ink); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
        .consent-foot { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 4px 0 0; padding-top: 14px; border-top: 1px solid var(--hairline); color: var(--muted); font: 500 13px/1.4 var(--font-sans); }
        .consent-foot a { color: var(--olive-ink); }
        @media (max-width: 480px) { .consent { padding: 22px 18px; } .consent-title { font-size: 23px; } }
      `}</style>
    </main>
  );
}
