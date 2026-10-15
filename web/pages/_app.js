import '../styles/globals.css';
import '../styles/classroom.css';
import '../styles/system.css';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import UpgradeModal from '../components/UpgradeModal';
import { scheduleProactiveRefresh, getToken } from '../lib/api';
import { applyTheme, syncThemeFromAccount } from '../lib/theme';
import { useProgress } from '../lib/progress';
import { Analytics } from '@vercel/analytics/react';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  // Public pages render without the signed-in shell. Pricing gets the app nav when signed in.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { setSignedIn(Boolean(getToken())); }, [router.pathname]);
  const isLoginPage = ['/', '/login', '/signup', '/pricing', '/auth/callback', '/reset-password'].includes(router.pathname)
    && !(router.pathname === '/pricing' && signedIn);

  // Authentication pages stay light; workspace routes honor the saved preference.
  useEffect(() => { applyTheme(router.pathname); }, [router.pathname]);

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
      <title>CordiaClassroom</title>
      <meta name="application-name" content="CordiaClassroom" />
      <meta name="description" content="Turn course material into focused study guides, notes, flashcards, and practice with CordiaClassroom." />
      <meta property="og:site_name" content="CordiaClassroom" />
      <meta property="og:title" content="CordiaClassroom" />
      <meta property="og:description" content="Turn course material into focused study guides, notes, flashcards, and practice." />
      <meta property="og:image" content="https://classroom.cordiaai.io/cordia-classroom-icon.png" key="og:image" />
            <meta name="twitter:card" content="summary" />
    </Head>
  );

  if (isLoginPage) {
    return <>{brandHead}<Component {...pageProps} /><Analytics /></>;
  }

  return (
    <>
      {brandHead}
      <Layout timerState={timerState} setTimerState={setTimerState}>
        <Component {...pageProps} timerState={timerState} setTimerState={setTimerState} />
      </Layout>
      <UpgradeModal />
      <Analytics />
    </>
  );
}
