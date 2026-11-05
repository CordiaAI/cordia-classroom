import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { checkUsername, normalizeUsername, usernameHint } from '../lib/profiles';

// A username box with a live availability check (after a short pause in typing). Reports
// { name, ok } upward so the form knows when Save can go. `current` is the student's own name,
// which is always fine to keep.
export default function UsernameField({ id = 'username', value, onChange, onStatus, current = '', autoFocus = false }) {
  const [status, setStatus] = useState({ state: 'idle', text: '' }); // idle | checking | ok | bad
  const name = normalizeUsername(value);

  useEffect(() => {
    const local = usernameHint(name);
    if (!name || local) {
      setStatus(name ? { state: 'bad', text: local } : { state: 'idle', text: '' });
      onStatus?.({ name, ok: false });
      return undefined;
    }
    if (current && name === current) {
      setStatus({ state: 'ok', text: 'This is your username.' });
      onStatus?.({ name, ok: false });
      return undefined;
    }
    setStatus({ state: 'checking', text: 'Checking…' });
    onStatus?.({ name, ok: false });
    let active = true;
    const timer = setTimeout(async () => {
      const result = await checkUsername(name);
      if (!active) return;
      if (!result) setStatus({ state: 'bad', text: "Couldn't check right now." });
      else setStatus(result.available ? { state: 'ok', text: 'Available' } : { state: 'bad', text: result.reason || 'Not available' });
      onStatus?.({ name, ok: Boolean(result?.available) });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [name, current]);

  return (
    <div className="uname">
      <div className={'uname-box' + (status.state === 'bad' ? ' is-bad' : status.state === 'ok' ? ' is-ok' : '')}>
        <span className="uname-at" aria-hidden="true">@</span>
        <input
          id={id}
          className="uname-input"
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          aria-describedby={`${id}-status`}
          aria-invalid={status.state === 'bad'}
          autoFocus={autoFocus}
        />
        {status.state === 'ok' && <Check size={18} strokeWidth={2} aria-hidden="true" className="uname-ok" />}
      </div>
      <p id={`${id}-status`} className={'uname-status' + (status.state === 'bad' ? ' is-bad' : '')} aria-live="polite">{status.text || '3 to 24 letters, numbers, _ or .'}</p>
      <style jsx>{`
        .uname { display: grid; gap: 6px; }
        .uname-box { display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--r-input); background: var(--card); }
        .uname-box:focus-within { border-color: var(--olive); outline: 2px solid var(--focus-ring); outline-offset: 2px; }
        .uname-input, .uname-input:focus { border: 0; box-shadow: none; background: transparent; padding: 0; }
        .uname-input:focus-visible { outline: none !important; }
        .uname-box.is-bad { border-color: var(--error); }
        .uname-at { color: var(--muted); font: 600 16px/1 var(--font-sans); }
        .uname-input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: var(--ink); font: 500 16px/1 var(--font-sans); }
        .uname-box :global(.uname-ok) { color: var(--olive-ink); flex: none; }
        .uname-status { margin: 0; color: var(--muted); font: 500 13px/1.4 var(--font-sans); }
        .uname-status.is-bad { color: var(--error); }
      `}</style>
    </div>
  );
}
