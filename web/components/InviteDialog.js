import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { apiFetch } from '../lib/api';
import { createInvite, inviteFriends, inviteLink, listInvites, regenerateInvite, revokeInvite } from '../lib/classrooms';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Invite people to a classroom: copy the link, read out the code, or invite friends by name.
// A private classroom only has the friends list (links and codes don't work there).
export default function InviteDialog({ classroom, onClose }) {
  const [invite, setInvite] = useState(null);
  const [privateRoom, setPrivateRoom] = useState(classroom.visibility === 'private');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [friends, setFriends] = useState(null);
  const [picked, setPicked] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    (async () => {
      const data = await listInvites(classroom.id);
      if (!live) return;
      const isPrivate = Boolean(data?.private);
      setPrivateRoom(isPrivate);
      let first = data?.invites?.[0] || null;
      if (!first && !isPrivate && data?.invites) first = (await createInvite(classroom.id))?.invite || null;
      if (live) { setInvite(first); setLoading(false); }
    })();
    apiFetch('/social/friends').then(data => { if (live) setFriends(data?.items || []); });
    return () => { live = false; };
  }, [classroom.id]);

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(''); }
  }

  async function regenerate() {
    if (!invite) return;
    setBusy(true);
    const data = await regenerateInvite(invite.id);
    setBusy(false);
    if (data?.invite) { setInvite(data.invite); setStatus('New link and code made. The old ones no longer work.'); }
  }

  async function turnOff() {
    if (!invite) return;
    setBusy(true);
    await revokeInvite(invite.id);
    setBusy(false);
    setInvite(null);
    setStatus('Link and code turned off.');
  }

  async function sendFriends() {
    if (!picked.length) return;
    setBusy(true);
    const data = await inviteFriends(classroom.id, picked);
    setBusy(false);
    setPicked([]);
    setStatus(data?.sent ? `Invited ${data.sent} ${data.sent === 1 ? 'friend' : 'friends'}.` : data?.detail || 'Nobody new to invite.');
  }

  const link = invite ? inviteLink(invite.token) : '';
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet inv" role="dialog" aria-modal="true" aria-labelledby="inv-title" onClick={event => event.stopPropagation()}>
          <div className="inv-head">
            <h2 id="inv-title" className="inv-title">Invite to {classroom.name}</h2>
            <button ref={closeRef} type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X {...ICON} /></button>
          </div>
          {loading && <SectionLoader label="Loading the invite" />}
          {!loading && privateRoom && <p className="c-meta">This classroom is private, so only people invited by name can join.</p>}
          {!loading && !privateRoom && invite && (
            <div className="inv-link">
              <label className="inv-label" htmlFor="inv-url">Link</label>
              <div className="inv-row">
                <input id="inv-url" className="c-input" readOnly value={link} onFocus={event => event.target.select()} />
                <button type="button" className="c-btn c-btn--secondary" onClick={() => copy(link, 'link')}>{copied === 'link' ? <Check {...ICON} /> : <Copy {...ICON} />}{copied === 'link' ? 'Copied' : 'Copy'}</button>
              </div>
              <p className="inv-label">Code</p>
              <div className="inv-row">
                <span className="inv-code" aria-label={`Code ${invite.code.split('').join(' ')}`}>{invite.code}</span>
                <button type="button" className="c-btn c-btn--secondary" onClick={() => copy(invite.code, 'code')}>{copied === 'code' ? <Check {...ICON} /> : <Copy {...ICON} />}{copied === 'code' ? 'Copied' : 'Copy'}</button>
              </div>
              <p className="c-meta">People enter it at <b>Join with a code</b>.</p>
              <div className="inv-row">
                <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={regenerate}><RefreshCw {...ICON} />New link and code</button>
                <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={turnOff}>Turn off</button>
              </div>
            </div>
          )}
          {!loading && !privateRoom && !invite && (
            <button type="button" className="c-btn c-btn--secondary" disabled={busy}
              onClick={async () => { const data = await createInvite(classroom.id); if (data?.invite) setInvite(data.invite); }}>Make a link and code</button>
          )}
          <div className="inv-friends">
            <h3 className="inv-label">Invite friends</h3>
            {friends === null && <SectionLoader label="Loading friends" />}
            {friends && !friends.length && <p className="c-meta">Add friends from their profiles to invite them here by name.</p>}
            {friends && friends.length > 0 && (
              <ul className="inv-list">
                {friends.map(friend => (
                  <li key={friend.user_id}>
                    <label className="inv-friend">
                      <input type="checkbox" checked={picked.includes(friend.user_id)}
                        onChange={event => setPicked(current => (event.target.checked ? [...current, friend.user_id] : current.filter(id => id !== friend.user_id)))} />
                      <span className="inv-avatar" aria-hidden="true">{friend.initials}</span>
                      <span>{friend.display_name}{friend.username ? <span className="c-meta"> @{friend.username}</span> : null}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {friends && friends.length > 0 && (
              <button type="button" className="c-btn c-btn--primary" disabled={busy || !picked.length} onClick={sendFriends}>
                Invite {picked.length || ''} {picked.length === 1 ? 'friend' : 'friends'}
              </button>
            )}
          </div>
          {status && <p className="c-meta" role="status">{status}</p>}
        </section>
      </div>
      <style jsx global>{`
        .inv { width: min(520px, 100%); display: grid; gap: 16px; max-height: min(90vh, 760px); overflow-y: auto; }
        .inv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .inv-title { margin: 0; font: 500 26px/1.15 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
        .inv-link, .inv-friends { display: grid; gap: 8px; }
        .inv-label { margin: 0; font: 600 14px/1.2 var(--font-sans); color: var(--ink); }
        .inv-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .inv-row .c-input { flex: 1 1 200px; min-width: 0; }
        .inv-code { font: 600 24px/1.2 var(--font-mono); letter-spacing: 0.12em; color: var(--ink); }
        .inv-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; max-height: 240px; overflow-y: auto; }
        .inv-friend { display: flex; align-items: center; gap: 10px; color: var(--ink); cursor: pointer; }
        .inv-friend input { width: 18px; height: 18px; accent-color: var(--olive); }
        .inv-avatar { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); flex: none; }
      `}</style>
    </BodyPortal>
  );
}
