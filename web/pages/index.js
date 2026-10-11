import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AcademicInfinityMark from '../components/AcademicInfinityMark';
import StudyDocument from '../components/StudyDocument';
import WorkspaceIcon from '../components/WorkspaceIcon';
import { getToken, setToken, scheduleProactiveRefresh } from '../lib/api';
import { supabaseAuth } from '../lib/supabase';

function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function profileFromForm(form) {
  const educationLevel = String(form.get('education_level') || '');
  return {
    name: String(form.get('name') || '').trim(),
    education_level: educationLevel,
    university: String(form.get('school') || '').trim(),
    major: educationLevel === 'university' ? String(form.get('major') || '').trim() : '',
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [educationLevel, setEducationLevel] = useState('university');
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getToken()) router.push('/dashboard');
  }, []);

  function finishSession(session) {
    setToken(session.access_token, session.user?.email, session.refresh_token, session.user?.user_metadata?.name);
    scheduleProactiveRefresh();
    router.push('/dashboard');
  }

  async function handleForgotSubmit(event) {
    event.preventDefault();
    setError('');
    const email = String(new FormData(event.currentTarget).get('email') || '').trim().toLowerCase();
    await supabaseAuth().resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setForgotSent(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setConfirmationSent(false);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    if (!email || !password) {
      setError('Enter your email and password, or continue with Google.');
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error: signUpError } = await supabaseAuth().signUp({
          email,
          password,
          options: { data: profileFromForm(form), emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) throw signUpError;
        if (data.session) finishSession(data.session);
        else setConfirmationSent(true);
      } else {
        const { data, error: signInError } = await supabaseAuth().signInWithPassword({ email, password });
        if (signInError) throw signInError;
        finishSession(data.session);
      }
    } catch (authError) {
      setError(authError?.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle(event) {
    setError('');
    const form = event.currentTarget.form;
    // Google can't carry school details, so the callback saves them after sign-in.
    if (isSignup && form) {
      if (!form.reportValidity()) return;
      try { sessionStorage.setItem('pendingProfile', JSON.stringify(profileFromForm(new FormData(form)))); } catch {}
    }
    setBusy(true);
    const { error: oauthError } = await supabaseAuth().signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(oauthError.message || 'Google sign-in could not start.');
      setBusy(false);
    }
  }

  function showLogin() {
    setForgotMode(false);
    setForgotSent(false);
    setError('');
  }

  function selectMode(signup) {
    setIsSignup(signup);
    setConfirmationSent(false);
    setError('');
  }

  return (
    <>
      <Head>
        <title>CordiaClassroom — AI Study Guides, Notes & Flashcards</title>
        <meta name="description" content="Turn lectures, textbooks, and course pages into focused study materials." />
        <link rel="canonical" href="https://classroom.cordiaai.io" />
      </Head>

      <main className="login-page" style={{ '--login-backdrop': "url('/classroom-clouds.webp')" }}>
        <header className="login-navigation">
          <a href="/" className="login-wordmark" aria-label="CordiaClassroom home"><AcademicInfinityMark className="top-navigation-mark" /><span>cordia</span></a>
          <nav aria-label="Public navigation"><a href="/mission">Our approach</a><a href="#classroom-sign-in">Sign in <span aria-hidden="true">↗</span></a></nav>
        </header>
        <div className="login-split">
          <section className="login-panel-left">
            <div className="login-brand-mark">
              <span className="login-eyebrow">A little focus. A deeper understanding.</span>
              <div className="login-brand-name">Cordia<br />Classroom</div>
              <h1 className="login-editorial-title">Your space to learn.</h1>
              <p className="login-brand-tagline">Turn your course material into notes, study guides, flashcards, and understanding — built around the way you learn.</p>
              <div className="landing-actions"><a className="scene-continue" href="#classroom-sign-in" onClick={() => selectMode(true)}>Get started <WorkspaceIcon name="arrow" /></a><a href="#classroom-preview">Explore the workspace <span>↓</span></a></div>
            </div>
          </section>
          <section id="classroom-sign-in" className="login-panel-right" aria-label="Classroom account access">
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
                <h2 className="login-form-title">{isSignup ? 'Create account' : 'Sign in'}</h2>
                <div className="login-mode-tabs" role="tablist" aria-label="Account access">
                  <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''} onClick={() => selectMode(false)}>Sign in</button>
                  <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''} onClick={() => selectMode(true)}>Create account</button>
                </div>

                <form key={isSignup ? 'signup' : 'login'} onSubmit={handleSubmit}>
                  {isSignup && (
                    <>
                      <div className="login-input-row">
                        <input name="name" type="text" className="login-underline-input" placeholder="Full name" autoComplete="name" required />
                      </div>
                      <div className="login-input-row">
                        <select name="education_level" className="login-underline-input" value={educationLevel} onChange={event => setEducationLevel(event.target.value)} required>
                          <option value="university">University or college</option>
                          <option value="high_school">High school</option>
                        </select>
                      </div>
                      <div className="login-input-row">
                        <input name="school" type="text" className="login-underline-input" placeholder={educationLevel === 'university' ? 'University' : 'High school'} autoComplete="organization" required />
                      </div>
                      {educationLevel === 'university' && (
                        <div className="login-input-row">
                          <input name="major" type="text" className="login-underline-input" placeholder="Major or area of study" required />
                        </div>
                      )}
                    </>
                  )}

                  <button type="button" className="login-oauth-button" onClick={continueWithGoogle} disabled={busy}>
                    <GoogleLogo />
                    {isSignup ? 'Sign up with Google' : 'Continue with Google'}
                  </button>
                  <div className="login-or"><span>or use email</span></div>

                  <div className="login-input-row">
                    <input name="email" type="email" className="login-underline-input" placeholder="Email" autoComplete="email" />
                  </div>
                  <div className="login-input-row">
                    <input name="password" type="password" className="login-underline-input" placeholder="Password" autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} />
                  </div>

                  {!isSignup && <div className="login-forgot"><a href="#" onClick={(event) => { event.preventDefault(); setForgotMode(true); setError(''); }}>Forgot password?</a></div>}
                  {error && <p className="login-form-error" role="alert">{error}</p>}
                  {confirmationSent && <p className="login-success">Account created. Check your email to confirm it.</p>}
                  <button type="submit" className="btn login-cta-btn" disabled={busy}>{isSignup ? 'Create account' : 'Sign in'}</button>
                </form>
              </div>
            )}
          </section>
        </div>
        <div id="classroom-preview" className="landing-document-preview"><StudyDocument guide={{ title: 'Relations and Functions', className: 'Explore Cordia Classroom', study_guide: 'Q1: Relations\nA1: A relation from a set A to a set B is a subset of the Cartesian product A × B. It describes how elements of one set connect to another.\nQ2: Functions\nA2: A function from A to B is a relation in which each element of A is associated with exactly one element of B.\nQ3: A simple example\nA3: If A = {1, 2, 3} and f(x) = x², then f maps each input to one output: 1 → 1, 2 → 4, and 3 → 9.' }} /></div>
      </main>
    </>
  );
}
