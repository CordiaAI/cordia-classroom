import { useEffect, useState } from 'react';
import { FolderSync, Search, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { classLabel } from '../lib/classLabel';
import { walkthroughEvent } from '../lib/walkthrough';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

const APPS = {
  drive: { name: 'Drive', base: '/drive' },
  dropbox: { name: 'Dropbox', base: '/dropbox' },
};

// In the Google Drive and Dropbox sheets: link a folder to each class. New and changed files in it
// come into that class in Library (now, then every 30 minutes).
export default function DriveFolders({ app = 'drive' }) {
  const { name: appName, base } = APPS[app] || APPS.drive;
  const [links, setLinks] = useState(null);
  const [classes, setClasses] = useState([]);
  const [adding, setAdding] = useState(false);
  const [classId, setClassId] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([apiFetch(`${base}/links`), apiFetch('/folders')]).then(([linkData, folderData]) => {
      setLinks(Array.isArray(linkData?.links) ? linkData.links : []);
      setClasses(Array.isArray(folderData?.folders) ? folderData.folders : []);
    });
  }, [base]);

  useEffect(() => {
    if (!adding) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const data = await apiFetch(`${base}/folders?q=${encodeURIComponent(query.trim())}`);
      if (!live) return;
      if (Array.isArray(data?.folders)) setFound(data.folders);
      else { setFound([]); setError(apiErrorMessage(data?.detail, `Couldn't search ${appName}. Try again.`)); }
    }, query ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [adding, query, base, appName]);

  const className = id => classLabel(classes.find(folder => folder.id === id)?.name || 'Class').title;
  const linkedClasses = new Set((links || []).map(link => link.library_folder_id));
  const open = classes.filter(folder => !linkedClasses.has(folder.id));

  async function link(folder) {
    setBusy(folder.id); setError(''); setNotice('');
    const data = await apiFetch(`${base}/links`, {
      method: 'PUT', timeoutMs: 120000,
      body: JSON.stringify({ library_folder_id: classId, drive_folder_id: folder.id, drive_folder_name: folder.name }),
    });
    setBusy('');
    if (!Array.isArray(data?.links)) { setError(apiErrorMessage(data?.detail, "That didn't link. Try again.")); return; }
    setLinks(data.links);
    if (app === 'drive') walkthroughEvent('drive-linked');
    setAdding(false); setQuery(''); setFound(null);
    setNotice(`Linked. ${data.imported ? `${data.imported} file${data.imported === 1 ? '' : 's'} came into ${className(classId)}.` : 'New files will come into the class as they appear.'}`);
  }

  async function unlink(entry) {
    setBusy(entry.library_folder_id); setError(''); setNotice('');
    const data = await apiFetch(`${base}/links/${entry.library_folder_id}`, { method: 'DELETE' });
    setBusy('');
    if (Array.isArray(data?.links)) { setLinks(data.links); setNotice('Unlinked. Files already in Library stay there.'); }
    else setError(apiErrorMessage(data?.detail, "That didn't unlink. Try again."));
  }

  async function syncNow() {
    setBusy('sync'); setError(''); setNotice('');
    const data = await apiFetch(`${base}/sync`, { method: 'POST', timeoutMs: 120000 });
    setBusy('');
    if (typeof data?.imported !== 'number') { setError(apiErrorMessage(data?.detail, `${appName} couldn't be reached. Try again.`)); return; }
    setNotice(data.imported ? `${data.imported} new file${data.imported === 1 ? '' : 's'} came into Library.` : 'Everything is up to date.');
  }

  if (links === null) return null;
  return (
    <div className="df">
      <h3 className="df-title">Class folders</h3>
      <p className="c-meta">Link a {appName} folder to a class. New slides and readings in it come into that class in Library on their own.</p>
      {links.length > 0 && (
        <ul className="df-list">
          {links.map(entry => (
            <li key={entry.library_folder_id} className="df-row">
              <span className="c-grow">
                <strong className="c-truncate">{className(entry.library_folder_id)}</strong>
                <span className="c-meta c-truncate">{appName}: {entry.drive_folder_name}</span>
              </span>
              <button type="button" className="c-icon-btn" aria-label={`Unlink ${entry.drive_folder_name}`} disabled={Boolean(busy)} onClick={() => unlink(entry)}><X {...ICON} /></button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="df-add">
          <label className="df-field">
            <span className="c-meta">Class</span>
            <select className="c-input" value={classId} onChange={event => setClassId(event.target.value)}>
              <option value="">Pick a class</option>
              {open.map(folder => <option key={folder.id} value={folder.id}>{classLabel(folder.name).title}</option>)}
            </select>
          </label>
          {classId && (
            <>
              <label className="cn-search">
                <Search size={20} strokeWidth={1.75} aria-hidden="true" />
                <input className="c-input" type="search" placeholder={`Search your ${appName} folders`} aria-label={`Search your ${appName} folders`} value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              {found === null ? null : found.length ? (
                <div className="c-list df-results">
                  {found.map(folder => (
                    <button key={folder.id} type="button" className="c-list-row cn-result" disabled={Boolean(busy)} onClick={() => link(folder)}>
                      <span className="c-grow"><span className="cn-row-title c-truncate">{folder.name}</span>
                        <span className="c-meta">{busy === folder.id ? 'Linking and bringing files in…' : folder.path || (folder.edited && `edited ${folder.edited}`)}</span></span>
                    </button>
                  ))}
                </div>
              ) : <p className="c-meta">No folders found. Try another name.</p>}
            </>
          )}
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => { setAdding(false); setQuery(''); setFound(null); }}>Cancel</button>
        </div>
      ) : (
        <div className="df-actions">
          <button type="button" className="c-btn c-btn--secondary" disabled={!open.length || Boolean(busy)} onClick={() => { setAdding(true); setClassId(open.length === 1 ? open[0].id : ''); }}>
            <FolderSync {...ICON} />Link a folder
          </button>
          {links.length > 0 && <button type="button" className="c-btn c-btn--quiet" disabled={Boolean(busy)} onClick={syncNow}>{busy === 'sync' ? 'Checking…' : 'Check for new files'}</button>}
        </div>
      )}
      {!classes.length && <p className="c-meta">Make a class in Library first.</p>}
      {notice && <p className="cn-notice" role="status">{notice}</p>}
      {error && <p className="cn-error" role="alert">{error}</p>}
      <style jsx>{`
        .df { display: grid; gap: 10px; width: 100%; padding-top: 12px; border-top: 1px solid var(--hairline); text-align: left; }
        .df-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .df .c-meta { margin: 0; }
        .df-list { list-style: none; margin: 0; padding: 0; display: grid; }
        .df-row { display: flex; align-items: center; gap: 12px; min-height: 52px; }
        .df-row .c-grow { flex: 1 1 auto; display: grid; gap: 2px; min-width: 0; }
        .df-add, .df-field { display: grid; gap: 8px; }
        .df-add > .c-btn { justify-self: start; }
        .df-results { max-height: 240px; overflow: auto; }
        .df-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      `}</style>
    </div>
  );
}
