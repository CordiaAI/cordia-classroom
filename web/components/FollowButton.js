import { useState } from 'react';
import { Check, ChevronDown, UserPlus, UserRoundX } from 'lucide-react';
import Menu from './Menu';
import { follow, unfollow } from '../lib/social';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

// Follow → Requested (when they approve followers; tap to take it back) → Following ▾ (Unfollow).
// state: 'none' | 'pending' | 'active'. onChange(nextState) after the server agrees.
export default function FollowButton({ userId, username, state = 'none', needsApproval = false, onChange, onError }) {
  const [busy, setBusy] = useState(false);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    const result = await action(userId);
    setBusy(false);
    if (result.error) { onError?.(result.error); return; }
    onChange?.(result.data.status || 'none');
  }

  if (state === 'active') {
    return (
      <span className="sb-menu">
        <Menu
          label={`Following @${username}`}
          align="left"
          trigger={<span className="sb-label"><Check {...ICON} />Following<ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" /></span>}
          items={[{ label: 'Unfollow', icon: UserRoundX, onSelect: () => run(unfollow) }]}
        />
        <SocialButtonStyle />
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => run(unfollow)} aria-label={`Follow request sent to @${username}. Take it back`}>
        Requested
      </button>
    );
  }
  return (
    <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => run(follow)} title={needsApproval ? 'They approve followers first' : undefined}>
      <UserPlus {...ICON} />Follow
    </button>
  );
}

// The ▾ menus look like buttons, not round icon buttons.
export function SocialButtonStyle() {
  return (
    <style jsx global>{`
      .sb-menu { display: inline-flex; }
      .sb-menu .c-icon-btn { width: auto; min-width: 0; height: 44px; padding: 0 16px; border-radius: var(--r-pill); }
      .sb-label { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); font: 600 15px/1 var(--font-sans); white-space: nowrap; }
    `}</style>
  );
}
