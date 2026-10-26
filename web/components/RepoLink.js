import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderGit2, MessageCircle, Search, X } from 'lucide-react';
import { apiErrorMessage } from '../lib/api';
import { agoLabel, getRepo, githubRepos, linkRepo, unlinkRepo } from '../lib/studyPlans';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const REVIEW = 'Read my code against the assignment instructions. What is done, what is missing, and is anything likely to be wrong?';

// Commits per day over the last two weeks, oldest first: one bar a day, today on the right.
function Activity({ perDay }) {
  const top = Math.max(1, ...perDay);
  return (
    <div className="rl-bars" role="img" aria-label={`${perDay.reduce((a, b) => a + b, 0)} commits in the last ${perDay.length} days`}>
      {perDay.map((count, index) => <span key={index} className={count ? 'is-on' : ''} style={{ height: `${count ? 25 + (75 * count) / top : 8}%` }} />)}
      <style jsx>{`
        .rl-bars { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
        .rl-bars span { flex: 1 1 0; min-width: 4px; border-radius: 3px; background: var(--hairline); }
        .rl-bars span.is-on { background: var(--accent); }
      `}</style>
    </div>
  );
}

// In an assignment's sheet: the GitHub repo the student is coding it in. Shows commit activity
// against the due date, and the Tutor reads the code with the instructions and rubric.
export default function RepoLink({ item, repo: initial }) {
  const [repo, setRepo] = useState(initial || null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setRepo(initial || null), [initial]);

  // Activity is the slow part (GitHub is asked), so it loads after the sheet opens.
  const linked = repo?.full_name;
  useEffect(() => {
    if (!linked) return undefined;
    let live = true;
    getRepo(item.id).then(data => { if (live && data?.repo) setRepo(data.repo); });
    return () => { live = false; };
  }, [item.id, linked]);

  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const data = await githubRepos(query.trim());
      if (!live) return;
      if (Array.isArray(data?.repos)) { setFound(data.repos); setError(''); }
      else { setFound([]); setError(apiErrorMessage(data?.detail, 'Connect GitHub in Settings › Connectors first.')); }
    }, query ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [picking, query]);

  async function pick(choice) {
    setBusy(true); setError('');
    const data = await linkRepo(item.id, choice.full_name, choice.branch);
    setBusy(false);
    if (data?.repo) { setRepo(data.repo); setPicking(false); setQuery(''); }
    else setError(apiErrorMessage(data?.detail, "That didn't link. Try again."));
  }

  async function unlink() {
    setBusy(true);
    const data = await unlinkRepo(item.id);
    setBusy(false);
    if (data && !data.detail) setRepo(null);
  }

  const reviewHref = `/tutor?assignment=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title || '')}&ask=${encodeURIComponent(REVIEW)}`;
  const activity = repo?.activity;
  const daysLeft = item.due_at ? Math.ceil((new Date(item.due_at) - Date.now()) / 86400000) : null;
  return (
    <div className="rl">
      {repo ? (
        <>
          <h3 className="rl-title">Your code</h3>
          <div className="rl-row">
            <FolderGit2 {...ICON} />
            <a className="c-grow c-truncate rl-name" href={repo.url} target="_blank" rel="noreferrer">{repo.full_name}</a>
            <button type="button" className="c-icon-btn" aria-label="Unlink repo" disabled={busy} onClick={unlink}><X {...ICON} /></button>
          </div>
          {activity && (
            <>
              <Activity perDay={activity.per_day} />
              <p className="c-meta">
                {[`${activity.total} commit${activity.total === 1 ? '' : 's'} in 2 weeks`,
                  activity.last ? `last commit ${agoLabel(activity.last.at)}` : 'none yet',
                  daysLeft != null && daysLeft >= 0 && (daysLeft ? `due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'due today')].filter(Boolean).join(' · ')}
              </p>
              {activity.last?.message && <p className="c-meta c-truncate rl-last">“{activity.last.message}”</p>}
            </>
          )}
          <Link href={reviewHref} className="c-btn c-btn--secondary rl-review"><MessageCircle {...ICON} />Ask Tutor about my code</Link>
        </>
      ) : picking ? (
        <>
          <label className="cn-search">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <input className="c-input" type="search" autoFocus placeholder="Search your GitHub repos" aria-label="Search your GitHub repos" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {found && found.length > 0 && (
            <div className="c-list rl-results">
              {found.slice(0, 8).map(choice => (
                <button key={choice.full_name} type="button" className="c-list-row cn-result" disabled={busy} onClick={() => pick(choice)}>
                  <span className="c-grow"><span className="cn-row-title c-truncate">{choice.full_name}</span>
                    <span className="c-meta">{[choice.private && 'private', choice.pushed && `pushed ${choice.pushed}`].filter(Boolean).join(' · ')}</span></span>
                </button>
              ))}
            </div>
          )}
          {found && !found.length && !error && <p className="c-meta">No repos found. Try another name.</p>}
          <button type="button" className="c-btn c-btn--quiet c-btn--sm rl-cancel" onClick={() => setPicking(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className="c-btn c-btn--quiet rl-link" onClick={() => { setPicking(true); setFound(null); }}><FolderGit2 {...ICON} />Coding it? Link a GitHub repo</button>
      )}
      {error && <p className="cn-error" role="alert">{error}{/Connect GitHub/.test(error) && <> <Link href="/settings?section=connectors&open=github">Connect it</Link></>}</p>}
      <style jsx>{`
        .rl { display: grid; gap: 8px; }
        .rl-title { margin: 0; font: 600 14px/1.4 var(--font-sans); color: var(--muted); }
        .rl .c-meta { margin: 0; }
        .rl-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .rl-name { flex: 1 1 auto; min-width: 0; color: var(--ink); font: 600 15px/1.4 var(--font-sans); }
        .rl-last { font-style: italic; }
        .rl :global(.rl-review), .rl .rl-link, .rl .rl-cancel { justify-self: start; }
        .rl-results { max-height: 220px; overflow: auto; }
      `}</style>
    </div>
  );
}
