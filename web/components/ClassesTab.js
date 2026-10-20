import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, GraduationCap, Plus, X } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../lib/api';
import CanvasConnectButton from './CanvasConnectButton';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function useSuggest(path, query, enabled) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!enabled) { setItems([]); return undefined; }
    const timer = setTimeout(async () => {
      const data = await apiFetch(path(query));
      setItems(data?.schools || data?.classes || []);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, enabled]);
  return items;
}

// School + code with autocomplete from the class database.
function AddClass({ onAdded, onCancel }) {
  const [schoolText, setSchoolText] = useState(typeof window !== 'undefined' ? localStorage.getItem('cordiaSchool') || '' : '');
  const [school, setSchool] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);
  const schools = useSuggest(q => '/classes/schools?q=' + encodeURIComponent(q), schoolText, !school && schoolText.trim().length >= 2);
  const catalog = useSuggest(q => `/classes/catalog?school_id=${school?.id}&q=${encodeURIComponent(q)}`, code, Boolean(school?.id) && code.trim().length >= 1);

  async function submit(event, picked) {
    event?.preventDefault();
    const value = picked?.code || code;
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    const data = await apiFetch('/classes', {
      method: 'POST',
      body: JSON.stringify(school?.id ? { school_id: school.id, code: value } : { school_name: schoolText.trim(), code: value }),
    });
    setBusy(false);
    if (data?.class) onAdded(data.class);
    else setError(apiErrorMessage(data?.detail, 'Use a course code like MGT 300'));
  }

  return (
    <form className="c-card cls-add" onSubmit={submit}>
      <label className="c-field cls-field">
        <span className="c-section-title cls-label">School</span>
        <input className="c-input" value={school ? school.name : schoolText} onChange={event => { setSchool(null); setSchoolText(event.target.value); }} autoComplete="off" autoFocus />
        {schools.length > 0 && (
          <ul className="c-menu cls-suggest" role="listbox" aria-label="Schools">
            {schools.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={() => { setSchool(item); codeRef.current?.focus(); }}>{item.name}</button></li>)}
          </ul>
        )}
      </label>
      <label className="c-field cls-field">
        <span className="c-section-title cls-label">Course code</span>
        <input ref={codeRef} className="c-input" value={code} onChange={event => setCode(event.target.value)} placeholder="MGT 300" autoComplete="off" />
        {catalog.length > 0 && (
          <ul className="c-menu cls-suggest" role="listbox" aria-label="Classes">
            {catalog.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={event => submit(event, item)}><strong>{item.code}</strong>{item.name && <span className="c-meta">{item.name}</span>}</button></li>)}
          </ul>
        )}
      </label>
      <div className="cls-add-actions">
        <button type="submit" className="c-btn c-btn--primary" disabled={busy || !code.trim() || !(school || schoolText.trim())}>Add</button>
        <button type="button" className="c-icon-btn" onClick={onCancel} aria-label="Cancel"><X {...ICON} /></button>
      </div>
      {error && <p className="cls-error" role="alert">{error}</p>}
    </form>
  );
}

export default function ClassesTab() {
  const [classes, setClasses] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    apiFetch('/classes').then(data => setClasses(Array.isArray(data?.classes) ? data.classes : []));
  }, []);

  return (
    <div className="c-stack cls">
      <div className="c-row">
        <span className="c-spacer" />
        <CanvasConnectButton />
        {!adding && <button type="button" className="c-btn c-btn--quiet" onClick={() => setAdding(true)}><Plus {...ICON} />Add class</button>}
      </div>
      {adding && <AddClass onCancel={() => setAdding(false)} onAdded={item => { setAdding(false); setClasses(list => [...(list || []).filter(c => c.id !== item.id), item].sort((a, b) => a.code.localeCompare(b.code))); }} />}
      <div className="c-card c-list">
        {!classes ? (
          [0, 1, 2].map(index => <div key={index} className="c-list-row"><div className="c-skeleton" style={{ height: 24, flex: 1 }} /></div>)
        ) : !classes.length ? (
          <div className="c-empty"><GraduationCap size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">No classes</span></div>
        ) : classes.map(item => (
          <Link key={item.id} href={'/class/' + item.id} className="c-list-row cls-row">
            <span className="cls-name">
              <strong>{item.code}</strong>
              {item.name && <span className="c-truncate">{item.name}</span>}
            </span>
            <span className="c-meta">{item.sharing_blocked ? 'Sharing off' : `${item.shared_count} set${item.shared_count === 1 ? '' : 's'}`}</span>
            <ChevronRight {...ICON} />
          </Link>
        ))}
      </div>
      <style jsx global>{`
        .cls-row { color: var(--ink); text-decoration: none; }
        .cls-row:hover { background: var(--hover); }
        .cls-name { flex: 1; display: flex; align-items: baseline; gap: 12px; min-width: 0; }
        .cls-name strong { flex: 0 0 auto; font: 500 17px/1.3 var(--font-display); }
        .cls-name span { font: 500 15px/1.3 var(--font-sans); }
        .cls-row .c-meta { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cls-add { position: relative; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 16px; }
        .cls-field { position: relative; }
        .cls-label { font-size: 13px; }
        .cls-suggest { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin-top: 4px; padding: 4px; list-style: none; }
        .cls-suggest button { display: flex; align-items: baseline; gap: 8px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: none; color: var(--ink); font: 500 15px/1.3 var(--font-sans); text-align: left; cursor: pointer; }
        .cls-suggest button:hover, .cls-suggest button:focus-visible { background: var(--hover); }
        .cls-add-actions { display: flex; gap: 4px; }
        .cls-error { grid-column: 1 / -1; margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        @media (max-width: 767px) { .cls-add { grid-template-columns: minmax(0, 1fr); } .cls-name { flex-direction: column; gap: 2px; } }
      `}</style>
    </div>
  );
}
