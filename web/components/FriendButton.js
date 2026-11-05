import { useState } from 'react';
import { ChevronDown, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import Menu from './Menu';
import { SocialButtonStyle } from './FollowButton';
import { acceptFriend, declineFriend, removeFriend, requestFriend } from '../lib/social';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

// Add friend → Requested (tap to take back) → Friends ▾ (Remove friend). When they asked you:
// Accept / Decline. Disabled with their reason when they aren't taking requests from you.
// state: 'none' | 'outgoing' | 'incoming' | 'friends'. onChange(nextState) after the server agrees.
export default function FriendButton({ userId, username, state = 'none', note, onChange, onError }) {
  const [busy, setBusy] = useState(false);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    const result = await action(userId);
    setBusy(false);
    if (result.error) { onError?.(result.error); return; }
    onChange?.(result.data.friendship || 'none');
  }

  if (state === 'friends') {
    return (
      <span className="sb-menu">
        <Menu
          label={`Friends with @${username}`}
          align="left"
          trigger={<span className="sb-label"><UserCheck {...ICON} />Friends<ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" /></span>}
          items={[{ label: 'Remove friend', icon: UserMinus, danger: true, onSelect: () => run(removeFriend) }]}
        />
        <SocialButtonStyle />
      </span>
    );
  }
  if (state === 'incoming') {
    return (
      <span className="fb-pair" role="group" aria-label={`Friend request from @${username}`}>
        <button type="button" className="c-btn c-btn--primary" disabled={busy} onClick={() => run(acceptFriend)}>Accept</button>
        <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => run(declineFriend)}>Decline</button>
        <style jsx>{`.fb-pair { display: inline-flex; gap: 8px; flex-wrap: wrap; }`}</style>
      </span>
    );
  }
  if (state === 'outgoing') {
    return (
      <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => run(removeFriend)} aria-label={`Friend request sent to @${username}. Take it back`}>
        Requested
      </button>
    );
  }
  return (
    <button type="button" className="c-btn c-btn--primary" disabled={busy || Boolean(note)} onClick={() => run(requestFriend)} title={note || undefined} aria-describedby={note ? `fb-note-${userId}` : undefined}>
      <UserPlus {...ICON} />Add friend
      {note && <span id={`fb-note-${userId}`} className="sr-only">{note}</span>}
    </button>
  );
}
