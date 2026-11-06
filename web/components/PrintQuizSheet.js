import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Printer } from 'lucide-react';
import BodyPortal from './BodyPortal';
import Toggle from './Toggle';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { getPref, setPref } from '../lib/progress';
import {
  DEFAULT_FORMAT, MAX_COUNT, PRESETS, TYPES, TYPE_NAMES, applyPreset, buildPrint, cleanFormat, encodeFormat, matchingPreset, setCount, toggleType,
} from '../lib/printQuiz.mjs';

// The "Print quiz" button on a finish screen: opens the sheet below.
export function PrintQuizButton({ guideId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="c-btn c-btn--secondary" onClick={() => setOpen(true)}><Printer size={20} strokeWidth={1.75} aria-hidden="true" />Print quiz</button>
      {open && <PrintQuizSheet guideId={guideId} onClose={() => setOpen(false)} />}
    </>
  );
}

// "Print quiz": the student picks the format (presets, or each type on/off with a count) and the
// options, sees the total questions and points as they change, then the print page opens in a new
// tab. The format is remembered on the account. Opened from the guide's ⋯ menu and the Quiz finish.
export default function PrintQuizSheet({ guideId, onClose }) {
  const [format, setFormat] = useState(() => cleanFormat(getPref('print', DEFAULT_FORMAT)));
  const [pools, setPools] = useState(null);
  const [error, setError] = useState('');
  const printRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/quiz/${guideId}/print-items`, { method: 'POST', timeoutMs: 60000, body: JSON.stringify({ fill: false }) }).then(data => {
      if (!alive) return;
      if (Array.isArray(data?.mc)) setPools(data);
      else setError(apiErrorMessage(data?.detail, 'This guide could not be prepared for printing.'));
    });
    return () => { alive = false; };
  }, [guideId]);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { if (pools) printRef.current?.focus(); }, [pools]);

  // Fill-in sentences are written when the quiz is printed; until then each likely candidate
  // counts as one blank, so the totals read "about".
  const fillEstimated = Boolean(pools && !pools.fill);
  const preview = useMemo(() => {
    if (!pools) return null;
    const fill = pools.fill || Array.from({ length: pools.fill_possible || 0 }, (_, i) => ({ id: `est${i}`, source: `est${i}`, parts: [], blanks: ['_'], points: 1 }));
    return buildPrint({ mc: pools.mc, matching: pools.matching, fill, short: pools.short }, format);
  }, [pools, format]);
  const preset = matchingPreset(format);
  const onCount = TYPES.filter(type => format.on[type]).length;

  function print() {
    setPref('print', format);
    window.open(`/print/quiz/${guideId}?f=${encodeFormat(format)}`, '_blank', 'noopener');
    onClose();
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet pqs" role="dialog" aria-modal="true" aria-labelledby="pqs-title" onClick={event => event.stopPropagation()}>
          <h2 id="pqs-title" className="pqs-title">Print quiz</h2>
          {error && <p className="retain-action-error" role="alert">{error}</p>}
          {!pools && !error && <p className="c-meta" role="status">Getting this guide&rsquo;s questions ready…</p>}
          {pools && (
            <>
              <div className="pqs-presets" role="group" aria-label="Quick formats">
                {PRESETS.map(item => (
                  <button key={item.key} type="button" className={'c-chip pqs-chip' + (preset === item.key ? ' is-on' : '')} aria-pressed={preset === item.key}
                    onClick={() => setFormat(current => applyPreset(current, item.key))}>{item.label}</button>
                ))}
              </div>
              <ul className="pqs-types">
                {TYPES.map(type => {
                  const on = format.on[type];
                  const count = format.counts[type];
                  return (
                    <li key={type} className={'pqs-type' + (on ? '' : ' is-off')}>
                      <Toggle checked={on} onChange={value => setFormat(current => toggleType(current, type, value))} label={TYPE_NAMES[type]} disabled={on && onCount === 1} />
                      <div className="pqs-stepper" role="group" aria-label={`${TYPE_NAMES[type]} count`}>
                        <button type="button" className="c-icon-btn" onClick={() => setFormat(current => setCount(current, type, count - 1))} disabled={!on || count <= 1} aria-label={`Fewer ${TYPE_NAMES[type].toLowerCase()}`}><Minus size={16} strokeWidth={2} aria-hidden="true" /></button>
                        <span className="pqs-count" aria-live="polite">{count}</span>
                        <button type="button" className="c-icon-btn" onClick={() => setFormat(current => setCount(current, type, count + 1))} disabled={!on || count >= MAX_COUNT} aria-label={`More ${TYPE_NAMES[type].toLowerCase()}`}><Plus size={16} strokeWidth={2} aria-hidden="true" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="pqs-total" aria-live="polite">
                {fillEstimated && format.on.fill ? 'About ' : ''}{preview.questions} {preview.questions === 1 ? 'question' : 'questions'} · {preview.points} {preview.points === 1 ? 'point' : 'points'}
              </p>
              {preview.notes.map(note => <p key={note} className="pqs-note">{note}</p>)}
              {pools.mc_flagged > 0 && format.on.mc && (
                <p className="pqs-note">{pools.mc_flagged === 1 ? '1 multiple-choice question is' : `${pools.mc_flagged} multiple-choice questions are`} left out because an answer choice is another question&rsquo;s answer. Refresh answer choices on the guide to include {pools.mc_flagged === 1 ? 'it' : 'them'}.</p>
              )}
              {fillEstimated && format.on.fill && <p className="pqs-note">Fill-in-the-blank sentences are written from your guide when you print. The first time counts as one AI quiz.</p>}
              <div className="pqs-options">
                <Toggle checked={format.shuffleQuestions || format.versions} disabled={format.versions} onChange={value => setFormat(current => ({ ...current, shuffleQuestions: value }))} label="Shuffle questions" />
                <Toggle checked={format.shuffleOptions || format.versions} disabled={format.versions} onChange={value => setFormat(current => ({ ...current, shuffleOptions: value }))} label="Shuffle answer choices" />
                <Toggle checked={format.answerKey} onChange={value => setFormat(current => ({ ...current, answerKey: value }))} label="Answer key on its own last page" />
                <Toggle checked={format.versions} onChange={value => setFormat(current => ({ ...current, versions: value }))} label="Versions A and B, each with its own key" />
              </div>
              <div className="pqs-actions">
                <button ref={printRef} type="button" className="c-btn c-btn--primary" onClick={print} disabled={!preview.questions}><Printer size={20} strokeWidth={1.75} aria-hidden="true" />Print</button>
                <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </section>
      </div>
      <style jsx global>{`
        .pqs { width: min(520px, 100%); display: grid; gap: 14px; max-height: calc(100vh - 48px); overflow-y: auto; }
        .pqs-title { margin: 0; font: 500 28px/1.15 var(--font-display); color: var(--ink); }
        .pqs-presets { display: flex; flex-wrap: wrap; gap: 8px; }
        .pqs-chip.is-on { background: var(--olive-tint); border-color: var(--olive); color: var(--olive-ink); }
        .pqs-types { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
        .pqs-type { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--hairline); }
        .pqs-type .c-toggle { flex: 1; }
        .pqs-type.is-off .pqs-count { color: var(--muted); }
        .pqs-stepper { display: inline-flex; align-items: center; gap: 4px; }
        .pqs-count { min-width: 28px; text-align: center; font: 600 16px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--ink); }
        .pqs-total { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); font-variant-numeric: tabular-nums; }
        .pqs-note { margin: 0; color: var(--muted); font: 500 var(--fs-13)/1.45 var(--font-sans); }
        .pqs-options { display: grid; gap: 10px; padding-top: 4px; }
        .pqs-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      `}</style>
    </BodyPortal>
  );
}
