import { useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';
import BodyPortal from '../BodyPortal';
import { assistantApi, assistantDownload } from '../../lib/assistant';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

export default function AssistantData({ view, setView, onDeleted, toast }) {
  const [deleting, setDeleting] = useState(null); // null | { text, busy, error }
  const name = view.identity.assistant_name;

  async function forget(fact) {
    const out = await assistantApi(`/memory/${fact.id}`, { method: 'DELETE' });
    if (out.ok) { setView(out.data); toast('Forgotten'); }
    else toast(out.data.error || "That didn't delete. Try again.");
  }

  async function exportData() {
    const ok = await assistantDownload('/account/export', `cordia-assistant-${new Date().toISOString().slice(0, 10)}.json`);
    if (!ok) toast("The download didn't start. Try again.");
  }

  async function deleteAssistant(event) {
    event.preventDefault();
    if (deleting.text !== 'DELETE' || deleting.busy) return;
    setDeleting(current => ({ ...current, busy: true, error: '' }));
    const out = await assistantApi('/account', { method: 'DELETE', json: { confirm: 'DELETE' } });
    if (out.ok) { setDeleting(null); onDeleted(); }
    else setDeleting(current => ({ ...current, busy: false, error: out.data.error || "That didn't delete. Try again." }));
  }

  return (
    <div className="c-stack">
      <div className="c-card asst-card">
        <h2 className="c-section-title">What {name} remembers</h2>
        {view.facts.length ? (
          <div className="c-list asst-flat-list">
            {view.facts.map(fact => (
              <div key={fact.id} className="c-list-row">
                <span className="c-grow asst-app-text">
                  <strong className="asst-row-title">{fact.value}</strong>
                  <span className="c-meta">{fact.key.replace(/_/g, ' ')}</span>
                </span>
                <button type="button" className="c-icon-btn" aria-label={`Forget ${fact.value}`} onClick={() => forget(fact)}><X {...ICON} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="c-meta">Nothing yet. Tell {name} things by text, like “my major is nursing”, and they show up here.</p>
        )}
      </div>

      <div className="c-card asst-row">
        <span className="asst-row-label"><Download {...ICON} /><span className="c-section-title">Your Assistant data</span></span>
        <button type="button" className="c-btn c-btn--secondary" onClick={exportData}>Download</button>
      </div>
      <div className="c-card asst-row">
        <span className="asst-row-label"><Trash2 {...ICON} /><span className="c-section-title">Delete the Assistant</span></span>
        <button type="button" className="c-btn c-btn--secondary asst-danger" onClick={() => setDeleting({ text: '', busy: false, error: '' })}>Delete</button>
      </div>
      <p className="c-meta">To stop texts any time, reply STOP. Your Classroom account isn't affected by any of this.</p>

      {deleting && (
        <BodyPortal>
          <div className="c-scrim" onClick={() => !deleting.busy && setDeleting(null)}>
            <form className="c-sheet asst-sheet" role="dialog" aria-modal="true" aria-labelledby="asst-delete-title" onSubmit={deleteAssistant} onClick={event => event.stopPropagation()}>
              <h2 id="asst-delete-title" className="c-title">Delete the Assistant?</h2>
              <p>This deletes your texts with {name}, its memories, reminders, personality and app connections, and stops all texts. Your Classroom account and study material stay. It can’t be undone.</p>
              <label className="c-field">
                <span>Type DELETE to confirm</span>
                <input className="c-input" value={deleting.text} onChange={event => setDeleting(current => ({ ...current, text: event.target.value }))} autoComplete="off" autoFocus />
              </label>
              {deleting.error && <p className="asst-error" role="alert">{deleting.error}</p>}
              <div className="asst-sheet-actions">
                <span className="c-grow" />
                <button type="button" className="c-btn c-btn--secondary" onClick={() => setDeleting(null)} disabled={deleting.busy}>Cancel</button>
                <button type="submit" className="c-btn c-btn--primary asst-delete-confirm" disabled={deleting.text !== 'DELETE' || deleting.busy}>{deleting.busy ? 'Deleting…' : 'Delete the Assistant'}</button>
              </div>
            </form>
          </div>
        </BodyPortal>
      )}
    </div>
  );
}
