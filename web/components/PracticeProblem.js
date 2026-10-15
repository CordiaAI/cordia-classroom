import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Eraser, Flag, MessageCircle, PenLine, Trash2, Wand2, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { themeColor } from '../lib/themeColor';
import { walkthroughEvent } from '../lib/walkthrough';
import Menu from './Menu';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const KEYPAD = ['+', '−', '×', '÷', '=', '√'];
const MORE_KEYS = ['π', 'Σ', '→', '^', '(', ')', '≤', '≥'];
const MATH = new Set(['calculation', 'word_problem']);
const CODE = new Set(['code', 'debugging']);

export function answerTool(problem) {
  const kind = String(problem?.practice_type || '').toLowerCase();
  if (MATH.has(kind)) return 'math';
  if (CODE.has(kind)) return 'code';
  return 'written';
}

// Canvas for working a math problem. Strokes use the theme's ink colour.
function useBoard({ problemKey, onTidy }) {
  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [tool, setTool] = useState('pen');
  const [hasInk, setHasInk] = useState(false);
  const [tidying, setTidying] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return undefined;
    const resize = () => {
      const rect = board.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
    };
    resize();
    setHasInk(false);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [problemKey]);

  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function begin(event) {
    drawing.current = true;
    walkthroughEvent('practice-drew');
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvasRef.current.getContext('2d');
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = themeColor('--ink');
    context.lineWidth = tool === 'eraser' ? 22 : 2.4;
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function move(event) {
    if (!drawing.current) return;
    const p = point(event);
    const context = canvasRef.current.getContext('2d');
    context.lineTo(p.x, p.y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === 'pen') setHasInk(true);
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  async function tidy() {
    const canvas = canvasRef.current;
    setTidying(true);
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = themeColor('--field');
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    const data = await apiFetch('/practice/recognize', { method: 'POST', timeoutMs: 60000, body: JSON.stringify({ image: flat.toDataURL('image/png') }) });
    setTidying(false);
    if (typeof data?.text === 'string' && data.text) {
      onTidy(data.text);
      clear();
    }
  }

  return { tool, setTool, hasInk, tidying, clear, tidy, board: (
    <div ref={boardRef} className="pp-board" data-tool={tool} data-spot="practice-canvas">
      <canvas ref={canvasRef} aria-label="Drawing workspace" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  ) };
}

// One practice problem: the right answer tool for its type, Check, a clear result, Next.
export default function PracticeProblem({ problem, index, total, guideId, answer = '', onAnswer, evaluation, onEvaluate, onNext, nextLabel = 'Next' }) {
  const tool = answerTool(problem);
  const inputRef = useRef(null);
  const [grading, setGrading] = useState(false);
  const [reported, setReported] = useState(false);
  const board = useBoard({ problemKey: `${guideId}:${index}`, onTidy: text => onAnswer([answer, text].filter(Boolean).join(' ')) });

  useEffect(() => { setReported(false); }, [index, guideId]);

  function insert(symbol) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? answer.length;
    const end = input?.selectionEnd ?? answer.length;
    const next = answer.slice(0, start) + symbol + answer.slice(end);
    onAnswer(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + symbol.length, start + symbol.length);
    });
  }

  async function check(event) {
    event.preventDefault();
    const studentAnswer = answer.trim();
    if (!studentAnswer || grading) return;
    setGrading(true);
    const data = await apiFetch('/practice/grade', {
      method: 'POST',
      body: JSON.stringify({ prompt: problem.prompt, reference: problem.answer, worked_solution: problem.worked_solution || '', student_answer: studentAnswer, work: '' }),
    });
    setGrading(false);
    if (typeof data?.correct !== 'boolean') {
      onEvaluate({ status: 'error', message: apiErrorMessage(data?.detail, "Couldn't check that. Try again.") });
      return;
    }
    onEvaluate({ status: data.correct ? 'correct' : 'retry', message: data.explanation || '' });
  }

  async function report() {
    const data = await apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message: [`Practice grading reported as incorrect.`, `Task: ${problem.prompt}`, `Student answer: ${answer}`, `Reference answer: ${problem.answer}`].join('\n').slice(0, 2000),
        category: 'incorrect_content', page_path: '/practice/' + guideId,
        context: { guide_id: guideId, question_id: `practice-${index + 1}` }, client_request_id: crypto.randomUUID(),
      }),
    });
    if (data?.submitted) setReported(true);
  }

  const checked = evaluation && evaluation.status !== 'error';
  return (
    <article className="c-card pp">
      <div className="pp-meta c-meta"><span>{index + 1} / {total}</span></div>
      <h2 className="pp-prompt">{problem.prompt}</h2>
      {problem.starter_code && <pre className="pp-code"><code>{problem.starter_code}</code></pre>}

      {tool === 'math' && (
        <>
          <div className="pp-toolbar" role="toolbar" aria-label="Workspace tools">
            <div className="c-seg" role="group" aria-label="Tool">
              <button type="button" className={board.tool === 'pen' ? 'is-active' : ''} aria-pressed={board.tool === 'pen'} onClick={() => board.setTool('pen')}><PenLine {...ICON} />Draw</button>
              <button type="button" className={board.tool === 'eraser' ? 'is-active' : ''} aria-pressed={board.tool === 'eraser'} onClick={() => board.setTool('eraser')}><Eraser {...ICON} />Erase</button>
            </div>
            <div className="pp-keys" role="group" aria-label="Keypad">
              {KEYPAD.map(symbol => <button key={symbol} type="button" className="c-icon-btn pp-key" onClick={() => insert(symbol)} aria-label={`Insert ${symbol}`} title={`Insert ${symbol}`}>{symbol}</button>)}
            </div>
            <Menu label="More tools" items={[
              ...[...KEYPAD.slice(3), ...MORE_KEYS].map(symbol => ({ label: `Insert ${symbol}`, onSelect: () => insert(symbol) })),
              { label: board.tidying ? 'Reading…' : 'Read my writing', icon: Wand2, disabled: !board.hasInk || board.tidying, onSelect: board.tidy },
              { label: 'Clear drawing', icon: Trash2, onSelect: board.clear },
            ]} />
          </div>
          {board.board}
        </>
      )}

      <form className="pp-answer" onSubmit={check}>
        <label htmlFor={`pp-answer-${index}`} className="pp-label">Your answer</label>
        {tool === 'math' ? (
          <input ref={inputRef} id={`pp-answer-${index}`} className="c-input pp-input" value={answer} onChange={event => onAnswer(event.target.value)} placeholder={problem.answer_format || ''} autoComplete="off" inputMode="text" />
        ) : (
          <textarea ref={inputRef} id={`pp-answer-${index}`} className={'c-input pp-text' + (tool === 'code' ? ' is-code' : '')} value={answer} onChange={event => onAnswer(event.target.value)} placeholder={problem.answer_format || ''} rows={tool === 'code' ? 8 : 5} spellCheck={tool !== 'code'} />
        )}
        {!checked && (
          <button type="submit" className="c-btn c-btn--primary pp-check" disabled={grading || !answer.trim()}>{grading ? 'Checking…' : 'Check'}</button>
        )}
      </form>

      {evaluation?.status === 'error' && <p className="pp-error" role="alert">{evaluation.message}</p>}

      {checked && (
        <div className={'pp-result ' + (evaluation.status === 'correct' ? 'is-right' : 'is-wrong')} role="status">
          <span className="pp-result-title">{evaluation.status === 'correct' ? <Check {...ICON} /> : <X {...ICON} />}{evaluation.status === 'correct' ? 'Correct' : 'Not quite'}</span>
          {evaluation.message && <p>{evaluation.message}</p>}
          <div className="pp-answer-key"><strong>Answer</strong> {problem.answer}</div>
          {problem.worked_solution && <div className="pp-answer-key"><strong>Why</strong> {problem.worked_solution}</div>}
          <div className="pp-result-actions">
            {evaluation.status !== 'correct' && (
              <button type="button" className="c-btn c-btn--secondary" onClick={() => window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { guideId, prompt: `Why is the answer to "${problem.prompt}" ${problem.answer}?`, send: true } }))}><MessageCircle {...ICON} />Ask</button>
            )}
            <button type="button" className="c-btn c-btn--quiet" onClick={report} disabled={reported}><Flag {...ICON} />{reported ? 'Reported' : 'Report'}</button>
            <span className="c-spacer" />
            {onNext && <button type="button" className="c-btn c-btn--primary" onClick={onNext} autoFocus>{nextLabel}<ArrowRight {...ICON} /></button>}
          </div>
        </div>
      )}

      <style jsx global>{`
        .pp { display: grid; gap: 16px; padding: 24px; min-width: 0; }
        .pp-meta { font-variant-numeric: tabular-nums; }
        .pp-prompt { margin: 0; font: 500 22px/1.4 var(--font-display); color: var(--ink); }
        .pp-code { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--field); overflow: auto; font: 500 14px/1.5 ui-monospace, monospace; }
        .pp-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }
        .pp-toolbar .c-seg button { display: inline-flex; align-items: center; gap: 6px; }
        .pp-keys { display: flex; gap: 8px; min-width: 0; overflow: hidden; }
        .pp-key { font: 600 17px/1 var(--font-sans); border: 1px solid var(--line); }
        .pp-board { position: relative; height: 280px; border-radius: 16px; border: 1px solid var(--line); background: var(--field); touch-action: none; }
        .pp-board canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
        .pp-board[data-tool='eraser'] canvas { cursor: cell; }
        .pp-answer { display: grid; gap: 8px; }
        .pp-label { font: 600 15px/1.2 var(--font-sans); color: var(--ink); }
        .pp-text { min-height: 120px; padding-top: 12px; resize: vertical; font-size: 17px; line-height: 1.5; }
        .pp-text.is-code { font: 500 14px/1.5 ui-monospace, monospace; }
        .pp-input { font-size: 17px; }
        .pp-check { justify-self: start; }
        .pp-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .pp-result { display: grid; gap: 10px; padding: 16px 18px; border-radius: 16px; border: 1px solid var(--line); background: var(--card); }
        .pp-result.is-right { border-color: var(--success); background: var(--success-bg); }
        .pp-result.is-wrong { border-color: var(--error); background: var(--error-bg); }
        .pp-result-title { display: inline-flex; align-items: center; gap: 8px; font: 700 17px/1.2 var(--font-sans); color: var(--ink); }
        .pp-result.is-right .pp-result-title .lucide { color: var(--success); }
        .pp-result.is-wrong .pp-result-title .lucide { color: var(--error); }
        .pp-result p { margin: 0; font: 500 15px/1.5 var(--font-sans); color: var(--ink); }
        .pp-answer-key { font: 500 15px/1.5 var(--font-sans); color: var(--ink); }
        .pp-result-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 639px) {
          .pp { padding: 16px; }
          .pp-keys .pp-key:nth-child(n + 4) { display: none; }
          .pp-board { height: 220px; }
        }
      `}</style>
    </article>
  );
}
