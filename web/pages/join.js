import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import { pageTitle } from '../lib/pageTitle';
import { previewInvite } from '../lib/classrooms';

// Join a classroom with the 8-character code someone gave you.
export default function JoinWithCode() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) { setError('Codes have 8 letters and numbers.'); return; }
    setBusy(true);
    const preview = await previewInvite(clean);
    setBusy(false);
    if (preview?.valid) router.push('/join/' + preview.token);
    else setError(preview?.reason || 'That code doesn’t work.');
  }

  if (!ready) return null;
  return (
    <div className="c-page">
      <Head><title>{pageTitle('Join a classroom')}</title></Head>
      <form className="c-card jcode" onSubmit={submit}>
        <h1 className="c-title">Join a classroom</h1>
        <label className="jcode-field" htmlFor="jcode-input">Enter the code you were given</label>
        <input id="jcode-input" className="c-input jcode-input" value={code} maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          onChange={event => { setCode(event.target.value); setError(''); }} placeholder="ABCD2345" />
        {error && <p className="jcode-error" role="alert">{error}</p>}
        <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
      <style jsx>{`
        .jcode { width: min(440px, 100%); margin: 32px auto; padding: 24px; display: grid; gap: 12px; }
        .jcode :global(.c-title) { margin: 0; }
        .jcode-field { font: 600 14px/1.2 var(--font-sans); color: var(--ink); }
        .jcode-input { font: 600 22px/1.2 var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; }
        .jcode-error { margin: 0; color: var(--text-error); }
      `}</style>
    </div>
  );
}
