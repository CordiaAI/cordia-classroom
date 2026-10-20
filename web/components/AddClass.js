import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../lib/api';

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

// Add a class: a name, plus an optional school and course code (autocompleted from the class
// database). The code is what joins the shared class sets, so a Library class and a shared
// class are the same thing. With `folderId`, an existing Library class gains its code.
export default function AddClass({ onAdded, onCancel, folderId = '', withName = false }) {
  const [name, setName] = useState('');
  const [schoolText, setSchoolText] = useState(typeof window !== 'undefined' ? localStorage.getItem('cordiaSchool') || '' : '');
  const [school, setSchool] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);
  // Suggestions show only while their field has focus, so they never sit over Add.
  const [listFor, setListFor] = useState(null);
  const fieldFocus = key => ({ onFocus: () => setListFor(key), onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setListFor(null); } });
  const keepFocus = { onMouseDown: event => event.preventDefault() };
  const schools = useSuggest(q => '/classes/schools?q=' + encodeURIComponent(q), schoolText, !school && schoolText.trim().length >= 2);
  const catalog = useSuggest(q => `/classes/catalog?school_id=${school?.id}&q=${encodeURIComponent(q)}`, code, Boolean(school?.id) && code.trim().length >= 1);

  async function submit(event, picked) {
    event?.preventDefault();
    const value = picked?.code || code;
    if (busy || !(value.trim() || (withName && name.trim()))) return;
    setBusy(true);
    setError('');
    if (!value.trim()) {
      // Just a name: a private Library class with no shared sets.
      const data = await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setBusy(false);
      if (data?.folder) onAdded({ folder: data.folder });
      else setError(apiErrorMessage(data?.detail, 'Class not created.'));
      return;
    }
    const where = school?.id ? { school_id: school.id } : { school_name: schoolText.trim() };
    const data = await apiFetch('/classes', {
      method: 'POST',
      body: JSON.stringify({ ...where, code: value, name: name.trim(), ...(folderId ? { folder_id: folderId } : {}) }),
    });
    setBusy(false);
    if (data?.class) {
      if (schoolText.trim()) try { localStorage.setItem('cordiaSchool', school?.name || schoolText.trim()); } catch {}
      onAdded({ class: data.class, folder: data.folder || null });
    } else setError(apiErrorMessage(data?.detail, 'Use a course code like MGT 300'));
  }

  return (
    <>
    <form className={'c-card cls-add' + (withName ? ' cls-add--named' : '')} onSubmit={submit}>
      {withName && (
        <label className="c-field cls-field">
          <span className="c-section-title cls-label">Name</span>
          <input className="c-input" value={name} onChange={event => setName(event.target.value)} placeholder="Biology" autoComplete="off" autoFocus />
        </label>
      )}
      <label className="c-field cls-field" {...fieldFocus('school')}>
        <span className="c-section-title cls-label">School{withName ? ' (optional, to share with classmates)' : ''}</span>
        <input className="c-input" value={school ? school.name : schoolText} onChange={event => { setSchool(null); setSchoolText(event.target.value); }} autoComplete="off" autoFocus={!withName} />
        {listFor === 'school' && schools.length > 0 && (
          <ul className="c-menu cls-suggest" role="listbox" aria-label="Schools" {...keepFocus}>
            {schools.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={() => { setSchool(item); codeRef.current?.focus(); }}>{item.name}</button></li>)}
          </ul>
        )}
      </label>
      <label className="c-field cls-field" {...fieldFocus('code')}>
        <span className="c-section-title cls-label">Course code{withName ? ' (optional)' : ''}</span>
        <input ref={codeRef} className="c-input" value={code} onChange={event => setCode(event.target.value)} placeholder="MGT 300" autoComplete="off" />
        {listFor === 'code' && catalog.length > 0 && (
          <ul className="c-menu cls-suggest" role="listbox" aria-label="Classes" {...keepFocus}>
            {catalog.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={event => submit(event, item)}><strong>{item.code}</strong>{item.name && <span className="c-meta">{item.name}</span>}</button></li>)}
          </ul>
        )}
      </label>
      <div className="cls-add-actions">
        <button type="submit" className="c-btn c-btn--primary" disabled={busy || (code.trim() ? !(school || schoolText.trim()) : !(withName && name.trim()))}>Add</button>
        <button type="button" className="c-icon-btn" onClick={onCancel} aria-label="Cancel"><X {...ICON} /></button>
      </div>
      {error && <p className="cls-error" role="alert">{error}</p>}
    </form>
      <style jsx global>{`
        .cls-add { position: relative; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 16px; }
        .cls-add--named { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto; }
        .cls-field { position: relative; }
        .cls-label { font-size: 13px; }
        .cls-suggest { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin-top: 4px; padding: 4px; list-style: none; max-height: 264px; overflow-y: auto; background: var(--canvas) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
        .cls-suggest button { display: flex; align-items: baseline; gap: 8px; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: none; color: var(--ink); font: 500 15px/1.3 var(--font-sans); text-align: left; cursor: pointer; }
        .cls-suggest button:hover, .cls-suggest button:focus-visible { background: var(--hover); }
        .cls-add-actions { display: flex; gap: 4px; }
        .cls-error { grid-column: 1 / -1; margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        /* Phones stack the fields, so the suggestions push Add down instead of covering it. */
        @media (max-width: 767px) { .cls-add, .cls-add--named { grid-template-columns: minmax(0, 1fr); } .cls-suggest { position: static; } }
      `}</style>
    </>
  );
}

