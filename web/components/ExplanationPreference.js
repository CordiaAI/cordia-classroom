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
      <label htmlFor={compact ? 'explain-preference-tutor' : 'explain-preference'}>How would you like me to explain things to you?</label>
      <p>Tell me in your own words. I&apos;ll use it every time you ask me something.</p>
      <textarea
        id={compact ? 'explain-preference-tutor' : 'explain-preference'}
        value={text}
        onChange={event => { setText(event.target.value); if (status === 'saved') setStatus('ready'); }}
        placeholder="For example: Use simple words and everyday examples. Go one step at a time."
        maxLength={500}
        rows={compact ? 3 : 4}
        disabled={status === 'loading'}
      />
      <div className="explain-preference-actions">
        <small>{status === 'saved' ? 'Saved. I’ll explain things this way.' : !['ready', 'loading', 'saving'].includes(status) ? status : `${text.length}/500`}</small>
        <button type="submit" className="btn" disabled={status === 'loading' || status === 'saving' || !changed}>{status === 'saving' ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
