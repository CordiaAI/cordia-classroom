import { useEffect, useMemo, useRef, useState } from 'react';
import BodyPortal from './BodyPortal';
import { useRouter } from 'next/router';
import { ArrowRight, BookOpen, CalendarDays, Compass, Globe, Layers, Library, Mic, NotebookPen, Palette, Search, Settings, X } from 'lucide-react';
import { matchesMakeItYours, openMakeItYours } from '../lib/makeItYours.mjs';
import { apiFetch } from '../lib/api';
import { supabaseRest } from '../lib/serverCopies';
import { ownedGuideIds, searchRows, uniqueRows } from '../lib/searchResults.mjs';
import { discoverGuides, publicSetRows } from '../lib/discover';
import VerifiedBadge from './VerifiedBadge';

function plain(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

let cache = null; // { guides, notes } loaded once per page session

const JUMPS = [
  { key: 'j-library', kind: 'jump', icon: Library, title: 'Library', href: '/library' },
  { key: 'j-calendar', kind: 'jump', icon: CalendarDays, title: 'Calendar', href: '/calendar' },
  { key: 'j-settings', kind: 'jump', icon: Settings, title: 'Settings', href: '/settings' },
];
// "theme", "make it yours", "dark mode", "appearance" and the like open the Make it yours sheet. It is listed after the
// student's own matches (and before public sets), so a class word that is also a setting word never pushes them down.
const MAKE_IT_YOURS = { key: 's-make-it-yours', kind: 'setting', icon: Palette, title: 'Make it yours', meta: 'Theme, colours, font, text size, light or dark', sheet: true };
// Public sets asked for: more than the three shown, so the student's own sets can be left out and three still show.
const PUBLIC_ASK = 6;

// ⌘K / Ctrl K: one search over study guides, flashcards, notes and lectures, then the top public
// sets from everyone (Discover) and a link to see them all on /explore.
// A glass search pill with the results in their own glass bubble 8px under it.
// instant: opened from the keyboard, so it shows on the next frame with no fade or rise (DESIGN-SPEC 6.1).
export default function SearchModal({ onClose, instant = false }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [guideHits, setGuideHits] = useState([]);
  // null until the shared search answers; it stays null (and the older search runs) if the
  // migration that adds it hasn't been applied yet.
  const [found, setFound] = useState(null);
  const [library, setLibrary] = useState(cache);
  const [publicHits, setPublicHits] = useState([]);
  // The query whose own results are on screen, so "Nothing of yours matches" waits for the answer.
  const [settled, setSettled] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const askRef = useRef(0); // the newest search; an older one that answers late is dropped
  // What Search was opened from: focus goes back there when it closes, and a sheet opened from here hands focus back there.
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const handedOffRef = useRef(false);
  // The field is focused the moment Search opens, so the pill shows the focus ring only when the
  // keyboard brings focus back to it (Shift Tab from the close button); the caret marks it otherwise.
  const tabbedRef = useRef(false);
  const [ringed, setRinged] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (!cache) {
      Promise.all([apiFetch('/guides?limit=100'), apiFetch('/smart_notes')]).then(([guides, notes]) => {
        cache = { guides: guides?.guides || [], notes: notes?.notes || [] };
        setLibrary(cache);
      });
    }
    return () => {
      const opener = openerRef.current;
      if (handedOffRef.current || !opener || opener === document.body || !opener.isConnected || typeof opener.focus !== 'function') return;
      // Only when nothing else took focus (a link that navigates moves it on by itself).
      if (!document.activeElement || document.activeElement === document.body || document.activeElement === inputRef.current) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    const ask = ++askRef.current;
    const current = () => ask === askRef.current;
    if (!q) { setGuideHits([]); setFound(null); setPublicHits([]); setSettled(''); return; }
    debounceRef.current = setTimeout(async () => {
      if (q.length >= 2) {
        discoverGuides({ q, limit: PUBLIC_ASK })
          .then(data => { if (current()) setPublicHits(Array.isArray(data?.guides) ? data.guides : []); })
          .catch(() => { if (current()) setPublicHits([]); });
      } else setPublicHits([]);
      const shared = await supabaseRest()('/rest/v1/rpc/search_my_materials', { method: 'POST', body: { search: q.slice(0, 500), max_results: 24 } }).catch(() => null);
      if (!current()) return;
      if (shared?.ok && Array.isArray(shared.data)) { setFound(searchRows(shared.data)); setSettled(q); return; }
      setFound(null);
      const data = await apiFetch('/search?q=' + encodeURIComponent(q)).catch(() => null);
      if (!current()) return;
      setGuideHits(data?.results || []);
      setSettled(q);
    }, 200);
  }, [query]);

  const live = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Before typing: the newest guides and notes, and the places people jump to most.
    if (!q) {
      const recent = (library?.guides || []).slice(0, 5).map(guide => ({ key: 'g' + guide.id, kind: 'recent', id: guide.id, title: guide.title, href: '/guide/' + guide.id }));
      const notes = (library?.notes || []).slice(0, 2).map(note => ({ key: 'n' + note.id, kind: 'recent', icon: NotebookPen, title: note.title || 'Untitled', href: '/smartnotes?id=' + note.id }));
      return uniqueRows([...recent, ...notes, ...JUMPS]);
    }
    const settings = matchesMakeItYours(q) ? [MAKE_IT_YOURS] : [];
    if (found) {
      const more = publicSetRows(publicHits, query, ownedGuideIds(library?.guides, found));
      return uniqueRows([...found, ...settings, ...more]);
    }
    const guides = guideHits.slice(0, 6).map(hit => ({ key: 'g' + hit.id, kind: 'guide', id: hit.id, title: hit.title, href: '/guide/' + hit.id }));
    const cards = [];
    for (const guide of library?.guides || []) {
      (guide.flashcards || []).forEach((card, index) => {
        if (cards.length < 6 && `${card.front} ${card.back}`.toLowerCase().includes(q)) {
          cards.push({ key: `c${guide.id}:${index}`, kind: 'card', id: guide.id, title: card.front, meta: guide.title, href: `/flashcards/study?guideId=${guide.id}` });
        }
      });
    }
    const notes = (library?.notes || [])
      .filter(note => `${note.title} ${plain(note.content)}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map(note => ({ key: 'n' + note.id, kind: 'note', title: note.title || 'Untitled', href: '/smartnotes?id=' + note.id }));
    const more = publicSetRows(publicHits, query, ownedGuideIds(library?.guides, [...guides, ...cards]));
    return uniqueRows([...guides, ...cards, ...notes, ...settings, ...more]);
  }, [query, guideHits, library, found, publicHits]);

  // While a search is out, the last answered list stays as it is (nothing shuffles under the pointer or
  // the arrow keys) and the new one replaces it whole when it lands.
  const q = query.trim();
  const searching = Boolean(q) && settled !== q;
  const shownRef = useRef({ query: '', rows: [] });
  if (!searching) shownRef.current = { query: q, rows: live };
  const results = searching ? (shownRef.current.query ? shownRef.current.rows : []) : live;

  useEffect(() => setActive(0), [results.length]);

  function go(result) {
    if (result.sheet) handedOffRef.current = true;
    onClose();
    if (result.sheet) { openMakeItYours(openerRef.current); return; }
    router.push(result.href);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    if (event.key === 'Enter' && results[active]) go(results[active]);
  }

  const ICON = { setting: Palette, guide: BookOpen, card: Layers, note: NotebookPen, lecture: Mic, recent: BookOpen, jump: ArrowRight, public: Globe, explore: Compass };
  const GROUP = { setting: 'Settings', guide: 'Guides', card: 'Cards', note: 'Notes', lecture: 'Lectures', recent: 'Recent', jump: 'Go to', public: 'Public sets', explore: '' };
  const ownCount = results.filter(result => !['explore', 'setting'].includes(result.kind)).length;
  const status = q && !ownCount ? (searching ? 'Searching' : 'Nothing of yours matches') : '';
  const optionId = index => `c-search-option-${index}`;

  return (
    <BodyPortal>
    <div className={'c-scrim c-search-scrim' + (instant ? ' is-instant' : '')} onClick={onClose}>
      <div className="c-search-palette" role="dialog" aria-modal="true" aria-label="Search" onClick={event => event.stopPropagation()} onKeyDown={event => { tabbedRef.current = event.key === 'Tab'; if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
        <div className={'search-pill' + (ringed ? ' is-ringed' : '')}>
          <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          <label className="sr-only" htmlFor="c-search-input">Search</label>
          <input
            id="c-search-input" ref={inputRef} className="search-input" type="search" placeholder="Search guides, cards, notes and lectures"
            value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown}
            onFocus={() => setRinged(tabbedRef.current)} onBlur={() => setRinged(false)}
            role="combobox" aria-expanded={results.length > 0} aria-controls="c-search-results" aria-autocomplete="list"
            aria-activedescendant={results[active] ? optionId(active) : undefined} autoComplete="off" spellCheck={false}
          />
          <button type="button" className="search-close" onClick={onClose} aria-label="Close search">
            <kbd className="search-esc">esc</kbd>
            <X className="search-x" size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="search-bubble" hidden={!results.length && !status}>
          {status && <p className="c-meta c-search-none" role="status">{status}</p>}
          <ul id="c-search-results" className="search-list" role="listbox" aria-label="Results">
            {results.map((result, index) => {
              const Icon = result.icon || ICON[result.kind];
              const groupStart = index === 0 || results[index - 1].kind !== result.kind;
              return [
                groupStart && GROUP[result.kind] ? <li key={result.key + ':group'} role="presentation" className="c-meta c-search-group">{GROUP[result.kind]}</li> : null,
                <li key={result.key} id={optionId(index)} role="option" aria-selected={index === active}>
                  <button type="button" tabIndex={-1} className={'c-search-hit' + (index === active ? ' is-active' : '')} onClick={() => go(result)} onMouseEnter={() => setActive(index)}>
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                    <span className="c-truncate">{result.title}</span>
                    {result.verified && <VerifiedBadge />}
                    {result.meta && <span className="c-meta c-truncate">{result.meta}</span>}
                  </button>
                </li>,
              ];
            })}
          </ul>
        </div>
      </div>
      <style jsx>{`
        /* Over a dimmed page: a glass pill holding the field, and the results in a separate glass
           bubble 8px under it. Both are the spec's glass (2.3): sheen over the strong fill, the frost,
           the soft inner highlight and hairline (the glass shadow), and the rim as a 1px border. Solid
           glass, reduced transparency and Paper & Clay turn the same tokens opaque and flat. */
        .c-search-scrim { place-items: start center; padding-top: 14vh; background: var(--scrim-strong); }
        .c-search-palette { display: grid; gap: 8px; width: min(640px, 100%); animation: c-rise 220ms var(--ease); }
        .search-pill, .search-bubble {
          position: relative; isolation: isolate;
          background: var(--glass-sheen), var(--glass-fill-strong);
          border: 1px solid; border-color: var(--glass-rim-border);
          -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
          box-shadow: var(--pane-float-shadow);
        }
        .search-pill { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 0 8px 0 20px; border-radius: var(--r-pill); color: var(--muted); }
        .search-bubble { border-radius: var(--r-panel); overflow: hidden; }
        .search-bubble[hidden] { display: none; }
        .search-input { flex: 1; min-width: 0; height: 58px; margin: 0; padding: 0; border: 0; background: transparent; color: var(--ink); font: 500 1.0625rem/1.4 var(--font-sans); outline: none; box-shadow: none; -webkit-appearance: none; appearance: none; }
        .search-input:focus, .search-input:focus-visible { outline: none; border: 0; box-shadow: none; }
        /* The pill is the field's box, so it takes the app's focus ring (system.css: 2px --focus-ring, 2px
           out) when the keyboard moves focus back into it. */
        .search-pill.is-ringed { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
        .search-input::placeholder { color: var(--muted); }
        .search-input::-webkit-search-cancel-button { display: none; }
        .search-close { flex: none; display: grid; place-items: center; min-width: 44px; height: 44px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); cursor: pointer; transition: box-shadow var(--dur) var(--ease), background-color var(--dur) var(--ease); }
        @media (hover: hover) { .search-close:hover { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); } }
        .search-esc { font: 600 0.8125rem/1 var(--font-sans); padding: 6px 8px; border-radius: var(--r-pill); background: transparent; box-shadow: inset 0 0 0 1px var(--hairline); color: var(--muted); }
        .search-close :global(.search-x) { display: none; }
        .c-search-scrim.is-instant, .c-search-scrim.is-instant .c-search-palette { animation: none; }
        .search-list { list-style: none; margin: 0; padding: 8px; max-height: min(60vh, 520px); overflow: auto; overscroll-behavior: contain; }
        .search-list:empty { display: none; }
        .c-search-group { padding: 10px 12px 4px; }
        .c-search-hit { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: var(--r-input); background: transparent; color: var(--ink); font: 600 0.9375rem/1.5 var(--font-sans); text-align: left; cursor: pointer; }
        /* The title gives way first; a short meta ("Studied by 7") stays whole. */
        .c-search-hit > :global(.c-truncate:not(.c-meta)) { flex: 0 1 auto; min-width: 0; }
        .c-search-hit :global(.c-meta) { flex: none; margin-left: auto; max-width: 45%; }
        .c-search-none { margin: 0; padding: 16px 20px; }
        .c-search-none + .search-list { padding-top: 0; }
        @media (max-width: 767px) {
          .c-search-scrim { place-items: start stretch; padding: calc(12px + env(safe-area-inset-top, 0px)) 12px 12px; }
          .c-search-palette { width: 100%; }
          .search-pill { min-height: 56px; padding-left: 16px; }
          .search-input { height: 54px; }
          .search-list { max-height: calc(100dvh - 56px - 8px - 24px - env(safe-area-inset-top, 0px) - 18px); }
          .search-esc { display: none; }
          .search-close :global(.search-x) { display: block; }
        }
        @media (prefers-reduced-motion: reduce) { .c-search-palette { animation: none; } }
      `}</style>
    </div>
    </BodyPortal>
  );
}
