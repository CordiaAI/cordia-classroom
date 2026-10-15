import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, X } from 'lucide-react';
import { useProgress } from '../lib/progress';
import { FEATURE_LIST } from '../lib/features';
import { showMe } from '../lib/showMe';
import ProgressRing from './ProgressRing';

// Every feature with "Show me". Items tick themselves from real use.
export function LearnList({ onBeforeShow }) {
  const router = useRouter();
  const progress = useProgress();
  return (
    <ul className="learn-list">
      {FEATURE_LIST.map(item => {
        const used = progress.used.includes(item.id);
        return (
          <li key={item.id}>
            <span className="learn-icon" aria-hidden="true">{used ? <Check size={20} strokeWidth={2} /> : <item.icon size={20} strokeWidth={1.75} />}</span>
            <span className="learn-label">{item.label}</span>
            {used && <span className="sr-only">done</span>}
            <button type="button" className="c-btn c-btn--quiet" onClick={async () => { onBeforeShow?.(); await showMe(router, item.id); }} aria-label={`Show me ${item.label}`}>Show me</button>
          </li>
        );
      })}
      <style jsx global>{`
        .learn-list { list-style: none; margin: 0; padding: 0; display: grid; }
        .learn-list li { display: flex; align-items: center; gap: 12px; min-height: 52px; border-top: 1px solid var(--line); }
        .learn-list li:first-child { border-top: 0; }
        .learn-icon { display: grid; place-items: center; width: 24px; flex: 0 0 auto; color: var(--ink); }
        .learn-label { flex: 1; min-width: 0; font-weight: 600; }
      `}</style>
    </ul>
  );
}

// Today header: a small ring "7 of 12" that opens the list in a sheet. Gone at 12 of 12.
export default function LearnCordia() {
  const progress = useProgress();
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const done = FEATURE_LIST.filter(item => progress.used.includes(item.id)).length;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  if (done >= FEATURE_LIST.length) return null;
  return (
    <>
      <button ref={opener} type="button" className="learn-ring" onClick={() => setOpen(true)} aria-label={`Learn Cordia, ${done} of ${FEATURE_LIST.length}`}>
        <ProgressRing value={done / FEATURE_LIST.length} size={28} stroke={3} label={false} title="" />
        <span className="c-meta">{done} of {FEATURE_LIST.length}</span>
      </button>
      {open && (
        <div className="c-scrim" onClick={close}>
          <section className="c-sheet learn-sheet" role="dialog" aria-modal="true" aria-labelledby="learn-title" onClick={event => event.stopPropagation()}>
            <header className="c-sheet-head">
              <h2 id="learn-title" className="c-title">Learn Cordia</h2>
              <button type="button" className="c-icon-btn" onClick={close} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
            </header>
            <LearnList onBeforeShow={() => setOpen(false)} />
          </section>
        </div>
      )}
      <style jsx global>{`
        .learn-ring { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 6px; border: 1px solid var(--glass-edge); border-radius: 999px; background: var(--glass); color: var(--ink); cursor: pointer; }
        .learn-ring .c-meta { color: var(--ink); }
        .learn-sheet { width: min(480px, 100%); }
      `}</style>
    </>
  );
}
