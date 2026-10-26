import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, MessageCircle, Search, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { linkDraft, unlinkDraft } from '../lib/studyPlans';
import { walkthroughEvent } from '../lib/walkthrough';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const FEEDBACK = 'Check my draft against the rubric. For each criterion, say what is there and what is missing.';

// In an assignment's sheet: the Google Doc the student is writing. The Tutor reads it with the
// rubric ("Get feedback"), and Cordia notices if it stops growing close to the deadline.
export default function DraftLink({ item, draft: initial }) {
  const [draft, setDraft] = useState(initial || null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(initial || null), [initial]);

  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const data = await apiFetch(`/connectors/gdocs/files?q=${encodeURIComponent(query.trim())}`);
      if (!live) return;
      if (Array.isArray(data?.files)) { setFound(data.files); setError(''); }
      else { setFound([]); setError(apiErrorMessage(data?.detail, 'Connect Google Docs in Settings › Connectors first.')); }
    }, query ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [picking, query]);

  async function pick(file) {
    setBusy(true); setError('');
    const data = await linkDraft(item.id, file.id, file.title);
    setBusy(false);
    if (data?.draft) { setDraft(data.draft); setPicking(false); setQuery(''); walkthroughEvent('docs-exported'); }
    else setError(apiErrorMessage(data?.detail, "That didn't link. Try again."));
  }

  async function unlink() {
    setBusy(true);
    const data = await unlinkDraft(item.id);
    setBusy(false);
    if (data && !data.detail) setDraft(null);
  }

  const feedbackHref = `/tutor?assignment=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title || '')}&ask=${encodeURIComponent(FEEDBACK)}`;
  return (
    <div className="dl">
      <h3 className="dl-title">Your draft</h3>
      {draft ? (
        <>
          <div className="dl-row">
            <FileText {...ICON} />
            <a className="c-grow c-truncate dl-name" href={draft.url} target="_blank" rel="noreferrer">{draft.title}</a>
            {typeof draft.words === 'number' && <span className="c-meta dl-words">{draft.words.toLocaleString()} words</span>}
            <button type="button" className="c-icon-btn" aria-label="Unlink draft" disabled={busy} onClick={unlink}><X {...ICON} /></button>
          </div>
          <Link href={feedbackHref} className="c-btn c-btn--secondary dl-feedback"><MessageCircle {...ICON} />Get feedback on it</Link>
        </>
      ) : picking ? (
        <>
          <label className="cn-search">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <input className="c-input" type="search" autoFocus placeholder="Search your Google Docs" aria-label="Search your Google Docs" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {found && found.length > 0 && (
            <div className="c-list dl-results">
              {found.slice(0, 8).map(file => (
                <button key={file.id} type="button" className="c-list-row cn-result" disabled={busy} onClick={() => pick(file)}>
                  <span className="c-grow"><span className="cn-row-title c-truncate">{file.title}</span>{file.edited && <span className="c-meta">edited {file.edited}</span>}</span>
                </button>
              ))}
            </div>
          )}
          {found && !found.length && !error && <p className="c-meta">No Docs found. Try another name.</p>}
          <button type="button" className="c-btn c-btn--quiet c-btn--sm dl-cancel" onClick={() => setPicking(false)}>Cancel</button>
        </>
      ) : (
        <>
          <p className="c-meta">Writing it in Google Docs? Link it and the Tutor can check it against the rubric.</p>
          <button type="button" className="c-btn c-btn--quiet dl-link" onClick={() => { setPicking(true); setFound(null); }}><FileText {...ICON} />Link a Google Doc</button>
        </>
      )}
      {error && <p className="cn-error" role="alert">{error}</p>}
      <style jsx>{`
        .dl { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--hairline); }
        .dl-title { margin: 0; font: 600 14px/1.4 var(--font-sans); color: var(--muted); }
        .dl .c-meta { margin: 0; }
        .dl-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .dl-name { color: var(--ink); font: 600 15px/1.4 var(--font-sans); }
        .dl-words { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .dl :global(.dl-feedback), .dl .dl-link, .dl .dl-cancel { justify-self: start; }
        .dl-results { max-height: 220px; overflow: auto; }
      `}</style>
    </div>
  );
}
