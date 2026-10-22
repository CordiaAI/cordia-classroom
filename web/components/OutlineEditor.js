import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Heading2, List, ListIndentIncrease, Pencil, Undo2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { domToOutline, outlineToHtml } from '../lib/outlineDoc';
import { walkthroughEvent } from '../lib/walkthrough';
import { KeptVisual, OutlineSelectMenu, PendingVisual, findAnchorBlock, useGuideVisuals, useOutlineSelection } from './OutlineVisuals';

const SAVE_MS = 900;
const GAP = 12;
const MIN_FIT = 160;
// Saved versions kept for Undo, newest last.
const UNDO_LIMIT = 50;

// A guide's Outline, which is also where the student's own notes live: the AI's outline (if the
// guide has material) and anything the student types, saved to the guide's notes as they go.
// Highlight text for Visualize, Explain, Make card or Ask; a visual appears right beside the
// highlighted line, and the one kept stays there.
// It opens read-only; Edit shows the formatting buttons, Undo and the page's tools, and Done
// goes back to reading. Undo steps back one saved change at a time (a regenerated outline too).
// tools: extra toolbar buttons from the page (Regenerate outline on a guide with material).
export default function OutlineEditor({ guide, version = 0, onSaved, onAction, tools = null, placeholder = 'Type your notes…' }) {
  const pageRef = useRef(null);
  const gutterRef = useRef(null);
  const saved = useRef(guide.notes || '');
  const timer = useRef(0);
  const [saving, setSaving] = useState('');
  // Empty notes open ready to type; anything written opens for reading.
  const [editing, setEditing] = useState(() => !(guide.notes || '').trim());
  const history = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(null); // { key, text, section }
  const [selection, setSelection] = useOutlineSelection(pageRef);
  const visuals = useGuideVisuals(guide.id);
  const hasSide = Boolean(pending || visuals.visuals.length);

  // The page is filled once per guide (and after the outline is rewritten); typing then owns it.
  useEffect(() => {
    if (!pageRef.current) return;
    // A rewritten outline (same guide) can be undone like any other change.
    if (version && saved.current !== (guide.notes || '')) remember(saved.current);
    pageRef.current.innerHTML = outlineToHtml(guide.notes || '');
    saved.current = guide.notes || '';
  }, [guide.id, version]);
  useEffect(() => { history.current = []; setCanUndo(false); }, [guide.id]);

  function remember(notes) {
    history.current = [...history.current, notes].slice(-UNDO_LIMIT);
    setCanUndo(true);
  }

  async function save() {
    const notes = domToOutline(pageRef.current);
    if (notes === saved.current) return;
    setSaving('Saving…');
    const data = await apiFetch(`/guides/${guide.id}`, { method: 'PATCH', body: JSON.stringify({ title: guide.title, notes }) });
    if (data?.guide) {
      remember(saved.current);
      saved.current = notes;
      setDirty(domToOutline(pageRef.current) !== notes);
      onSaved?.(notes);
      setSaving('Saved');
      walkthroughEvent('note-written');
    } else setSaving('Not saved. Keep typing to try again.');
  }

  function onInput() {
    setDirty(true);
    setSaving('');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_MS);
  }
  useEffect(() => () => { clearTimeout(timer.current); if (pageRef.current && domToOutline(pageRef.current) !== saved.current) save(); }, [guide.id]);

  // Undo: put back the version saved before the last change, and save that.
  async function undo() {
    clearTimeout(timer.current);
    const current = domToOutline(pageRef.current);
    // Unsaved typing is the last change: undo goes back to what was last saved.
    const previous = current !== saved.current ? saved.current : history.current[history.current.length - 1];
    if (previous === undefined) return;
    if (current === saved.current) history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    pageRef.current.innerHTML = outlineToHtml(previous);
    setSaving('Saving…');
    const data = await apiFetch(`/guides/${guide.id}`, { method: 'PATCH', body: JSON.stringify({ title: guide.title, notes: previous }) });
    setDirty(false);
    if (data?.guide) { saved.current = previous; onSaved?.(previous); setSaving('Undone'); }
    else setSaving('Not saved. Try again.');
  }

  function finishEditing() {
    clearTimeout(timer.current);
    save();
    setEditing(false);
  }

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
    // Each visual fits the height of the lines it was made from (never under MIN_FIT, to stay readable).
    nodes.forEach((node, index) => {
      const first = blocks[index];
      const last = findAnchorBlock(page, node.dataset.anchor, { end: true });
      const top = first?.getBoundingClientRect().top;
      const bottom = Math.max(first?.getBoundingClientRect().bottom || 0, last?.getBoundingClientRect().bottom || 0);
      if (first) node.style.setProperty('--oe-fit', `${Math.max(MIN_FIT, Math.round(bottom - top))}px`);
      else node.style.removeProperty('--oe-fit');
    });
    // A visual whose line can't be found at all stays at the top, never pushed under the others.
    const order = nodes.map((node, index) => index).sort((x, y) => (blocks[x] && blocks[y] ? (blocks[x].compareDocumentPosition(blocks[y]) & 4 ? -1 : 1) : blocks[x] ? 1 : blocks[y] ? -1 : x - y));
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
      const block = blocks[index] || page.firstElementChild;
      if (!block) continue;
      const node = nodes[index];
      const before = gaps.get(block) || 0;
      gaps.set(block, before + node.offsetHeight + GAP);
      block.setAttribute('data-oe-gap', '');
      block.style.marginBottom = `${gaps.get(block) + GAP}px`;
      node.dataset.before = String(before);
    }
    for (const index of order) {
      const block = blocks[index] || page.firstElementChild;
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
      {editing ? (
        <div className="oe-tools" role="toolbar" aria-label="Notes formatting">
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('heading')}><Heading2 size={16} strokeWidth={1.75} aria-hidden="true" />Heading</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('list')}><List size={16} strokeWidth={1.75} aria-hidden="true" />Bullet</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={() => format('indent')}><ListIndentIncrease size={16} strokeWidth={1.75} aria-hidden="true" />Detail</button>
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={undo} disabled={!canUndo && !dirty} aria-label="Undo last change"><Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />Undo</button>
          {tools}
          <span className="c-spacer" />
          <span className="c-meta oe-status" role="status">{saving}</span>
          <button type="button" className="c-btn c-btn--primary c-btn--sm" onMouseDown={event => event.preventDefault()} onClick={finishEditing}><Check size={16} strokeWidth={1.75} aria-hidden="true" />Done</button>
        </div>
      ) : (
        <div className="oe-tools oe-tools--read">
          <span className="c-spacer" />
          <span className="c-meta oe-status" role="status">{saving}</span>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => { setEditing(true); setSaving(''); requestAnimationFrame(() => pageRef.current?.focus()); }}><Pencil size={16} strokeWidth={1.75} aria-hidden="true" />Edit</button>
        </div>
      )}
      <div className="oe-main">
        <div
          ref={pageRef}
          className={'oe-page c-study' + (editing ? ' is-editing' : '')}
          contentEditable={editing}
          suppressContentEditableWarning
          role={editing ? 'textbox' : undefined}
          aria-multiline={editing ? 'true' : undefined}
          aria-label={editing ? 'Outline and notes' : undefined}
          data-placeholder={editing ? placeholder : 'No notes yet. Press Edit to write some.'}
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
        .oe { position: relative; display: grid; gap: 12px 28px; align-items: start; }
        /* The Edit / formatting bar spans the outline and its visuals, so Edit and Done sit at the far right. */
        .oe-tools { grid-column: 1 / -1; }
        .oe.has-side { grid-template-columns: minmax(0, 1fr) minmax(320px, 46%); }
        .oe-main { display: grid; gap: 12px; min-width: 0; }
        .oe-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: -8px 0 0 -12px; }
        .oe-status { font-size: 13px; }
        .oe-tools--read { margin-top: -8px; }
        .oe-page.is-editing { box-shadow: 0 0 0 1px var(--line); border-radius: var(--r-input); padding: 12px; margin: -12px; }
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
