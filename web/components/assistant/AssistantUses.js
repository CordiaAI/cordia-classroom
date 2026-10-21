import Toggle from '../Toggle';

const CALENDARS = ['gcal', 'icloud_calendar'];

// What the student wants the Assistant for. Each choice turns on the texts that serve it.
export function UsesPicker({ catalog, value, onChange, disabled = false }) {
  const toggle = (id, on) => onChange(on ? [...value, id] : value.filter(use => use !== id));
  return (
    <div className="asst-toggles">
      {catalog.uses.map(use => (
        <div key={use.id} className="asst-toggle-row">
          <Toggle label={use.name} checked={value.includes(use.id)} disabled={disabled} onChange={on => toggle(use.id, on)} />
          <span className="c-meta">{use.desc}</span>
        </div>
      ))}
    </div>
  );
}

export default function AssistantUses({ view, catalog, save, onOpenApps }) {
  const uses = view.identity.uses;
  const name = view.identity.assistant_name;
  const hasCalendar = view.connections.some(c => CALENDARS.includes(c.provider) && c.status === 'active');
  return (
    <div className="c-stack">
      <div className="c-card asst-card">
        <div>
          <h2 className="c-section-title">What {name} helps with</h2>
          <p className="c-meta">Pick what you want texts about. You can always text {name} about anything; this decides what it texts you first.</p>
        </div>
        <UsesPicker catalog={catalog} value={uses} onChange={next => save({ section: 'uses', uses: next })} />
        {uses.includes('classes') && !hasCalendar && (
          <div className="asst-actions asst-spread">
            <span className="c-meta">Class reminders come from your calendar. Connect Google or Apple Calendar so {name} knows when they are.</span>
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={onOpenApps}>Connect a calendar</button>
          </div>
        )}
        {!uses.length && <p className="c-meta">With nothing picked, {name} only texts when you text it, plus reminders you ask for.</p>}
      </div>
    </div>
  );
}
