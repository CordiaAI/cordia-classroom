import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { assistantApi, formatPhone } from '../../lib/assistant';
import { UsesPicker } from './AssistantUses';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

const ZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
];

function guessZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ZONES.some(([id]) => id === zone) ? zone : 'America/New_York';
}

// Step 1: the number Cordia texts, proven with a texted code.
export function PhoneStep({ onDone }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode(event) {
    event?.preventDefault();
    if (phone.replace(/\D/g, '').length < 10) { setError('Enter your phone number with area code.'); return; }
    setBusy(true); setError('');
    const out = await assistantApi('/setup/code', { method: 'POST', json: { phone } });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That didn't send. Try again."); return; }
    setSent(true); setCode('');
  }

  async function verify(event) {
    event.preventDefault();
    setBusy(true); setError('');
    const out = await assistantApi('/setup/verify', { method: 'POST', json: { phone, code } });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That code didn't work. Check it or send a new one."); return; }
    onDone();
  }

  return (
    <div className="c-card asst-card">
      <div className="asst-intro">
        <MessageCircle {...ICON} />
        <div>
          <h2 className="c-section-title">Add your phone</h2>
          <p className="c-meta">Cordia texts you reminders, plans and check-ins, and answers when you text back.</p>
        </div>
      </div>
      {sent ? (
        <form className="asst-form" onSubmit={verify} noValidate>
          <label className="c-field">
            <span>Code sent to {formatPhone(phone)}</span>
            <input className="c-input asst-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
          </label>
          {error && <p className="asst-error" role="alert">{error}</p>}
          <div className="asst-actions">
            <button type="submit" className="c-btn c-btn--primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
            <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={sendCode}>Send a new code</button>
            <button type="button" className="c-btn c-btn--quiet" onClick={() => { setSent(false); setError(''); }}>Use a different number</button>
          </div>
        </form>
      ) : (
        <form className="asst-form" onSubmit={sendCode} noValidate>
          <label className="c-field">
            <span>Mobile number</span>
            <input className="c-input asst-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(555) 123-4567" value={phone} onChange={event => setPhone(formatPhone(event.target.value))} />
          </label>
          {error && <p className="asst-error" role="alert">{error}</p>}
          <div className="asst-actions">
            <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
          </div>
          <p className="c-meta">One text with a code. US numbers only. Msg &amp; data rates may apply.</p>
        </form>
      )}
    </div>
  );
}

