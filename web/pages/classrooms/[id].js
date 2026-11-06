import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowDown, ArrowLeft, ArrowUp, Flag, FolderOpen, UserPlus } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { pageTitle } from '../../lib/pageTitle';
import { LoadingArea, Reveal, SectionLoader, useLoadGate } from '../../components/CordiaLoader';
import UserChip from '../../components/UserChip';
import Menu from '../../components/Menu';
import InviteDialog from '../../components/InviteDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  KIND_LABELS, ROLE_LABELS, VISIBILITY_HELP, approveMember, archiveClassroom, changeRole, classroomActivity, getClassroom,
  leaveClassroom, listItems, listMembers, removeItem, removeMember, reorderItems, setMilestone, setShareProgress,
  transferOwnership, updateClassroom,
} from '../../lib/classrooms';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const TABS = [
  { key: 'guides', label: 'Guides' },
  { key: 'study', label: 'Study' },
  { key: 'members', label: 'Members' },
  { key: 'progress', label: 'Progress' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
];
const ACTIVITY_TEXT = {
  member_joined: () => 'joined',
  guide_added: entry => `added ${entry.item_title ? `“${entry.item_title}”` : 'a guide'}`,
  folder_added: entry => `added the folder ${entry.item_title ? `“${entry.item_title}”` : ''}`.trim(),
  milestone_set: entry => `set a milestone${entry.label ? `: ${entry.label}` : ''}${entry.date ? ` (${entry.date})` : ''}`,
};

// One classroom: its guides and folders (with milestones), members and roles, activity, and
// settings. ARIA tabs; arrow keys move between them.
export default function ClassroomPage() {
  const router = useRouter();
  const id = String(router.query.id || '');
  const { ready } = useRequireAuth();
  const [room, setRoom] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('guides');
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState('');
  const gate = useLoadGate(Boolean(room) || missing);

  async function load() {
    const data = await getClassroom(id);
    if (data?.classroom) setRoom(data.classroom);
    else setMissing(true);
  }
  useEffect(() => { if (ready && id) load(); }, [ready, id]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  function onTabKey(event) {
    const index = TABS.findIndex(item => item.key === tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    setTab(next.key);
    document.getElementById(`crtab-${next.key}`)?.focus();
  }

  if (!ready) return null;
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading the classroom" />;
  if (missing) {
    return (
      <div className="c-page">
        <div className="c-card cr-missing">
          <h1 className="c-title">Classroom not found</h1>
          <p className="c-meta">It may have been archived, or you’re not a member.</p>
          <Link href="/classrooms" className="c-btn c-btn--secondary">Your classrooms</Link>
        </div>
        <style jsx>{`.cr-missing { display: grid; gap: 12px; justify-items: start; padding: 24px; } .cr-missing :global(.c-title), .cr-missing p { margin: 0; }`}</style>
      </div>
    );
  }

  return (
    <Reveal phase={gate}>
      <div className="c-page cr">
        <Head><title>{pageTitle(room.name)}</title></Head>
        <header className="c-page-head cr-head">
          <div className="c-row">
            <Link href="/classrooms" className="c-icon-btn" aria-label="Your classrooms"><ArrowLeft {...ICON} /></Link>
            <h1 className="c-title cr-title">{room.name}</h1>
          </div>
          {room.can.invite && <button type="button" className="c-btn c-btn--primary" onClick={() => setInviting(true)}><UserPlus {...ICON} />Invite</button>}
        </header>
        <p className="c-meta cr-facts">
          {KIND_LABELS[room.kind]}{room.instructor_request === 'requested' ? ' · Instructor class requested, waiting for Cordia to check' : ''}
          {' · '}{room.member_count} {room.member_count === 1 ? 'member' : 'members'}
          {room.class ? <> · <Link href={'/class/' + room.class.id}>{room.class.code}</Link></> : null}
          {' · You’re '}{(ROLE_LABELS[room.me.role] || '').toLowerCase()}
        </p>
        {room.description && <p className="cr-desc">{room.description}</p>}

        <div className="c-seg is-scroller cr-tabs" role="tablist" aria-label="Classroom" onKeyDown={onTabKey}>
          {TABS.map(item => (
            <button key={item.key} id={`crtab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`crpanel-${item.key}`}
              tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>
              {item.label}{item.key === 'members' && room.pending_count ? ` (${room.pending_count} waiting)` : ''}
            </button>
          ))}
        </div>
        <div id={`crpanel-${tab}`} role="tabpanel" aria-labelledby={`crtab-${tab}`} className="cr-panel">
          {tab === 'guides' && <GuidesTab room={room} onToast={setToast} />}
          {tab === 'study' && <p className="c-card cr-soon">Study together: shared sessions and goals for this classroom are coming next.</p>}
          {tab === 'members' && <MembersTab room={room} onToast={setToast} onChanged={load} />}
          {tab === 'progress' && <p className="c-card cr-soon">{room.kind === 'instructor_class' ? 'Progress from students who chose to share it will show here.' : 'Group progress is coming next.'}</p>}
          {tab === 'activity' && <ActivityTab room={room} />}
          {tab === 'settings' && <SettingsTab room={room} onToast={setToast} onSaved={setRoom} onGone={() => router.push('/classrooms')} />}
        </div>
        {inviting && <InviteDialog classroom={room} onClose={() => setInviting(false)} />}
        {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      </div>
      <style jsx>{`
        .cr { display: grid; gap: 12px; }
        .cr-head { flex-wrap: wrap; gap: 8px; }
        .cr-title { overflow-wrap: anywhere; }
        .cr-facts, .cr-desc { margin: 0; }
        .cr-facts :global(a) { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        .cr-desc { color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
        .cr-tabs { justify-self: start; max-width: 100%; }
        .cr-tabs button { white-space: nowrap; }
        .cr-panel { display: grid; gap: 12px; }
        .cr-panel :global(.cr-soon) { margin: 0; padding: 16px; color: var(--muted-ink); }
      `}</style>
    </Reveal>
  );
}

function GuidesTab({ room, onToast }) {
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  async function load() {
    const data = await listItems(room.id);
    setItems(data?.items || []);
  }
  useEffect(() => { load(); }, [room.id]);

  async function move(index, step) {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + step, 0, moved);
    setItems(next);
    await reorderItems(room.id, next.map(item => ({ item_type: item.item_type, item_id: item.item_id })));
  }

  async function remove(item) {
    const data = await removeItem(room.id, item.item_type, item.item_id);
    if (data?.removed) { setItems(current => current.filter(entry => entry !== item)); onToast('Removed from the classroom'); }
    else onToast(data?.detail || "Couldn't remove it.");
  }

  if (items === null) return <SectionLoader label="Loading guides" />;
  return (
    <>
      {room.can.add && <p className="c-meta cr-hint">Add guides from a guide’s page or a shared guide’s page with <b>Add to classroom</b>.</p>}
      {!items.length && <p className="c-card cr-soon">Nothing shared here yet.</p>}
      <ol className="cr-items">
        {items.map((item, index) => (
          <li key={item.item_type + item.item_id} className="c-card cr-item">
            <div className="cr-item-main">
              {item.item_type === 'guide' ? (
                <Link href={(item.guide.is_mine ? '/guide/' : '/sets/') + item.guide.id} className="cr-item-title">{item.guide.title}</Link>
              ) : (
                <span className="cr-item-title"><FolderOpen {...ICON} />{item.folder.name}</span>
              )}
              <span className="c-meta">
                {item.item_type === 'guide'
                  ? `${item.guide.question_count} ${item.guide.question_count === 1 ? 'question' : 'questions'}${item.guide.author ? ` · ${item.guide.author.display_name}` : ''}`
                  : `${item.folder.guides.length} ${item.folder.guides.length === 1 ? 'guide' : 'guides'} · new ones appear here too`}
              </span>
              {(item.milestone_label || item.milestone_date) && (
                <span className="cr-milestone"><Flag size={16} strokeWidth={1.75} aria-hidden="true" />{[item.milestone_label, item.milestone_date].filter(Boolean).join(' · ')}</span>
              )}
              {item.item_type === 'folder' && item.folder.guides.length > 0 && (
                <ul className="cr-folder">
                  {item.folder.guides.map(guide => (
                    <li key={guide.id}><Link href={(guide.is_mine ? '/guide/' : '/sets/') + guide.id}>{guide.title}</Link></li>
                  ))}
                </ul>
              )}
              {editing === item && <MilestoneForm room={room} item={item} onDone={async saved => { setEditing(null); if (saved) { await load(); onToast('Milestone saved'); } }} />}
            </div>
            {(room.can.manage || item.removable) && (
              <div className="cr-item-actions">
                {room.can.manage && (
                  <>
                    <button type="button" className="c-icon-btn" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.guide?.title || item.folder?.name} up`}><ArrowUp {...ICON} /></button>
                    <button type="button" className="c-icon-btn" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item.guide?.title || item.folder?.name} down`}><ArrowDown {...ICON} /></button>
                  </>
                )}
                <Menu label={`More for ${item.guide?.title || item.folder?.name}`} items={[
                  ...(room.can.manage ? [{ label: 'Set milestone', icon: Flag, onSelect: () => setEditing(item) }] : []),
                  ...(item.removable ? [{ label: 'Remove from classroom', onSelect: () => remove(item), danger: true }] : []),
                ]} />
              </div>
            )}
          </li>
        ))}
      </ol>
      <style jsx>{`
        .cr-hint { margin: 0; }
        .cr-items { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .cr-item { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; min-width: 0; }
        .cr-item-main { display: grid; gap: 4px; flex: 1; min-width: 0; }
        .cr-item-main :global(.cr-item-title) { display: inline-flex; align-items: center; gap: 8px; font: 600 16px/1.3 var(--font-sans); color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
        .cr-milestone { display: inline-flex; align-items: center; gap: 6px; font: 600 13px/1.3 var(--font-sans); color: var(--olive-ink); }
        .cr-folder { margin: 4px 0 0; padding-left: 20px; display: grid; gap: 4px; }
        .cr-folder :global(a) { color: var(--ink); overflow-wrap: anywhere; }
        .cr-item-actions { display: inline-flex; gap: 4px; flex: none; }
      `}</style>
    </>
  );
}

function MilestoneForm({ room, item, onDone }) {
  const [label, setLabel] = useState(item.milestone_label || '');
  const [when, setWhen] = useState(item.milestone_date || '');
  async function save(event) {
    event.preventDefault();
    const data = await setMilestone(room.id, item.item_type, item.item_id, { milestone_label: label.trim() || null, milestone_date: when || null });
    onDone(Boolean(data && !data.detail));
  }
  return (
    <form className="crm" onSubmit={save}>
      <input className="c-input" aria-label="Milestone" value={label} maxLength={120} onChange={event => setLabel(event.target.value)} placeholder="Unit 2 quiz" />
      <input className="c-input" aria-label="Milestone date" type="date" value={when} onChange={event => setWhen(event.target.value)} />
      <button type="submit" className="c-btn c-btn--primary c-btn--sm">Save</button>
      <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => onDone(false)}>Cancel</button>
      <style jsx>{`.crm { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; } .crm .c-input { flex: 1 1 160px; min-width: 0; }`}</style>
    </form>
  );
}

function MembersTab({ room, onToast, onChanged }) {
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(null);
  async function load() { setData(await listMembers(room.id) || { members: [], roles: [] }); }
  useEffect(() => { load(); }, [room.id]);

  async function act(run, done) {
    const result = await run();
    if (result?.detail) { onToast(result.detail); return; }
    onToast(done);
    await load();
    onChanged?.();
  }

  if (data === null) return <SectionLoader label="Loading members" />;
  const pending = data.members.filter(member => member.status === 'pending');
  const active = data.members.filter(member => member.status === 'active');
  const row = member => {
    const items = [];
    if (data.roles.length && member.role !== 'owner') {
      data.roles.filter(role => role !== member.role).forEach(role => items.push({ label: `Make ${ROLE_LABELS[role].toLowerCase()}`, onSelect: () => act(() => changeRole(room.id, member.user_id, role), 'Role changed') }));
      items.push({ label: 'Make owner', onSelect: () => setConfirm({ title: `Make ${member.display_name} the owner?`, body: 'You’ll become an admin. Only the owner can change roles or archive the classroom.', run: () => act(() => transferOwnership(room.id, member.user_id), 'Ownership handed over') }) });
    }
    if (member.removable) items.push({ label: 'Remove from classroom', danger: true, onSelect: () => setConfirm({ title: `Remove ${member.display_name}?`, body: 'Their own guides and folders leave the classroom with them.', run: () => act(() => removeMember(room.id, member.user_id), 'Removed') }) });
    return (
      <li key={member.user_id} className="crmb-row">
        <UserChip person={member} meta={ROLE_LABELS[member.role] + (member.is_me ? ' · You' : '')} />
        {member.status === 'pending' ? (
          <span className="crmb-actions">
            <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => act(() => approveMember(room.id, member.user_id), 'Approved')}>Approve</button>
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => act(() => removeMember(room.id, member.user_id), 'Declined')}>Decline</button>
          </span>
        ) : items.length > 0 && <Menu label={`More for ${member.display_name}`} items={items} />}
      </li>
    );
  };
  return (
    <>
      {pending.length > 0 && (
        <section className="c-card crmb">
          <h2 className="crmb-title">Waiting to join</h2>
          <ul className="crmb-list">{pending.map(row)}</ul>
        </section>
      )}
      <section className="c-card crmb">
        <h2 className="crmb-title">{active.length} {active.length === 1 ? 'member' : 'members'}</h2>
        <ul className="crmb-list">{active.map(row)}</ul>
      </section>
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.body} confirmLabel="Yes" onCancel={() => setConfirm(null)} onConfirm={async () => { const next = confirm; setConfirm(null); await next.run(); }} />}
      <style jsx>{`
        .crmb { display: grid; gap: 8px; padding: 16px; }
        .crmb-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .crmb-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .crmb-list :global(.crmb-row) { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
        .crmb-list :global(.crmb-actions) { display: inline-flex; gap: 6px; flex: none; }
      `}</style>
    </>
  );
}

function ActivityTab({ room }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => { classroomActivity(room.id).then(data => setEntries(data?.activity || [])); }, [room.id]);
  if (entries === null) return <SectionLoader label="Loading activity" />;
  if (!entries.length) return <p className="c-card cr-soon">Nothing yet. Joins, new guides and milestones show up here.</p>;
  return (
    <ul className="c-card cra">
      {entries.map(entry => (
        <li key={entry.id}>
          <b>{entry.actor?.display_name || 'Someone'}</b> {(ACTIVITY_TEXT[entry.kind] || (() => ''))(entry)}
          <span className="c-meta"> · {String(entry.created_at || '').slice(0, 10)}</span>
        </li>
      ))}
      <style jsx>{`.cra { margin: 0; padding: 16px 16px 16px 20px; display: grid; gap: 8px; color: var(--ink); overflow-wrap: anywhere; }`}</style>
    </ul>
  );
}

function SettingsTab({ room, onToast, onSaved, onGone }) {
  const [form, setForm] = useState({ name: room.name, description: room.description, visibility: room.visibility, join_policy: room.join_policy,
    members_can_add: room.members_can_add, members_can_invite: room.members_can_invite });
  const [share, setShare] = useState(Boolean(room.me.progress_visible_to_staff));
  const [confirm, setConfirm] = useState(null);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

  async function save(event) {
    event.preventDefault();
    const data = await updateClassroom(room.id, form);
    if (data?.classroom) { onSaved(data.classroom); onToast('Saved'); } else onToast(data?.detail || "Couldn't save.");
  }

  async function toggleShare(on) {
    setShare(on);
    const data = await setShareProgress(room.id, on);
    if (data?.detail) { setShare(!on); onToast(data.detail); } else onToast(on ? 'Your instructor can see your progress here' : 'Your progress is private here');
  }

  return (
    <>
      {room.kind === 'instructor_class' && room.me.role === 'member' && (
        <section className="c-card crs">
          <h2 className="crs-title">Your progress</h2>
          <label className="crs-check"><input type="checkbox" checked={share} onChange={event => toggleShare(event.target.checked)} /><span>Let this class’s instructor and admins see my progress</span></label>
        </section>
      )}
      {room.can.manage && (
        <form className="c-card crs" onSubmit={save}>
          <h2 className="crs-title">Classroom settings</h2>
          <label className="crs-field"><span>Name</span><input className="c-input" value={form.name} maxLength={120} onChange={event => set('name', event.target.value)} /></label>
          <label className="crs-field"><span>Description</span><textarea className="c-input" rows={3} value={form.description} maxLength={2000} onChange={event => set('description', event.target.value)} /></label>
          <fieldset className="crs-field">
            <legend>Who can join</legend>
            {['unlisted', 'private', ...(room.class ? ['public'] : [])].map(value => (
              <label key={value} className="crs-check"><input type="radio" name="crs-vis" checked={form.visibility === value} onChange={() => set('visibility', value)} /><span>{VISIBILITY_HELP[value]}</span></label>
            ))}
          </fieldset>
          <label className="crs-check"><input type="checkbox" checked={form.join_policy === 'approval'} onChange={event => set('join_policy', event.target.checked ? 'approval' : 'auto')} /><span>Approve each person before they join</span></label>
          <label className="crs-check"><input type="checkbox" checked={form.members_can_add} onChange={event => set('members_can_add', event.target.checked)} /><span>Members can add guides</span></label>
          <label className="crs-check"><input type="checkbox" checked={form.members_can_invite} onChange={event => set('members_can_invite', event.target.checked)} /><span>Members can invite people</span></label>
          <button type="submit" className="c-btn c-btn--primary">Save</button>
        </form>
      )}
      <section className="c-card crs">
        {room.can.owner ? (
          <>
            <p className="c-meta">To leave, make someone else the owner first (Members tab).</p>
            <button type="button" className="c-btn c-btn--danger" onClick={() => setConfirm({ title: 'Archive this classroom?', body: 'It closes for everyone and its invites stop working. Guides stay with their authors.', run: async () => { const data = await archiveClassroom(room.id); if (data?.archived) onGone(); else onToast(data?.detail || "Couldn't archive it."); } })}>Archive classroom</button>
          </>
        ) : (
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setConfirm({ title: 'Leave this classroom?', body: 'Guides and folders you added leave with you. You can join again with an invite.', run: async () => { const data = await leaveClassroom(room.id); if (data?.status === 'removed') onGone(); else onToast(data?.detail || "Couldn't leave."); } })}>Leave classroom</button>
        )}
      </section>
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.body} confirmLabel="Yes" onCancel={() => setConfirm(null)} onConfirm={async () => { const next = confirm; setConfirm(null); await next.run(); }} />}
      <style jsx>{`
        .crs { display: grid; gap: 12px; padding: 16px; justify-items: start; }
        .crs-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .crs-field { display: grid; gap: 6px; width: 100%; margin: 0; padding: 0; border: 0; min-width: 0; }
        .crs-field > span, .crs-field legend { font: 600 14px/1.2 var(--font-sans); color: var(--ink); padding: 0; margin-bottom: 4px; }
        .crs-check { display: flex; gap: 10px; align-items: flex-start; color: var(--ink); cursor: pointer; }
        .crs-check input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--olive); flex: none; }
        .crs :global(.c-meta) { margin: 0; }
      `}</style>
    </>
  );
}
