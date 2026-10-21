import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { setDeadlineDone } from '../lib/canvas';

// A deadline's checkbox. Saves right away; puts the box back if the save fails.
export default function DoneCheck({ id, title, done, onChange }) {
  const [checked, setChecked] = useState(Boolean(done));
  useEffect(() => setChecked(Boolean(done)), [done]);

  async function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    const next = !checked;
    setChecked(next);
    onChange?.(next);
    if (!(await setDeadlineDone(id, next))) {
      setChecked(!next);
      onChange?.(!next);
    }
  }

  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={`${checked ? 'Mark not done' : 'Mark done'}: ${title}`} className={'done-check' + (checked ? ' is-done' : '')} onClick={toggle}>
      {checked && <Check size={16} strokeWidth={2.25} aria-hidden="true" />}
      <style jsx>{`
        .done-check { flex: 0 0 auto; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 2px solid var(--muted); border-radius: 8px; background: transparent; color: var(--on-olive); cursor: pointer; transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease); }
        .done-check:hover { border-color: var(--olive); }
        .done-check:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .done-check.is-done { background: var(--olive); border-color: var(--olive); }
        .done-check::before { content: ''; position: absolute; inset: -9px; }
        .done-check { position: relative; }
      `}</style>
    </button>
  );
}
