import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { clearAuth, getToken, tryRefreshToken } from '../lib/api';
import { rememberReturnTo, takeReturnTo } from '../lib/returnTo.mjs';
import PublicPage from '../components/PublicPage';
import AuthCard from '../components/AuthCard';

// Signed-out home: the headline and the sign-in card. /login and /signup reuse it.
export function Landing({ mode = 'signin', path = '/' }) {
  const router = useRouter();
  useEffect(() => {
    const back = rememberReturnTo(new URLSearchParams(window.location.search).get('next'));
    if (!getToken()) return;
    if (!back) {
      router.push('/dashboard');
      return;
    }
    // The Assistant sends students here when their token has expired: renew it and go back,
    // or sign in again if it can't be renewed.
    tryRefreshToken().then(ok => {
      if (ok) window.location.assign(takeReturnTo() || back);
      else clearAuth();
    });
  }, []);

  return (
    <PublicPage
      title="CordiaClassroom — AI Study Guides, Notes & Flashcards"
      description="Turn lectures, textbooks, and course pages into focused study materials."
      path={path}
      backdrop="/login-learning-backdrop.webp"
    >
      <div className="landing">
        <section className="landing-hero">
          <div className="landing-brand-name" aria-hidden="true">Cordia<br />Classroom</div>
          <h1 className="landing-title">Your space to learn.</h1>
        </section>
        <AuthCard mode={mode} linkModes={path !== '/'} key={mode} />
      </div>
      <style jsx>{`
        .landing { display: grid; grid-template-columns: minmax(0, 1fr) 400px; align-items: center; gap: 48px; min-height: calc(100vh - 64px - 128px); }
        .landing-brand-name { font:600 20px/1.15 var(--font-display); color: var(--olive-ink); margin-bottom: 20px; }
        .landing-title { margin: 0; font:600 40px/1.15 var(--font-display); letter-spacing:-0.015em; color: var(--ink); }
        @media (max-width: 860px) { .landing { grid-template-columns: 1fr; gap: 32px; min-height: 0; } }
      `}</style>
    </PublicPage>
  );
}

export default function LoginPage() {
  return <Landing />;
}
