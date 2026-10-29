import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { loadFolders } from '../lib/folders';
import { logAnswer } from '../lib/learningEvents';
import { answerTimer } from '../lib/learningEvents.mjs';

export default function NCLEXQuizMode({ questions, guideId, onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState(null);       // MCQ: selected index (int)
  const [sataSelected, setSataSelected] = useState([]); // SATA: array of selected indices
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveFolderId, setSaveFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'

  const q = questions[currentIndex];
  const isSata = q.type === 'sata';
  // Each question is timed from when it shows to the answer (select-all: to Submit).
  const timer = useRef(null);
  useEffect(() => { timer.current = answerTimer(() => performance.now(), document.hidden); }, [currentIndex, questions]);
  useEffect(() => {
    const onVisibility = () => timer.current?.visibility(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  function logNclex(isCorrect) {
    logAnswer({ guideId, question: q.stem, mode: 'nclex', type: 'mc', credit: isCorrect ? 1 : 0, timing: timer.current?.done() });
  }

  function toggleSata(i) {
    if (answered) return;
    setSataSelected(prev =>
      prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
    );
  }

  function submitSata() {
    if (answered || sataSelected.length === 0) return;
    const correctSet = new Set(q.correct_indices);
    const selectedSet = new Set(sataSelected);
    const isCorrect =
      correctSet.size === selectedSet.size &&
      [...correctSet].every(i => selectedSet.has(i));
    logNclex(isCorrect);

    const newAnswers = [...answers, {
      question_index: currentIndex,
      selected_indices: sataSelected,
      is_correct: isCorrect
    }];
    setAnswers(newAnswers);
    setAnswered(true);

    if (currentIndex === questions.length - 1) {
      submitQuiz(newAnswers);
    }
  }

  function selectMcq(i) {
    if (answered) return;
    setSelected(i);
    const isCorrect = q.correct_indices.includes(i);
    logNclex(isCorrect);
    const newAnswers = [...answers, {
      question_index: currentIndex,
      selected_indices: [i],
      is_correct: isCorrect
    }];
    setAnswers(newAnswers);
    setAnswered(true);

    if (currentIndex === questions.length - 1) {
      submitQuiz(newAnswers);
    }
  }

  function nextQuestion() {
    setCurrentIndex(currentIndex + 1);
    setSelected(null);
    setSataSelected([]);
    setAnswered(false);
  }

  async function submitQuiz(finalAnswers) {
    const data = await apiFetch('/nclex/' + guideId + '/submit', {
      method: 'POST',
      body: JSON.stringify({ answers: finalAnswers })
    });
    setScore(data);
    setDone(true);
    if (onComplete) onComplete(data);
  }

  function retake() {
    setCurrentIndex(0);
    setSelected(null);
    setSataSelected([]);
    setAnswered(false);
    setAnswers([]);
    setDone(false);
    setScore(null);
  }

  async function openSaveForm() {
    setShowSave(true);
    setSaveTitle('NCLEX Practice — ' + new Date().toLocaleDateString());
    const data = await loadFolders();
    if (data?.folders) setFolders(data.folders);
  }

  async function saveAsGuide() {
    if (!saveTitle.trim()) return;
    setSaveStatus('saving');

    // Format NCLEX questions as Q/A study guide
    const studyGuide = questions.map((q, i) => {
      const correctAnswers = q.correct_indices.map(ci => q.options[ci]).join('; ');
      return `Q${i + 1}: ${q.stem}\nA${i + 1}: ${correctAnswers} — ${q.rationale || ''}`;
    }).join('\n');

    // One flashcard per question
    const flashcards = questions.map(q => ({
      front: q.stem,
      back: q.correct_indices.map(ci => q.options[ci]).join('; ') + (q.rationale ? ' — ' + q.rationale : '')
    }));

    const body = {
      title: saveTitle.trim(),
      study_guide: studyGuide,
      flashcards,
      source_type: 'study_guide',
      source_title: 'Source study guide',
      source_id: guideId,
    };
    if (saveFolderId) body.folder_id = saveFolderId;

    const saved = await apiFetch('/guides', { method: 'POST', body: JSON.stringify(body) });
    if (saved?.guide) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('error');
    }
  }

  if (done && score) {
    return (
      <div className="quiz-result">
        <div className="quiz-score">{score.score}%</div>
        <div className="quiz-score-label">NCLEX Practice Score</div>
        <div className="quiz-breakdown">{score.correct} out of {score.total} correct</div>
        <div className="completion-actions" style={{ marginTop: 20, gap: 8 }}>
          <button className="btn" onClick={retake}>Retake</button>
          {saveStatus === 'saved' ? (
            <button className="btn" disabled style={{ opacity: 0.7 }}>Saved</button>
          ) : (
            <button className="btn" onClick={openSaveForm} disabled={showSave}>Save as Study Guide</button>
          )}
          <button className="btn-outline" onClick={() => window.history.back()}>Back to Guide</button>
        </div>

        {showSave && saveStatus !== 'saved' && (
          <div style={{
            marginTop: 16, padding: 16, background: 'var(--bg-secondary)',
            border: '1px solid var(--border-default)', borderRadius: 10
          }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Title
            </label>
            <input
              type="text"
              value={saveTitle}
              onChange={e => setSaveTitle(e.target.value)}
              style={{ marginBottom: 10, width: '100%' }}
            />
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Save to Class (optional)
            </label>
            <select
              value={saveFolderId}
              onChange={e => setSaveFolderId(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', background: 'var(--bg-deepest)',
                border: '1px solid var(--border-default)', borderRadius: 8,
                color: 'var(--text-primary)', fontSize: '0.9em', marginBottom: 12
              }}
            >
              <option value="">No class</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={saveAsGuide} disabled={saveStatus === 'saving' || !saveTitle.trim()}>
                {saveStatus === 'saving' ? 'Saving...' : 'Save'}
              </button>
              <button className="btn-outline" onClick={() => setShowSave(false)}>Cancel</button>
            </div>
            {saveStatus === 'error' && (
              <div style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>Failed to save. Try again.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  function mcqOptionClass(i) {
    if (!answered) return 'quiz-option' + (selected === i ? ' selected' : '');
    if (q.correct_indices.includes(i)) return 'quiz-option correct';
    if (i === selected) return 'quiz-option wrong';
    return 'quiz-option disabled';
  }

  function sataOptionClass(i) {
    if (!answered) return 'nclex-sata-checkbox' + (sataSelected.includes(i) ? ' selected' : '');
    const wasSelected = sataSelected.includes(i);
    const isCorrect = q.correct_indices.includes(i);
    if (isCorrect && wasSelected) return 'nclex-sata-checkbox correct';
    if (!isCorrect && wasSelected) return 'nclex-sata-checkbox wrong';
    if (isCorrect && !wasSelected) return 'nclex-sata-checkbox missed';
    return 'nclex-sata-checkbox disabled';
  }

  const isLastQuestion = currentIndex === questions.length - 1;

  return (
    <div className="quiz-question-card">
      <div className="quiz-counter">Question {currentIndex + 1} of {questions.length}</div>
      <div className="progress-bar-container" style={{ marginBottom: 16 }}>
        <div className="progress-bar-fill" style={{ width: ((currentIndex / questions.length) * 100) + '%' }} />
      </div>

      <div className="nclex-type-badge">{isSata ? 'Select All That Apply' : 'Multiple Choice'}</div>
      <div className="quiz-question-text">{q.stem}</div>

      {isSata ? (
        <>
          {q.options.map((opt, i) => (
            <label key={i} className={sataOptionClass(i)} onClick={() => !answered && toggleSata(i)}>
              <input
                type="checkbox"
                checked={sataSelected.includes(i)}
                onChange={() => toggleSata(i)}
                disabled={answered}
              />
              {opt}
            </label>
          ))}
          {!answered && (
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={submitSata}
              disabled={sataSelected.length === 0}
            >
              Submit Answer
            </button>
          )}
        </>
      ) : (
        q.options.map((opt, i) => (
          <button key={i} className={mcqOptionClass(i)} onClick={() => selectMcq(i)}>
            {opt}
          </button>
        ))
      )}

      {answered && (
        <>
          <div className="nclex-rationale">
            <strong>Rationale</strong>
            {q.rationale}
          </div>
          {!isLastQuestion && (
            <button className="btn" style={{ marginTop: 16 }} onClick={nextQuestion}>
              Next Question
            </button>
          )}
        </>
      )}
    </div>
  );
}
