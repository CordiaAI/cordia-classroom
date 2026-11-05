import { useState } from 'react';
import { Copy, EyeOff, Globe, Link2, Lock, ShieldAlert, UserRound, Users } from 'lucide-react';
import Menu from './Menu';
import PublishSheet from './PublishSheet';
import { copyText, guideLink, setGuideVisibility } from '../lib/guideSharing';
import { chipLabel } from '../lib/guideVisibility.mjs';

const ICONS = { public: Globe, link: Link2, classroom: Users, private: Lock };

// Who can see a guide (Private · Link · Classroom · Public), whether the author's name shows, and
// Share (copies the link). Replaces the old "Shared with MGT 300" chip. The server decides: the
// first public or link share answers honor_code_required, and the Honor Code sheet opens.
//   guide: { id, visibility, attribution, review_status, hold_reason }
//   course: { code, sharing_blocked } when the guide is filed under a class, else null
//   copy: true for a copy of someone else's guide (it stays private)
export default function VisibilityChip({ guide, course, copy = false, onChange, onToast }) {
  const [asking, setAsking] = useState(null); // 'public' | 'link' while the Honor Code sheet is open
  const visibility = guide.visibility || 'private';
  const attribution = guide.attribution || 'named';
  const Icon = ICONS[visibility] || Lock;
  const held = (guide.review_status || 'ok') !== 'ok';

  async function apply(changes, message) {
    const { result, honor, error } = await setGuideVisibility(guide.id, changes);
    if (honor) { setAsking(changes.visibility); return false; }
    if (error) { onToast?.(error); return false; }
    onChange?.(result);
    if (result.review_status === 'held') onToast?.('Held for review');
    else if (message) onToast?.(message(result));
    return true;
  }

  async function share() {
    const ok = await copyText(guideLink(guide.id));
    onToast?.(ok ? 'Link copied' : guideLink(guide.id));
  }

  // A copy of someone else's guide, or a private guide in a class whose instructor turned sharing off.
  const fixed = copy ? 'Private copy' : course?.sharing_blocked && visibility === 'private' ? `Sharing off for ${course.code}` : null;

  const label = chipLabel(visibility, course);
  const pick = (value, text) => () => apply({ visibility: value }, () => text);
  const items = [
    { key: 'public', label: 'Public', meta: 'Anyone can find it', icon: Globe, current: visibility === 'public', onSelect: pick('public', 'Public') },
    { key: 'link', label: 'Link', meta: 'Only people with the link', icon: Link2, current: visibility === 'link', onSelect: pick('link', 'Anyone with the link can see it') },
    {
      key: 'classroom', label: 'Classroom', icon: Users, current: visibility === 'classroom', disabled: !course || course.sharing_blocked,
      meta: !course ? 'Add it to a class first' : course.sharing_blocked ? `Sharing is off for ${course.code}` : `Classmates in ${course.code}`,
      onSelect: pick('classroom', `Shared with ${course?.code || 'your class'}`),
    },
    { key: 'private', label: 'Private', meta: 'Only you', icon: Lock, current: visibility === 'private', onSelect: pick('private', 'Private') },
    attribution === 'anonymous'
      ? { key: 'name', label: 'Show my name', meta: 'Now: Anonymous classmate', icon: UserRound, onSelect: () => apply({ attribution: 'named' }, () => 'Your name shows') }
      : { key: 'name', label: 'Post anonymously', meta: 'Now: your name shows', icon: EyeOff, onSelect: () => apply({ attribution: 'anonymous' }, () => 'Shown as Anonymous classmate') },
    ...(visibility === 'private' ? [] : [{ key: 'share', label: 'Share', meta: 'Copy the link', icon: Copy, onSelect: share }]),
  ];

  return (
    <span className="vis">
      {fixed ? (
        <span className="c-chip vis-static"><Lock size={16} strokeWidth={1.75} aria-hidden="true" />{fixed}</span>
      ) : (
        <Menu
          label={`Who can see this: ${label}`}
          align="left"
          trigger={<span className="vis-label"><Icon size={16} strokeWidth={1.75} aria-hidden="true" />{label}</span>}
          items={items}
        />
      )}
      {held && (
        <span className="c-chip vis-held" title={guide.hold_reason || undefined}>
          <ShieldAlert size={16} strokeWidth={1.75} aria-hidden="true" />Held for review
        </span>
      )}
      {asking && (
        <PublishSheet
          visibility={asking}
          attribution={attribution}
          onClose={() => setAsking(null)}
          onPublish={async chosen => {
            const ok = await apply({ visibility: asking, attribution: chosen, accept_honor_code: true },
              () => (asking === 'public' ? 'Public' : 'Anyone with the link can see it'));
            if (ok) setAsking(null);
          }}
          onPrivate={async () => {
            if (visibility !== 'private') await apply({ visibility: 'private' }, () => 'Private');
            else onToast?.('Kept private');
            setAsking(null);
          }}
        />
      )}
      <style jsx>{`
        .vis { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .vis-label { display: inline-flex; align-items: center; gap: 6px; font: 600 13px/1 var(--font-sans); white-space: nowrap; }
        .vis :global(.c-menu-wrap > .c-icon-btn) { width: auto; height: 32px; padding: 0 12px; border-radius: var(--r-pill); border: 1px solid var(--line); }
        .vis-held, .vis-static { display: inline-flex; align-items: center; gap: 6px; height: 32px; font: 600 13px/1 var(--font-sans); }
        .vis-held { color: var(--warning); }
      `}</style>
    </span>
  );
}
