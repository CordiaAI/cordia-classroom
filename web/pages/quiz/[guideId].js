import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, openUpgrade } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { PRO_TYPES, TYPE_LABELS } from '../../lib/retainEngine.mjs';
import QuizMode from '../../components/QuizMode';

const TYPE_HINTS = {
  mc: 'Pick the right answer',
  written: 'Explain in your own words',
  fill: 'Type the key term',
  matching: 'Drag terms to their answers',
};
const STORAGE_KEY = 'retainTypes';

function rememberedTypes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const valid = Array.isArray(saved) ? saved.filter(type => TYPE_LABELS[type]) : [];
    return valid.length ? valid : ['mc'];
  } catch {
    return ['mc'];
  }
}

export default function QuizPage() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [types, setTypes] = useState(['mc']);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    setTypes(rememberedTypes());
    apiFetch('/billing/status').then(data => {
      if (data?.features) setPlan({ pro: data.plan === 'classroom_plus' || data.unlimited, left: data.features.retain_types?.remaining ?? 0 });
    });
  }, [ready]);

  const proLocked = plan && !plan.pro && plan.left <= 0;

  // A remembered Pro type the account can no longer use is turned off rather than failing on Start.
  useEffect(() => {
    if (proLocked) setTypes(current => (current.some(type => !PRO_TYPES.includes(type)) ? current.filter(type => !PRO_TYPES.includes(type)) : ['mc']));
  }, [proLocked]);

  function toggle(type) {
    if (PRO_TYPES.includes(type) && proLocked && !types.includes(type)) {
      openUpgrade({ feature: 'retain_types' });
      return;
    }
    const next = types.includes(type) ? types.filter(item => item !== type) : [...types, type];
    setTypes(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* remembering is optional */ }
  }

  async function start() {
    setStarting(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/session`, { method: 'POST', body: JSON.stringify({ types }) });
    setStarting(false);
    if (data?.cards?.length) setSession({ ...data, selected: types, version: Date.now() });
    else setError(data?.detail || 'Retain could not start. Make sure this guide has questions and answers.');
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/regenerate`, { method: 'POST' });
    setRegenerating(false);
    if (data?.questions) setSession(null);
    else setError(data?.detail || 'Could not regenerate the questions.');
  }

  return (
    <div className="fade-in">
      <div className="retain-page-header">
        <div>
          <a href="#" onClick={e => { e.preventDefault(); router.back(); }} style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
            &larr; Back to Guide
          </a>
          <h2>Retain</h2>
        </div>
        <button className="btn-outline" onClick={regenerate} disabled={regenerating || starting}>
          {regenerating ? 'Regenerating...' : 'Regenerate questions'}
        </button>
      </div>
      {error && <div className="retain-action-error" role="alert">{error}</div>}

      {session ? (
        <QuizMode
          key={session.version}
          questions={session.questions}
          cards={session.cards}
          types={session.selected}
          guideId={guideId}
          onRestart={() => setSession(null)}
        />
      ) : (
        <section className="quiz-question-card retain-picker" aria-labelledby="retain-picker-title">
          <h3 id="retain-picker-title">How do you want to be quizzed?</h3>
          <p className="retain-hint">Pick one or more. Each question uses the type that fits it best, and short one-sentence answers stay multiple choice.</p>
          <div className="retain-type-grid" role="group" aria-label="Question types">
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const pro = PRO_TYPES.includes(type);
              const on = types.includes(type);
              return (
                <button key={type} type="button" className={'retain-type' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(type)}>
                  <strong>{label}</strong>
                  <small>{TYPE_HINTS[type]}</small>
                  {pro && plan && !plan.pro && (
                    <span className="retain-pro-badge">{plan.left > 0 ? 'Pro · free try' : 'Pro'}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="retain-hint">Miss a question and it comes back until you get it right two more times.</p>
          <button type="button" className="btn retain-start" onClick={start} disabled={starting || !types.length || !guideId}>
            {starting ? 'Preparing your questions…' : 'Start Retain'}
          </button>
        </section>
      )}
    </div>
  );
}
