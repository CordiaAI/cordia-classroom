import { useEffect, useState } from 'react';
import { MessageCircle, Smartphone, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import ConfirmDialog from './ConfirmDialog';

// Settings › Tutor: "What Cordia remembers". One memory shared by the Tutor and the Assistant
// (public.student_memory): things a student shared about themselves that help explain things to them,
// used by Help me remember. Each can be forgotten, or all at once; an Assistant memory is forgotten there too.
const FROM = { tutor: { label: 'From the Tutor', icon: MessageCircle }, assistant: { label: 'From your Assistant', icon: Smartphone } };

export default function MemorySettings() {
  const [memories, setMemories] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false); // the "Clear all" confirmation is open

  useEffect(() => {
    apiFetch('/memories').then(data => setMemories(Array.isArray(data?.memories) ? data.memories : []));
  }, []);

  async function forget(memory) {
    setBusy(memory.id);
    setError('');
    const data = await apiFetch(`/memories/${memory.id}`, { method: 'DELETE' });
    setBusy('');
    if (Array.isArray(data?.memories)) setMemories(data.memories);
    else setError(apiErrorMessage(data?.detail, 'That wasn’t forgotten. Try again.'));
  }

  async function forgetAll() {
    setClearing(false);
    setBusy('all');
    setError('');
    const data = await apiFetch('/memories', { method: 'DELETE' });
    setBusy('');
    if (Array.isArray(data?.memories)) setMemories(data.memories);
    else setError(apiErrorMessage(data?.detail, 'Your memories weren’t cleared. Try again.'));
  }

  if (memories === null) return null;
  const fromAssistant = memories.some(memory => memory.source === 'assistant');
  return (
    <div className="c-card settings-card mem">
      <div className="settings-head">
        <h2 className="c-section-title">What Cordia remembers</h2>
        {memories.length > 0 && (
          <button type="button" className="c-btn c-btn--quiet c-btn--danger mem-clear" disabled={Boolean(busy)} onClick={() => setClearing(true)}>Clear all</button>
        )}
      </div>
      <p className="c-meta mem-note">Things you’ve told the Tutor or your Assistant about yourself, like your goals and interests. Help me remember uses them to make tricks that stick. Cordia is told not to keep health, contact details or other private things.</p>
      {memories.length ? (
        <ul className="mem-list">
          {memories.map(memory => {
            const from = FROM[memory.source] || FROM.tutor;
            return (
              <li key={memory.id} className="mem-row">
                <span className="mem-icon" aria-hidden="true"><from.icon size={20} strokeWidth={1.75} /></span>
                <span className="mem-text">{memory.value}<span className="c-meta mem-from">{from.label}</span></span>
                <button type="button" className="c-icon-btn mem-forget" disabled={busy === memory.id} onClick={() => forget(memory)} aria-label={`Forget: ${memory.value}`}><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="c-meta mem-note">Nothing yet. Tell the Tutor what you’re studying for or what you’re into, and it’ll remember.</p>}
      {error && <p className="retain-action-error" role="alert">{error}</p>}
      {clearing && (
        <ConfirmDialog
          title="Clear everything Cordia remembers?"
          message={`All ${memories.length === 1 ? 'of it' : `${memories.length} things`} will be forgotten for good${fromAssistant ? ', including what your Assistant remembers' : ''}. This can't be undone.`}
          confirmLabel="Clear all"
          onConfirm={forgetAll}
          onCancel={() => setClearing(false)}
        />
      )}
      <style jsx>{`
        .mem-note { margin: 0; }
        .mem-list { list-style: none; margin: 0; padding: 0; display: grid; }
        /* Icon, text and Forget share one centre line; every row is the same height at least. */
        .mem-row { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr) 2.5rem; align-items: center; column-gap: 0.75rem; min-height: 3.5rem; padding: 0.375rem 0; }
        .mem-icon { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--glass-inner); color: var(--olive-ink); }
        .mem-text { display: grid; gap: 0.125rem; min-width: 0; overflow-wrap: anywhere; }
        .mem-from { font-size: 0.8125rem; }
        .mem :global(.mem-forget) { justify-self: end; }
      `}</style>
    </div>
  );
}
