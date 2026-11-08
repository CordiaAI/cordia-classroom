import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import Toggle from '../../components/Toggle';
import UsernameField from '../../components/UsernameField';
import { claimUsername, loadBlocks, loadMyProfile, saveProfileSettings, unblockUser } from '../../lib/profiles';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const VISIBILITY = [
  { value: 'public', label: 'Everyone', hint: 'Anyone signed in to Cordia can see your profile.' },
  { value: 'friends', label: 'Friends', hint: 'Friends see your whole profile; everyone else sees only your username and display name.' },
  { value: 'private', label: 'Only me', hint: 'Others see only your username and display name.' },
];
const FOLLOWS = [{ value: 'everyone', label: 'Anyone' }, { value: 'approval', label: 'Ask me first' }];
const FRIEND_REQUESTS = [
  { value: 'everyone', label: 'Anyone' },
  { value: 'friends_of_friends', label: 'Friends of friends' },
  { value: 'nobody', label: 'No one' },
];

function Choice({ label, options, value, onPick }) {
  return (
    <div className="c-chips" role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" className="c-chip" aria-pressed={value === option.value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Profile and privacy: your username and display name, who sees your profile and what's on it,
// who can follow you or send friend requests, and the people you blocked.
export default function PrivacySettings() {
  const { ready } = useRequireAuth();
  const [me, setMe] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [userDraft, setUserDraft] = useState('');
  const [userStatus, setUserStatus] = useState({ name: '', ok: false });
  const [userError, setUserError] = useState('');

  useEffect(() => {
    if (!ready) return;
    Promise.all([loadMyProfile(), loadBlocks()]).then(([profile, blocked]) => {
      if (!profile) { setFailed(true); return; }
      setMe(profile);
      setNameDraft(profile.display_name || '');
      setUserDraft(profile.username || profile.suggestions?.[0] || '');
      setBlocks(blocked || []);
    });
  }, [ready]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const gate = useLoadGate(Boolean(me) || failed);
  if (!ready) return null;
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading privacy settings" />;

  async function save(changes) {
    const previous = me;
    setMe(current => ({ ...current, ...changes }));
    const result = await saveProfileSettings(changes);
    if (result.error) { setMe(previous); setToast(result.error); return; }
    setMe(result.profile);
    setToast('Saved');
  }

  async function saveUsername(event) {
    event.preventDefault();
    if (!userStatus.ok) return;
    setUserError('');
    const result = await claimUsername(userStatus.name);
    if (result.error) { setUserError(result.error); return; }
    setMe(result.profile);
    setToast(previousName ? 'Username changed' : 'Username saved');
  }

  async function saveDisplayName(event) {
    event?.preventDefault();
    const clean = nameDraft.trim().replace(/\s+/g, ' ');
    if (clean === (me.display_name || '')) return;
    await save({ display_name: clean });
  }

  async function unblock(person) {
    if (await unblockUser(person.user_id)) {
      setBlocks(current => current.filter(item => item.user_id !== person.user_id));
      setToast(`Unblocked ${person.username ? '@' + person.username : person.display_name}`);
    }
  }

  const previousName = me?.username || '';
  const waitUntil = me?.can_change_username_at ? new Date(me.can_change_username_at) : null;
  const visibility = VISIBILITY.find(option => option.value === me?.profile_visibility) || VISIBILITY[0];

  return (
    <Reveal phase={gate}>
      <div className="c-page pv">
        <header className="pv-head">
          <Link href="/settings?section=account" className="c-icon-btn" aria-label="Back to Settings"><ArrowLeft {...ICON} /></Link>
          <h1 className="c-title">Profile and privacy</h1>
        </header>

        {failed && <p className="c-card pv-failed" role="alert">Couldn't load your profile settings. Try again in a moment.</p>}

        {me && (
          <>
            <section className="c-card pv-card" aria-labelledby="pv-profile">
              <div className="pv-card-head">
                <h2 id="pv-profile" className="c-section-title">Profile</h2>
                {me.username && <Link href={`/u/${me.username}`} className="pv-link">View your profile<ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" /></Link>}
              </div>
              <form className="pv-field" onSubmit={saveUsername}>
                <label className="pv-label" htmlFor="pv-username">Username</label>
                {waitUntil ? (
                  <p className="pv-static">@{me.username} <span className="c-meta">You can change it again on {waitUntil.toLocaleDateString([], { month: 'long', day: 'numeric' })}.</span></p>
                ) : (
                  <>
                    <UsernameField id="pv-username" value={userDraft} onChange={value => { setUserDraft(value); setUserError(''); }} onStatus={setUserStatus} current={previousName} />
                    {previousName && <p className="c-meta pv-help">After a change, links to @{previousName} keep working for 90 days. Then you can change it again after 30 days.</p>}
                    {userError && <p className="pv-error" role="alert">{userError}</p>}
                    <button type="submit" className="c-btn c-btn--secondary pv-save" disabled={!userStatus.ok}>{previousName ? 'Change username' : 'Save username'}</button>
                  </>
                )}
              </form>
              <form className="pv-field" onSubmit={saveDisplayName}>
                <label className="pv-label" htmlFor="pv-display">Display name</label>
                <input id="pv-display" className="c-input" value={nameDraft} maxLength={50} onChange={event => setNameDraft(event.target.value)} onBlur={saveDisplayName} placeholder={me.name ? me.name.split(' ')[0] : 'Your name'} />
                <p className="c-meta pv-help">Shown on your profile. Leave it empty to use your first name.</p>
              </form>
              <Toggle label="Show my full name on my profile" checked={me.show_real_name} onChange={value => save({ show_real_name: value })} />
            </section>

            <section className="c-card pv-card" aria-labelledby="pv-who">
              <h2 id="pv-who" className="c-section-title">Who can see your profile</h2>
              {me.profile_locked ? (
                <p className="c-meta pv-help"><strong>Private</strong> (required for students under 18). Only you see your profile; friends see your name.</p>
              ) : (
                <>
                  <Choice label="Who can see your profile" options={VISIBILITY} value={visibility.value} onPick={value => save({ profile_visibility: value })} />
                  <p className="c-meta pv-help">{visibility.hint}</p>
                </>
              )}
              <Toggle label="Show my school" checked={me.show_school} onChange={value => save({ show_school: value })} />
              <Toggle label="Show my study streak" checked={me.show_streak} onChange={value => save({ show_streak: value })} />
            </section>

            <section className="c-card pv-card" aria-labelledby="pv-connect">
              <h2 id="pv-connect" className="c-section-title">Follows and friends</h2>
              <p className="pv-label" id="pv-follow-label">Who can follow you</p>
              <Choice label="Who can follow you" options={FOLLOWS} value={me.allow_follows} onPick={value => save({ allow_follows: value })} />
              <p className="pv-label">Who can send you friend requests</p>
              <Choice label="Who can send you friend requests" options={FRIEND_REQUESTS} value={me.allow_friend_requests} onPick={value => save({ allow_friend_requests: value })} />
              <Toggle label="Let classmates from my courses find me" checked={Boolean(me.find_by_classmates)} onChange={value => save({ find_by_classmates: value })} />
              <p className="c-meta pv-help">People taking your courses this term can see you under “Classmates from Canvas” and follow you or send a friend request. Never shown if your profile is private.</p>
            </section>

            <section className="c-card pv-card" aria-labelledby="pv-blocked">
              <h2 id="pv-blocked" className="c-section-title">Blocked</h2>
              {blocks?.length ? (
                <ul className="pv-blocks">
                  {blocks.map(person => (
                    <li key={person.user_id}>
                      <span className="pv-block-name">
                        <strong>{person.display_name}</strong>
                        {person.username && <span className="c-meta">@{person.username}</span>}
                      </span>
                      <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => unblock(person)}>Unblock</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="c-meta pv-help">You haven't blocked anyone. Block someone from the ⋯ menu on their profile.</p>
              )}
            </section>
          </>
        )}

        {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
        <style jsx>{`
          .pv { width: min(720px, 100%); margin: 0 auto; display: grid; gap: 16px; }
          .pv-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
          .pv-head h1 { margin: 0; }
          .pv-card { display: grid; gap: 14px; padding: 20px; }
          @media (max-width: 767px) { .pv-card { padding: 16px; } }
          .pv-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
          .pv-card h2 { margin: 0; }
          .pv-field { display: grid; gap: 8px; margin: 0; }
          .pv-label { margin: 0; color: var(--ink); font: 600 15px/1.3 var(--font-sans); }
          .pv-static { margin: 0; color: var(--ink); font: 600 16px/1.5 var(--font-sans); }
          .pv-static span { display: block; font-weight: 500; }
          .pv-help { margin: 0; }
          .pv-error { margin: 0; color: var(--error); font-weight: 600; }
          .pv-save { justify-self: start; }
          .pv-link { display: inline-flex; align-items: center; gap: 6px; color: var(--olive-ink); font: 600 15px/1 var(--font-sans); }
          .pv-blocks { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
          .pv-blocks li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
          .pv-block-name { display: grid; min-width: 0; }
          .pv-block-name strong, .pv-block-name span { overflow-wrap: anywhere; }
          .pv-failed { margin: 0; padding: 16px 20px; }
        `}</style>
      </div>
    </Reveal>
  );
}
