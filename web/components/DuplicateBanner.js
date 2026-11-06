import { useState } from 'react';
import { Copy, X } from 'lucide-react';
import MergeSheet from './MergeSheet';
import { dismissPair, useDuplicates } from '../lib/duplicates';

// Top of the Library (Mine): the first pair of sets that look like the same material, with Review
// (the merge sheet) and Not now (never suggested again). Nothing shows until a pair is found.
export default function DuplicateBanner({ onMerged }) {
  const { pairs } = useDuplicates();
  const [open, setOpen] = useState(null);
  const pair = pairs[0];
  if (!pair && !open) return null;

  return (
    <>
      {pair && (
        <section className="c-card dup-banner" aria-labelledby="dup-title">
          <span className="dup-icon" aria-hidden="true"><Copy size={20} strokeWidth={1.75} /></span>
          <div className="dup-main">
            <h2 id="dup-title" className="dup-title">These sets look like the same material</h2>
            <p className="dup-sets"><strong>{pair.keep.title}</strong> and <strong>{pair.merge.title}</strong></p>
            {pairs.length > 1 && <p className="c-meta dup-more">{pairs.length - 1} more {pairs.length - 1 === 1 ? 'pair' : 'pairs'} after this one</p>}
            <div className="dup-actions">
              <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => setOpen(pair)}>Review</button>
              <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => dismissPair(pair)}>Not now</button>
            </div>
          </div>
          <button type="button" className="c-icon-btn dup-close" onClick={() => dismissPair(pair)} aria-label={`Don't suggest merging ${pair.keep.title} and ${pair.merge.title}`}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </section>
      )}
      {open && <MergeSheet pair={open} onClose={() => setOpen(null)} onMerged={onMerged} />}
      <style jsx>{`
        .dup-banner { position: relative; display: flex; gap: 14px; align-items: flex-start; padding: 16px 48px 16px 16px; min-width: 0; }
        .dup-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .dup-main { display: grid; gap: 4px; min-width: 0; }
        .dup-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .dup-sets { margin: 0; color: var(--muted-ink); overflow-wrap: anywhere; }
        .dup-sets strong { color: var(--ink); font-weight: 600; }
        .dup-more { margin: 0; }
        .dup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
        .dup-banner :global(.dup-close) { position: absolute; top: 8px; right: 8px; }
      `}</style>
    </>
  );
}
