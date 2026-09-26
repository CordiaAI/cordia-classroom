import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { AID_TABS, defaultAidTab } from '../lib/learningStyle';
import MermaidDiagram from './MermaidDiagram';

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function blankMatches(attempt, answer) {
  const typed = normalize(attempt);
  const expected = normalize(answer);
  if (!typed) return false;
  return typed === expected || (typed.length >= 3 && (expected.includes(typed) || typed.includes(expected)));
}

function useStudyAid(guideId, number, mode, cache) {
  const [state, setState] = useState(() => cache.current[mode] || { loading: true });
  useEffect(() => {
    if (cache.current[mode]?.data) { setState(cache.current[mode]); return; }
    let active = true;
    setState({ loading: true });
    apiFetch('/study-aids', {
      method: 'POST',
      body: JSON.stringify({ guide_id: guideId, number, mode }),
      timeoutMs: 45000,
    }).then(data => {
      const next = data?.mode === mode
        ? { data }
        : { error: apiErrorMessage(data?.detail, 'This view could not be built right now.') };
      if (next.data) cache.current[mode] = next;
      if (active) setState(next);
    });
    return () => { active = false; };
  }, [guideId, number, mode]);
  return state;
}

function Blanks({ blanks, onDone }) {
  const [values, setValues] = useState({});
  const [checked, setChecked] = useState(false);
  if (!blanks?.length) return null;
  return (
    <div className="study-aid-blanks">
      {blanks.map(blank => {
        const correct = checked && blankMatches(values[blank.number], blank.answer);
        return (
          <label key={blank.number} className="study-aid-blank">
            <span>({blank.number})</span>
            <input
              value={values[blank.number] || ''}
              onChange={event => { setChecked(false); setValues(prev => ({ ...prev, [blank.number]: event.target.value })); }}
              aria-label={`Blank ${blank.number}`}
            />
            {checked && <em className={correct ? 'correct' : 'incorrect'}>{correct ? 'Correct' : `Answer: ${blank.answer}`}</em>}
          </label>
        );
      })}
      <div className="study-aid-actions">
        <button type="button" className="btn" onClick={() => { setChecked(true); onDone?.(); }}>Check</button>
        {checked && <button type="button" className="btn-outline" onClick={() => { setValues({}); setChecked(false); }}>Try again</button>}
      </div>
    </div>
  );
}

function CheckedAttempt({ guideId, number, mode, task, placeholder, allowSpeech = false }) {
  const [attempt, setAttempt] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

  useEffect(() => () => recognitionRef.current?.stop(), []);

  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = event => {
      const spoken = Array.from(event.results).map(result => result[0].transcript).join(' ');
      setAttempt(prev => (prev ? prev + ' ' : '') + spoken);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function submit() {
    setBusy(true);
    const data = await apiFetch('/study-aids/check', {
      method: 'POST',
      body: JSON.stringify({ guide_id: guideId, number, mode, attempt }),
      timeoutMs: 30000,
    });
    setBusy(false);
    setResult(data?.verdict ? data : { error: apiErrorMessage(data?.detail, 'Cordia could not check this right now.') });
  }

  return (
    <div className="study-aid-attempt">
      <p className="study-aid-task"><strong>Your turn:</strong> {task}</p>
      <textarea value={attempt} onChange={event => setAttempt(event.target.value)} placeholder={placeholder} rows={3} maxLength={2000} />
      <div className="study-aid-actions">
        <button type="button" className="btn" onClick={submit} disabled={busy || !attempt.trim()}>{busy ? 'Checking…' : 'Check my answer'}</button>
        {allowSpeech && Recognition && (
          <button type="button" className="btn-outline" onClick={toggleListening}>{listening ? 'Stop' : 'Say it'}</button>
        )}
        {result?.verdict && result.verdict !== 'got_it' && (
          <button type="button" className="btn-outline" onClick={() => setResult(null)}>Try again</button>
        )}
      </div>
      {result?.error && <p className="study-aid-error" role="alert">{result.error}</p>}
      {result?.verdict && (
        <p className={`study-aid-feedback ${result.verdict}`} role="status">
          <strong>{result.verdict === 'got_it' ? 'Got it. ' : result.verdict === 'partly' ? 'Almost. ' : 'Not yet. '}</strong>
          {result.feedback}
        </p>
      )}
    </div>
  );
}

function AidState({ state, children }) {
  if (state.loading) return <p className="study-aid-status">Building this view…</p>;
  if (state.error) return <p className="study-aid-error" role="alert">{state.error}</p>;
  return children(state.data);
}

function VisualAid({ guideId, number, cache }) {
  const state = useStudyAid(guideId, number, 'visual', cache);
  const [practice, setPractice] = useState(false);
  return (
    <AidState state={state}>
      {data => (
        <div>
          {data.caption && <p className="study-aid-caption">{data.caption}</p>}
          <MermaidDiagram code={practice ? data.practice_mermaid : data.mermaid} label={data.caption || 'Concept diagram'} />
          {practice ? (
            <>
              <p className="study-aid-task"><strong>Your turn:</strong> fill in the numbered boxes from memory.</p>
              <Blanks blanks={data.blanks} />
              <button type="button" className="btn-outline" onClick={() => setPractice(false)}>Show full diagram</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setPractice(true)}>Complete the diagram</button>
          )}
        </div>
      )}
    </AidState>
  );
}

