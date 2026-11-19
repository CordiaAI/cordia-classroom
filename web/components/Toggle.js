import { useId } from 'react';

// An on/off switch. The label is the accessible name; the visual track is olive when on.
// With a description it is a setting row: the label and what it does on the left, the switch on the
// right. The description is read as the switch's description, not as part of its name.
export default function Toggle({ checked, onChange, label, description, disabled = false, hideLabel = false }) {
  const id = useId();
  return (
    <label className={'c-toggle' + (description ? ' c-toggle--row' : '') + (disabled ? ' is-disabled' : '')}>
      <span className="c-toggle-text">
        <span id={`${id}-label`} className={hideLabel ? 'sr-only' : 'c-toggle-label'}>{label}</span>
        {description && <span className="c-meta c-toggle-desc" id={`${id}-desc`}>{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined} onChange={event => onChange(event.target.checked)} />
      <span className="c-toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}
