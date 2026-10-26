import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiErrorMessage } from '../lib/api';
import { notionHome, notionPages, notionSetup, notionSync } from '../lib/studyPlans';

// In the Notion sheet: the page Cordia lives under. It holds a "Cordia assignments" database that
// stays in sync both ways, and the guides exported to Notion.
export default function NotionHome() {
  const [home, setHome] = useState(undefined);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { notionHome().then(data => setHome(data?.home || null)); }, []);
  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const data = await notionPages(query.trim());
      if (!live) return;
      if (Array.isArray(data?.pages)) { setFound(data.pages); setError(''); }
      else { setFound([]); setError(apiErrorMessage(data?.detail, "Couldn't search Notion. Try again.")); }
    }, query ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [picking, query]);

  async function choose(page) {
    setBusy(page.id); setError(''); setNotice('');
    const data = await notionSetup(page.id, page.title);
    setBusy('');
    if (!data?.home) { setError(apiErrorMessage(data?.detail, "Notion didn't make the database. Try again.")); return; }
    setHome(data.home); setPicking(false); setQuery('');
    setNotice(`"Cordia assignments" is in ${page.title}${data.added ? ` with ${data.added} assignment${data.added === 1 ? '' : 's'}` : ''}. Mark one Done there and it's done here too.`);
  }

  async function syncNow() {
    setBusy('sync'); setError(''); setNotice('');
    const data = await notionSync();
    setBusy('');
    if (data?.on) setNotice(data.added || data.done_in_notion ? `Added ${data.added || 0}, ${data.done_in_notion || 0} marked done from Notion.` : 'Everything is up to date.');
    else setError(apiErrorMessage(data?.detail, "Notion couldn't be reached. Try again."));
  }

  if (home === undefined) return null;
  return (
    <div className="nh">
      <h3 className="nh-title">Course database</h3>
      {home && !picking ? (
        <>
          <p className="c-meta">Your assignments are in <strong>Cordia assignments</strong> under {home.title}, with course, due date and status. Exported guides go there too.</p>
          <div className="nh-actions">
            <button type="button" className="c-btn c-btn--secondary" disabled={Boolean(busy)} onClick={syncNow}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button type="button" className="c-btn c-btn--quiet" disabled={Boolean(busy)} onClick={() => { setPicking(true); setFound(null); }}>Use another page</button>
          </div>
        </>
      ) : picking ? (
        <>
          <p className="c-meta">Pick a page you shared with Cordia. Don't see it? In Notion, open the page, then ••• › Connections and add Cordia.</p>
          <label className="cn-search">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <input className="c-input" type="search" autoFocus placeholder="Search your shared pages" aria-label="Search your shared Notion pages" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {found && found.length > 0 && (
            <div className="c-list nh-results">
              {found.slice(0, 10).map(page => (
                <button key={page.id} type="button" className="c-list-row cn-result" disabled={Boolean(busy)} onClick={() => choose(page)}>
                  <span className="c-grow"><span className="cn-row-title c-truncate">{page.title}</span>
                    <span className="c-meta">{busy === page.id ? 'Making the database…' : page.edited && `edited ${page.edited}`}</span></span>
                </button>
              ))}
            </div>
          )}
          {found && !found.length && !error && <p className="c-meta">No shared pages found. Share a page with Cordia in Notion, then search again.</p>}
          <button type="button" className="c-btn c-btn--quiet c-btn--sm nh-cancel" onClick={() => setPicking(false)}>Cancel</button>
        </>
      ) : (
        <>
          <p className="c-meta">Get your assignments as a Notion database that stays in sync: due dates update on their own, and marking one Done in Notion checks it off here.</p>
          <button type="button" className="c-btn c-btn--secondary nh-start" onClick={() => { setPicking(true); setFound(null); }}>Set it up</button>
        </>
      )}
      {notice && <p className="cn-notice" role="status">{notice}</p>}
      {error && <p className="cn-error" role="alert">{error}</p>}
      <style jsx>{`
        .nh { display: grid; gap: 10px; width: 100%; padding-top: 12px; border-top: 1px solid var(--hairline); text-align: left; }
        .nh-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .nh .c-meta { margin: 0; }
        .nh-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .nh .nh-start, .nh .nh-cancel { justify-self: start; }
        .nh-results { max-height: 240px; overflow: auto; }
      `}</style>
    </div>
  );
}
