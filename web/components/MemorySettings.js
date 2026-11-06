import { useEffect, useState } from 'react';
import { MessageCircle, Smartphone, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';

// Settings › Tutor: "What Cordia remembers". One memory shared by the Tutor and the Assistant
// (public.student_memory): things a student shared about themselves that help explain things to them,
// used by Help me remember. Each can be forgotten; an Assistant memory is forgotten there too.
const FROM = { tutor: { label: 'From the Tutor', icon: MessageCircle }, assistant: { label: 'From your Assistant', icon: Smartphone } };

export default function MemorySettings() {
  const [memories, setMemories] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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

  if (memories === null) return null;
  return (
    <div className="c-card settings-card mem">
      <h2 className="c-section-title">What Cordia remembers</h2>
      <p className="c-meta settings-note">Things you’ve told the Tutor or your Assistant about yourself, like your goals and interests. Help me remember uses them to make tricks that stick. Health, contact details and other private things are never kept.</p>
      {memories.length ? (
        <ul className="mem-list">
          {memories.map(memory => {
            const from = FROM[memory.source] || FROM.tutor;
            return (
              <li key={memory.id} className="mem-row">
                <from.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                <span className="mem-text">{memory.value}<span className="c-meta mem-from">{from.label}</span></span>
                <button type="button" className="c-icon-btn mem-forget" disabled={busy === memory.id} onClick={() => forget(memory)} aria-label={`Forget: ${memory.value}`}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="c-meta">Nothing yet. Tell the Tutor what you’re studying for or what you’re into, and it’ll remember.</p>}
      {error && <p className="retain-action-error" role="alert">{error}</p>}
      <style jsx>{`
        .mem { display: grid; gap: var(--space-3); }
        .mem-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
        .mem-row { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
        .mem-row :global(.lucide) { flex: none; color: var(--olive-ink); }
        .mem-text { flex: 1; min-width: 0; display: grid; gap: 2px; overflow-wrap: anywhere; }
        .mem-from { font-size: 12px; }
      `}</style>
    </div>
  );
}
