import { useEffect } from 'react';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';

const GROUPS = [
  { title: 'Anywhere', keys: [['⌘K / Ctrl K', 'Search'], ['?', 'This list'], ['Esc', 'Close a panel or window']] },
  { title: 'Flashcards and review', keys: [['Space or Enter', 'Flip'], ['1', 'Again'], ['2', 'Got it'], ['←', 'Back one card']] },
  { title: 'Tutor panel', keys: [['← →', 'Resize (on the handle)'], ['Shift + ← →', 'Resize faster']] },
  { title: 'Notes', keys: [['Tab / Shift Tab', 'Indent / outdent'], ['Typing shortcuts', 'Listed in the editor']] },
];

// Every keyboard shortcut in one place. Opened with "?" or from Help.
export default function ShortcutsSheet({ onClose }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet keys-sheet" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="keys-title" className="c-title">Keyboard shortcuts</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" autoFocus><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          {GROUPS.map(group => (
            <section key={group.title} className="keys-group" aria-label={group.title}>
              <h3 className="c-section-title">{group.title}</h3>
              <dl>
                {group.keys.map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}
              </dl>
            </section>
          ))}
        </section>
      </div>
      <style jsx>{`
        .keys-sheet { width: min(560px, 100%); }
        .keys-group { margin-top: 16px; }
        dl { margin: 8px 0 0; display: grid; gap: 6px; }
        dl div { display: flex; align-items: center; gap: 12px; }
        dt { flex: 0 0 150px; }
        dd { margin: 0; }
        kbd { font: 600 13px/1 var(--font-sans); background: var(--olive-tint); border-radius: var(--r-pill); padding: 5px 8px; }
      `}</style>
    </BodyPortal>
  );
}
