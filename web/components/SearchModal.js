import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { BookOpen, Layers, NotebookPen, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

function plain(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

let cache = null; // { guides, notes } loaded once per page session

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
    if (!q) return [];
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

  const ICON = { guide: BookOpen, card: Layers, note: NotebookPen };
  const GROUP = { guide: 'Guides', card: 'Cards', note: 'Notes' };

  return (
    <div className="c-scrim c-search-scrim" onClick={onClose}>
      <div className="c-sheet c-search-sheet" role="dialog" aria-modal="true" aria-label="Search" onClick={event => event.stopPropagation()}>
        <div className="c-row">
          <label className="c-search">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Search</span>
            <input ref={inputRef} className="c-input" type="search" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-controls="c-search-results" />
          </label>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close search"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
        <ul id="c-search-results" className="c-search-results" role="listbox" aria-label="Results">
          {results.map((result, index) => {
            const Icon = ICON[result.kind];
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
        .c-search-scrim { place-items: start center; padding-top: 12vh; }
        .c-search-sheet { width: min(600px, 100%); padding: 12px; }
        .c-search-results { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; }
        .c-search-results:not(:empty) { margin-top: 8px; }
        .c-search-group { padding: 10px 12px 4px; }
        .c-search-hit { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: var(--r-input); background: transparent; color: var(--ink); font: 600 15px/1.3 var(--font-sans); text-align: left; cursor: pointer; }
        .c-search-hit.is-active { background: var(--olive-tint); }
        .c-search-hit :global(.c-meta) { margin-left: auto; max-width: 40%; }
        .c-search-none { padding: 16px 12px; }
        @media (max-width: 767px) { .c-search-scrim { place-items: end stretch; padding-top: 0; } }
      `}</style>
    </div>
  );
}
