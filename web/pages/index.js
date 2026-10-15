import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight } from 'lucide-react';
import { getToken } from '../lib/api';
import PublicPage from '../components/PublicPage';
import AuthCard from '../components/AuthCard';

// Signed-out home: the headline and the sign-in card. /login and /signup reuse it.
export function Landing({ mode = 'signin', path = '/' }) {
  const router = useRouter();
  useEffect(() => {
    if (getToken()) router.push('/dashboard');
  }, []);

  return (
    <PublicPage
      title="CordiaClassroom — AI Study Guides, Notes & Flashcards"
      description="Turn lectures, textbooks, and course pages into focused study materials."
      path={path}
    >
      <div className="landing">
        <section className="landing-hero">
          <div className="landing-brand-name" aria-hidden="true">Cordia<br />Classroom</div>
          <h1 className="landing-title">Your space to learn.</h1>
          {path === '/' && <Link href="/signup" className="landing-cta">Get started<ArrowRight size={20} strokeWidth={1.75} aria-hidden="true" /></Link>}
        </section>
        <AuthCard mode={mode} linkModes={path !== '/'} key={mode} />
      </div>
      <style jsx>{`
        .landing { display: grid; grid-template-columns: minmax(0, 1fr) 400px; align-items: center; gap: 48px; min-height: calc(100vh - 64px - 128px); }
        .landing-brand-name { font: 600 22px/1.15 var(--font-display); color: var(--olive-ink); margin-bottom: 20px; }
        .landing-title { margin: 0; font: 600 clamp(44px, 7vw, 88px)/1.02 var(--font-display); letter-spacing: -0.02em; color: var(--ink); }
        .landing-hero :global(.landing-cta) { display: inline-flex; align-items: center; gap: 8px; height: 48px; margin-top: 32px; padding: 0 24px; border-radius: 999px; background: var(--olive); color: var(--on-olive); font: 600 15px/1 var(--font-sans); text-decoration: none; }
        @media (max-width: 1023px) { .landing { grid-template-columns: 1fr; gap: 32px; min-height: 0; } .landing-hero :global(.landing-cta) { display: none; } }
      `}</style>
    </PublicPage>
  );
}

export default function LoginPage() {
  return <Landing />;
}
