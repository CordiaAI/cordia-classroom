import { useEffect, useState } from 'react';
import { Sheet } from './Overlay';
import { useRouter } from 'next/router';
import { Check, X } from 'lucide-react';
import { useProgress } from '../lib/progress';
import { FEATURE_LIST, featureUsed } from '../lib/features';
import { showMe } from '../lib/showMe';
import ProgressRing from './ProgressRing';

// Every feature with "Show me". Items tick themselves from real use.
export function LearnList({ onBeforeShow }) {
  const router = useRouter();
  const progress = useProgress();
  return (
    <ul className="learn-list">
      {FEATURE_LIST.map(item => {
        const used = featureUsed(progress, item.id);
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

export const LEARN_EVENT = 'cordia:learn';

export function openLearnCordia() {
  window.dispatchEvent(new CustomEvent(LEARN_EVENT));
}

// The one Learn Cordia sheet (opened from the Today ring and from Help).
export function LearnSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(LEARN_EVENT, show);
    return () => window.removeEventListener(LEARN_EVENT, show);
  }, []);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} labelledBy="learn-title" className="learn-sheet">
      <header className="c-sheet-head">
        <h2 id="learn-title" className="c-title">Learn Cordia</h2>
        <button type="button" className="c-icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      </header>
      <LearnList onBeforeShow={() => setOpen(false)} />
    </Sheet>
  );
}

// Today header: a small ring "7 of 12" that opens the sheet. Gone at 12 of 12.
export default function LearnCordia() {
  const progress = useProgress();
  const done = FEATURE_LIST.filter(item => featureUsed(progress, item.id)).length;
  if (done >= FEATURE_LIST.length) return null;
  return (
    <>
      <button type="button" className="learn-ring" onClick={openLearnCordia} aria-label={`Learn Cordia, ${done} of ${FEATURE_LIST.length}`}>
        <ProgressRing value={done / FEATURE_LIST.length} size={28} stroke={3} label={false} title="" />
        <span className="c-meta">{done} of {FEATURE_LIST.length}</span>
      </button>
      <style jsx global>{`
        .learn-ring { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 6px; border: 1px solid var(--glass-edge); border-radius: 999px; background: var(--glass); color: var(--ink); cursor: pointer; }
        .learn-ring .c-meta { color: var(--ink); }
        .learn-sheet { width: min(480px, 100%); }
      `}</style>
    </>
  );
}
