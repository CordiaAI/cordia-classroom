import { useEffect, useState } from 'react';
import { setPref, useProgress } from '../lib/progress';
import { FEEDBACK, cleanFeedback, prefKey } from '../lib/submitQuiz.mjs';
import SegmentedControl from './SegmentedControl';

// "Show if I'm right" for a mode ('quiz' or 'timed'): the last choice, saved on the account with a
// copy in the browser (lib/progress.js). Quiz starts on "After each question", the Timed test on
// "When I submit".
export function useFeedbackChoice(mode) {
  const saved = useProgress().prefs?.[prefKey(mode)];
  const [value, setValue] = useState(() => cleanFeedback(saved, mode));
  useEffect(() => { setValue(cleanFeedback(saved, mode)); }, [saved, mode]);
  function choose(next) {
    setValue(next);
    setPref(prefKey(mode), next);
  }
  return [value, choose];
}

export default function FeedbackChoice({ value, onChange, id = 'feedback-choice' }) {
  return (
    <div className="fb-choice">
      <span id={id} className="fb-label">Show if I&rsquo;m right</span>
      <SegmentedControl kind="radio" labelledBy={id} className="fb-seg">
        {Object.entries(FEEDBACK).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} className={value === key ? 'is-active' : ''} onClick={() => onChange(key)}>{label}</button>
        ))}
      </SegmentedControl>
      <style jsx>{`
        .fb-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
        .fb-label { font: 600 15px/1.3 var(--font-sans); color: var(--ink); }
      `}</style>
    </div>
  );
}
