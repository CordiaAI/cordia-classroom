import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { UsersRound } from 'lucide-react';
import { KIND_LABELS, joinClassroom, joinMessage } from '../lib/classrooms';

// The classroom an invite leads to, and Join. An instructor class first asks whether its
// instructor may see your progress (you can change it later in the classroom's settings).
export default function JoinCard({ preview, signedIn }) {
  const router = useRouter();
  const room = preview.classroom;
  const [share, setShare] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function join() {
    setBusy(true);
    const result = await joinClassroom({ token: preview.token, ...(room.needs_consent ? { share_progress: share } : {}) });
    setBusy(false);
    if (result?.status === 'active') { router.push('/classrooms/' + result.classroom_id); return; }
    setMessage(joinMessage(result));
  }

  const status = room.my_status;
  return (
    <section className="c-card jc" aria-labelledby="jc-title">
      <UsersRound size={28} strokeWidth={1.75} aria-hidden="true" className="jc-icon" />
      <h1 id="jc-title" className="jc-title">{room.name}</h1>
      <p className="c-meta jc-facts">
        {KIND_LABELS[room.kind]} · {room.member_count} {room.member_count === 1 ? 'member' : 'members'}
        {room.owner ? ` · Made by ${room.owner.display_name}` : ''}
      </p>
      {room.description && <p className="jc-desc">{room.description}</p>}
      {!signedIn && (
        <>
          <p className="c-meta">Sign up or sign in, then open this link again to join.</p>
          <div className="jc-actions">
            <Link href="/signup" className="c-btn c-btn--primary">Sign up free</Link>
            <Link href="/login" className="c-btn c-btn--secondary">Sign in</Link>
          </div>
        </>
      )}
      {signedIn && status === 'active' && <Link href={'/classrooms/' + room.id} className="c-btn c-btn--primary">Open classroom</Link>}
      {signedIn && status === 'pending' && <p className="c-meta" role="status">You asked to join. You’ll get in once an admin approves it.</p>}
      {signedIn && !status && (
        <>
          {room.needs_consent && (
            <fieldset className="jc-consent">
              <legend>Your instructor can see your progress in this class if you allow it.</legend>
              <label><input type="radio" name="jc-share" checked={share === true} onChange={() => setShare(true)} /><span>Share my progress with the instructor</span></label>
              <label><input type="radio" name="jc-share" checked={share === false} onChange={() => setShare(false)} /><span>Keep my progress private</span></label>
              <p className="c-meta">You can change this later in the classroom’s settings.</p>
            </fieldset>
          )}
          <button type="button" className="c-btn c-btn--primary" disabled={busy || (room.needs_consent && share === null)} onClick={join}>
            {busy ? 'Joining…' : room.join_policy === 'approval' ? 'Ask to join' : 'Join'}
          </button>
          {message && <p className="c-meta" role="status">{message}</p>}
        </>
      )}
      <style jsx>{`
        .jc { width: min(520px, 100%); margin: 32px auto; padding: 24px; display: grid; gap: 12px; justify-items: start; }
        .jc :global(.jc-icon) { color: var(--olive-ink); }
        .jc-title { margin: 0; font: 500 32px/1.15 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
        .jc-facts, .jc-desc, .jc p { margin: 0; }
        .jc-desc { color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
        .jc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .jc-consent { margin: 0; padding: 0; border: 0; display: grid; gap: 8px; min-width: 0; }
        .jc-consent legend { font: 600 15px/1.35 var(--font-sans); color: var(--ink); margin-bottom: 4px; padding: 0; }
        .jc-consent label { display: flex; gap: 10px; align-items: center; color: var(--ink); cursor: pointer; }
        .jc-consent input { width: 18px; height: 18px; accent-color: var(--olive); }
      `}</style>
    </section>
  );
}
