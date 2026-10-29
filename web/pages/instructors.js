import { useEffect, useState } from 'react';
import { Mail, School, ShieldOff } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { publicFetch } from '../lib/publicApi';
import { supabaseAuth } from '../lib/supabase';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const PENDING = 'cordiaInstructorPending';

// An instructor verifies a school email, then turns sharing off for a course.
export default function Instructors() {
  const [schoolText, setSchoolText] = useState('');
  const [school, setSchool] = useState(null);
  const [schools, setSchools] = useState([]);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Back from the email link: the access token is in the URL fragment.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get('access_token');
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      if (pending?.school) { setSchool(pending.school); setEmail(pending.email || ''); }
    } catch { /* storage blocked */ }
    if (access) {
      setToken(access);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (school || schoolText.trim().length < 2) { setSchools([]); return undefined; }
    const timer = setTimeout(async () => {
      const result = await publicFetch('/instructors/schools?q=' + encodeURIComponent(schoolText.trim()));
      setSchools(result.data?.schools || []);
    }, 200);
    return () => clearTimeout(timer);
  }, [schoolText, school]);

  async function sendLink(event) {
    event.preventDefault();
    if (!school || !email.trim()) return;
    setBusy(true);
    setError('');
    try { sessionStorage.setItem(PENDING, JSON.stringify({ school, email: email.trim() })); } catch { /* storage blocked */ }
    const { error: failed } = await supabaseAuth().signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + '/instructors', shouldCreateUser: true } });
    setBusy(false);
    if (failed) setError('Could not send the email');
    else setSent(true);
  }

  async function block(event) {
    event.preventDefault();
    if (!code.trim() || !school) return;
    setBusy(true);
    setError('');
    const result = await publicFetch('/instructors/block', { method: 'POST', token, body: JSON.stringify({ school_id: school.id, course_code: code.trim() }) });
    setBusy(false);
    if (result.ok) {
      setDone(result.data.code);
      try { sessionStorage.removeItem(PENDING); } catch { /* storage blocked */ }
    } else setError(typeof result.data?.detail === 'string' ? result.data.detail : 'Could not turn sharing off');
  }

  return (
    <PublicPage title="Instructors — Cordia Classroom" description="Turn off class sharing for your course." path="/instructors">
      <section className="ins">
        <h1 className="ins-title">Instructors</h1>
        <div className="ins-intro">
          <p>Students in the same course can share their study sets with each other. If you’d rather they didn’t for a course you teach, turn sharing off: sets already shared become private, and no new ones can be shared. Students can still study with their own materials.</p>
          <ol className="ins-steps">
            <li>Pick your school and enter your school email.</li>
            <li>Open the sign-in link we email you.</li>
            <li>Enter the course code, like MGT 300.</li>
          </ol>
        </div>
        <div className="ins-card">
          {done ? (
            <p className="ins-line" role="status"><ShieldOff {...ICON} />Sharing is off for {done}</p>
          ) : token ? (
            <form className="ins-form" onSubmit={block}>
              <p className="ins-line"><School {...ICON} />{school?.name}</p>
              <label className="ins-field">
                <span>Course code</span>
                <input className="c-input" value={code} onChange={event => setCode(event.target.value)} placeholder="MGT 300" autoFocus />
              </label>
              <button type="submit" className="c-btn c-btn--primary" disabled={busy || !code.trim()}>Turn off sharing</button>
            </form>
          ) : sent ? (
            <p className="ins-line" role="status"><Mail {...ICON} />Check {email} and open the link to continue.</p>
          ) : (
            <form className="ins-form" onSubmit={sendLink}>
              <label className="ins-field ins-school">
                <span>School</span>
                <input className="c-input" value={school ? school.name : schoolText} onChange={event => { setSchool(null); setSchoolText(event.target.value); }} autoComplete="organization" />
                {schools.length > 0 && (
                  <ul className="ins-suggest" role="listbox" aria-label="Schools">
                    {schools.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={() => { setSchool(item); setSchools([]); }}>{item.name}</button></li>)}
                  </ul>
                )}
              </label>
              <label className="ins-field">
                <span>School email</span>
                <input className="c-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" />
              </label>
              <button type="submit" className="c-btn c-btn--primary" disabled={busy || !school || !email.trim()}>Verify email</button>
            </form>
          )}
          {error && <p className="ins-error" role="alert">{error}</p>}
        </div>
      </section>
      <style jsx global>{`
        .ins { width: min(520px, 100%); margin: 0 auto; display: grid; gap: 24px; }
        .ins-title { margin: 0; font: 500 40px/1.08 'Newsreader', Georgia, serif; letter-spacing: -0.02em; }
        .ins-intro { display: grid; gap: 12px; color: var(--muted); font: 500 16px/1.55 var(--font-sans); }
        .ins-intro p { margin: 0; }
        .ins-steps { margin: 0; padding-left: 22px; display: grid; gap: 4px; }
        .ins-card { display: grid; gap: 16px; padding: 28px; border-radius: 28px; background: var(--surface-card); border: 1px solid var(--hairline); box-shadow: var(--shadow-float); -webkit-backdrop-filter: blur(28px) saturate(170%); backdrop-filter: blur(28px) saturate(170%); }
        .ins-form { display: grid; gap: 16px; }
        .ins-field { position: relative; display: grid; gap: 6px; font: 600 13px/1 var(--font-sans); }
        .ins-line { display: flex; align-items: center; gap: 10px; margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .ins-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .ins-suggest { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; margin: 4px 0 0; padding: 4px; list-style: none; border-radius: 16px; background: var(--surface-raised); box-shadow: var(--shadow-float); }
        .ins-suggest button { width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: none; font: 500 15px/1.3 var(--font-sans); text-align: left; cursor: pointer; color: var(--ink); }
        .ins-suggest button:hover { background: var(--lift-pane); box-shadow: var(--lg-highlight); }
      `}</style>
    </PublicPage>
  );
}
