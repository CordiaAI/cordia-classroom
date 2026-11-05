import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, Ban, Flag, Flame, GraduationCap, Layers, Lock, Pencil } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import Menu from '../../components/Menu';
import ConfirmDialog from '../../components/ConfirmDialog';
import FeedbackModal from '../../components/FeedbackModal';
import FollowButton from '../../components/FollowButton';
import FriendButton from '../../components/FriendButton';
import { blockUser, loadProfile } from '../../lib/profiles';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const TABS = [
  { key: 'guides', label: 'Guides', empty: 'No public guides yet.' },
  { key: 'folders', label: 'Folders', empty: 'Nothing here yet.' },
  { key: 'classrooms', label: 'Classrooms', empty: 'Nothing here yet.' },
];

// A student's profile: who they are (as much as they chose to show) and what they share. Blocked
// pairs and unknown names look the same: not available. An old username moves to the new one.
export default function ProfilePage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const username = String(router.query.username || '');
  const [result, setResult] = useState(null); // { profile } | { missing } | { error }
  const [tab, setTab] = useState('guides');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!ready || !username) return undefined;
    let active = true;
    setResult(null);
    loadProfile(username).then(data => {
      if (!active) return;
      if (data.redirect) router.replace(`/u/${encodeURIComponent(data.redirect)}`);
      else setResult(data);
    });
    return () => { active = false; };
  }, [ready, username]);

  const gate = useLoadGate(Boolean(result));
  if (!ready) return null;
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading profile" />;

  const profile = result?.profile;

  // A follow or friend change: the button updates at once, then the profile is read again so the
  // counts (and "Follows you") match the server.
  function relate(changes) {
    setResult(current => ({ ...current, profile: { ...current.profile, relationship: { ...current.profile.relationship, ...changes } } }));
    loadProfile(username).then(data => { if (data.profile) setResult(data); });
  }

  async function block() {
    setConfirmBlock(false);
    if (await blockUser(profile.id)) setBlocked(true);
  }

  function onTabKey(event) {
    const index = TABS.findIndex(item => item.key === tab);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    setTab(target.key);
    document.getElementById(`ptab-${target.key}`)?.focus();
  }

  return (
    <Reveal phase={gate}>
      <div className="c-page up">
        <header className="up-top">
          <button type="button" className="c-icon-btn" aria-label="Back" onClick={() => router.back()}><ArrowLeft {...ICON} /></button>
        </header>

        {!profile && (
          <div className="c-card up-empty" role="status">
            <h1 className="c-section-title">{result?.missing ? "This profile isn't available" : "Couldn't load this profile"}</h1>
            <p className="c-meta">{result?.missing ? 'The link may be wrong, or the profile may have moved.' : 'Check your connection and try again.'}</p>
            <Link href="/library" className="c-btn c-btn--secondary">Go to Library</Link>
          </div>
        )}

        {profile && blocked && (
          <div className="c-card up-empty" role="status">
            <h1 className="c-section-title">You blocked @{profile.username}</h1>
            <p className="c-meta">You won't see each other. Unblock them any time in Privacy settings.</p>
            <Link href="/settings/privacy" className="c-btn c-btn--secondary">Privacy settings</Link>
          </div>
        )}

        {profile && !blocked && (
          <>
            <section className={'c-card up-head' + (profile.is_self ? ' is-self' : '')} aria-labelledby="up-name">
              <div className="up-avatar" aria-hidden="true">{profile.initials}</div>
              <div className="up-who">
                <h1 id="up-name" className="c-title up-name">{profile.display_name || `@${profile.username}`}</h1>
                <p className="up-handle">@{profile.username}{profile.real_name && profile.real_name !== profile.display_name ? <span> · {profile.real_name}</span> : null}</p>
                {(profile.school || profile.streak > 0 || profile.badges?.length > 0) && (
                  <ul className="up-facts">
                    {profile.school && <li><GraduationCap size={18} strokeWidth={1.75} aria-hidden="true" />{profile.school}</li>}
                    {profile.streak > 0 && <li><Flame size={18} strokeWidth={1.75} aria-hidden="true" />{profile.streak}-day streak</li>}
                    {(profile.badges || []).map(badge => <li key={badge.key || badge.label} className="up-badge">{badge.label}</li>)}
                  </ul>
                )}
                {profile.counts && (
                  <p className="up-counts">
                    <span><strong>{profile.counts.followers}</strong> {profile.counts.followers === 1 ? 'follower' : 'followers'}</span>
                    <span><strong>{profile.counts.following}</strong> following</span>
                    <span><strong>{profile.counts.friends}</strong> {profile.counts.friends === 1 ? 'friend' : 'friends'}</span>
                  </p>
                )}
                {profile.relationship?.follows_you && profile.relationship.friendship !== 'friends' && <p className="c-meta up-follows-you">Follows you</p>}
                {profile.friend_note && <p className="c-meta up-follows-you">{profile.friend_note}</p>}
              </div>
              <div className="up-actions">
                {profile.is_self ? (
                  <Link href="/settings/privacy" className="c-btn c-btn--secondary"><Pencil {...ICON} />Edit profile</Link>
                ) : (
                  <>
                  <FriendButton userId={profile.id} username={profile.username} state={profile.relationship?.friendship}
                    note={profile.friend_note} onChange={friendship => relate({ friendship })} onError={setToast} />
                  <FollowButton userId={profile.id} username={profile.username} state={profile.relationship?.following}
                    needsApproval={profile.follows_need_approval} onChange={following => relate({ following })} onError={setToast} />
                  <Menu label={`More for @${profile.username}`} items={[
                    { label: 'Block', icon: Ban, danger: true, onSelect: () => setConfirmBlock(true) },
                    { label: 'Report', icon: Flag, onSelect: () => setReporting(true) },
                  ]} />
                  </>
                )}
              </div>
            </section>

            {profile.limited ? (
              <div className="c-card up-private">
                <Lock {...ICON} />
                <p>This profile is private.</p>
              </div>
            ) : (
              <>
                <div className="c-seg up-tabs" role="tablist" aria-label="Profile" onKeyDown={onTabKey}>
                  {TABS.map(item => (
                    <button
                      key={item.key}
                      id={`ptab-${item.key}`}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.key}
                      aria-controls={`ppanel-${item.key}`}
                      tabIndex={tab === item.key ? 0 : -1}
                      className={tab === item.key ? 'is-active' : ''}
                      onClick={() => setTab(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {TABS.filter(item => item.key === tab).map(item => (
                  <div key={item.key} id={`ppanel-${item.key}`} role="tabpanel" aria-labelledby={`ptab-${item.key}`} className="up-panel">
                    {(profile[item.key] || []).length === 0 && (
                      <p className="c-card up-none">{profile.is_self && item.key === 'guides' ? 'Guides you make public will show here.' : item.empty}</p>
                    )}
                    {item.key === 'guides' && profile.guides.length > 0 && (
                      <ul className="c-card up-guides">
                        {profile.guides.map(guide => (
                          <li key={guide.id}>
                            <Link href={`/sets/${guide.id}`} className="up-guide">
                              <span className="up-guide-icon"><Layers {...ICON} /></span>
                              <span className="up-guide-text">
                                <strong className="c-truncate">{guide.title}</strong>
                                <span className="c-meta">{guide.question_count} {guide.question_count === 1 ? 'question' : 'questions'}</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {confirmBlock && (
          <ConfirmDialog
            title={`Block @${profile.username}?`}
            message="You won't see each other's profiles, and they can't find you. They aren't told."
            confirmLabel="Block"
            onConfirm={block}
            onCancel={() => setConfirmBlock(false)}
          />
        )}
        {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
        {reporting && (
          <FeedbackModal initialCategory="other" initialMessage={`Report @${profile.username}: `} onClose={() => setReporting(false)} />
        )}

        <style jsx>{`
          .up { width: min(760px, 100%); margin: 0 auto; display: grid; gap: 16px; }
          .up-top { display: flex; }
          .up-guides { list-style: none; margin: 0; padding: 6px; display: grid; }
          .up-guides li + li { border-top: 1px solid var(--line); }
          .up :global(.up-guide) { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 10px; color: var(--ink); text-decoration: none; min-width: 0; }
          .up :global(.up-guide:hover strong) { text-decoration: underline; text-underline-offset: 3px; }
          .up-guide-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
          .up-guide-text { display: grid; gap: 2px; min-width: 0; }
          .up-guide-text strong { font: 600 15px/1.3 var(--font-sans); }
          .up-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 16px; align-items: start; padding: 20px; }
          .up-avatar { display: grid; place-items: center; width: 72px; height: 72px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); font: 600 26px/1 var(--font-sans); }
          .up-who { display: grid; gap: 4px; min-width: 0; }
          .up-name { margin: 0; overflow-wrap: anywhere; }
          .up-handle { margin: 0; color: var(--muted); font: 600 15px/1.4 var(--font-sans); overflow-wrap: anywhere; }
          .up-handle span { font-weight: 500; }
          .up-facts { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 6px 0 0; padding: 0; list-style: none; color: var(--ink); font: 500 15px/1.4 var(--font-sans); }
          .up-facts li { display: inline-flex; align-items: center; gap: 6px; }
          .up-facts :global(svg) { color: var(--olive-ink); }
          .up-badge { padding: 2px 10px; border-radius: var(--r-pill); background: var(--olive-tint); color: var(--olive-ink); font-weight: 600; }
          .up-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
          .up-counts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 0; color: var(--muted); font: 500 15px/1.4 var(--font-sans); }
          .up-counts strong { color: var(--ink); font-weight: 600; }
          .up-follows-you { margin: 2px 0 0; }
          .up-tabs { justify-self: start; }
          .up-panel { display: grid; gap: 8px; }
          .up-none { margin: 0; color: var(--muted); text-align: center; padding: 32px 16px; }
          .up-private { display: flex; align-items: center; gap: 10px; padding: 16px 20px; color: var(--muted); }
          .up-private p { margin: 0; }
          .up-empty { display: grid; gap: 10px; justify-items: start; padding: 20px; }
          .up-empty h1, .up-empty p { margin: 0; }
          @media (max-width: 767px) {
            .up-head { gap: 12px; padding: 16px; }
            .up-avatar { width: 56px; height: 56px; font-size: 20px; }
            .up-head { grid-template-columns: auto minmax(0, 1fr); }
            .up-actions { grid-column: 1 / -1; justify-content: flex-start; }
            .up-head.is-self .up-actions :global(.c-btn) { flex: 1; }
          }
        `}</style>
      </div>
    </Reveal>
  );
}
