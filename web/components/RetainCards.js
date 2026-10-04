import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { conceptAnswer, fillMatches, normalize, shuffled } from '../lib/retainEngine.mjs';

// A wrong answer of any type opens the Tutor's "why was I wrong" help.
export function askTutorAboutMiss(guideId, question, selectedAnswer, options = []) {
  window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', {
    detail: {
      guideId,
      skill: 'retain',
      prompt: 'Can you explain why my answer does not work and help me understand the difference?',
      retainContext: {
        question: question.question,
        options,
        selected_answer: selectedAnswer,
        correct_answer: conceptAnswer(question),
      },
    },
  }));
}

function NextButton({ onNext }) {
  return <button type="button" className="quiz-gotit-btn" onClick={onNext} autoFocus>Got it!</button>;
}

export function McCard({ card, question, guideId, onResult, onNext }) {
  const answer = conceptAnswer(question);
  const [options] = useState(() => (card.reask ? shuffled(question.options, card.id) : question.options));
  const [selected, setSelected] = useState(null);

  function choose(option) {
    if (selected !== null) return;
    setSelected(option);
    const right = option === answer;
    if (!right) askTutorAboutMiss(guideId, question, option, options);
    onResult([{ concept: card.concepts[0], credit: right ? 1 : 0, response: option }]);
  }

  function optionClass(option) {
    if (selected === null) return 'quiz-option';
    if (option === answer) return 'quiz-option ' + (selected === answer ? 'correct-shine' : 'correct-glow');
    if (option === selected) return 'quiz-option wrong-shake';
    return 'quiz-option disabled';
  }

  return (
    <>
      <div className="quiz-question-text">{question.question}</div>
      {options.map(option => (
        <button key={option} type="button" className={optionClass(option)} onClick={() => choose(option)}>{option}</button>
      ))}
      {selected !== null && <NextButton onNext={onNext} />}
    </>
  );
}

export function FillCard({ card, question, guideId, onResult, onNext }) {
  const answer = conceptAnswer(question);
  const [value, setValue] = useState('');
  const [right, setRight] = useState(null);

  function check(event) {
    event.preventDefault();
    if (right !== null || !value.trim()) return;
    const correct = fillMatches(value, answer);
    setRight(correct);
    if (!correct) askTutorAboutMiss(guideId, question, value.trim());
    onResult([{ concept: card.concepts[0], credit: correct ? 1 : 0, response: value.trim() }]);
  }

  return (
    <form onSubmit={check}>
      <div className="quiz-question-text">{question.question}</div>
      <div className="retain-fill-row">
        <input
          className={'retain-fill-input' + (right === true ? ' right' : right === false ? ' wrong' : '')}
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder="Type the answer"
          aria-label="Your answer"
          readOnly={right !== null}
          autoFocus
          autoComplete="off"
        />
        {right === null && <button type="submit" className="btn" disabled={!value.trim()}>Check</button>}
      </div>
      {right !== null && (
        <p className={'retain-feedback ' + (right ? 'right' : 'wrong')} role="status">
          {right ? 'Correct!' : <>Not quite. The answer is <strong>{answer}</strong>.</>}
        </p>
      )}
      {right !== null && <NextButton onNext={onNext} />}
    </form>
  );
}

