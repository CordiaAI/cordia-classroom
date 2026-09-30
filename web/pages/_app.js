import '../styles/globals.css';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { scheduleProactiveRefresh, getToken } from '../lib/api';
import { Analytics } from '@vercel/analytics/react';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isLoginPage = router.pathname === '/';

  // Authentication pages stay light; workspace routes honor the saved preference.
  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('theme');
    const theme = router.pathname === '/' || router.pathname === '/reset-password' ? 'light' : saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, [router.pathname]);

  // Start proactive token refresh if already logged in
  useEffect(() => {
    if (getToken()) scheduleProactiveRefresh();
  }, []);
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
      <meta property="og:image" content="https://classroom.cordiaai.io/cordia-classroom-icon.png" />
      <meta property="og:url" content="https://classroom.cordiaai.io" />
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
      <Analytics />
    </>
  );
}
