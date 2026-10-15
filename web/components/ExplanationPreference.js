import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/api';

// The student's own words on how the Tutor should explain things.
export default function ExplanationPreference({ compact = false, onSaved }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    apiFetch('/explanation-preference').then(data => {
      if (!active) return;
      const value = typeof data?.text === 'string' ? data.text : '';
      setText(value);
      setSaved(value);
      setStatus('ready');
    });
    return () => { active = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    setStatus('saving');
    const data = await apiFetch('/explanation-preference', { method: 'PUT', body: JSON.stringify({ text }) });
    if (typeof data?.text === 'string') {
      setText(data.text);
      setSaved(data.text);
      setStatus('saved');
      onSaved?.();
    } else {
      setStatus(apiErrorMessage(data?.detail, 'Could not save. Please try again.'));
    }
  }

  const changed = text.trim() !== saved.trim();
  return (
    <form className={`explain-preference${compact ? ' compact' : ''}`} onSubmit={save}>
      <label htmlFor={compact ? 'explain-preference-tutor' : 'explain-preference'}>How should I explain things?</label>
      <textarea
        id={compact ? 'explain-preference-tutor' : 'explain-preference'}
        value={text}
        onChange={event => { setText(event.target.value); if (status === 'saved') setStatus('ready'); }}
        placeholder="Simple words, one step at a time"
        maxLength={500}
        rows={compact ? 3 : 4}
        disabled={status === 'loading'}
      />
      <div className="explain-preference-actions">
        <small className="c-meta" role={status === 'saved' || !['ready', 'loading', 'saving'].includes(status) ? 'status' : undefined}>{status === 'saved' ? 'Saved' : !['ready', 'loading', 'saving'].includes(status) ? status : `${text.length}/500`}</small>
        <button type="submit" className="c-btn c-btn--primary" disabled={status === 'loading' || status === 'saving' || !changed}>{status === 'saving' ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