// Drag an answer onto its question, or tap an answer and then tap the question (phones).
export function MatchingCard({ card, questions, guideId, onResult, onNext }) {
  const rows = card.concepts.map(index => ({ index, question: questions[index], answer: conceptAnswer(questions[index]) }));
  const [bank] = useState(() => shuffled(rows.map(row => row.answer), card.id));
  const [placed, setPlaced] = useState({});
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const used = new Set(Object.values(placed));

  function place(index, answer) {
    if (checked || !answer) return;
    setPlaced(current => {
      const next = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== answer));
      next[index] = answer;
      return next;
    });
    setPicked(null);
  }

  function clear(index) {
    if (checked) return;
    setPlaced(current => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function check() {
    setChecked(true);
    const results = rows.map(row => {
      const right = normalize(placed[row.index]) === normalize(row.answer);
      return { concept: row.index, credit: right ? 1 : 0, response: placed[row.index] || '' };
    });
    const miss = rows.find((row, i) => results[i].credit !== 1);
    if (miss) askTutorAboutMiss(guideId, miss.question, placed[miss.index] || '(no match)', bank);
    onResult(results);
  }

  return (
    <>
      <div className="quiz-question-text">Match each question with its answer.</div>
      <p className="retain-hint">Drag an answer onto a question, or tap an answer and then tap the question.</p>
      <div className="retain-match-bank" aria-label="Answers">
        {bank.filter(answer => !used.has(answer)).map(answer => (
          <button
            key={answer}
            type="button"
            className={'retain-chip' + (picked === answer ? ' picked' : '')}
            draggable={!checked}
            onDragStart={event => event.dataTransfer.setData('text/plain', answer)}
            onClick={() => setPicked(picked === answer ? null : answer)}
            aria-pressed={picked === answer}
          >{answer}</button>
        ))}
      </div>
      <ol className="retain-match-rows">
        {rows.map(row => {
          const value = placed[row.index];
          const state = !checked ? '' : normalize(value) === normalize(row.answer) ? ' right' : ' wrong';
          return (
            <li key={row.index} className={'retain-match-row' + state}>
              <span>{row.question.question}</span>
              <button
                type="button"
                className={'retain-slot' + (value ? ' filled' : '') + (picked ? ' ready' : '')}
                onClick={() => (picked ? place(row.index, picked) : clear(row.index))}
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); place(row.index, event.dataTransfer.getData('text/plain')); }}
                aria-label={value ? `Answer: ${value}. Tap to remove.` : 'Empty. Tap after choosing an answer.'}
              >{value || 'Drop answer here'}</button>
              {checked && state === ' wrong' && <small className="retain-correct-answer">Answer: {row.answer}</small>}
            </li>
          );
        })}
      </ol>
      {!checked
        ? <button type="button" className="btn retain-check" onClick={check} disabled={Object.keys(placed).length !== rows.length}>Check matches</button>
        : <NextButton onNext={onNext} />}
    </>
  );
}

const VERDICTS = { 1: ['right', 'Right!'], 0.5: ['partial', 'Partly right'], 0: ['wrong', 'Not quite'] };

export function WrittenCard({ card, question, guideId, onResult, onNext, onSwitch }) {
  const concept = card.concepts[0];
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState(null);
  const [error, setError] = useState('');

  async function check(event) {
    event.preventDefault();
    if (busy || grade || !value.trim()) return;
    setBusy(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ concept, answer: value.trim() }),
    });
    setBusy(false);
    if (typeof data?.credit !== 'number') {
      setError(data?.detail || 'Cordia could not check this answer right now.');
      return;
    }
    setGrade(data);
    if (data.credit !== 1) askTutorAboutMiss(guideId, question, value.trim());
    onResult([{ concept, credit: data.credit, response: value.trim(), token: data.token }]);
  }

  const [tone, label] = grade ? VERDICTS[grade.credit] : [];
  return (
    <form onSubmit={check}>
      <div className="quiz-question-text">{question.question}</div>
      <textarea
        className="retain-written-input"
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder="Answer in your own words"
        aria-label="Your answer"
        rows={4}
        readOnly={Boolean(grade) || busy}
        maxLength={4000}
        autoFocus
      />
      {!grade && (
        <div className="retain-written-actions">
          <button type="submit" className="btn" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Check answer'}</button>
          {error && (
            <>
              <span className="retain-action-error" role="alert">{error}</span>
              <button type="button" className="btn-outline" onClick={() => onSwitch('mc')}>Use multiple choice instead</button>
            </>
          )}
        </div>
      )}
      {grade && (
        <div className={'retain-feedback ' + tone} role="status">
          <strong>{label}</strong> {grade.explanation}
          {grade.credit !== 1 && <p className="retain-guide-answer"><span>Guide answer</span>{grade.answer}</p>}
        </div>
      )}
      {grade && <NextButton onNext={onNext} />}
    </form>
  );
}
