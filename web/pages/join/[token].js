import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getToken } from '../../lib/api';
import { pageTitle } from '../../lib/pageTitle';
import { previewInvite } from '../../lib/classrooms';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import PublicPage from '../../components/PublicPage';
import JoinCard from '../../components/JoinCard';

// An invite link (/join/<token>): the classroom it leads to, then Join. Signed-out visitors see the
// preview in the public frame with Sign up and Sign in.
export default function JoinInvitePage() {
  const router = useRouter();
  const token = String(router.query.token || '');
  const [signedIn, setSignedIn] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => { setSignedIn(Boolean(getToken())); }, []);
  useEffect(() => {
    if (!token || signedIn === null) return;
    previewInvite(token).then(setPreview);
  }, [token, signedIn]);
  const gate = useLoadGate(Boolean(preview));

  const body = gate === 'waiting' || gate === 'loader' ? <LoadingArea phase={gate} label="Opening the invite" /> : (
    <Reveal phase={gate}>
      {preview?.valid ? <JoinCard preview={preview} signedIn={signedIn} /> : (
        <section className="c-card jbad">
          <h1 className="c-title">This invite doesn’t work</h1>
          <p>{preview?.reason || 'This invite isn’t valid.'}</p>
          <Link href={signedIn ? '/join' : '/'} className="c-btn c-btn--secondary">{signedIn ? 'Enter a code' : 'Go to Cordia'}</Link>
          <style jsx>{`.jbad { width: min(520px, 100%); margin: 32px auto; padding: 24px; display: grid; gap: 12px; justify-items: start; } .jbad :global(.c-title), .jbad p { margin: 0; }`}</style>
        </section>
      )}
    </Reveal>
  );
  const head = <Head><title>{pageTitle(preview?.classroom?.name || 'Join a classroom')}</title><meta name="robots" content="noindex" /></Head>;
  if (!signedIn) return <>{head}<PublicPage title={pageTitle('Join a classroom')} description="A classroom invite on Cordia Classroom." path={`/join/${token}`}>{body}</PublicPage></>;
  return <>{head}<div className="c-page">{body}</div></>;
}
