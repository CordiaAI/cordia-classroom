import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AcademicInfinityMark from '../components/AcademicInfinityMark';
import { getToken, responseJson, setToken, scheduleProactiveRefresh } from '../lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.push('/dashboard');
  }, []);

  async function handleForgotSubmit(event) {
    event.preventDefault();
    setError('');
    const email = String(new FormData(event.currentTarget).get('email') || '').trim().toLowerCase();

    try {
      const response = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.ok) setForgotSent(true);
      else setError((await responseJson(response)).detail || 'Unable to send reset email.');
    } catch {
      setError('Service unavailable. Try again in a moment.');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get('email') || '').trim().toLowerCase(),
      password: String(form.get('password') || ''),
    };

    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await responseJson(response);

      if (response.ok && data.access_token) {
        setToken(data.access_token, data.email, data.refresh_token, data.name);
        scheduleProactiveRefresh();
        router.push('/dashboard');
      } else {
        const detail = (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail)?.replace(/^Value error,\s*/, '');
        const reference = data.request_id ? ` Reference: ${data.request_id}` : '';
        setError(response.status === 401
          ? `That email and password did not match. Try again or reset your password.${reference}`
          : detail || 'Authentication failed.');
      }
    } catch {
      setError('Service unavailable. Try again in a moment.');
    }
  }

  async function continueWithGoogle() {
    setOauthLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/auth/oauth/google`);
      const data = await responseJson(response);
      if (!response.ok || !data?.url) throw new Error(data?.detail || 'Google sign-in could not start.');
      window.location.assign(data.url);
    } catch (oauthError) {
      setError(oauthError.message || 'Google sign-in could not start.');
      setOauthLoading(false);
    }
  }

  function showLogin() {
    setForgotMode(false);
    setForgotSent(false);
    setError('');
  }

  function selectPasswordMode(enabled) {
    setPasswordMode(enabled);
    setError('');
  }

  return (
    <>
      <Head>
        <title>CordiaClassroom — AI Study Guides, Notes & Flashcards</title>
        <meta name="description" content="Turn lectures, textbooks, and course pages into focused study materials." />
        <link rel="canonical" href="https://classroom.cordiacode.com" />
      </Head>

      <main className="login-page" style={{ '--login-backdrop': "url('/login-learning-backdrop.webp')" }}>
        <div className="login-split">
          <section className="login-panel-left">
            <div className="login-brand-mark">
              <AcademicInfinityMark className="login-academic-mark" />
              <div className="login-brand-name">CordiaClassroom <small>beta</small></div>
              <h1 className="login-editorial-title">Learn from anything.</h1>
              <p className="login-brand-tagline">Capture educational material from any page and turn it into a focused study workspace.</p>
            </div>
          </section>

          <section className="login-panel-right">
            {forgotMode ? (
              <div className="login-form-wrap">
                <h2 className="login-form-title">Reset password</h2>
                {forgotSent ? (
                  <p className="login-success">If an account exists with that email, a reset link has been sent.</p>
                ) : (
                  <form onSubmit={handleForgotSubmit}>
                    <div className="login-input-row">
                      <input name="email" type="email" className="login-underline-input" placeholder="Email" autoComplete="email" required />
                    </div>
                    {error && <p className="login-form-error" role="alert">{error}</p>}
                    <button type="submit" className="btn login-cta-btn">Send reset link</button>
                  </form>
                )}
                <p className="login-switch-text"><a href="#" onClick={(event) => { event.preventDefault(); showLogin(); }}>Back to sign in</a></p>
              </div>
            ) : (
              <div className="login-form-wrap">
                <h2 className="login-form-title">Sign in</h2>
                <button type="button" className="login-oauth-button" onClick={continueWithGoogle} disabled={oauthLoading}>
                  <span aria-hidden="true">G</span>
                  {oauthLoading ? 'Opening Google…' : 'Continue with Google'}
                </button>
                <p className="login-switch-text">New to CordiaClassroom? Continue with Google to create your account.</p>
                {error && !passwordMode && <p className="login-form-error" role="alert">{error}</p>}

                {passwordMode ? (
                  <>
                    <div className="login-or"><span>existing email account</span></div>
                    <form onSubmit={handleSubmit}>
                      <div className="login-input-row">
                        <input name="email" type="email" className="login-underline-input" placeholder="Email" autoComplete="email" required />
                      </div>
                      <div className="login-input-row">
                        <input name="password" type="password" className="login-underline-input" placeholder="Password" autoComplete="current-password" minLength={8} required />
                      </div>
                      <div className="login-forgot"><a href="#" onClick={(event) => { event.preventDefault(); setForgotMode(true); setError(''); }}>Forgot password?</a></div>
                      {error && <p className="login-form-error" role="alert">{error}</p>}
                      <button type="submit" className="btn login-cta-btn">Sign in</button>
                    </form>
                    <p className="login-switch-text"><a href="#" onClick={(event) => { event.preventDefault(); selectPasswordMode(false); }}>Hide email sign-in</a></p>
                  </>
                ) : (
                  <p className="login-switch-text">
                    Signed up with email and password before?{' '}
                    <a href="#" onClick={(event) => { event.preventDefault(); selectPasswordMode(true); }}>Sign in with email</a>
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
