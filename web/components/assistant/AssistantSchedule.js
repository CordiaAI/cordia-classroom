import { useEffect, useState } from 'react';
import Toggle from '../Toggle';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WINDOWS = { morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening' };

function TimeField({ label, value, min, max, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="c-field">
      <span>{label}</span>
      <input className="c-input" type="time" value={draft} min={min} max={max} onChange={event => setDraft(event.target.value)} onBlur={() => draft && draft !== value && onSave(draft)} />
    </label>
  );
}

export default function AssistantSchedule({ view, catalog, save, toast }) {
  const user = view.user;
  const style = view.style;
  const name = view.identity.assistant_name;
  const paused = user.paused_until && new Date(user.paused_until) > new Date();

  async function setSchedule(patch, done) {
    if (await save({ section: 'schedule', ...patch })) toast(done || 'Saved');
  }

  function toggleDay(day) {
    const next = user.days_off.includes(day) ? user.days_off.filter(d => d !== day) : [...user.days_off, day];
    setSchedule({ days_off: next });
  }

  function toggleWindow(key) {
    const next = user.checkin_windows.includes(key) ? user.checkin_windows.filter(w => w !== key) : [...user.checkin_windows, key];
    setSchedule({ checkin_windows: next });
  }

  function pauseFor(days) {
    setSchedule({ paused_until: new Date(Date.now() + days * 86400000).toISOString() }, `Paused for ${days === 7 ? 'a week' : `${days} days`}`);
  }

  return (
    <div className="c-stack">
      <div className="c-card asst-card">
        <h2 className="c-section-title">Your day</h2>
        <p className="c-meta">{name} plans around these and never texts first during quiet hours. Quiet hours always cover 9 PM to 8 AM.</p>
        <div className="asst-grid">
          <TimeField label="Usually up by" value={user.wake_time} onSave={value => setSchedule({ wake_time: value })} />
          <TimeField label="Usually asleep by" value={user.sleep_time} onSave={value => setSchedule({ sleep_time: value })} />
          <TimeField label="Quiet from" value={user.quiet_start} min="12:00" max="21:00" onSave={value => setSchedule({ quiet_start: value })} />
          <TimeField label="Quiet until" value={user.quiet_end} min="08:00" max="12:00" onSave={value => setSchedule({ quiet_end: value })} />
        </div>
        <div className="c-field">
          <span id="days-off">Days off</span>
          <div className="asst-chips" role="group" aria-labelledby="days-off">
            {DAYS.map((label, day) => (
              <button key={label} type="button" className="c-chip" aria-pressed={user.days_off.includes(day)} onClick={() => toggleDay(day)}>{label}</button>
            ))}
          </div>
          <span className="c-meta">{name} stays quiet on the days you pick.</span>
        </div>
        <div className="c-field">
          <span id="windows">Check-in times</span>
          <div className="asst-chips" role="group" aria-labelledby="windows">
            {catalog.checkin_windows.map(key => (
              <button key={key} type="button" className="c-chip" aria-pressed={user.checkin_windows.includes(key)} onClick={() => toggleWindow(key)}>{WINDOWS[key] || key}</button>
            ))}
          </div>
        </div>
        <div className="asst-actions asst-spread">
          <span className="c-meta">{paused ? `Paused until ${new Date(user.paused_until).toLocaleDateString([], { month: 'short', day: 'numeric' })}.` : 'Need a break? Pause check-ins. Reminders you set still come.'}</span>
          {paused ? (
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setSchedule({ paused_until: null }, 'Resumed')}>Resume</button>
          ) : (
            <div className="asst-actions">
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => pauseFor(1)}>Pause a day</button>
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => pauseFor(7)}>Pause a week</button>
            </div>
          )}
        </div>
      </div>

      <div className="c-card asst-card">
        <h2 className="c-section-title">Check-ins</h2>
        <p className="c-meta">What {name} texts you about first. Turning one off cancels any already scheduled.</p>
        <div className="asst-toggles">
          {catalog.nudge_kinds.map(kind => (
            <div key={kind.kind} className="asst-toggle-row">
              <Toggle label={kind.name} checked={style.kinds[kind.kind]} onChange={value => save({ section: 'nudges', kinds: { [kind.kind]: value } })} />
              <span className="c-meta">{kind.desc}</span>
            </div>
          ))}
        </div>
        <div className="c-field">
          <span id="per-day">Texts per day</span>
          <div className="c-seg asst-seg" role="group" aria-labelledby="per-day">
            {[0, 1, 2, 3, 4].map(n => (
              <button key={n} type="button" aria-pressed={style.max_per_day === n} className={style.max_per_day === n ? 'is-active' : ''} onClick={() => save({ section: 'nudges', max_per_day: n })}>{n === 0 ? 'As needed' : `${n} a day`}</button>
            ))}
          </div>
          <span className="c-meta">Replies and reminders you ask for never count.</span>
        </div>
        <div className="c-field">
          <span id="lead">Heads-up before events</span>
          <div className="c-seg asst-seg" role="group" aria-labelledby="lead">
            {catalog.lead_minutes.map(n => (
              <button key={n} type="button" aria-pressed={style.lead_minutes === n} className={style.lead_minutes === n ? 'is-active' : ''} onClick={() => save({ section: 'nudges', lead_minutes: n })}>{n === 60 ? '1 hour' : `${n} min`}</button>
            ))}
          </div>
        </div>
        {view.goals.length > 0 && (
          <div className="c-field">
            <span>Goals</span>
            <div className="c-list asst-flat-list">
              {view.goals.map(goal => (
                <div key={goal.id} className="c-list-row">
                  <span className="c-grow c-truncate">{goal.title}</span>
                  <select className="c-select asst-inline-select" aria-label={`How often to check in on ${goal.title}`} value={catalog.goal_frequencies.some(f => f.value === goal.cadence) ? goal.cadence : 'weekly'} onChange={event => save({ section: 'nudges', goal_frequency: { [goal.id]: event.target.value } })}>
                    {catalog.goal_frequencies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <span className="c-meta">Text {name} a new goal, like “I want to run 3 times a week”.</span>
          </div>
        )}
      </div>
    </div>
  );
}
