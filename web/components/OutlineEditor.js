import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heading2, List, ListIndentIncrease } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { domToOutline, outlineToHtml } from '../lib/outlineDoc';
import { walkthroughEvent } from '../lib/walkthrough';
import { KeptVisual, OutlineSelectMenu, PendingVisual, findAnchorBlock, useGuideVisuals, useOutlineSelection } from './OutlineVisuals';

const SAVE_MS = 900;
const GAP = 12;

// A guide's Outline, which is also where the student's own notes live: the AI's outline (if the
// guide has material) and anything the student types, saved to the guide's notes as they go.
// Highlight text for Visualize, Explain, Make card or Ask; a visual appears right beside the
// highlighted line, and the one kept stays there.
export default function OutlineEditor({ guide, version = 0, onSaved, onAction, placeholder = 'Type your notes…' }) {
  const pageRef = useRef(null);
  const gutterRef = useRef(null);
  const saved = useRef(guide.notes || '');
  const timer = useRef(0);
  const [saving, setSaving] = useState('');
  const [pending, setPending] = useState(null); // { key, text, section }
  const [selection, setSelection] = useOutlineSelection(pageRef);
  const visuals = useGuideVisuals(guide.id);
  const hasSide = Boolean(pending || visuals.visuals.length);

  // The page is filled once per guide (and after the outline is rewritten); typing then owns it.
  useEffect(() => {
    if (!pageRef.current) return;
    pageRef.current.innerHTML = outlineToHtml(guide.notes || '');
    saved.current = guide.notes || '';
  }, [guide.id, version]);

  async function save() {
    const notes = domToOutline(pageRef.current);
    if (notes === saved.current) return;
    setSaving('Saving…');
    const data = await apiFetch(`/guides/${guide.id}`, { method: 'PATCH', body: JSON.stringify({ title: guide.title, notes }) });
    if (data?.guide) {
      saved.current = notes;
      onSaved?.(notes);
      setSaving('Saved');
      walkthroughEvent('note-written');
    } else setSaving('Not saved. Keep typing to try again.');
  }

  function onInput() {
    setSaving('');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_MS);
  }
  useEffect(() => () => { clearTimeout(timer.current); if (pageRef.current && domToOutline(pageRef.current) !== saved.current) save(); }, [guide.id]);

  function format(kind) {
    pageRef.current?.focus();
    if (kind === 'heading') document.execCommand('formatBlock', false, 'h2');
    else if (kind === 'list') document.execCommand('insertUnorderedList');
    else document.execCommand('indent');
    onInput();
  }

  function onMenu(kind, picked) {
    setSelection(null);
    if (kind === 'visualize') setPending({ key: Date.now(), text: picked.text, section: picked.section });
    else onAction?.(kind, picked.text);
  }

  // Each visual sits by its line: beside it on wide screens (pushed down to the line, never over
  // the one above), and on narrow screens right under it, with room opened below the line.
  const items = [
    ...visuals.visuals.map(visual => ({ key: visual.id, anchor: visual.anchor, visual })),
    ...(pending ? [{ key: 'pending', anchor: pending.text, pending }] : []),
  ];
  function place() {
    const page = pageRef.current;
    const gutter = gutterRef.current;
    if (!page) return;
    for (const block of page.querySelectorAll('[data-oe-gap]')) { block.style.marginBottom = ''; block.removeAttribute('data-oe-gap'); }
    if (!gutter) return;
    const side = window.matchMedia('(min-width: 1100px)').matches;
    const nodes = [...gutter.children].filter(node => node.dataset.anchor !== undefined);
    const blocks = nodes.map(node => findAnchorBlock(page, node.dataset.anchor));
    const order = nodes.map((node, index) => index).sort((x, y) => (blocks[x] && blocks[y] ? (blocks[x].compareDocumentPosition(blocks[y]) & 4 ? -1 : 1) : blocks[x] ? -1 : 1));
    if (side) {
      const top = gutter.getBoundingClientRect().top;
      let floor = 0;
      for (const [position, index] of order.entries()) {
        const node = nodes[index];
        Object.assign(node.style, { position: '', top: '', order: String(position) });
        const wanted = blocks[index] ? blocks[index].getBoundingClientRect().top - top : floor;
        const want = Math.max(wanted, floor);
        node.style.marginTop = `${want - floor}px`;
        floor = want + node.offsetHeight + GAP;
      }
      return;
    }
    // Narrow: open a gap under each line and lay its visuals into it.
    const box = gutter.parentElement.getBoundingClientRect();
    const gaps = new Map();
    for (const index of order) {
      const block = blocks[index] || page.lastElementChild;
      if (!block) continue;
      const node = nodes[index];
      const before = gaps.get(block) || 0;
      gaps.set(block, before + node.offsetHeight + GAP);
      block.setAttribute('data-oe-gap', '');
      block.style.marginBottom = `${gaps.get(block) + GAP}px`;
      node.dataset.before = String(before);
    }
    for (const index of order) {
      const block = blocks[index] || page.lastElementChild;
      if (!block) continue;
      const node = nodes[index];
      Object.assign(node.style, { position: 'absolute', marginTop: '0', top: `${block.getBoundingClientRect().bottom - box.top + GAP + Number(node.dataset.before || 0)}px` });
    }
  }
  // Re-place when the page, or any visual (an image finishing loading), changes size.
  const observer = useRef(null);
  useLayoutEffect(() => {
    place();
    if (observer.current && gutterRef.current) for (const node of gutterRef.current.children) observer.current.observe(node);
  });
  useEffect(() => {
    if (!hasSide) return undefined;
    let frame = 0;
    observer.current = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); });
    if (pageRef.current) observer.current.observe(pageRef.current);
    if (gutterRef.current) for (const node of gutterRef.current.children) observer.current.observe(node);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); observer.current.disconnect(); observer.current = null; window.removeEventListener('resize', place); if (pageRef.current) for (const block of pageRef.current.querySelectorAll('[data-oe-gap]')) { block.style.marginBottom = ''; block.removeAttribute('data-oe-gap'); } };
  }, [hasSide]);

  return (
    <div className={'oe' + (hasSide ? ' has-side' : '')}>
      <div className="oe-main">
        <div className="oe-tools" role="toolbar" aria-label="Notes formatting">
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('heading')}><Heading2 size={16} strokeWidth={1.75} aria-hidden="true" />Heading</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('list')}><List size={16} strokeWidth={1.75} aria-hidden="true" />Bullet</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('indent')}><ListIndentIncrease size={16} strokeWidth={1.75} aria-hidden="true" />Detail</button>
          <span className="c-spacer" />
          <span className="c-meta oe-status" role="status">{saving}</span>
        </div>
        <div
          ref={pageRef}
          className="oe-page c-study"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Outline and notes"
          data-placeholder={placeholder}
          data-spot="note-new"
          onInput={onInput}
          onBlur={() => { clearTimeout(timer.current); save(); }}
        />
      </div>
      {hasSide && (
        <aside ref={gutterRef} className="oe-side" aria-label="Visuals">
          {items.map(item => (
            <div key={item.key} data-anchor={item.anchor || ''} className="oe-side-item">
              {item.pending
                ? <PendingVisual pending={item.pending} title={guide.title} onCancel={() => setPending(null)} onKeep={async visual => { setPending(null); await visuals.keep(visual); }} />
                : <KeptVisual visual={item.visual} onRemove={visuals.remove} />}
            </div>
          ))}
        </aside>
      )}
      <OutlineSelectMenu selection={selection} onAction={onMenu} />
      <style jsx>{`
        .oe { position: relative; display: grid; gap: 28px; align-items: start; }
        .oe.has-side { grid-template-columns: minmax(0, 1fr) minmax(320px, 46%); }
        .oe-main { display: grid; gap: 12px; min-width: 0; }
        .oe-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: -8px 0 0 -12px; }
        .oe-status { font-size: 13px; }
        .oe-side { position: relative; display: flex; flex-direction: column; min-width: 0; }
        .oe-side-item + .oe-side-item { margin-top: ${GAP}px; }
        .oe-page { min-height: 240px; outline: none; display: grid; gap: 12px; align-content: start; }
        .oe-page:empty::before { content: attr(data-placeholder); color: var(--muted); }
        .oe-page :global(h2) { display: flex; gap: 12px; align-items: baseline; margin: 20px 0 0; font: 600 20px/1.3 var(--font-sans); letter-spacing: 0; counter-increment: oe-section; }
        .oe-page :global(h2:first-child) { margin-top: 0; }
        .oe-page :global(h2::before) { content: counter(oe-section); flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); user-select: none; }
        .oe-page { counter-reset: oe-section; }
        .oe-page :global(.oe-overview) { margin: 0; padding-bottom: 20px; border-bottom: 1px solid var(--line); font: 400 var(--fs-20, 20px)/1.5 var(--font-sans); color: var(--ink); }
        .oe-page :global(ul) { margin: 0; padding-left: 22px; display: grid; gap: 8px; }
        .oe-page :global(ul ul) { margin-top: 6px; gap: 4px; list-style: circle; color: var(--muted-ink); }
        .oe-page :global(p), .oe-page :global(div) { margin: 0; }
        .oe-page :global(strong) { font-weight: 600; color: var(--ink); }
        @media (max-width: 1099px) {
          .oe.has-side { grid-template-columns: minmax(0, 1fr); }
          .oe-side { position: absolute; inset: 0; pointer-events: none; }
          .oe-side-item { left: 0; right: 0; pointer-events: auto; }
          .oe-side-item + .oe-side-item { margin-top: 0; }
        }
      `}</style>
    </div>
  );
}
