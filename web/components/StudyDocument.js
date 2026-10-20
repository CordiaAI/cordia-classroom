import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Layers, MessageCircle, Sparkles } from 'lucide-react';
import { parseQAPairs, parseNotes } from '../lib/formatters';
import { walkthroughEvent } from '../lib/walkthrough';

const PER_PAGE = 3;

// The reading view: page list on the left, the page in the middle. Each question
// ends with Got it / Explain; selecting text offers Explain, Make card and Ask.
export default function StudyDocument({ guide, page: controlledPage, onPageChange, onRead, onExplain, renderAid, readSections, onSelection }) {
  const [localPage, setLocalPage] = useState(0);
  const [selection, setSelection] = useState(null); // { text, top, left }
  const paperRef = useRef(null);
  const pairs = parseQAPairs(guide?.study_guide);
  const notes = parseNotes(guide?.notes);
  const pages = Math.max(1, Math.ceil(pairs.length / PER_PAGE));
  const page = Math.min(pages - 1, Math.max(0, controlledPage ?? localPage));
  const visible = pairs.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  function changePage(next) {
    const clamped = Math.max(0, Math.min(pages - 1, next));
    if (onPageChange) onPageChange(clamped); else setLocalPage(clamped);
    paperRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
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
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onUp);
      document.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onSelection]);

  function act(kind) {
    const text = selection?.text;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (text) onSelection(kind, text);
  }

  return (
    <section className="reader" aria-label="Study guide">
      {pages > 1 && (
        <nav className="reader-pages" aria-label="Pages">
          {Array.from({ length: pages }, (_, index) => {
            const first = pairs[index * PER_PAGE];
            return (
              <button key={index} type="button" className={'reader-thumb' + (page === index ? ' is-active' : '')} onClick={() => changePage(index)} aria-current={page === index ? 'page' : undefined} aria-label={`Page ${index + 1}`}>
                <span className="c-meta">{index + 1}</span>
                <span className="reader-thumb-text">{first?.question}</span>
              </button>
            );
          })}
        </nav>
      )}

      <article ref={paperRef} className="c-card reader-paper">
        {visible.length ? visible.map((pair, offset) => {
          const index = page * PER_PAGE + offset;
          const read = readSections?.has(index);
          return (
            <section className="reader-block" key={pair.index}>
              <h2 className="reader-q"><span className="c-meta">{index + 1}</span>{pair.question}</h2>
              <p className="c-study reader-a" data-spot={offset === 0 ? 'reader-text' : undefined}>{pair.answer}</p>
              {pair.image && <img className="reader-img" src={pair.image} alt="" />}
              {(onRead || onExplain) && (
                <div className="reader-actions">
                  {onRead && (
                    <button type="button" className={'c-btn c-btn--quiet' + (read ? ' is-read' : '')} aria-pressed={Boolean(read)} onClick={() => onRead(index)}>
                      <Check size={20} strokeWidth={1.75} aria-hidden="true" />Got it
                    </button>
                  )}
                  {onExplain && (
                    <button type="button" className="c-btn c-btn--quiet" data-spot={offset === 0 ? 'explain' : undefined} onClick={() => { walkthroughEvent('explain'); onExplain(index); }}>
                      <Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Explain
                    </button>
                  )}
                </div>
              )}
              {renderAid?.(index)}
            </section>
          );
        }) : guide?.study_guide ? (
          <p className="c-study reader-prose">{guide.study_guide}</p>
        ) : notes.length ? (
          <ul className="c-study reader-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        ) : null}

        {pages > 1 && (
          <footer className="reader-foot">
            <button type="button" className="c-icon-btn" aria-label="Previous page" disabled={!page} onClick={() => changePage(page - 1)}><ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
            <span className="c-meta">{page + 1} / {pages}</span>
            <button type="button" className="c-icon-btn" aria-label="Next page" disabled={page >= pages - 1} onClick={() => changePage(page + 1)}><ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </footer>
        )}
      </article>

      {selection && (
        <div className="c-menu reader-select" style={{ top: selection.top, left: selection.left }} role="menu" aria-label="Selection" onMouseDown={event => event.preventDefault()}>
          <button type="button" role="menuitem" onClick={() => act('explain')}><Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Explain</button>
          <button type="button" role="menuitem" data-spot="make-card" onClick={() => act('card')}><Layers size={20} strokeWidth={1.75} aria-hidden="true" />Make card</button>
          <button type="button" role="menuitem" onClick={() => act('ask')}><MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />Ask</button>
        </div>
      )}

      <style jsx>{`
        .reader { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; align-items: start; }
        .reader:not(:has(.reader-pages)) { grid-template-columns: minmax(0, 1fr); }
        .reader-pages { position: sticky; top: calc(var(--bar-h) + 16px); display: grid; gap: 8px; max-height: calc(100vh - var(--bar-h) - 40px); overflow: auto; padding: 2px; }
        .reader-thumb { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--line); border-radius:var(--r-input); background: var(--card); color: var(--ink); text-align: left; cursor: pointer; }
        .reader-thumb.is-active { border-color: var(--olive); box-shadow: 0 0 0 1px var(--olive); }
        .reader-thumb-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font:600 13px/1.5 var(--font-sans); }
        .reader-paper { padding: 40px 48px; min-width: 0; display: grid; justify-items: center; scroll-margin-top: calc(var(--bar-h) + 16px); }
        .reader-block { width: 100%; max-width: 68ch; padding: 8px 0 28px; }
        .reader-block + .reader-block { border-top: 1px solid var(--line); padding-top: 28px; }
        .reader-q { display: flex; gap: 12px; align-items: baseline; margin: 0 0 12px; font:600 20px/1.15 var(--font-display); letter-spacing:0; }
        .reader-a { margin: 0; white-space: pre-wrap; }
        .reader-img { display: block; max-width: 100%; margin-top: 16px; border-radius:var(--r-input); }
        .reader-actions { display: flex; gap: 4px; margin: 16px 0 0 -12px; }
        .reader-actions :global(.is-read) { color: var(--success); }
        .reader-prose, .reader-notes { white-space: pre-wrap; width: 100%; }
        .reader-foot { display: flex; align-items: center; gap: 12px; padding-top: 16px; }
        .reader-select { position: fixed; display: flex; min-width: 0; gap: 2px; z-index: 150; }
        .reader-select :global([role='menuitem']) { width: auto; }
        @media (max-width: 1023px) {
          .reader { grid-template-columns: minmax(0, 1fr); }
          .reader-pages { display: none; }
        }
        @media (max-width: 767px) {
          .reader-paper { padding: 24px 18px; }
          .reader-q { font-size:20px; }
        }
      `}</style>
    </section>
  );
}
