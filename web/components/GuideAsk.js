import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { askGuide } from '../lib/socialActivity';

// Ask the Tutor about this guide (Stage 10). It answers only from this guide's outline and
// questions, names the ideas it used, and says plainly when the guide doesn't cover something.
// "Explain more" asks again for a fuller answer. Each answer uses the student's Tutor allowance.
export default function GuideAsk({ guideId }) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [result, setResult] = useState(null); // { covered, answer, cited, detail } | { error }
  const [busy, setBusy] = useState('');

  async function ask(text, detail) {
    if (!text.trim() || busy) return;
    setBusy(detail);
    setAsked(text.trim());
    const data = await askGuide(guideId, text.trim(), detail);
    setBusy('');
    setResult({ ...data, detail });
  }

  return (
    <section className="c-card ga" aria-labelledby="ga-title">
      <h2 id="ga-title" className="ga-title"><MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />Ask about this guide</h2>
      <form className="ga-form" onSubmit={event => { event.preventDefault(); ask(question, 'short'); }}>
        <label htmlFor="ga-question" className="ga-label">Your question</label>
        <div className="ga-row">
          <input id="ga-question" className="c-input ga-input" value={question} maxLength={1000} onChange={event => setQuestion(event.target.value)} placeholder="What does this guide say about…" />
          <button type="submit" className="c-btn c-btn--primary" disabled={!question.trim() || Boolean(busy)} aria-busy={busy === 'short'}>{busy === 'short' ? 'Asking…' : 'Ask'}</button>
        </div>
      </form>
      <div aria-live="polite">
        {result?.error && <p className="ga-error" role="alert">{result.error}</p>}
        {result && !result.error && (
          <div className={'ga-answer' + (result.covered ? '' : ' is-uncovered')}>
            <p className="c-meta ga-asked">{asked}</p>
            {result.answer.split(/\n{2,}/).map((part, index) => <p key={index}>{part}</p>)}
            {result.cited?.length > 0 && (
              <p className="c-meta ga-cited">From this guide: {result.cited.map(item => `“${item.question}”`).join(', ')}</p>
            )}
            {result.covered && result.detail === 'short' && (
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => ask(asked, 'long')} disabled={Boolean(busy)} aria-busy={busy === 'long'}>
                {busy === 'long' ? 'Explaining…' : 'Explain more'}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="c-meta ga-note">Answers come only from this guide. Uses your Tutor answers.</p>
      <style jsx>{`
        .ga { display: grid; gap: 12px; padding: 16px; }
        .ga-title { display: flex; align-items: center; gap: 8px; margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .ga-title :global(svg) { color: var(--olive-ink); }
        .ga-form { display: grid; gap: 6px; }
        .ga-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .ga-row { display: flex; gap: 8px; }
        .ga-input { flex: 1; min-width: 0; }
        .ga-answer { display: grid; gap: 8px; justify-items: start; padding: 12px 14px; border-radius: var(--r-input); background: var(--olive-tint); color: var(--ink); font: 500 15px/1.5 var(--font-sans); }
        .ga-answer.is-uncovered { background: transparent; border: 1px solid var(--line); }
        .ga-answer p { margin: 0; overflow-wrap: anywhere; }
        .ga-asked { font-weight: 600; }
        .ga-cited { font-size: 13px; }
        .ga-error { margin: 0; color: var(--error); font: 600 14px/1.4 var(--font-sans); }
        .ga-note { margin: 0; }
        @media (max-width: 480px) { .ga-row { flex-direction: column; } }
      `}</style>
    </section>
  );
}
