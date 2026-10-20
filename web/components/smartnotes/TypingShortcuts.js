import { useEffect } from 'react';
import { X } from 'lucide-react';
import BodyPortal from '../BodyPortal';

// What the notes paper does as you type (lib/notesEditing.js formatOnKeyDown).
const RULES = [
  ['**bold** then Space', 'Bold'],
  ['_italic_ then Space', 'Italic'],
  ['`code` then Space', 'Code'],
  ['~~strike~~ then Space', 'Strikethrough'],
  ['# / ## / ### then Enter', 'Heading'],
  ['ALL CAPS line then Enter', 'Section heading'],
  ['--- then Enter', 'Divider'],
  ['!! text', 'Callout'],
  ['> text', 'Quote'],
  ['>> text', 'Sub-bullet'],
  ['- , 1. or A. at the start', 'Lists that continue on Enter'],
  ['term = meaning', 'Definition'],
  ['term: rest', 'Bold term'],
  ['Tab / Shift Tab', 'Indent / outdent'],
  ['Backspace at a list start', 'Leave the list'],
];

export default function TypingShortcuts({ onClose }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet typing-sheet" role="dialog" aria-modal="true" aria-labelledby="typing-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="typing-title" className="c-title">Typing shortcuts</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" autoFocus><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          <p className="c-meta">Notes also capitalize sentences and fix common spellings and acronyms as you type.</p>
          <dl>
            {RULES.map(([keys, result]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{result}</dd></div>)}
          </dl>
        </section>
      </div>
      <style jsx>{`
        .typing-sheet { width: min(560px, 100%); }
        dl { margin: 12px 0 0; display: grid; gap: 6px; }
        dl div { display: flex; align-items: center; gap: 12px; }
        dt { flex: 0 0 220px; }
        dd { margin: 0; }
        kbd { font: 600 13px/1 var(--font-sans); background: var(--olive-tint); border-radius: var(--r-pill); padding: 5px 8px; white-space: nowrap; }
        @media (max-width: 600px) { dl div { flex-direction: column; align-items: flex-start; gap: 2px; } dt { flex: none; } }
      `}</style>
    </BodyPortal>
  );
}
