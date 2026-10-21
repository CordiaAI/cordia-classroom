import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { clearAuth, getToken, tryRefreshToken } from '../lib/api';
import { rememberReturnTo, takeReturnTo } from '../lib/returnTo.mjs';
import PublicPage from '../components/PublicPage';
import AuthCard from '../components/AuthCard';

// Things Classroom does that other study apps don't. They slide right to left under the title.
const FEATURES = [
  'Generates math practice',
  'Tutor reminds you through phone messages',
  'Records lectures into full outlines',
  'Captures slides from Canvas, Blackboard and Moodle',
  'Shows the grade you need on your next assignment',
  'Syncs Canvas deadlines and grades',
  'Learns how you study best',
  'Tutor reads the page you have open',
];

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
          <h1 className="landing-title">Classroom</h1>
          <p className="landing-tagline">Your space to learn.</p>
          <ul className="sr-only">{FEATURES.map(feature => <li key={feature}>{feature}</li>)}</ul>
          <div className="landing-ticker" aria-hidden="true">
            <div className="landing-ticker-track">
              {[...FEATURES, ...FEATURES].map((feature, index) => <span key={index} className="landing-ticker-item">{feature}</span>)}
            </div>
          </div>
        </section>
        <AuthCard mode={mode} linkModes={path !== '/'} key={mode} />
      </div>
      <style jsx>{`
        .landing { display: grid; grid-template-columns: minmax(0, 1fr) 400px; align-items: center; gap: 48px; min-height: calc(100vh - 64px - 128px); }
        .landing-hero { min-width: 0; }
        /* Bigger than other page titles (refine.css sets every h1 to 40). */
        .landing-title { margin: 0; font:600 64px/1.05 var(--font-display); font-size: 64px !important; letter-spacing:-0.015em; color: var(--ink); }
        .landing-tagline { margin: 12px 0 0; font:500 20px/1.4 var(--font-sans); color: var(--ink); }
        .landing-ticker { margin-top: 32px; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, var(--ink) 10%, var(--ink) 90%, transparent); mask-image: linear-gradient(90deg, transparent, var(--ink) 10%, var(--ink) 90%, transparent); }
        .landing-ticker-track { display: flex; gap: 12px; width: max-content; animation: landing-ticker 48s linear infinite; }
        .landing-ticker:hover .landing-ticker-track { animation-play-state: paused; }
        .landing-ticker-item { flex: none; padding: 10px 18px; border: 1px solid var(--glass-edge); border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--lg-depth); color: var(--ink); font:600 15px/1.2 var(--font-sans); white-space: nowrap; }
        .landing-ticker-item::before { content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 10px 2px 0; border-radius: 50%; background: var(--olive); vertical-align: middle; }
        /* The list is drawn twice, so moving it by half its width loops without a jump. */
        @keyframes landing-ticker { from { transform: translateX(0); } to { transform: translateX(calc(-50% - 6px)); } }
        @media (prefers-reduced-motion: reduce) { .landing-ticker { -webkit-mask-image: none; mask-image: none; } .landing-ticker-track { animation: none; width: auto; flex-wrap: wrap; } .landing-ticker-item:nth-child(n + ${FEATURES.length + 1}) { display: none; } }
        @media (max-width: 860px) { .landing { grid-template-columns: 1fr; gap: 32px; min-height: 0; } .landing-title { font-size: 44px !important; } .landing-tagline { font-size: 17px; } .landing-ticker { margin-top: 24px; } }
      `}</style>
    </PublicPage>
  );
}

export default function LoginPage() {
  return <Landing />;
}
