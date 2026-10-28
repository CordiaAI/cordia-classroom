import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import NapkinVisual from './NapkinVisual';
import { COVER_CONTEXT, removeCover, saveCover } from '../lib/classCover';
import { classLabel } from '../lib/classLabel';

// Change a class's cover: redraw it, or describe what it should show, then use the one you like.
export default function ClassCoverSheet({ folder, defaultText, onClose, onSaved }) {
  const [text, setText] = useState(folder.cover?.text || defaultText);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { title } = classLabel(folder.name);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function finish(request) {
    setBusy(true);
    setError('');
    const result = await request;
    setBusy(false);
    if (result.folder) onSaved(result.folder);
    else setError(typeof result.error === 'string' ? result.error : 'Cover not saved');
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet cover-sheet" role="dialog" aria-modal="true" aria-labelledby="cover-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="cover-title" className="c-title">Cover for {title}</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          {folder.cover?.url && (
            <figure className="cover-now">
              <img src={folder.cover.url} alt={folder.cover.alt || ''} />
              <figcaption className="c-meta">Current cover</figcaption>
            </figure>
          )}
          <label className="cover-field">
            <span>What the cover shows</span>
            <textarea className="c-input" rows={5} value={text} onChange={event => setText(event.target.value)} maxLength={1500} />
            <span className="c-meta">Start from the class's topics, or describe your own. Each new drawing uses one visual.</span>
          </label>
          <NapkinVisual key={text} text={text.trim()} context={COVER_CONTEXT} name="class-cover" useLabel="Use as cover"
            onUse={visual => finish(saveCover(folder.id, { url: visual.url, alt: visual.alt || '', text: text.trim(), redraw: 0, theme: visual.theme === 'dark' ? 'dark' : 'light' }))} />
          {error && <p className="cover-error" role="alert">{error}</p>}
          {folder.cover?.url && (
            <button type="button" className="c-btn c-btn--quiet cover-remove" disabled={busy} onClick={() => finish(removeCover(folder.id))}><Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />Remove cover</button>
          )}
        </section>
      </div>
      <style jsx global>{`
        .cover-sheet { width: min(560px, 100%); display: grid; gap: 16px; }
        .cover-now { margin: 0; display: grid; gap: 6px; }
        .cover-now img { width: 100%; aspect-ratio: 16 / 10; object-fit: contain; padding: 12px; border-radius: var(--r-row); background: var(--draw-paper); border: 1px solid var(--hairline); }
        .cover-field { display: grid; gap: 6px; font: 600 13px/1.2 var(--font-sans); }
        .cover-field textarea { resize: vertical; min-height: 110px; font: 500 15px/1.45 var(--font-sans); }
        .cover-field .c-meta { font-weight: 500; }
        .cover-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
        .cover-remove { justify-self: start; }
      `}</style>
    </BodyPortal>
  );
}
