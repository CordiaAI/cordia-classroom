import { useEffect, useState } from 'react';
import { RotateCcw, Sparkles, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import CoverArt, { COVER_ICON_COMPONENTS } from './CoverArt';
import { COVER_COLORS, COVER_ICONS, coverFor } from '../lib/coverDesign.mjs';
import { pickIcons, removeCover, saveCover } from '../lib/classCover';
import { classLabel } from '../lib/classLabel';

// Change a class's cover: its colour and up to three icons (the first is the big one), or let
// Cordia pick the icons from the class's material.
export default function ClassCoverSheet({ folder, titles = [], onClose, onSaved }) {
  const start = coverFor(folder, titles);
  const [color, setColor] = useState(start.color);
  const [icons, setIcons] = useState(start.icons);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { title } = classLabel(folder.name);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(name) {
    setIcons(current => (current.includes(name) ? current.filter(icon => icon !== name) : [...current, name].slice(-3)));
  }

  async function suggest() {
    setBusy('pick');
    const picked = await pickIcons(folder.name, titles);
    setBusy('');
    if (picked) setIcons(picked);
  }

  async function finish(request) {
    setBusy('save');
    setError('');
    const result = await request;
    setBusy('');
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
          <div className="cover-preview"><CoverArt color={color} icons={icons} /></div>
          <div className="cover-row" role="radiogroup" aria-label="Colour">
            {Array.from({ length: COVER_COLORS }, (_, index) => (
              <button key={index} type="button" role="radio" aria-checked={color === index} aria-label={`Colour ${index + 1}`}
                className={'cover-swatch' + (color === index ? ' is-on' : '')} style={{ '--sw': `var(--cover-${index + 1})`, '--sw-ink': `var(--cover-ink-${index + 1})` }} onClick={() => setColor(index)} />
            ))}
          </div>
          <div className="cover-icons-head">
            <span className="c-meta">Icons: pick up to 3. The first is the big one.</span>
            <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={suggest} disabled={Boolean(busy)}><Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />{busy === 'pick' ? 'Picking…' : 'Pick for me'}</button>
          </div>
          <div className="cover-grid" role="group" aria-label="Icons">
            {COVER_ICONS.map(name => {
              const Icon = COVER_ICON_COMPONENTS[name];
              const at = icons.indexOf(name);
              return (
                <button key={name} type="button" className={'cover-icon' + (at >= 0 ? ' is-on' : '')} aria-pressed={at >= 0} aria-label={name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')} title={name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')} onClick={() => toggle(name)}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  {at >= 0 && <span className="cover-icon-n">{at + 1}</span>}
                </button>
              );
            })}
          </div>
          {error && <p className="cover-error" role="alert">{error}</p>}
          <div className="c-row cover-actions">
            {folder.cover && <button type="button" className="c-btn c-btn--quiet" disabled={Boolean(busy)} onClick={() => finish(removeCover(folder.id))}><RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" />Reset</button>}
            <span className="c-spacer" />
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="c-btn c-btn--primary" disabled={Boolean(busy) || !icons.length} onClick={() => finish(saveCover(folder.id, { color, icons }))}>{busy === 'save' ? 'Saving…' : 'Save cover'}</button>
          </div>
        </section>
      </div>
      <style jsx global>{`
        .cover-sheet { width: min(560px, 100%); display: grid; gap: 14px; }
        .cover-preview { position: relative; aspect-ratio: 16 / 9; border-radius: var(--r-row); overflow: hidden; border: 1px solid var(--hairline); }
        .cover-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .cover-swatch { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--hairline); background: var(--sw); cursor: pointer; box-shadow: inset 0 0 0 9px var(--sw), inset 0 0 0 30px var(--sw-ink); }
        .cover-swatch.is-on { outline: 2px solid var(--olive); outline-offset: 2px; }
        .cover-icons-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .cover-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px; }
        .cover-icon { position: relative; display: grid; place-items: center; height: 44px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--muted); cursor: pointer; }
        .cover-icon:hover { background: var(--olive-tint); color: var(--ink); }
        .cover-icon.is-on { background: var(--lg-fill-strong, var(--surface-raised)); border-color: var(--olive); color: var(--olive-ink); }
        .cover-icon-n { position: absolute; top: 2px; right: 4px; font: 700 10px/1 var(--font-sans); color: var(--olive-ink); }
        .cover-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
        .cover-actions { gap: 8px; }
      `}</style>
    </BodyPortal>
  );
}
