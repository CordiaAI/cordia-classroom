import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Layers, Users, X } from 'lucide-react';
import { SectionLoader } from './CordiaLoader';
import { loadSavedGuides, loadVisibilityReview, saveForLater } from '../lib/guideSharing';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { savedMeta } from '../lib/guideVisibility.mjs';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
export const SECTIONS = [
  { key: 'mine', label: 'Mine' },
  { key: 'saved', label: 'Saved' },
  { key: 'class', label: 'Class sets' },
];

// Mine · Saved · Class sets: ARIA tabs; arrow keys move between them.
export function SectionTabs({ section, onChange }) {
  function onKeyDown(event) {
    const index = SECTIONS.findIndex(item => item.key === section);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length];
    onChange(next.key);
    document.getElementById(`lsec-${next.key}`)?.focus();
  }
  return (
    <div className="c-seg lib-sections" role="tablist" aria-label="Library" onKeyDown={onKeyDown}>
      {SECTIONS.map(item => (
        <button key={item.key} id={`lsec-${item.key}`} type="button" role="tab" aria-selected={section === item.key}
          aria-controls={`lsec-panel-${item.key}`} tabIndex={section === item.key ? 0 : -1}
          className={section === item.key ? 'is-active' : ''} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
      <style jsx>{`
        .lib-sections { justify-self: start; width: fit-content; max-width: 100%; }
        .lib-sections button { white-space: nowrap; }
      `}</style>
    </div>
  );
}

// Guides saved from other people, newest first. One that's gone private or held says so.
export function SavedGuides({ onToast }) {
  const [guides, setGuides] = useState(null);
  useEffect(() => { loadSavedGuides().then(list => setGuides(list || [])); }, []);

  async function remove(id) {
    const { error } = await saveForLater(id, false);
    if (error) { onToast?.(error); return; }
    setGuides(current => current.filter(item => item.id !== id));
    onToast?.('Removed from Saved');
  }

  if (!guides) return <SectionLoader height={120} label="Loading saved guides" />;
  if (!guides.length) {
    return (
      <div className="c-empty">
        <Bookmark size={32} strokeWidth={1.75} aria-hidden="true" />
        <span className="c-section-title">Nothing saved yet</span>
        <span className="c-meta">Save a guide someone shared and it shows up here.</span>
      </div>
    );
  }
  return (
    <ul className="c-card lsec-list">
      {guides.map(item => (
        <li key={item.id} className="lsec-row">
          <span className="lsec-icon"><Layers {...ICON} /></span>
          {item.available ? (
            <Link href={`/sets/${item.id}`} className="lsec-main">
              <strong className="c-truncate">{item.title}</strong>
              <span className="c-meta c-truncate">{savedMeta(item)}
              </span>
            </Link>
          ) : (
            <span className="lsec-main">
              <strong>No longer available</strong>
              <span className="c-meta">The owner made it private, or it was removed.</span>
            </span>
          )}
          <button type="button" className="c-icon-btn" onClick={() => remove(item.id)} aria-label={item.available ? `Remove ${item.title} from Saved` : 'Remove from Saved'}>
            <X {...ICON} />
          </button>
        </li>
      ))}
      <style jsx>{`
        .lsec-list { list-style: none; margin: 0; padding: 6px; display: grid; }
        .lsec-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 6px 6px 10px; border-radius: var(--r-row); min-width: 0; }
        .lsec-row + .lsec-row { border-top: 1px solid var(--line); }
        .lsec-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .lsec-row :global(.lsec-main) { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; color: var(--ink); text-decoration: none; }
        .lsec-row :global(a.lsec-main:hover strong) { text-decoration: underline; text-underline-offset: 3px; }
        .lsec-row :global(.lsec-main strong) { font: 600 15px/1.3 var(--font-sans); }
      `}</style>
    </ul>
  );
}

// Your classes, each opening its Class sets (what classmates shared with the course).
export function ClassSetList({ classes }) {
  if (!classes.length) {
    return (
      <div className="c-empty">
        <Users size={32} strokeWidth={1.75} aria-hidden="true" />
        <span className="c-section-title">No classes yet</span>
        <span className="c-meta">Add a class in Mine to see what classmates share.</span>
      </div>
    );
  }
  return (
    <ul className="c-card lsec-list">
      {classes.map(item => (
        <li key={item.id} className="lsec-row">
          <span className="lsec-icon"><Users {...ICON} /></span>
          <Link href={`/class/${item.id}`} className="lsec-main">
            <strong className="c-truncate">{item.code}{item.name ? ` ${item.name}` : ''}</strong>
            <span className="c-meta">{item.sharing_blocked ? 'Sharing is off for this class' : `${item.shared_count} shared ${item.shared_count === 1 ? 'set' : 'sets'}`}</span>
          </Link>
        </li>
      ))}
      <style jsx>{`
        .lsec-list { list-style: none; margin: 0; padding: 6px; display: grid; }
        .lsec-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 10px; border-radius: var(--r-row); min-width: 0; }
        .lsec-row + .lsec-row { border-top: 1px solid var(--line); }
        .lsec-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .lsec-row :global(.lsec-main) { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; color: var(--ink); text-decoration: none; }
        .lsec-row :global(a.lsec-main:hover strong) { text-decoration: underline; text-underline-offset: 3px; }
        .lsec-row :global(.lsec-main strong) { font: 600 15px/1.3 var(--font-sans); }
      `}</style>
    </ul>
  );
}

// Once, for students whose guides were shared with a class before guides could go public.
export function VisibilityNote() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (readUserValue('cordiaVisibilityNoteSeen', false)) return;
    loadVisibilityReview().then(setCount);
  }, []);
  if (!count) return null;
  function dismiss() {
    writeUserValue('cordiaVisibilityNoteSeen', true);
    setCount(0);
  }
  return (
    <div className="lsec-note" role="status">
      <Users {...ICON} />
      <p>
        {count === 1 ? 'One of your guides is' : `${count} of your guides are`} shared with your class only, without your name.
        {' '}You can now make {count === 1 ? 'it' : 'them'} public: open a guide and use the chip under its title.
      </p>
      <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={dismiss}>Got it</button>
      <style jsx>{`
        .lsec-note { display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; border-radius: var(--r-row); background: var(--olive-tint); color: var(--ink); }
        .lsec-note :global(.lucide) { flex: none; color: var(--olive-ink); }
        .lsec-note p { flex: 1 1 auto; margin: 0; font: 600 14px/1.45 var(--font-sans); }
      `}</style>
    </div>
  );
}
