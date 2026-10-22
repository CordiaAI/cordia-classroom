import '../styles/globals.css';
import '../styles/classroom.css';
import '../styles/system.css';
import '../styles/refine.css';
import '../styles/tokens.css';
import '../styles/glass.css';
import '../styles/assistant.css';
import '../styles/motion.css';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { installErrorReporting } from '../lib/errorReport';
import { installAmbientMotion } from '../lib/ambientMotion';
import Layout from '../components/Layout';
import UpgradeModal from '../components/UpgradeModal';
import { scheduleProactiveRefresh, getToken } from '../lib/api';
import { applyTheme, syncThemeFromAccount } from '../lib/theme';
import { useProgress } from '../lib/progress';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  // Public pages render without the signed-in shell. Pricing gets the app nav when signed in.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { setSignedIn(Boolean(getToken())); }, [router.pathname]);
  const isLoginPage = ['/', '/login', '/signup', '/pricing', '/auth/callback', '/reset-password', '/instructors', '/copyright', '/mission', '/install-extension', '/privacy', '/terms', '/honor-code'].includes(router.pathname)
    && !(router.pathname === '/pricing' && signedIn);

  // Authentication pages stay light; workspace routes honor the saved preference.
  useEffect(() => { applyTheme(router.pathname); }, [router.pathname]);
  useEffect(() => { installErrorReporting(); }, []);
  useEffect(() => installAmbientMotion(), []);

  // Start proactive token refresh if already logged in; the account's saved theme wins over the cache.
  useEffect(() => {
    if (!getToken()) return;
    scheduleProactiveRefresh();
  }, []);
  // The account's saved theme replaces the local cache as soon as the account loads.
  const progress = useProgress();
  useEffect(() => { if (progress.theme) syncThemeFromAccount(); }, [progress.theme]);
  const [timerState, setTimerState] = useState({
    mode: 'focus', minutes: 25, seconds: 0, isRunning: false
  });
  const brandHead = (
    <Head>
      {/* Phones: fit the screen exactly, no pinch or double-tap zoom, and run edge to edge under the notch. */}
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" key="viewport" />
      <title>CordiaClassroom</title>
      <meta name="application-name" content="CordiaClassroom" />
      <meta name="description" content="Turn course material into focused study guides, notes, flashcards, and practice with CordiaClassroom." />
      <meta property="og:site_name" content="CordiaClassroom" />
      <meta property="og:title" content="CordiaClassroom" />
      <meta property="og:description" content="Turn course material into focused study guides, notes, flashcards, and practice." />
      <meta property="og:image" content="https://classroom.cordiaai.io/og-image.png" key="og:image" />
      <meta property="og:image:width" content="1200" key="og:image:width" />
      <meta property="og:image:height" content="630" key="og:image:height" />
            <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
    </Head>
  );

  if (isLoginPage) {
    return <>{brandHead}<Component {...pageProps} /><Analytics /><SpeedInsights /></>;
  }

  return (
    <>
      {brandHead}
      <Layout timerState={timerState} setTimerState={setTimerState}>
        <Component {...pageProps} timerState={timerState} setTimerState={setTimerState} />
      </Layout>
      <UpgradeModal />
      <Analytics />
      <SpeedInsights />
    </>
  );
}
