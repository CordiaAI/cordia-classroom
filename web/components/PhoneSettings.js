import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { getRefreshToken, getToken, getUserEmail, getUserName, getUserPhone, setToken } from '../lib/api';
import { supabaseAuth } from '../lib/supabase';
import { formatPhone, normalizePhone } from '../lib/phone.mjs';
import { authMessage } from './AuthCard';

// Settings › Account: the phone number for text sign-in. Adding it here puts it on this
// account, so signing in by phone opens the same account instead of making a new one.
export default function PhoneSettings() {
  const [current, setCurrent] = useState('');
  const [step, setStep] = useState(null); // null | 'number' | 'code'
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => setCurrent(getUserPhone()), []);

  // Supabase changes the phone on the signed-in session; any refreshed tokens are kept.
  async function withSession() {
    const { data, error: sessionError } = await supabaseAuth().setSession({ access_token: getToken(), refresh_token: getRefreshToken() });
    if (sessionError || !data?.session) throw sessionError || new Error('session');
    if (data.session.access_token !== getToken()) setToken(data.session.access_token, getUserEmail(), data.session.refresh_token, getUserName());
  }

  async function sendCode(event) {
    event?.preventDefault();
    setError('');
    const number = normalizePhone(phone);
    if (!number) { setError('Enter your phone number with area code.'); return; }
    setBusy(true);
    try {
      await withSession();
      const { error: updateError } = await supabaseAuth().updateUser({ phone: number });
      if (updateError) throw updateError;
      setSentTo(number);
      setCode('');
      setStep('code');
    } catch (failure) {
      setError(/already|exists|registered/i.test(`${failure?.code} ${failure?.message}`) ? 'That number is already on another account.' : authMessage(failure));
    }
    setBusy(false);
  }

  async function verify(event) {
    event.preventDefault();
    setError('');
    const token = code.replace(/\D/g, '');
    if (token.length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true);
    const { data, error: verifyError } = await supabaseAuth().verifyOtp({ phone: sentTo, token, type: 'phone_change' });
    setBusy(false);
    if (verifyError || !data?.session) { setError(authMessage(verifyError || { message: 'invalid otp' })); return; }
    setToken(data.session.access_token, getUserEmail(), data.session.refresh_token, getUserName());
    setCurrent(getUserPhone());
    setStep(null);
    setNotice('Phone added. You can sign in with a texted code now.');
  }

  return (
    <div className="c-card settings-phone">
      <div className="settings-phone-head">
        <span className="settings-phone-label"><Smartphone size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">Phone</span></span>
        {!step && <button type="button" className="c-btn c-btn--secondary" onClick={() => { setStep('number'); setError(''); setNotice(''); }}>{current ? 'Change' : 'Add phone'}</button>}
      </div>
      <p className="c-meta">{current ? `${formatPhone(current)} · sign in with a texted code` : 'Add your number to sign in with a texted code.'}</p>
      {step === 'number' && (
        <form className="settings-phone-form" onSubmit={sendCode} noValidate>
          <input className="c-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" aria-label="Phone number" value={phone} onChange={event => setPhone(event.target.value)} autoFocus />
          <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
          <button type="button" className="c-btn c-btn--quiet" onClick={() => setStep(null)}>Cancel</button>
        </form>
      )}
      {step === 'code' && (
        <form className="settings-phone-form" onSubmit={verify} noValidate>
          <input className="c-input settings-phone-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} aria-label={`Code sent to ${formatPhone(sentTo)}`} placeholder="6-digit code" value={code} onChange={event => setCode(event.target.value)} autoFocus />
          <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
          <button type="button" className="c-btn c-btn--quiet" onClick={sendCode} disabled={busy}>Send a new code</button>
        </form>
      )}
      {error && <p className="settings-phone-error" role="alert">{error}</p>}
      {notice && <p className="settings-phone-notice" role="status">{notice}</p>}
      <style jsx>{`
        .settings-phone { display: grid; gap: 10px; padding: 16px 20px; }
        .settings-phone-label { display: inline-flex; align-items: center; gap: 10px; }
        .settings-phone-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .settings-phone .c-meta, .settings-phone-error, .settings-phone-notice { margin: 0; }
        .settings-phone-form { display: flex; flex-wrap: wrap; gap: 8px; }
        .settings-phone-form :global(.c-input) { flex: 1 1 200px; min-width: 0; }
        .settings-phone-code { letter-spacing: 0.3em; font-variant-numeric: tabular-nums; }
        .settings-phone-error { color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .settings-phone-notice { color: var(--olive-ink); font: 600 15px/1.4 var(--font-sans); }
      `}</style>
    </div>
  );
}
