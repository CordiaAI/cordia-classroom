import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BodyPortal from './BodyPortal';

// The first time a student shares a guide beyond their class: the Honor Code in three lines, the
// name choice, and "Make private" one tap away. `visibility` is 'public' or 'link'.
export default function PublishSheet({ visibility, attribution = 'named', onPublish, onPrivate, onClose }) {
  const [named, setNamed] = useState(attribution !== 'anonymous');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(action) {
    setBusy(true);
    await action();
    setBusy(false);
  }

  const isLink = visibility === 'link';
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet publish-sheet" role="dialog" aria-modal="true" aria-labelledby="publish-title" onClick={event => event.stopPropagation()}>
          <h2 id="publish-title" className="publish-title">{isLink ? 'Share by link?' : 'Make it public?'}</h2>
          <p className="publish-lead">
            {isLink ? 'Anyone with the link can see it. It isn’t listed anywhere.' : 'Anyone can find it and study from it.'}
            {' '}First, the Honor Code:
          </p>
          <ul className="publish-rules">
            <li>Share your own notes and summaries.</li>
            <li>No exams, quizzes, answer keys or test banks.</li>
            <li>Only share material you have the right to share.</li>
          </ul>
          <label className="publish-name">
            <input type="checkbox" checked={named} onChange={event => setNamed(event.target.checked)} />
            <span>Show my name</span>
          </label>
          <div className="publish-actions">
            <button ref={firstRef} type="button" className="c-btn c-btn--primary" disabled={busy}
              onClick={() => run(() => onPublish(named ? 'named' : 'anonymous'))}>
              {isLink ? 'Agree and share' : 'Agree and publish'}
            </button>
            <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => run(onPrivate)}>Make private</button>
          </div>
          <Link href="/honor-code" className="publish-honor" target="_blank">Read the full Honor Code</Link>
        </section>
      </div>
      <style jsx global>{`
        .publish-sheet { width: min(420px, 100%); display: grid; gap: 16px; }
        .publish-title { margin: 0; font: 500 28px/1.15 var(--font-display); color: var(--ink); }
        .publish-lead { margin: 0; color: var(--muted-ink); }
        .publish-rules { margin: 0; padding-left: 20px; display: grid; gap: 6px; color: var(--ink); }
        .publish-name { display: inline-flex; align-items: center; gap: 8px; font: 600 14px/1.2 var(--font-sans); color: var(--ink); cursor: pointer; }
        .publish-name input { width: 18px; height: 18px; accent-color: var(--olive); }
        .publish-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .publish-honor { justify-self: center; font: 600 13px/1 var(--font-sans); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 420px) { .publish-actions { grid-template-columns: 1fr; } }
      `}</style>
    </BodyPortal>
  );
}
