// An on/off switch. The label is the accessible name; the visual track is olive when on.
export default function Toggle({ checked, onChange, label, disabled = false, hideLabel = false }) {
  return (
    <label className={'c-toggle' + (disabled ? ' is-disabled' : '')}>
      <span className={hideLabel ? 'sr-only' : 'c-toggle-label'}>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="c-toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}
