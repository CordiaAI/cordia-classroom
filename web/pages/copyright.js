import { useState } from 'react';
import PublicPage from '../components/PublicPage';
import { publicFetch } from '../lib/publicApi';

const CONTACT = 'copyright@cordiacode.com';

// Takedown requests. A named set is hidden at once, pending review.
export default function Copyright() {
  const [form, setForm] = useState({ name: '', email: '', work: '', location: '', statement: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const ready = form.name.trim() && form.email.trim() && form.work.trim() && form.location.trim() && form.statement;

  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    const result = await publicFetch('/copyright/takedown', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(typeof result.data?.detail === 'string' ? result.data.detail : 'Could not send. Email us instead.');
  }

  return (
    <PublicPage title="Copyright — Cordia Classroom" description="Report shared material that uses your work without permission." path="/copyright">
      <section className="cr">
        <h1 className="cr-title">Copyright</h1>
        <div className="cr-card">
          {done ? (
            <p className="cr-line" role="status">Received</p>
          ) : (
            <form className="cr-form" onSubmit={submit}>
              <label className="cr-field"><span>Name</span><input className="c-input" value={form.name} onChange={set('name')} autoComplete="name" /></label>
              <label className="cr-field"><span>Email</span><input className="c-input" type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
              <label className="cr-field"><span>Your work</span><textarea className="c-input" rows={3} value={form.work} onChange={set('work')} /></label>
              <label className="cr-field"><span>Link to the set</span><input className="c-input" value={form.location} onChange={set('location')} inputMode="url" /></label>
              <label className="cr-check">
                <input type="checkbox" checked={form.statement} onChange={set('statement')} />
                <span>I own this work or act for its owner, and I believe in good faith this use isn't authorized.</span>
              </label>
              {error && <p className="cr-error" role="alert">{error}</p>}
              <button type="submit" className="c-btn c-btn--primary" disabled={!ready || busy}>Send</button>
            </form>
          )}
          <a className="cr-contact" href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </div>
      </section>
      <style jsx global>{`
        .cr { width: min(560px, 100%); margin: 0 auto; display: grid; gap: 24px; }
        .cr-title { margin: 0; font: 500 40px/1.08 'Newsreader', Georgia, serif; letter-spacing: -0.02em; }
        .cr-card { display: grid; gap: 16px; padding: 28px; border-radius: 28px; background: var(--surface-card); border: 1px solid var(--hairline); box-shadow: var(--shadow-float); -webkit-backdrop-filter: blur(28px) saturate(170%); backdrop-filter: blur(28px) saturate(170%); }
        .cr-form { display: grid; gap: 16px; }
        .cr-field { display: grid; gap: 6px; font: 600 13px/1 var(--font-sans); }
        .cr-field textarea { min-height: 96px; padding-top: 12px; resize: vertical; }
        .cr-check { display: flex; gap: 10px; align-items: flex-start; font: 500 15px/1.45 var(--font-sans); cursor: pointer; }
        .cr-check input { margin-top: 3px; width: 20px; height: 20px; flex: 0 0 auto; accent-color: var(--olive); }
        .cr-line { margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .cr-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .cr-contact { justify-self: start; color: var(--ink); font: 600 15px/1 var(--font-sans); }
      `}</style>
    </PublicPage>
  );
}
