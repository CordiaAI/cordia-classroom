import { useEffect, useMemo, useRef, useState } from 'react';
import BodyPortal from './BodyPortal';
import { useRouter } from 'next/router';
import { ArrowRight, BookOpen, CalendarDays, Layers, Library, NotebookPen, Search, Settings, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

function plain(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

let cache = null; // { guides, notes } loaded once per page session

const JUMPS = [
  { key: 'j-library', kind: 'jump', icon: Library, title: 'Library', href: '/library' },
  { key: 'j-calendar', kind: 'jump', icon: CalendarDays, title: 'Calendar', href: '/calendar' },
  { key: 'j-settings', kind: 'jump', icon: Settings, title: 'Settings', href: '/settings' },
];

// ⌘K / Ctrl K: one search over study guides, flashcards and notes.
export default function SearchModal({ onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [guideHits, setGuideHits] = useState([]);
  const [library, setLibrary] = useState(cache);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (!cache) {
      Promise.all([apiFetch('/guides?limit=100'), apiFetch('/smart_notes')]).then(([guides, notes]) => {
        cache = { guides: guides?.guides || [], notes: notes?.notes || [] };
        setLibrary(cache);
      });
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setGuideHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      const data = await apiFetch('/search?q=' + encodeURIComponent(q));
      setGuideHits(data?.results || []);
    }, 200);
  }, [query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Before typing: the newest guides and notes, and the places people jump to most.
    if (!q) {
      const recent = (library?.guides || []).slice(0, 5).map(guide => ({ key: 'g' + guide.id, kind: 'recent', title: guide.title, href: '/guide/' + guide.id }));
      const notes = (library?.notes || []).slice(0, 2).map(note => ({ key: 'n' + note.id, kind: 'recent', icon: NotebookPen, title: note.title || 'Untitled', href: '/smartnotes?id=' + note.id }));
      return [...recent, ...notes, ...JUMPS];
    }
    const guides = guideHits.slice(0, 6).map(hit => ({ key: 'g' + hit.id, kind: 'guide', title: hit.title, href: '/guide/' + hit.id }));
    const cards = [];
    for (const guide of library?.guides || []) {
      (guide.flashcards || []).forEach((card, index) => {
        if (cards.length < 6 && `${card.front} ${card.back}`.toLowerCase().includes(q)) {
          cards.push({ key: `c${guide.id}:${index}`, kind: 'card', title: card.front, meta: guide.title, href: `/flashcards/study?guideId=${guide.id}` });
        }
      });
    }
    const notes = (library?.notes || [])
      .filter(note => `${note.title} ${plain(note.content)}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map(note => ({ key: 'n' + note.id, kind: 'note', title: note.title || 'Untitled', href: '/smartnotes?id=' + note.id }));
    return [...guides, ...cards, ...notes];
  }, [query, guideHits, library]);

  useEffect(() => setActive(0), [results.length]);

  function go(result) {
    onClose();
    router.push(result.href);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') onClose();
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    if (event.key === 'Enter' && results[active]) go(results[active]);
  }

  const ICON = { guide: BookOpen, card: Layers, note: NotebookPen, recent: BookOpen, jump: ArrowRight };
  const GROUP = { guide: 'Guides', card: 'Cards', note: 'Notes', recent: 'Recent', jump: 'Go to' };

  return (
    <BodyPortal>
    <div className="c-scrim c-search-scrim" onClick={onClose}>
      <div className="c-sheet c-search-sheet" role="dialog" aria-modal="true" aria-label="Search" onClick={event => event.stopPropagation()}>
        <div className="search-bar">
          <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          <label className="sr-only" htmlFor="c-search-input">Search</label>
          <input id="c-search-input" ref={inputRef} className="search-input" type="search" placeholder="Search guides, cards and notes" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-controls="c-search-results" autoComplete="off" spellCheck={false} />
          <button type="button" className="search-close" onClick={onClose} aria-label="Close search">
            <kbd className="search-esc">esc</kbd>
            <X className="search-x" size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <ul id="c-search-results" className="search-list" role="listbox" aria-label="Results">
          {results.map((result, index) => {
            const Icon = result.icon || ICON[result.kind];
            const groupStart = index === 0 || results[index - 1].kind !== result.kind;
            return (
              <li key={result.key} role="option" aria-selected={index === active}>
                {groupStart && <div className="c-meta c-search-group">{GROUP[result.kind]}</div>}
                <button type="button" className={'c-search-hit' + (index === active ? ' is-active' : '')} onClick={() => go(result)} onMouseEnter={() => setActive(index)}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span className="c-truncate">{result.title}</span>
                  {result.meta && <span className="c-meta c-truncate">{result.meta}</span>}
                </button>
              </li>
            );
          })}
          {query.trim() && !results.length && <li className="c-meta c-search-none">No results</li>}
        </ul>
      </div>
      <style jsx>{`
        /* A centered panel over a dimmed page: the field on top, recent work and places below it. */
        .c-search-scrim { place-items: start center; padding-top: 14vh; background: var(--scrim-strong); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
        .c-search-sheet { width: min(640px, 100%); padding: 0; overflow: hidden; background: var(--lg-menu, var(--card)) !important; }
        .search-bar { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 0 12px 0 20px; color: var(--muted); }
        .search-input { flex: 1; min-width: 0; height: 60px; padding: 0; border: 0; background: transparent; color: var(--ink); font:500 17px/1.4 var(--font-sans); outline: none; box-shadow: none; -webkit-appearance: none; appearance: none; }
        .search-input:focus, .search-input:focus-visible { outline: none; box-shadow: none; }
        /* The bar is the field's box, flush with the panel's top edge, so its focus ring sits just inside it. */
        .search-bar:has(.search-input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: inherit; }
        .search-input::placeholder { color: var(--muted); }
        .search-input::-webkit-search-cancel-button { display: none; }
        .search-close { flex: none; display: grid; place-items: center; min-width: 44px; height: 44px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); cursor: pointer; }
        .search-close:hover { color: var(--ink); }
        .search-close:focus-visible { outline: 2px solid var(--olive); outline-offset: -4px; }
        .search-esc { font:600 12px/1 var(--font-sans); padding: 6px 8px; border-radius: var(--r-pill); background: var(--olive-tint); color: var(--muted); }
        .search-close :global(.search-x) { display: none; }
        .search-list { list-style: none; margin: 0; padding: 0 8px; max-height: 60vh; overflow: auto; }
        .search-list:not(:empty) { border-top: 1px solid var(--line); padding: 8px; }
        .c-search-group { padding: 10px 12px 4px; }
        .c-search-hit { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius:var(--r-input); background: transparent; color: var(--ink); font:600 15px/1.5 var(--font-sans); text-align: left; cursor: pointer; }
        .c-search-hit.is-active { background: var(--olive-tint); }
        .c-search-hit :global(.c-meta) { margin-left: auto; max-width: 40%; }
        .c-search-none { padding: 16px 12px; }
        @media (max-width: 767px) {
          .c-search-scrim { place-items: end stretch; padding-top: 0; }
          .search-esc { display: none; }
          .search-close :global(.search-x) { display: block; }
        }
      `}</style>
    </div>
    </BodyPortal>
  );
}
