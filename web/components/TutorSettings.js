import { useEffect, useState } from 'react';
import ExplanationPreference from './ExplanationPreference';
import { TUTOR_MODES, setTutorMode, tutorMode } from '../lib/tutorPrefs';

// Settings › Tutor: how the Tutor works in every chat.
export default function TutorSettings() {
  const [mode, setMode] = useState('');
  useEffect(() => setMode(tutorMode()), []);

  function pick(id) {
    setMode(id);
    setTutorMode(id);
  }

  return (
    <>
      <div className="c-card settings-card">
        <h2 className="c-section-title">Tutor mode</h2>
        <p className="c-meta settings-note">Used in every chat. The Tutor opens on a new chat each time; earlier ones are under Past chats.</p>
        <div className="c-seg tutor-mode-picker" role="radiogroup" aria-label="Tutor mode">
          {TUTOR_MODES.map(item => (
            <button key={item.id || 'auto'} type="button" role="radio" aria-checked={mode === item.id} onClick={() => pick(item.id)} title={item.detail}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="c-meta settings-note">{TUTOR_MODES.find(item => item.id === mode)?.detail}</p>
      </div>
      <div className="c-card settings-card"><ExplanationPreference /></div>
      <style jsx>{`
        .settings-card { display: grid; gap: 12px; padding: 20px; }
        .settings-note { margin: -4px 0 0; }
        .tutor-mode-picker { justify-self: start; flex-wrap: wrap; }
      `}</style>
    </>
  );
}
