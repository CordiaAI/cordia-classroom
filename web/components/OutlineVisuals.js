import { useCallback, useEffect, useState } from 'react';
import { Layers, MessageCircle, Shapes, Sparkles, Trash2, X } from 'lucide-react';
import { authOnlyHeaders } from '../lib/api';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { walkthroughEvent } from '../lib/walkthrough';
import NapkinVisual from './NapkinVisual';

// Visuals in a guide's Outline: highlight text, press Visualize, three versions appear beside that
// section; the one the student keeps stays there. Kept visuals are saved through
// /api/guide-visuals, or in this browser until the guide_visuals table exists.

const localKey = guideId => `guideVisuals:${guideId}`;

export function useGuideVisuals(guideId) {
  const [visuals, setVisuals] = useState([]);
  const [stored, setStored] = useState(true);

  useEffect(() => {
    if (!guideId) return undefined;
    let active = true;
    setVisuals(readUserValue(localKey(guideId), []));
    fetch(`/api/guide-visuals?guideId=${encodeURIComponent(guideId)}`, { headers: authOnlyHeaders() })
      .then(response => response.json())
      .then(data => {
        if (!active) return;
        if (data?.stored && Array.isArray(data.visuals)) {
          setStored(true);
          setVisuals([...data.visuals, ...readUserValue(localKey(guideId), [])]);
        } else setStored(false);
      })
      .catch(() => { if (active) setStored(false); });
    return () => { active = false; };
  }, [guideId]);

  const saveLocal = useCallback(next => writeUserValue(localKey(guideId), next.filter(item => item.local)), [guideId]);

  const keep = useCallback(async visual => {
    let saved = null;
    if (stored) {
      const data = await fetch('/api/guide-visuals', {
        method: 'POST',
        headers: { ...authOnlyHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideId, ...visual }),
      }).then(response => response.json()).catch(() => null);
      if (data?.stored && data.visual) saved = data.visual;
    }
    if (!saved) saved = { ...visual, id: `local-${Date.now()}`, local: true };
    setVisuals(current => {
      const next = [...current, saved];
      saveLocal(next);
      return next;
    });
    walkthroughEvent('visual-added');
  }, [guideId, stored, saveLocal]);

  const remove = useCallback(async visual => {
    setVisuals(current => {
      const next = current.filter(item => item.id !== visual.id);
      saveLocal(next);
      return next;
    });
    if (!visual.local) {
      await fetch('/api/guide-visuals', {
        method: 'DELETE',
        headers: { ...authOnlyHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideId, id: visual.id }),
      }).catch(() => null);
    }
  }, [guideId, saveLocal]);

  return { visuals, keep, remove };
}

