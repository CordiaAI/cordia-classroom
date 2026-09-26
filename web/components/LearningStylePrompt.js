import { useState } from 'react';
import LearningStylePicker from './LearningStylePicker';
import { useLearningStyle } from '../lib/learningStyle';

// Asked once, on the first visit after sign-in. Skipping keeps Classroom's standard behavior.
export default function LearningStylePrompt() {
  const { learningStyle, saveStyle } = useLearningStyle();
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState(false);
  if (closed || !learningStyle?.enabled || learningStyle.prompted) return null;

  async function choose(style) {
    setSaving(true);
    await saveStyle(style);
    setSaving(false);
    setClosed(true);
  }

  return (
    <div className="learning-style-prompt-backdrop">
      <section className="learning-style-prompt" role="dialog" aria-modal="true" aria-labelledby="learning-style-title">
        <h2 id="learning-style-title">How do you like to study?</h2>
        <p>Pick what feels right. Guides and Tutor will start there, every tool stays one click away, and you can change this anytime in Settings.</p>
        <LearningStylePicker value={null} onSelect={choose} disabled={saving} />
        <button type="button" className="btn-outline learning-style-skip" onClick={() => choose(null)} disabled={saving}>
          Skip for now
        </button>
      </section>
    </div>
  );
}
