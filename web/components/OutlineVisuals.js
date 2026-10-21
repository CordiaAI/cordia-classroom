import { useCallback, useEffect, useState } from 'react';
import BodyPortal from './BodyPortal';
import { Layers, Maximize2, MessageCircle, Shapes, Sparkles, Trash2, X } from 'lucide-react';
import { authOnlyHeaders } from '../lib/api';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { walkthroughEvent } from '../lib/walkthrough';
import NapkinVisual from './NapkinVisual';
import { visualContent } from '../lib/visualText';

// Visuals in a guide's Outline: highlight text, press Visualize, three Napkin versions appear right
// beside that line; the one the student keeps stays there. Kept visuals are saved through /api/guide-visuals, or in this browser until the
// guide_visuals table exists.

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

// The block (heading, point or line) a node sits in, inside the editable page.
export function blockOf(node, root) {
  let el = node?.nodeType === 1 ? node : node?.parentElement;
  while (el && el !== root) {
    if (/^(LI|H[1-6]|P)$/.test(el.tagName) || el.parentElement === root) return el;
    el = el.parentElement;
  }
  return null;
}

// The text of the section a block is in: its heading and everything up to the next heading.
export function sectionTextOf(block, root) {
  if (!block || !root) return '';
  let top = block;
  while (top.parentElement && top.parentElement !== root) top = top.parentElement;
  let start = top;
  while (start.previousElementSibling && !/^H[1-6]$/.test(start.tagName)) start = start.previousElementSibling;
  const parts = [];
  for (let el = start; el; el = el.nextElementSibling) {
    if (el !== start && /^H[1-6]$/.test(el.tagName)) break;
    parts.push(el.innerText || el.textContent || '');
  }
  return parts.join('\n').trim();
}

// The block whose own text holds the start of `anchor` (a point's text, not its sub-points'), so
// a kept visual finds its line again.
const ownText = el => [...el.childNodes].filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map(n => n.textContent).join('');
const squash = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
export function findAnchorBlock(root, anchor) {
  const want = squash(anchor).slice(0, 60);
  if (!root || !want) return null;
  const blocks = [...root.querySelectorAll('li, h1, h2, h3, p')];
  return blocks.find(el => squash(ownText(el)).includes(want))
    || blocks.find(el => want.includes(squash(ownText(el)).slice(0, 40)) && squash(ownText(el)).length > 8)
    || null;
}

// The highlight menu over the Outline: Visualize first, then Explain, Make card and Ask.
export function useOutlineSelection(rootRef) {
  const [selection, setSelection] = useState(null); // { text, section, top, left }
  useEffect(() => {
    function check() {
      const current = window.getSelection();
      const text = current?.toString().replace(/\s+/g, ' ').trim();
      const root = rootRef.current;
      if (!text || text.length < 3 || !current.rangeCount || !root?.contains(current.anchorNode)) { setSelection(null); return; }
      const block = blockOf(current.anchorNode, root);
      const rect = current.getRangeAt(0).getBoundingClientRect();
      setSelection({
        text: text.slice(0, 600),
        section: sectionTextOf(block, root),
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
  }, [rootRef]);
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

// The visual being drawn for a highlight: three Napkin versions to pick from.
export function PendingVisual({ pending, title, onKeep, onCancel }) {
  const text = visualContent(pending.text, pending.section);
  const keep = visual => onKeep({ anchor: pending.text, ...visual });
  return (
    <div className="ov-pending">
      <div className="ov-pending-head">
        <span className="c-meta ov-quote">“{pending.text.length > 90 ? pending.text.slice(0, 90) + '…' : pending.text}”</span>
        <button type="button" className="c-icon-btn" aria-label="Cancel visual" onClick={onCancel}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <NapkinVisual
        key={pending.key}
        text={text}
        context={title}
        auto
        useLabel="Keep this"
        name="outline-visual"
        onUse={visual => keep({ url: visual.url, alt: visual.alt || '', theme: visual.theme || 'light' })}
      />
      <OutlineVisualStyle />
    </div>
  );
}

// A visual the student kept: opens full size, can be removed.
export function KeptVisual({ visual, onRemove }) {
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    if (!enlarged) return undefined;
    const onKey = event => { if (event.key === 'Escape') setEnlarged(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);
  const art = <img className={`ov-img ov-${visual.theme === 'dark' ? 'dark' : 'light'}`} src={visual.url} alt={visual.alt || 'Visual'} loading="lazy" />;
  return (
    <figure className="ov-kept">
      <button type="button" className="ov-open" aria-label="Open visual full size" onClick={() => setEnlarged(true)}>{art}</button>
      <div className="ov-tools">
        <button type="button" className="c-icon-btn" aria-label="Open visual full size" title="Full size" onClick={() => setEnlarged(true)}><Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" /></button>
        <button type="button" className="c-icon-btn" aria-label="Remove visual" title="Remove visual" onClick={() => onRemove(visual)}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      {enlarged && (
        <BodyPortal>
          <div className="c-scrim ov-zoom" onClick={() => setEnlarged(false)} role="dialog" aria-modal="true" aria-label="Visual">
            <div className="ov-zoom-art">{art}</div>
            <button type="button" className="c-icon-btn ov-zoom-close" aria-label="Close" onClick={() => setEnlarged(false)}><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
        </BodyPortal>
      )}
      <OutlineVisualStyle />
    </figure>
  );
}

function OutlineVisualStyle() {
  return (
    <style jsx global>{`
      .ov-select { position: fixed; display: flex; flex-wrap: wrap; min-width: 0; max-width: calc(100vw - 16px); gap: 2px; z-index: 150; }
      .ov-select [role='menuitem'] { width: auto; }
      .ov-select .ov-select-main { color: var(--olive-ink); font-weight: 600; }
      .ov-pending { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-row); background: var(--surface-card, var(--card)); box-shadow: var(--shadow-float); }
      .ov-pending-head { display: flex; align-items: flex-start; gap: 8px; }
      .ov-quote { flex: 1; min-width: 0; font-style: italic; }
      .ov-pending .nv-frame { aspect-ratio: auto; min-height: 260px; max-height: none; padding: 8px; }
      .ov-pending .nv-image { width: 100%; }
      .ov-kept { position: relative; margin: 0; padding: 8px; border: 1px solid var(--hairline, var(--line)); border-radius: var(--r-row); background: var(--surface-card, var(--card)); }
      .ov-img { display: block; width: 100%; height: auto; }
      [data-theme='dark'] .ov-img.ov-light, :root:not([data-theme='dark']) .ov-img.ov-dark { filter: invert(1) hue-rotate(180deg); }
      .ov-open { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; cursor: zoom-in; }
      .ov-tools { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
      .ov-tools .c-icon-btn { background: var(--card); }
      .ov-kept:hover .ov-tools, .ov-tools:focus-within { opacity: 1; }
      @media (hover: none) { .ov-tools { opacity: 1; } }
      .ov-zoom { display: grid; place-items: center; padding: 24px; cursor: zoom-out; }
      .ov-zoom-art { width: min(1200px, 100%); max-height: calc(100vh - 48px); overflow: auto; border-radius: var(--r-card); background: var(--card); padding: 16px; box-shadow: var(--shadow-float); }
      .ov-zoom-art .ov-img { max-height: calc(100vh - 80px); object-fit: contain; }
      .ov-zoom-close { position: fixed; top: 16px; right: 16px; background: var(--card); }
    `}</style>
  );
}
