import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Layers, Maximize2, MessageCircle, Minus, Plus, Sparkles } from 'lucide-react';
import { parseQAPairs, parseNotes } from '../lib/formatters';
import { walkthroughEvent } from '../lib/walkthrough';

const PER_PAGE = 3;
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// The original Classroom document: page thumbnails, a paper page, page and zoom
// controls. Each section ends with Got it / Explain; selecting text offers
// Explain, Make card and Ask.
export default function StudyDocument({
  guide, label, page: controlledPage, onPageChange, onRead, onExplain, renderAid, readSections, onSelection, onOpen, compact = false,
}) {
  const [localPage, setLocalPage] = useState(0);
  const [scale, setScale] = useState(100);
  const [selection, setSelection] = useState(null);
  const rootRef = useRef(null);
  const paperRef = useRef(null);
  const pairs = parseQAPairs(guide?.study_guide);
  const notes = parseNotes(guide?.notes);
  const pages = Math.max(1, Math.ceil(pairs.length / PER_PAGE));
  const page = Math.min(pages - 1, Math.max(0, controlledPage ?? localPage));
  const visible = pairs.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  function changePage(next) {
    const clamped = Math.max(0, Math.min(pages - 1, next));
    if (onPageChange) onPageChange(clamped); else setLocalPage(clamped);
    paperRef.current?.scrollTo?.({ top: 0 });
  }

  useEffect(() => {
    if (!onSelection) return undefined;
    function check() {
      const current = window.getSelection();
      const text = current?.toString().trim();
      if (!text || !current.rangeCount || !paperRef.current?.contains(current.anchorNode)) { setSelection(null); return; }
      const rect = current.getRangeAt(0).getBoundingClientRect();
      setSelection({ text: text.slice(0, 600), top: Math.max(8, rect.top - 56), left: Math.min(window.innerWidth - 300, Math.max(8, rect.left + rect.width / 2 - 140)) });
      walkthroughEvent('selection');
    }
    const onUp = () => setTimeout(check, 0);
    const onScroll = () => setSelection(null);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    document.addEventListener('touchend', onUp);
    paperRef.current?.addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
      document.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScroll);
    };
  }, [onSelection]);

  function act(kind) {
    const text = selection?.text;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (text) onSelection(kind, text);
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.();
  }

  return (
    <section ref={rootRef} className={'doc c-card' + (compact ? ' is-compact' : '')} aria-label={guide?.title || 'Study guide'}>
      <header className="doc-bar">
        <span className="doc-label"><BookOpen {...ICON} /><span className="c-truncate">{label || guide?.title}</span></span>
        <span className="doc-actions">
          {onOpen && <button type="button" className="c-icon-btn" onClick={onOpen} aria-label="Open guide"><BookOpen {...ICON} /></button>}
          <button type="button" className="c-icon-btn" onClick={fullscreen} aria-label="Full screen"><Maximize2 {...ICON} /></button>
        </span>
      </header>

      <div className="doc-body">
        {pages > 1 && (
          <nav className="doc-thumbs" aria-label="Pages">
            {Array.from({ length: pages }, (_, index) => (
              <button key={index} type="button" className={'doc-thumb' + (page === index ? ' is-active' : '')} onClick={() => changePage(index)} aria-label={`Page ${index + 1}`} aria-current={page === index ? 'page' : undefined}>
                <span className="doc-thumb-num" aria-hidden="true">{index + 1}</span>
                <span className="doc-thumb-paper" aria-hidden="true">
                  <i className="t" />
                  {pairs.slice(index * PER_PAGE, index * PER_PAGE + PER_PAGE).map(pair => <span key={pair.index}><i className="q" /><i /><i className="s" /></span>)}
                </span>
              </button>
            ))}
          </nav>
        )}

        <article ref={paperRef} className="doc-paper" style={{ '--doc-scale': scale / 100 }}>
          <h2 className="doc-title">{guide?.title}</h2>
          <hr className="doc-rule" />
          {visible.length ? visible.map((pair, offset) => {
            const index = page * PER_PAGE + offset;
            const read = readSections?.has(index);
            return (
              <section className="doc-section" key={pair.index}>
                <h3><span className="doc-num">{index + 1}.</span>{pair.question}</h3>
                <p data-spot={offset === 0 ? 'reader-text' : undefined}>{pair.answer}</p>
                {pair.image && <img src={pair.image} alt="" />}
                {(onRead || onExplain) && (
                  <div className="doc-section-actions">
                    {onRead && (
                      <button type="button" className={'c-btn c-btn--quiet' + (read ? ' is-read' : '')} aria-pressed={Boolean(read)} onClick={() => onRead(index)}>
                        <Check {...ICON} />Got it
                      </button>
                    )}
                    {onExplain && (
                      <button type="button" className="c-btn c-btn--quiet" data-spot={offset === 0 ? 'explain' : undefined} onClick={() => { walkthroughEvent('explain'); onExplain(index); }}>
                        <Sparkles {...ICON} />Explain
                      </button>
                    )}
                  </div>
                )}
                {renderAid?.(index)}
              </section>
            );
          }) : guide?.study_guide ? (
            <p className="doc-prose">{guide.study_guide}</p>
          ) : notes.length ? (
            <ul className="doc-prose">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          ) : null}
        </article>
      </div>

      <footer className="doc-foot">
        <div className="doc-pager">
          <button type="button" className="c-icon-btn" aria-label="Previous page" disabled={!page} onClick={() => changePage(page - 1)}><ChevronLeft {...ICON} /></button>
          <span className="c-meta">{page + 1} / {pages}</span>
          <button type="button" className="c-icon-btn" aria-label="Next page" disabled={page >= pages - 1} onClick={() => changePage(page + 1)}><ChevronRight {...ICON} /></button>
        </div>
        <div className="doc-zoom">
          <button type="button" className="c-icon-btn" aria-label="Zoom out" disabled={scale <= 80} onClick={() => setScale(value => value - 10)}><Minus {...ICON} /></button>
          <span className="c-meta">{scale}%</span>
          <button type="button" className="c-icon-btn" aria-label="Zoom in" disabled={scale >= 140} onClick={() => setScale(value => value + 10)}><Plus {...ICON} /></button>
        </div>
      </footer>

      {selection && (
        <div className="c-menu doc-select" style={{ top: selection.top, left: selection.left }} role="menu" aria-label="Selection" onMouseDown={event => event.preventDefault()}>
          <button type="button" role="menuitem" onClick={() => act('explain')}><Sparkles {...ICON} />Explain</button>
          <button type="button" role="menuitem" data-spot="make-card" onClick={() => act('card')}><Layers {...ICON} />Make card</button>
          <button type="button" role="menuitem" onClick={() => act('ask')}><MessageCircle {...ICON} />Ask</button>
        </div>
      )}

      <style jsx global>{`
        .doc { display: flex; flex-direction: column; min-width: 0; padding: 12px; height: min(760px, calc(100svh - 200px)); min-height: 520px; }
        .doc.is-compact { height: 100%; min-height: 0; }
        .doc:fullscreen { height: 100vh; padding: 24px; border-radius: 0; }
        .doc-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 4px 8px 12px; }
        .doc-label { display: flex; align-items: center; gap: 10px; min-width: 0; font: 500 13px/1.3 var(--font-sans); }
        .doc-actions { display: flex; gap: 4px; }
        .doc-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 16px; }
        .doc-body:not(:has(.doc-thumbs)) { grid-template-columns: minmax(0, 1fr); }
        .doc-thumbs { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding: 4px 2px; }
        .doc-thumb { position: relative; display: block; padding: 0 0 0 16px; border: 0; background: none; cursor: pointer; text-align: left; }
        .doc-thumb-num { position: absolute; top: 0; left: 0; font: 500 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--muted); }
        .doc-thumb-paper { display: grid; gap: 6px; align-content: start; aspect-ratio: .72; padding: 8px 7px; border-radius: 6px; border: 1px solid var(--line); background: var(--field); transition: border-color 160ms ease-out; }
        .doc-thumb.is-active .doc-thumb-paper { border: 2px solid var(--ink); }
        .doc-thumb-paper span { display: grid; gap: 2px; }
        .doc-thumb-paper i { display: block; height: 2px; border-radius: 2px; background: var(--line); }
        .doc-thumb-paper i.t { height: 4px; width: 70%; background: var(--muted); opacity: .45; }
        .doc-thumb-paper i.q { width: 85%; background: var(--muted); opacity: .35; }
        .doc-thumb-paper i.s { width: 60%; }
        .doc-paper { min-height: 0; overflow-y: auto; padding: clamp(24px, 4vw, 48px) clamp(20px, 5vw, 56px); border-radius: 20px; background: var(--field); color: var(--ink); font: 400 calc(19px * var(--doc-scale, 1))/1.6 var(--font-display); scrollbar-width: thin; }
        .doc-title { margin: 0; font: 500 calc(40px * var(--doc-scale, 1))/1.08 var(--font-display); letter-spacing: -0.02em; overflow-wrap: anywhere; }
        .doc-rule { margin: 20px 0 24px; border: 0; border-top: 1px solid var(--line); }
        .doc-section { max-width: 68ch; margin: 0 0 24px; }
        .doc-section h3 { display: flex; gap: 12px; margin: 0 0 8px; font: 600 calc(19px * var(--doc-scale, 1))/1.4 var(--font-display); }
        .doc-num { flex: 0 0 auto; min-width: 20px; font-variant-numeric: tabular-nums; }
        .doc-section p { margin: 0 0 4px 32px; white-space: pre-wrap; }
        .doc-section img { max-width: 100%; margin-left: 32px; border-radius: 12px; }
        .doc-section-actions { display: flex; gap: 4px; margin-left: 20px; }
        .doc-section-actions .is-read { color: var(--success); }
        .doc-prose { white-space: pre-wrap; max-width: 68ch; }
        .doc-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 4px 0 108px; }
        .doc-body:not(:has(.doc-thumbs)) + .doc-foot { padding-left: 4px; }
        .doc-pager, .doc-zoom { display: flex; align-items: center; gap: 4px; }
        .doc-select { position: fixed; display: flex; min-width: 0; gap: 2px; z-index: 150; }
        .doc-select [role='menuitem'] { width: auto; }
        @media (max-width: 1023px) {
          .doc-body { grid-template-columns: minmax(0, 1fr); }
          .doc-thumbs { display: none; }
          .doc-foot { padding-left: 4px; }
          .doc-zoom { display: none; }
        }
        @media (max-width: 767px) {
          .doc { height: auto; min-height: 0; padding: 8px; }
          .doc-paper { padding: 24px 18px; overflow: visible; }
          .doc-title { font-size: 28px; }
          .doc-section p { margin-left: 0; }
          .doc-section-actions { margin-left: -12px; }
        }
      `}</style>
    </section>
  );
}
