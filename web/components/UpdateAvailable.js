import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import BodyPortal from './BodyPortal';
import CordiaLoader from './CordiaLoader';
import { acceptUpdate, guideChanges, stayOnVersion } from '../lib/studyGuide';

// Someone else's guide, after its author changed it (Stage 4). The student keeps studying the version
// they started on until they choose: Accept update (unchanged ideas keep their progress, changed
// ones step back one level, removed ones are set aside) or Stay on vN. `viewer` is the study
// payload's viewer; onChanged reloads the screen after either choice.
export default function UpdateAvailable({ guideId, viewer, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!viewer || viewer.version >= viewer.current_version || !viewer.changes) return null;

  async function run(action) {
    setBusy(true);
    await action(guideId);
    setBusy(false);
    setOpen(false);
    onChanged?.();
  }

  const { added = 0, changed = 0, removed = 0 } = viewer.changes;
  const summary = [added && `${added} new`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean).join(', ');
  if (viewer.stayed) {
    return (
      <p className="update-quiet c-meta">
        You’re studying version {viewer.version}.{' '}
        <button type="button" className="update-link" onClick={() => setOpen(true)}>See the update</button>
        {open && <ChangesDialog guideId={guideId} viewer={viewer} busy={busy} onAccept={() => run(acceptUpdate)} onStay={() => setOpen(false)} onClose={() => setOpen(false)} />}
        <style jsx>{`
          .update-quiet { margin: 0 0 12px; }
          .update-link { padding: 0; border: 0; background: none; color: var(--ink); font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
        `}</style>
      </p>
    );
  }
  return (
    <section className="update-banner c-card" aria-labelledby="update-title">
      <RefreshCw size={20} strokeWidth={1.75} aria-hidden="true" className="update-icon" />
      <div className="update-text">
        <h2 id="update-title" className="update-title">Updated to version {viewer.current_version}</h2>
        <p className="c-meta">{viewer.author?.display_name ? `${viewer.author.display_name} changed this guide` : 'The author changed this guide'}: {summary}.</p>
      </div>
      <div className="update-actions">
        <button type="button" className="c-btn c-btn--secondary" onClick={() => setOpen(true)}>See changes</button>
        <button type="button" className="c-btn c-btn--primary" disabled={busy} onClick={() => run(acceptUpdate)}>Accept update</button>
        <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={() => run(stayOnVersion)}>Stay on v{viewer.version}</button>
      </div>
      {open && <ChangesDialog guideId={guideId} viewer={viewer} busy={busy} onAccept={() => run(acceptUpdate)} onStay={() => run(stayOnVersion)} onClose={() => setOpen(false)} />}
      <style jsx>{`
        .update-banner { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: start; padding: 16px; margin: 0 0 16px; }
        .update-banner :global(.update-icon) { color: var(--olive-ink); margin-top: 2px; }
        .update-title { margin: 0 0 2px; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .update-text p { margin: 0; }
        .update-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
        @media (max-width: 480px) { .update-actions { display: grid; grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}

function ChangesDialog({ guideId, viewer, busy, onAccept, onStay, onClose }) {
  const [changes, setChanges] = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    let live = true;
    guideChanges(guideId).then(data => { if (live) setChanges(data && !data.detail ? data : { failed: true }); });
    return () => { live = false; };
  }, [guideId]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet changes-sheet" role="dialog" aria-modal="true" aria-labelledby="changes-title" onClick={event => event.stopPropagation()}>
          <h2 id="changes-title" className="changes-title">What changed in version {viewer.current_version}</h2>
          {!changes && <CordiaLoader size={32} label="Loading the changes" />}
          {changes?.failed && <p className="c-meta">The changes couldn’t load. You can still accept the update or stay.</p>}
          {changes && !changes.failed && (
            <div className="changes-list">
              <ChangeGroup title="Changed" items={changes.changed} changed />
              <ChangeGroup title="New" items={changes.added} />
              <ChangeGroup title="Removed" items={changes.removed} />
              <p className="c-meta">Accepting keeps your progress on everything that didn’t change. Changed questions step back one level. Removed ones are set aside, not lost.</p>
            </div>
          )}
          <div className="changes-actions">
            <button ref={firstRef} type="button" className="c-btn c-btn--primary" disabled={busy} onClick={onAccept}>Accept update</button>
            <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={onStay}>Stay on v{viewer.version}</button>
          </div>
        </section>
      </div>
      <style jsx global>{`
        .changes-sheet { width: min(560px, 100%); max-height: min(80vh, 720px); overflow-y: auto; display: grid; gap: 16px; }
        .changes-title { margin: 0; font: 500 26px/1.15 var(--font-display); color: var(--ink); }
        .changes-list { display: grid; gap: 16px; }
        .changes-group h3 { margin: 0 0 8px; font: 600 14px/1.2 var(--font-sans); color: var(--muted-ink); text-transform: uppercase; letter-spacing: 0.04em; }
        .changes-group ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .changes-group li { padding: 12px; border-radius: var(--r-row); background: var(--card-sunk); overflow-wrap: anywhere; }
        .changes-q { margin: 0 0 4px; font: 600 15px/1.35 var(--font-sans); color: var(--ink); }
        .changes-a { margin: 0; color: var(--ink); }
        .changes-before { margin: 4px 0 0; color: var(--muted-ink); }
        .changes-before s { text-decoration-thickness: 1px; }
        .changes-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media (max-width: 420px) { .changes-actions { grid-template-columns: 1fr; } }
      `}</style>
    </BodyPortal>
  );
}

function ChangeGroup({ title, items, changed = false }) {
  if (!items?.length) return null;
  return (
    <section className="changes-group" aria-label={title}>
      <h3>{title} ({items.length})</h3>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <p className="changes-q">{item.question}</p>
            <p className="changes-a">{item.answer}</p>
            {changed && item.before && item.before.answer !== item.answer && (
              <p className="changes-before c-meta">Was: <s>{item.before.answer}</s></p>
            )}
            {changed && item.before && item.before.question !== item.question && (
              <p className="changes-before c-meta">Question was: {item.before.question}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// A guide the student studied that's no longer available: the plain reason, and that their progress
// is kept for if it comes back.
export function GuideUnavailable({ title, reason }) {
  return (
    <section className="gone c-card" aria-labelledby="gone-title">
      <h1 id="gone-title" className="gone-title">{title || 'This guide'} isn’t available</h1>
      <p className="gone-reason">{reason}</p>
      <p className="c-meta">Your progress is saved. If the guide comes back, you’ll pick up where you left off.</p>
      <Link href="/library" className="c-btn c-btn--secondary">Back to Library</Link>
      <style jsx>{`
        .gone { max-width: 560px; margin: 48px auto; padding: 24px; display: grid; gap: 12px; justify-items: start; }
        .gone-title { margin: 0; font: 500 30px/1.15 var(--font-display); color: var(--ink); overflow-wrap: anywhere; }
        .gone-reason { margin: 0; color: var(--ink); }
        .gone p { margin: 0; }
      `}</style>
    </section>
  );
}