// Step 2: age, the day's shape and the consents carriers review, word for word from the Assistant.
export function ProfileStep({ catalog, phoneLast4, onDone }) {
  const [form, setForm] = useState({ first_name: '', timezone: guessZone(), wake_time: '08:00', sleep_time: '23:00', adult: false, sms: false, personality: false, terms: false });
  const [uses, setUses] = useState(['assignments', 'classes', 'study']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (!form.adult) { setError('You need to be 18 or older to use the Assistant.'); return; }
    if (!form.sms) { setError('The Assistant works by text, so the texting consent is required.'); return; }
    if (!form.personality || !form.terms) { setError('Check every box to continue.'); return; }
    setBusy(true); setError('');
    const out = await assistantApi('/onboard', {
      method: 'POST',
      json: {
        step: 'profile',
        data: {
          adult: true,
          timezone: form.timezone,
          wake_time: form.wake_time,
          sleep_time: form.sleep_time,
          ...(form.first_name.trim() ? { first_name: form.first_name.trim() } : {}),
          uses,
          consents: { sms_informational: true, personality_data: true, terms: true },
        },
      },
    });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That didn't save. Try again."); return; }
    onDone();
  }

  return (
    <form className="c-card asst-card asst-form" onSubmit={submit} noValidate>
      <div>
        <h2 className="c-section-title">About your day</h2>
        <p className="c-meta">Texts go to the number ending in {phoneLast4}. Cordia never texts while you sleep.</p>
      </div>
      <div className="asst-grid">
        <label className="c-field"><span>First name</span><input className="c-input" maxLength={40} autoComplete="given-name" value={form.first_name} onChange={event => set('first_name', event.target.value)} /></label>
        <label className="c-field"><span>Time zone</span>
          <select className="c-select" value={form.timezone} onChange={event => set('timezone', event.target.value)}>
            {ZONES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="c-field"><span>Usually up by</span><input className="c-input" type="time" value={form.wake_time} onChange={event => set('wake_time', event.target.value)} /></label>
        <label className="c-field"><span>Usually asleep by</span><input className="c-input" type="time" value={form.sleep_time} onChange={event => set('sleep_time', event.target.value)} /></label>
      </div>
      <div className="asst-form">
        <div>
          <h3 className="asst-subtitle">What should Cordia help with?</h3>
          <p className="c-meta">You can change this any time in Settings.</p>
        </div>
        <UsesPicker catalog={catalog} value={uses} onChange={setUses} />
      </div>
      <div className="asst-checks">
        <label className="asst-check"><input type="checkbox" checked={form.adult} onChange={event => set('adult', event.target.checked)} /><span>I am 18 or older.</span></label>
        <label className="asst-check"><input type="checkbox" checked={form.sms} onChange={event => set('sms', event.target.checked)} /><span>{catalog.consents.sms}</span></label>
        <label className="asst-check"><input type="checkbox" checked={form.personality} onChange={event => set('personality', event.target.checked)} /><span>{catalog.consents.personality}</span></label>
        <label className="asst-check"><input type="checkbox" checked={form.terms} onChange={event => set('terms', event.target.checked)} /><span>I agree to the Cordia <a href="/assistant/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/assistant/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
      </div>
      {error && <p className="asst-error" role="alert">{error}</p>}
      <div className="asst-actions">
        <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Continue to survey'}</button>
      </div>
    </form>
  );
}

const SCALE = ['Very inaccurate', 'Moderately inaccurate', 'Neither', 'Moderately accurate', 'Very accurate'];

// The personality survey: setup's stages, or a retake from settings (`retake`).
export function SurveyStep({ items, stage = 1, retake = false, onDone, onCancel }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = items.every(item => answers[item.id]);

  async function submit(event) {
    event.preventDefault();
    if (!done) { setError('Answer every statement to continue.'); return; }
    setBusy(true); setError('');
    const responses = Object.fromEntries(items.map(item => [String(item.id), answers[item.id]]));
    const out = retake
      ? await assistantApi('/survey', { method: 'POST', json: { responses } })
      : await assistantApi('/onboard', { method: 'POST', json: { step: 'survey', data: { responses } } });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That didn't save. Try again."); return; }
    setAnswers({});
    onDone(out.data);
  }

  return (
    <form className="c-card asst-card asst-form" onSubmit={submit} noValidate>
      <div>
        <h2 className="c-section-title">{stage === 2 ? 'A few more' : 'How do you work?'}</h2>
        <p className="c-meta">How accurately does each describe you? It tunes how Cordia coaches you, and you can change any of it after.</p>
      </div>
      <ol className="asst-survey">
        {items.map(item => (
          <li key={item.id}>
            <fieldset>
              <legend>{item.text}</legend>
              <div className="c-seg asst-scale" role="radiogroup" aria-label={item.text}>
                {SCALE.map((label, index) => (
                  <button key={label} type="button" role="radio" aria-checked={answers[item.id] === index + 1} className={answers[item.id] === index + 1 ? 'is-active' : ''} onClick={() => setAnswers(current => ({ ...current, [item.id]: index + 1 }))}>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {error && <p className="asst-error" role="alert">{error}</p>}
      <div className="asst-actions">
        <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Saving…' : retake ? 'Save answers' : 'Continue'}</button>
        {onCancel && <button type="button" className="c-btn c-btn--secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