// The highlight menu over the Outline: Visualize first, then Explain, Make card and Ask.
// `section` is the data-outline-section of the block the highlight sits in.
export function useOutlineSelection(containerRef) {
  const [selection, setSelection] = useState(null); // { text, section, top, left }
  useEffect(() => {
    function check() {
      const current = window.getSelection();
      const text = current?.toString().trim();
      const container = containerRef.current;
      if (!text || text.length < 3 || !current.rangeCount || !container?.contains(current.anchorNode)) { setSelection(null); return; }
      let node = current.anchorNode.nodeType === 1 ? current.anchorNode : current.anchorNode.parentElement;
      const block = node?.closest?.('[data-outline-section]');
      const rect = current.getRangeAt(0).getBoundingClientRect();
      setSelection({
        text: text.slice(0, 600),
        section: block?.getAttribute('data-outline-section') || '',
        // On touch screens the phone's own Copy menu sits above a selection, so go below it.
        top: window.matchMedia('(pointer: coarse)').matches ? Math.min(window.innerHeight - 64, rect.bottom + 16) : Math.max(8, rect.top - 56),
        left: Math.max(8, Math.min(window.innerWidth - 380, rect.left + rect.width / 2 - 180)),
      });
    }
    const onUp = () => setTimeout(check, 0);
    const onScroll = () => setSelection(null);
    // Phones select by long-press and drag handles, which don't always end in a touchend.
    let settle = 0;
    const onChange = () => { clearTimeout(settle); settle = setTimeout(check, 350); };
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    document.addEventListener('touchend', onUp);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimeout(settle);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
      document.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [containerRef]);
  return [selection, setSelection];
}

export function OutlineSelectMenu({ selection, onAction }) {
  if (!selection) return null;
  const act = kind => { window.getSelection()?.removeAllRanges(); onAction(kind, selection); };
  return (
    <div className="c-menu ov-select" style={{ top: selection.top, left: selection.left }} role="menu" aria-label="Selection" onMouseDown={event => event.preventDefault()}>
      <button type="button" role="menuitem" className="ov-select-main" onClick={() => act('visualize')}><Shapes size={20} strokeWidth={1.75} aria-hidden="true" />Visualize</button>
      <button type="button" role="menuitem" onClick={() => act('explain')}><Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Explain</button>
      <button type="button" role="menuitem" onClick={() => act('card')}><Layers size={20} strokeWidth={1.75} aria-hidden="true" />Make card</button>
      <button type="button" role="menuitem" onClick={() => act('ask')}><MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />Ask</button>
      <OutlineVisualStyle />
    </div>
  );
}

// The column beside one Outline section: the visual being drawn (three versions to pick from)
// and the ones already kept.
export function SectionVisuals({ kept, pending, context, onKeep, onCancel, onRemove }) {
  return (
    <aside className="ov-side" aria-label="Visuals">
      {pending && (
        <div className="ov-pending">
          <div className="ov-pending-head">
            <span className="c-meta ov-quote">“{pending.text.length > 90 ? pending.text.slice(0, 90) + '…' : pending.text}”</span>
            <button type="button" className="c-icon-btn" aria-label="Cancel visual" onClick={onCancel}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
          <NapkinVisual
            key={pending.key}
            text={pending.text}
            context={context}
            auto
            useLabel="Keep this"
            name="outline-visual"
            onUse={visual => onKeep({ section: pending.section, anchor: pending.text, url: visual.url, alt: visual.alt || '', theme: visual.theme || 'light' })}
            fallback={() => null}
          />
        </div>
      )}
      {kept.map(visual => (
        <figure key={visual.id} className="ov-kept">
          <img className={`ov-img ov-${visual.theme === 'dark' ? 'dark' : 'light'}`} src={visual.url} alt={visual.alt || 'Visual'} loading="lazy" />
          <button type="button" className="c-icon-btn ov-remove" aria-label="Remove visual" title="Remove visual" onClick={() => onRemove(visual)}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button>
        </figure>
      ))}
      <OutlineVisualStyle />
    </aside>
  );
}

function OutlineVisualStyle() {
  return (
    <style jsx global>{`
      .ov-select { position: fixed; display: flex; flex-wrap: wrap; min-width: 0; max-width: calc(100vw - 16px); gap: 2px; z-index: 150; }
      .ov-select [role='menuitem'] { width: auto; }
      .ov-select .ov-select-main { color: var(--olive-ink); font-weight: 600; }
      .ov-side { display: grid; gap: 12px; align-content: start; min-width: 0; }
      .ov-pending { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-row); background: var(--surface-card, var(--card)); }
      .ov-pending-head { display: flex; align-items: flex-start; gap: 8px; }
      .ov-quote { flex: 1; min-width: 0; font-style: italic; }
      .ov-pending .nv-frame { aspect-ratio: 4 / 3; padding: 8px; }
      .ov-kept { position: relative; margin: 0; padding: 8px; border: 1px solid var(--hairline, var(--line)); border-radius: var(--r-row); background: var(--surface-card, var(--card)); }
      .ov-img { display: block; width: 100%; height: auto; }
      [data-theme='dark'] .ov-img.ov-light, :root:not([data-theme='dark']) .ov-img.ov-dark { filter: invert(1) hue-rotate(180deg); }
      .ov-remove { position: absolute; top: 6px; right: 6px; opacity: 0; transition: opacity .15s; background: var(--card); }
      .ov-kept:hover .ov-remove, .ov-remove:focus-visible { opacity: 1; }
      @media (hover: none) { .ov-remove { opacity: 1; } }
    `}</style>
  );
}
