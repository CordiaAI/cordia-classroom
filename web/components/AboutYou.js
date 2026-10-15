import { useEffect, useState } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import { canvasStatus } from '../lib/canvas';
import CanvasConnectSheet from './CanvasConnectSheet';
import { apiFetch } from '../lib/api';
import { DAY_ONE, endWalkthrough, walkthroughEvent } from '../lib/walkthrough';
import { saveOnboardingStep } from '../lib/onboarding';

const LEVELS = [{ value: 'university', label: 'University' }, { value: 'high_school', label: 'High school' }];
const MAJORS = ['Nursing', 'Biology', 'Business', 'Psychology', 'Computer science', 'Engineering', 'Law', 'Education', 'History', 'Arts'];

// Day one, step 1: level, school and major as quick picks (moved out of sign-up).
export default function AboutYou() {
  const [level, setLevel] = useState('university');
  const [school, setSchool] = useState('');
  const [major, setMajor] = useState('');
  const [otherMajor, setOtherMajor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasConnected, setCanvasConnected] = useState(false);
  useEffect(() => { canvasStatus().then(data => { setCanvasReady(Boolean(data)); setCanvasConnected(Boolean(data?.connected)); }); }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try { localStorage.setItem('cordiaSchool', school.trim()); } catch { /* storage blocked */ }
    await apiFetch('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ education_level: level, university: school.trim(), major: level === 'university' ? major.trim() : '' }),
    });
    setSaving(false);
    walkthroughEvent('about-done');
  }

  function skip() {
    endWalkthrough('skipped');
    saveOnboardingStep('done');
  }

  return (
    <form className="about" onSubmit={save} aria-labelledby="about-title">
      <header className="about-head">
        <span className="c-meta">1 of {DAY_ONE.length}</span>
        <button type="button" className="c-btn c-btn--secondary about-skip" onClick={skip}>Skip</button>
      </header>
      <h1 id="about-title" className="c-title">About you</h1>

      <fieldset className="about-group">
        <legend className="c-section-title">Level</legend>
        <div className="c-chips">
          {LEVELS.map(item => <button key={item.value} type="button" className="c-chip about-chip" aria-pressed={level === item.value} onClick={() => setLevel(item.value)}>{item.label}</button>)}
        </div>
      </fieldset>

      <label className="c-field about-group">
        <span className="c-section-title">School</span>
        <input className="c-input" value={school} onChange={event => setSchool(event.target.value)} autoComplete="organization" placeholder={level === 'university' ? 'University' : 'High school'} />
      </label>

      {canvasReady && level === 'university' && (
        <div className="about-canvas">
          {canvasConnected
            ? <span className="c-chip about-chip" aria-pressed="true">Canvas connected</span>
            : <button type="button" className="c-chip about-chip" onClick={() => setCanvasOpen(true)}><Link2 size={16} strokeWidth={1.75} aria-hidden="true" />Connect Canvas</button>}
        </div>
      )}
      {canvasOpen && <CanvasConnectSheet school={school} onClose={() => setCanvasOpen(false)} onConnected={data => setCanvasConnected(Boolean(data?.connected))} />}

      {level === 'university' && (
        <fieldset className="about-group">
          <legend className="c-section-title">Major</legend>
          <div className="c-chips">
            {MAJORS.map(item => <button key={item} type="button" className="c-chip about-chip" aria-pressed={!otherMajor && major === item} onClick={() => { setOtherMajor(false); setMajor(item); }}>{item}</button>)}
            <button type="button" className="c-chip about-chip" aria-pressed={otherMajor} onClick={() => { setOtherMajor(true); setMajor(''); }}>Other</button>
          </div>
          {otherMajor && <input className="c-input about-other" value={major} onChange={event => setMajor(event.target.value)} aria-label="Major" placeholder="Major" autoFocus />}
        </fieldset>
      )}

      <button type="submit" className="c-btn c-btn--primary c-btn--lg about-next" disabled={saving}>
        {saving ? 'Saving…' : 'Continue'}<ArrowRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <style jsx>{`
        .about { display: grid; gap: 24px; width: min(560px, 100%); margin: 4vh auto 0; }
        .about-head { display: flex; align-items: center; justify-content: space-between; }
        .about-group { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; }
        .about-group legend { margin-bottom: 10px; }
        .about-group :global(.about-chip) { height: 44px; padding: 0 18px; font-size: 15px; }
        .about-other { margin-top: 4px; }
        .about-next { justify-self: start; min-width: 180px; }
        @media (max-width: 767px) { .about-next { width: 100%; } }
      `}</style>
    </form>
  );
}
