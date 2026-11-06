import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import { SectionLoader } from '../components/CordiaLoader';
import UserChip from '../components/UserChip';
import {
  acceptFriend, approveFollow, declineFollow, declineFriend, loadPeople, removeFollower, removeFriend, unfollow,
} from '../lib/social';
import SegmentedControl from '../components/SegmentedControl';

const TABS = [
  { key: 'activity', label: 'Activity' },
  { key: 'friends', label: 'Friends' },
  { key: 'following', label: 'Following' },
  { key: 'followers', label: 'Followers' },
  { key: 'requests', label: 'Requests' },
];

// The lists each tab shows. Requests has four: what's waiting on you, then what you sent.
const LISTS = {
  friends: [{ id: 'friends', list: 'friends', empty: "No friends yet. Add friends from their profile." }],
  following: [{ id: 'following', list: 'following', empty: "You aren't following anyone yet." }],
  followers: [{ id: 'followers', list: 'followers', empty: 'No followers yet.' }],
  requests: [
    { id: 'friend-in', list: 'requests', params: { kind: 'friend', direction: 'incoming' }, title: 'Friend requests', empty: 'No friend requests.' },
    { id: 'follow-in', list: 'requests', params: { kind: 'follow', direction: 'incoming' }, title: 'Follow requests', empty: 'No follow requests.' },
    { id: 'friend-out', list: 'requests', params: { kind: 'friend', direction: 'outgoing' }, title: 'Friend requests you sent', empty: 'Nothing waiting.' },
    { id: 'follow-out', list: 'requests', params: { kind: 'follow', direction: 'outgoing' }, title: 'Follow requests you sent', empty: 'Nothing waiting.' },
  ],
};

// What you can do with each person, per list. Each action removes them from the list when done.
const ACTIONS = {
  friends: [{ label: 'Remove', run: removeFriend }],
  following: [{ label: 'Unfollow', run: unfollow }],
  followers: [{ label: 'Remove', run: removeFollower }],
  'friend-in': [{ label: 'Accept', run: acceptFriend, primary: true }, { label: 'Decline', run: declineFriend }],
  'follow-in': [{ label: 'Approve', run: approveFollow, primary: true }, { label: 'Decline', run: declineFollow }],
  'friend-out': [{ label: 'Cancel', run: removeFriend }],
  'follow-out': [{ label: 'Cancel', run: unfollow }],
};

// Friends: who you're friends with, who you follow, who follows you, and requests both ways.
// Activity from people you follow arrives in a later stage.
export default function FriendsPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const [tab, setTab] = useState('friends');
  const [lists, setLists] = useState({}); // id -> { items, cursor, failed }
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const wanted = String(router.query.tab || '');
    if (TABS.some(item => item.key === wanted)) setTab(wanted);
  }, [router.query.tab]);

  useEffect(() => {
    if (!ready) return;
    (LISTS[tab] || []).forEach(section => { if (!lists[section.id]) load(section); });
  }, [ready, tab]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  async function load(section, cursor) {
    const data = await loadPeople(section.list, { ...section.params, cursor });
    setLists(current => {
      const before = cursor ? current[section.id]?.items || [] : [];
      return { ...current, [section.id]: data ? { items: [...before, ...data.items], cursor: data.next_cursor } : { items: before, failed: true } };
    });
  }

  function pick(key) {
    setTab(key);
    router.replace({ pathname: '/friends', query: key === 'friends' ? {} : { tab: key } }, undefined, { shallow: true });
  }

  function onTabKey(event) {
    const index = TABS.findIndex(item => item.key === tab);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    pick(target.key);
    document.getElementById(`ftab-${target.key}`)?.focus();
  }

  async function act(sectionId, person, action) {
    const key = `${sectionId}:${person.user_id}`;
    if (busy) return;
    setBusy(key);
    const result = await action.run(person.user_id);
    setBusy('');
    if (result.error) { setToast(result.error); return; }
    setLists(current => {
      const next = { ...current, [sectionId]: { ...current[sectionId], items: current[sectionId].items.filter(item => item.user_id !== person.user_id) } };
      // Accepting a friend changes Friends and Following too: read them again when next shown.
      if (sectionId === 'friend-in' && action.primary) { delete next.friends; delete next.following; delete next.followers; }
      if (sectionId === 'follow-in' && action.primary) delete next.followers;
      return next;
    });
  }

  if (!ready) return null;
  const sections = LISTS[tab] || [];
  const loading = sections.some(section => !lists[section.id]);

  return (
    <div className="c-page fr">
      <header className="c-page-head"><h1 className="c-title">Friends</h1></header>
      <SegmentedControl kind="tabs" label="Friends" className="fr-tabs" scroller onKeyDown={onTabKey}>
        {TABS.map(item => (
          <button key={item.key} id={`ftab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`fpanel-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? 'is-active' : ''} onClick={() => pick(item.key)}>
            {item.label}
          </button>
        ))}
      </SegmentedControl>

      <div id={`fpanel-${tab}`} role="tabpanel" aria-labelledby={`ftab-${tab}`} className="fr-panel">
        {tab === 'activity' && <p className="c-card fr-empty">Activity from people you follow arrives soon.</p>}
        {tab !== 'activity' && loading && <SectionLoader height={160} label="Loading" />}
        {tab !== 'activity' && !loading && sections.map(section => {
          const data = lists[section.id];
          return (
            <section key={section.id} className="fr-section" aria-labelledby={section.title ? `fs-${section.id}` : undefined}>
              {section.title && <h2 id={`fs-${section.id}`} className="c-section-title">{section.title}</h2>}
              {data.failed && <p className="c-card fr-empty" role="alert">Couldn't load this list. Try again in a moment.</p>}
              {!data.failed && data.items.length === 0 && <p className="c-card fr-empty">{section.empty}</p>}
              {data.items.length > 0 && (
                <ul className="c-card fr-list">
                  {data.items.map(person => (
                    <li key={person.user_id}>
                      <UserChip person={person} />
                      <span className="fr-actions">
                        {ACTIONS[section.id].map(action => (
                          <button key={action.label} type="button" className={'c-btn c-btn--sm ' + (action.primary ? 'c-btn--primary' : 'c-btn--secondary')}
                            disabled={busy === `${section.id}:${person.user_id}`} onClick={() => act(section.id, person, action)}
                            aria-label={`${action.label} ${person.username ? '@' + person.username : person.display_name}`}>
                            {action.label}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {data.cursor && <button type="button" className="c-btn c-btn--secondary fr-more" onClick={() => load(section, data.cursor)}>Show more</button>}
            </section>
          );
        })}
      </div>

      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      <style jsx>{`
        .fr { width: min(760px, 100%); margin: 0 auto; display: grid; gap: 16px; }
        :global(.fr-tabs) { justify-self: start; max-width: 100%; }
        .fr-panel { display: grid; gap: 20px; }
        .fr-section { display: grid; gap: 10px; }
        .fr-section h2 { margin: 0; }
        .fr-empty { margin: 0; padding: 24px 20px; color: var(--muted); text-align: center; }
        .fr-list { display: grid; margin: 0; padding: 6px 0; list-style: none; }
        .fr-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; min-width: 0; }
        .fr-list li + li { border-top: 1px solid var(--hairline); }
        .fr-actions { display: flex; gap: 8px; flex: none; margin-left: auto; }
        .fr-more { justify-self: start; }
        /* Narrow: two buttons (Accept, Decline) drop under the name; one fits beside it. */
        .fr-list li { flex-wrap: wrap; }
      `}</style>
    </div>
  );
}
