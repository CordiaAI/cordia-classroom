import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { clearAuth, getToken, tryRefreshToken } from '../lib/api';
import { rememberReturnTo, takeReturnTo } from '../lib/returnTo.mjs';
import PublicPage from '../components/PublicPage';
import AuthCard from '../components/AuthCard';
import { ENTITY_LINE } from '../lib/brand.mjs';

// What Classroom does. They slide right to left under the title; the ones with a use-case page
// (lib/useCases/) link to it.
const FEATURES = [
  { text: 'Turns slides and PDFs into study guides', href: '/ai-study-guide-generator' },
  { text: 'Generates math practice' },
  { text: 'Makes practice quizzes from your notes', href: '/ai-quiz-generator' },
  { text: 'Tutor reminds you through phone messages' },
  { text: 'Records lectures into full outlines' },
  { text: 'Makes flashcards with spaced review', href: '/ai-flashcard-maker' },
  { text: 'Captures slides from Canvas, Blackboard and Moodle', href: '/install-extension' },
  { text: 'Shows the grade you need on your next assignment' },
  { text: 'Syncs Canvas deadlines and grades', href: '/canvas-study-tool' },
  { text: 'Learns how you study best' },
  { text: 'Tutor reads the page you have open' },
];

// One ticker pill: a link when the feature has a page. The ticker is hidden from screen readers
// (the list above it carries the same links), so its links stay out of the tab order.
const Pill = ({ feature }) => (feature.href
  ? <Link href={feature.href} className="landing-ticker-item" tabIndex={-1}>{feature.text}</Link>
  : <span className="landing-ticker-item">{feature.text}</span>);

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
    <PublicPage path={path} backdrop="/login-learning-backdrop.webp">
      <div className="landing">
        <section className="landing-hero">
          <h1 className="landing-title">Cordia Classroom</h1>
          {/* Answer-first: what Cordia Classroom is, before the feature ticker and the sign-in card. */}
          <p className="landing-lede">{ENTITY_LINE}</p>
          <ul className="sr-only">{FEATURES.map(feature => <li key={feature.text}>{feature.href ? <Link href={feature.href}>{feature.text}</Link> : feature.text}</li>)}</ul>
          <div className="landing-ticker" aria-hidden="true">
            <div className="landing-ticker-track">
              {[...FEATURES, ...FEATURES].map((feature, index) => <Pill key={index} feature={feature} />)}
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
        .landing-lede { max-width: 34em; margin: 16px 0 0; color: var(--text-secondary); font: 500 var(--fs-17)/1.5 var(--font-sans); }
        .landing-ticker { margin-top: 32px; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, var(--ink) 10%, var(--ink) 90%, transparent); mask-image: linear-gradient(90deg, transparent, var(--ink) 10%, var(--ink) 90%, transparent); }
        .landing-ticker-track { display: flex; gap: 12px; width: max-content; animation: landing-ticker 48s linear infinite; }
        .landing-ticker:hover .landing-ticker-track { animation-play-state: paused; }
        .landing-ticker :global(.landing-ticker-item) { flex: none; padding: 10px 18px; border: 1px solid var(--glass-edge); border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--lg-depth); color: var(--ink); font:600 15px/1.2 var(--font-sans); white-space: nowrap; text-decoration: none; }
        .landing-ticker :global(.landing-ticker-item)::before { content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 10px 2px 0; border-radius: 50%; background: var(--olive); vertical-align: middle; }
        /* The list is drawn twice, so moving it by half its width loops without a jump. */
        @keyframes landing-ticker { from { transform: translateX(0); } to { transform: translateX(calc(-50% - 6px)); } }
        @media (prefers-reduced-motion: reduce) { .landing-ticker { -webkit-mask-image: none; mask-image: none; } .landing-ticker-track { animation: none; width: auto; flex-wrap: wrap; } .landing-ticker :global(.landing-ticker-item):nth-child(n + ${FEATURES.length + 1}) { display: none; } }
        @media (max-width: 860px) { .landing { grid-template-columns: 1fr; gap: 32px; min-height: 0; } .landing-title { font-size: clamp(34px, 10vw, 44px) !important; } .landing-lede { font-size: var(--fs-15); } .landing-ticker { margin-top: 24px; } }
      `}</style>
    </PublicPage>
  );
}

export default function LoginPage() {
  return <Landing />;
}
