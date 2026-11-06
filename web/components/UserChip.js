import Link from 'next/link';

// A person in a list: initials avatar, display name and @username, linking to their profile.
// person: { username, display_name, initials }. Without a username it isn't a link.
import VerifiedBadge from './VerifiedBadge';

export default function UserChip({ person, meta }) {
  const body = (
    <>
      <span className="uc-avatar" aria-hidden="true">{person.initials || '?'}</span>
      <span className="uc-names">
        <strong className="uc-name"><span className="c-truncate">{person.display_name || (person.username ? '@' + person.username : 'Someone')}</span>{person.verified && <VerifiedBadge />}</strong>
        <span className="c-meta c-truncate">{person.username ? '@' + person.username : ''}{meta ? (person.username ? ' · ' : '') + meta : ''}</span>
      </span>
    </>
  );
  return (
    <>
      {person.username ? <Link href={`/u/${person.username}`} className="uc">{body}</Link> : <span className="uc">{body}</span>}
      <style jsx global>{`
        .uc { display: flex; align-items: center; gap: 12px; min-width: 0; color: var(--ink); text-decoration: none; }
        a.uc:hover .uc-names strong { text-decoration: underline; text-underline-offset: 3px; }
        .uc-avatar { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); font: 600 15px/1 var(--font-sans); }
        .uc-names { display: grid; gap: 2px; min-width: 0; }
        .uc-names strong { font: 600 15px/1.3 var(--font-sans); }
        .uc-name { display: flex; align-items: center; gap: 4px; min-width: 0; }
      `}</style>
    </>
  );
}
