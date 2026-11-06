import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { mergePreview, mergeSets } from '../lib/duplicates';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Merge two sets that look like the same material. The student picks the one to keep (a shared set
// is always the one kept), sees what moves over, and merges. The other set leaves the Library and
// can be restored from the kept set's menu for 30 days.
export default function MergeSheet({ pair, onClose, onMerged }) {
  const router = useRouter();
  const sets = [pair.keep, pair.merge];
  const [keepId, setKeepId] = useState(pair.keep.id);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const sheetRef = useRef(null);
  const keep = sets.find(set => set.id === keepId);
  const other = sets.find(set => set.id !== keepId);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError('');
    mergePreview(keepId, other.id).then(data => { if (alive) setPreview(data); }).catch(caught => { if (alive) setError(caught.message); });
    return () => { alive = false; };
  }, [keepId, other.id]);

  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function merge() {
    setBusy(true);
    setError('');
    try {
      const result = await mergeSets(keepId, other.id);
      setDone({ ...result, keptTitle: keep.title, mergedTitle: other.title });
      onMerged?.(result);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  const blocked = preview?.merge?.blocked;
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={() => !busy && onClose()}>
        <section ref={sheetRef} tabIndex={-1} className="c-sheet ms" role="dialog" aria-modal="true" aria-labelledby="ms-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="ms-title" className="c-title ms-title">{done ? 'Merged' : 'Merge these sets?'}</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          {done ? (
            <div className="ms-done" role="status">
              <span className="ms-done-icon" aria-hidden="true"><Check size={22} strokeWidth={2} /></span>
              <p><strong>{done.mergedTitle}</strong> is now part of <strong>{done.keptTitle}</strong>.</p>
              <p className="c-meta">Changed your mind? Restore it from {done.keptTitle}&rsquo;s ⋯ menu for 30 days.</p>
              <div className="ms-actions">
                <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Done</button>
                <button type="button" className="c-btn c-btn--primary" onClick={() => { onClose(); router.push('/guide/' + done.kept); }}>Open {done.keptTitle}</button>
              </div>
            </div>
          ) : (
            <>
              <p className="c-meta ms-lead">These look like the same material. Merging keeps one set with everything from both.</p>
              <fieldset className="ms-pick">
                <legend className="ms-legend">Keep</legend>
                {sets.map(set => (
                  <label key={set.id} className={'ms-option' + (keepId === set.id ? ' is-on' : '')}>
                    <input type="radio" name="ms-keep" value={set.id} checked={keepId === set.id}
                      disabled={busy || (set.id !== keepId && !sets.find(s => s.id !== set.id).can_merge_away)}
                      onChange={() => setKeepId(set.id)} />
                    <span className="ms-option-main">
                      <span className="ms-option-title">{set.title}</span>
                      <span className="c-meta">{plural(set.cards, 'card')} · {plural(set.questions, 'question')}</span>
                      {!set.can_merge_away && <span className="c-meta">Shared, so it&rsquo;s the one kept</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
              {!preview && !error && <SectionLoader height={72} label="Checking what moves over" />}
              {preview && (
                <ul className="ms-what">
                  <li>
                    {preview.added_cards || preview.added_questions
                      ? <>Adds {[preview.added_cards ? plural(preview.added_cards, 'new card') : '', preview.added_questions ? plural(preview.added_questions, 'new question') : ''].filter(Boolean).join(' and ')} to <strong>{keep.title}</strong>.</>
                      : <>Everything in {other.title} is already in <strong>{keep.title}</strong>.</>}
                    {preview.shared > 0 && <> {plural(preview.shared, 'idea')} in both stay{preview.shared === 1 ? 's' : ''} once, with your best progress.</>}
                  </li>
                  {preview.notes && <li>{other.title}&rsquo;s notes go at the end of the outline, under their own heading.</li>}
                  {(preview.quiz_attempts > 0 || preview.study_sessions > 0) && <li>Its quiz scores and study time move over too.</li>}
                  {preview.skipped > 0 && <li>{plural(preview.skipped, 'item')} won&rsquo;t fit, because a set holds at most 50 questions.</li>}
                  <li><strong>{other.title}</strong> leaves your Library. You can restore it from {keep.title}&rsquo;s ⋯ menu for 30 days.</li>
                </ul>
              )}
              {(error || blocked) && <p className="ms-error" role="alert">{error || blocked}</p>}
              <div className="ms-actions">
                <button type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="c-btn c-btn--primary" onClick={merge} disabled={busy || !preview || Boolean(blocked)} aria-busy={busy}>
                  {busy ? 'Merging…' : `Merge into ${keep.title.length > 28 ? keep.title.slice(0, 27) + '…' : keep.title}`}
                </button>
              </div>
            </>
          )}
          <style jsx>{`
            .ms { width: min(560px, 100%); display: grid; gap: 14px; }
            .ms-title { margin: 0; }
            .ms-lead { margin: 0; }
            .ms-pick { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
            .ms-legend { margin-bottom: 6px; padding: 0; font: 600 13px/1.3 var(--font-sans); color: var(--muted-ink); }
            .ms-option { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-input); cursor: pointer; min-width: 0; }
            .ms-option.is-on { border-color: var(--olive); background: var(--olive-tint); }
            .ms-option input { margin-top: 3px; accent-color: var(--olive); flex: none; }
            .ms-option-main { display: grid; gap: 2px; min-width: 0; }
            .ms-option-title { font: 600 16px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
            .ms-what { display: grid; gap: 8px; margin: 0; padding-left: 20px; color: var(--ink); font: 500 15px/1.45 var(--font-sans); }
            .ms-what li { overflow-wrap: anywhere; }
            .ms-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
            .ms-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
            .ms-done { display: grid; gap: 10px; justify-items: start; }
            .ms-done p { margin: 0; overflow-wrap: anywhere; }
            .ms-done-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
            .ms-done .ms-actions { justify-self: stretch; }
          `}</style>
        </section>
      </div>
    </BodyPortal>
  );
}
