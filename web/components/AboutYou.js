import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { apiFetch } from '../lib/api';
import { walkthroughEvent } from '../lib/walkthrough';

const LEVELS = [{ value: 'university', label: 'University' }, { value: 'high_school', label: 'High school' }];
// "Help me remember" hooks after a miss use these two (backend services/onboarding_questions.py).
const MEMORY_STYLES = [
  { value: 'funny', label: 'Make it funny' },
  { value: 'link', label: 'Link it to something I know' },
  { value: 'rhyme', label: 'A rhyme or catchy line' },
  { value: 'picture', label: 'A picture in my head' },
  { value: 'letters', label: 'First letters, like ROY G BIV' },
];
const INTERESTS = [
  { value: 'sports', label: 'Sports' }, { value: 'music', label: 'Music' }, { value: 'gaming', label: 'Gaming' },
  { value: 'movies_tv', label: 'Movies & TV' }, { value: 'food', label: 'Food' }, { value: 'outdoors', label: 'Outdoors' },
  { value: 'art_design', label: 'Art & design' }, { value: 'fashion', label: 'Fashion' }, { value: 'tech', label: 'Tech' },
  { value: 'animals', label: 'Animals' }, { value: 'books', label: 'Books' }, { value: 'travel', label: 'Travel' },
];
const MAX_INTERESTS = 3;
const MAJORS = ['Nursing', 'Biology', 'Business', 'Psychology', 'Computer science', 'Engineering', 'Law', 'Education', 'History', 'Arts'];

// First run, while the first guide builds: level, school, major, how they like to remember things
// and what they're into, as quick picks, so the questions fill the wait instead of delaying the
// start. Skip just moves on.
export default function AboutYou({ index = 1, total = 4 }) {
  const [level, setLevel] = useState('university');
  const [school, setSchool] = useState('');
  const [major, setMajor] = useState('');
  const [otherMajor, setOtherMajor] = useState(false);
  const [memoryStyle, setMemoryStyle] = useState('');
  const [interests, setInterests] = useState([]);
  const [saving, setSaving] = useState(false);

  function toggleInterest(value) {
    setInterests(current => current.includes(value)
      ? current.filter(item => item !== value)
      : current.length < MAX_INTERESTS ? [...current, value] : current);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try { localStorage.setItem('cordiaSchool', school.trim()); } catch { /* storage blocked */ }
    await apiFetch('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ education_level: level, university: school.trim(), major: level === 'university' ? major.trim() : '' }),
    });
    const answers = [
      memoryStyle && { question_id: 'memory_style', version: 1, answer: { value: memoryStyle }, source: 'onboarding' },
      interests.length && { question_id: 'interests', version: 1, answer: { value: interests }, source: 'onboarding' },
    ].filter(Boolean);
    // Never holds up onboarding: a hook without these answers just uses the defaults.
    if (answers.length) apiFetch('/onboarding/answers', { method: 'POST', body: JSON.stringify({ answers }) }).catch(() => {});
    setSaving(false);
    walkthroughEvent('about-done');
  }

  return (
    <BodyPortal>
    <div className="c-scrim">
    <form className="c-sheet about" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="about-title">
      <header className="about-head">
        <span className="c-meta">{index + 1} of {total}</span>
        <button type="button" className="c-btn c-btn--secondary about-skip" onClick={() => walkthroughEvent('about-done')}>Skip</button>
      </header>
      <h1 id="about-title" className="c-title">While it builds: about you</h1>

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

      <fieldset className="about-group">
        <legend className="c-section-title">How do you like to remember things?</legend>
        <div className="c-chips">
          {MEMORY_STYLES.map(item => <button key={item.value} type="button" className="c-chip about-chip" aria-pressed={memoryStyle === item.value} onClick={() => setMemoryStyle(memoryStyle === item.value ? '' : item.value)}>{item.label}</button>)}
        </div>
      </fieldset>

      <fieldset className="about-group">
        <legend className="c-section-title">What are you into? <span className="c-meta about-hint">Pick up to {MAX_INTERESTS}</span></legend>
        <div className="c-chips">
          {INTERESTS.map(item => {
            const on = interests.includes(item.value);
            return <button key={item.value} type="button" className="c-chip about-chip" aria-pressed={on} disabled={!on && interests.length >= MAX_INTERESTS} onClick={() => toggleInterest(item.value)}>{item.label}</button>;
          })}
        </div>
      </fieldset>

      <button type="submit" className="c-btn c-btn--primary c-btn--lg about-next" disabled={saving}>
        {saving ? 'Saving…' : 'Continue'}<ArrowRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <style jsx>{`
        .about { display: grid; gap: 24px; width: min(560px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; }
        .about-head { display: flex; align-items: center; justify-content: space-between; }
        .about-group { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; }
        .about-group legend { margin-bottom: 10px; }
        .about-group :global(.about-chip) { height: 44px; padding: 0 18px; font-size: 15px; }
        .about-group :global(.about-chip:disabled) { opacity: 0.45; cursor: default; }
        .about-hint { margin-left: 6px; font-weight: 400; }
        .about-other { margin-top: 4px; }
        .about-next { justify-self: start; min-width: 180px; }
        @media (max-width: 767px) { .about-next { width: 100%; } }
      `}</style>
    </form>
    </div>
    </BodyPortal>
  );
}