function AuralAid({ guideId, number, cache }) {
  const state = useStudyAid(guideId, number, 'aural', cache);
  const [speaking, setSpeaking] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, []);

  function toggleSpeech(script) {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <AidState state={state}>
      {data => (
        <div>
          <div className="study-aid-actions">
            {canSpeak && <button type="button" className="btn" onClick={() => toggleSpeech(data.script)}>{speaking ? 'Stop' : 'Listen'}</button>}
            <button type="button" className="btn-outline" onClick={() => setShowWords(value => !value)}>{showWords || !canSpeak ? 'Hide words' : 'Show words'}</button>
          </div>
          {(showWords || !canSpeak) && <p className="study-aid-script">{data.script}</p>}
          <CheckedAttempt guideId={guideId} number={number} mode="aural" task={data.task} placeholder="Explain it in your own words, typed or spoken…" allowSpeech />
        </div>
      )}
    </AidState>
  );
}

function ReadWriteAid({ guideId, number, cache }) {
  const state = useStudyAid(guideId, number, 'read_write', cache);
  return (
    <AidState state={state}>
      {data => (
        <div>
          <ul className="study-aid-notes">{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          {data.key_terms?.length > 0 && (
            <dl className="study-aid-terms">
              {data.key_terms.map(term => (
                <div key={term.term}><dt>{term.term}</dt><dd>{term.meaning}</dd></div>
              ))}
            </dl>
          )}
          {data.blanks?.length > 0 && (
            <>
              <p className="study-aid-task"><strong>Your turn:</strong> complete the summary.</p>
              <p className="study-aid-script">{data.practice_summary}</p>
              <Blanks blanks={data.blanks} />
            </>
          )}
        </div>
      )}
    </AidState>
  );
}

function KinestheticAid({ guideId, number, cache }) {
  const state = useStudyAid(guideId, number, 'kinesthetic', cache);
  return (
    <AidState state={state}>
      {data => (
        <div>
          <p className="study-aid-example"><strong>Example:</strong> {data.example}</p>
          <CheckedAttempt guideId={guideId} number={number} mode="kinesthetic" task={data.task} placeholder="Apply the idea here…" />
        </div>
      )}
    </AidState>
  );
}

const AIDS = { visual: VisualAid, aural: AuralAid, read_write: ReadWriteAid, kinesthetic: KinestheticAid };

export default function StudyAidPanel({ guideId, number, style, onClose }) {
  const [tab, setTab] = useState(defaultAidTab(style));
  const cache = useRef({});
  const Aid = AIDS[tab];
  return (
    <section className="study-aid-panel" aria-label="Learn it your way">
      <div className="study-aid-tabs" role="tablist">
        {AID_TABS.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            className={'study-aid-tab' + (tab === option.id ? ' active' : '')}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" className="study-aid-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      {tab === 'mix' ? (
        <div className="study-aid-mix">
          <VisualAid key={`${number}-visual`} guideId={guideId} number={number} cache={cache} />
          <KinestheticAid key={`${number}-kinesthetic`} guideId={guideId} number={number} cache={cache} />
        </div>
      ) : (
        <Aid key={`${number}-${tab}`} guideId={guideId} number={number} cache={cache} />
      )}
    </section>
  );
}
