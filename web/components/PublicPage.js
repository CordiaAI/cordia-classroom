import Head from 'next/head';
import Link from 'next/link';
import AcademicInfinityMark from './AcademicInfinityMark';

const SITE = 'https://classroom.cordiaai.io';

// Shared frame for the signed-out pages: clouds, wordmark, and three links.
export default function PublicPage({ title, description, path = '/', children }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={SITE + path} />
        <meta property="og:url" content={SITE + path} />
        <meta property="og:image" content={`${SITE}/cordia-classroom-icon.png`} key="og:image" />
      </Head>
      <div className="public" style={{ '--public-backdrop': "url('/classroom-clouds.webp')" }}>
        <header className="public-nav">
          <Link href="/" className="public-brand" aria-label="Cordia Classroom home"><AcademicInfinityMark className="public-mark" title="" /><span>cordia</span></Link>
          <nav aria-label="Public">
            <Link href="/mission">Approach</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/login" className="public-signin">Sign in</Link>
          </nav>
        </header>
        <main className="public-main">{children}</main>
      </div>
      <style jsx global>{`
        .public { min-height: 100vh; background: linear-gradient(rgba(237, 242, 244, .55), rgba(237, 242, 244, .8)), var(--public-backdrop) center / cover fixed; color: #171B18; }
        .public-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 64px; padding: 0 24px; background: rgba(255, 255, 252, .73); border-bottom: 1px solid rgba(255, 255, 255, .85); -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%); }
        .public-brand { display: inline-flex; align-items: center; gap: 8px; color: #171B18; text-decoration: none; font: 600 22px/1 var(--font-display); }
        .public-brand:hover { text-decoration: none; }
        .public-mark { width: 30px; height: 26px; object-fit: contain; }
        .public-nav nav { display: flex; align-items: center; gap: 4px; }
        .public-nav nav a { display: inline-flex; align-items: center; height: 40px; padding: 0 14px; border-radius: 999px; color: #171B18; font: 600 15px/1 var(--font-sans); text-decoration: none; }
        .public-nav nav a:hover { background: rgba(83, 97, 73, .12); text-decoration: none; }
        .public-nav nav a.public-signin { background: #536149; color: #fff; }
        .public-main { width: min(1120px, 100%); margin: 0 auto; padding: 48px 24px 80px; }
        @media (max-width: 600px) { .public-nav { padding: 0 12px 0 16px; } .public-nav nav a:not(.public-signin):first-child { display: none; } .public-main { padding: 32px 16px 64px; } }
      `}</style>
    </>
  );
}
