import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import BodyPortal from './BodyPortal';
import UsernameField from './UsernameField';
import { getToken } from '../lib/api';
import { currentWalkthrough } from '../lib/walkthrough';
import { claimUsername, loadMyProfile } from '../lib/profiles';

const ASKED = 'cordiaUsernameAsked';
// Study screens and the first-run walkthrough come first; the question waits for a calm page.
const QUIET = ['/session', '/flashcards/study', '/quiz/[guideId]', '/nclex/[guideId]', '/practice/[guideId]', '/learn/[guideId]', '/play/[guideId]', '/settings/privacy', '/u/[username]'];

// Once per sign-in (per browser session), a student without a username is asked to pick one.
// "Not now" asks again next time. Nothing shows when the server can't answer.
export default function UsernameClaim() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState({ name: '', ok: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const asking = useRef(false);

  useEffect(() => {
    if (me || asking.current || !getToken() || QUIET.includes(router.pathname) || currentWalkthrough()) return;
    try { if (sessionStorage.getItem(ASKED)) return; } catch { /* storage blocked: ask anyway */ }
    asking.current = true;
    loadMyProfile().then(profile => {
      try { sessionStorage.setItem(ASKED, '1'); } catch { /* storage blocked */ }
      if (profile && !profile.username) {
        setMe(profile);
        setValue(profile.suggestions?.[0] || '');
      }
    });
  }, [router.pathname]);

  useEffect(() => {
    if (!me) return undefined;
    const onKey = event => { if (event.key === 'Escape') setMe(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me]);

  if (!me) return null;

  async function save(event) {
    event.preventDefault();
    if (!status.ok || saving) return;
    setSaving(true);
    setError('');
    const result = await claimUsername(status.name);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    setMe(null);
  }

  return (
    <BodyPortal>
      <div className="c-scrim">
        <form className="c-sheet claim" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="claim-title">
          <h1 id="claim-title" className="c-title">Pick a username</h1>
          <p className="claim-lead">It's how classmates find you, and your profile link: <span className="claim-link">/u/{status.name || 'username'}</span></p>
          <label className="c-section-title" htmlFor="claim-username">Username</label>
          <UsernameField id="claim-username" value={value} onChange={setValue} onStatus={setStatus} autoFocus />
          {me.suggestions?.length > 0 && (
            <div className="claim-suggest">
              <span className="c-meta">Ideas</span>
              <div className="c-chips">
                {me.suggestions.map(name => (
                  <button key={name} type="button" className="c-chip" aria-pressed={status.name === name} onClick={() => setValue(name)}>@{name}</button>
                ))}
              </div>
            </div>
          )}
          <p className="c-meta claim-note">Your profile shows your username and anything you make public. You choose who sees it in <Link href="/settings/privacy" onClick={() => setMe(null)}>Privacy settings</Link>.</p>
          {error && <p className="claim-error" role="alert">{error}</p>}
          <div className="claim-actions">
            <button type="button" className="c-btn c-btn--secondary" onClick={() => setMe(null)}>Not now</button>
            <button type="submit" className="c-btn c-btn--primary" disabled={!status.ok || saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
          <style jsx>{`
            .claim { display: grid; gap: 14px; width: min(480px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; }
            .claim-lead { margin: 0; color: var(--ink); }
            .claim-link { font-weight: 600; overflow-wrap: anywhere; }
            .claim-suggest { display: grid; gap: 8px; }
            .claim-note { margin: 0; }
            .claim-error { margin: 0; color: var(--error); font-weight: 600; }
            .claim-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
            @media (max-width: 767px) { .claim-actions :global(.c-btn) { flex: 1; } }
          `}</style>
        </form>
      </div>
    </BodyPortal>
  );
}
