import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import AILoadingSphere from '../../components/AILoadingSphere';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SYMBOLS = ['+', '−', '×', '÷', '=', 'x²', '√', 'Σ', '→'];

function readableText(value) {
  return String(value || '')
    .replace(/<\/?(?:p|div|li|h[1-6]|blockquote|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

export default function PracticeWorkspace() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const canvasRef = useRef(null);
  const boardRef = useRef(null);
  const drawing = useRef(false);
  const drawings = useRef({});
  const drag = useRef(null);
  const fileRef = useRef(null);
  const [guide, setGuide] = useState(null);
  const [upload, setUpload] = useState(null);
  const [problems, setProblems] = useState([]);
  const [practiceInfo, setPracticeInfo] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);
  const [tool, setTool] = useState('pen');
  const [workText, setWorkText] = useState({});
  const [tokens, setTokens] = useState({});
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState({});
  const [evaluations, setEvaluations] = useState({});
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId).then(data => {
      if (data?.guide) setGuide(data.guide);
      else setError(apiErrorMessage(data?.detail, 'This study guide could not be loaded.'));
    });
  }, [ready, guideId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return;
    const resize = () => {
      const rect = board.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const snapshot = drawings.current[problemIndex] || '';
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      if (snapshot) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = snapshot;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [problemIndex, problems.length]);

  const sourceTitle = upload?.title || guide?.title || 'Study material';
  const sourceText = readableText(upload?.content || guide?.study_guide || guide?.notes);
  const current = problems[problemIndex];
  const currentTokens = tokens[problemIndex] || [];

  async function generateProblems() {
    if (!guide && !upload) return;
    setLoading(true);
    setError('');
    const data = await apiFetch('/practice', {
      method: 'POST',
      timeoutMs: 120000,
      body: JSON.stringify(upload
        ? { content: upload.content, title: upload.title }
        : { guide_id: guide.id }),
    });
    if (Array.isArray(data?.problems) && data.problems.length === 10) {
      setProblems(data.problems);
      setPracticeInfo({ subjectArea: data.subject_area, domain: data.domain, truthNote: data.truth_note });
      setProblemIndex(0);
      setAnswers({});
      setRevealed({});
      setEvaluations({});
      setTokens({});
      setWorkText({});
      drawings.current = {};
    } else {
      setError(apiErrorMessage(data?.detail, 'Cordia could not create the practice set.'));
    }
    setLoading(false);
  }

  async function useUploadedFile(file) {
    if (!file) return;
    setExtracting(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(API + '/extract-file-text', {
        method: 'POST',
        headers: authOnlyHeaders(),
        body: form,
      });
      const data = await responseJson(response);
      if (!response.ok || !data?.text) throw new Error(apiErrorMessage(data?.detail, 'This file could not be read.'));
      setUpload({ title: file.name, content: data.text });
      setProblems([]);
      setPracticeInfo(null);
      setProblemIndex(0);
      drawings.current = {};
    } catch (uploadError) {
      setError(uploadError.message || 'This file could not be read.');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginDraw(event) {
    if (tool !== 'pen') return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    const context = canvasRef.current.getContext('2d');
    context.strokeStyle = '#11120f';
    context.lineWidth = 2.4;
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function moveDraw(event) {
    if (!drawing.current || tool !== 'pen') return;
    const p = point(event);
    const context = canvasRef.current.getContext('2d');
    context.lineTo(p.x, p.y);
    context.stroke();
  }

  function endDraw() {
    drawing.current = false;
    if (canvasRef.current) drawings.current[problemIndex] = canvasRef.current.toDataURL();
  }

  function changeProblem(nextIndex) {
    if (canvasRef.current) drawings.current[problemIndex] = canvasRef.current.toDataURL();
    setProblemIndex(Math.max(0, Math.min(problems.length - 1, nextIndex)));
  }

  function addSymbol(symbol) {
    const next = { id: Date.now() + Math.random(), value: symbol, x: 48 + currentTokens.length * 12, y: 54 + currentTokens.length * 10 };
    setTokens(all => ({ ...all, [problemIndex]: [...(all[problemIndex] || []), next] }));
  }

  function beginTokenDrag(event, token) {
    const rect = boardRef.current.getBoundingClientRect();
    drag.current = { id: token.id, offsetX: event.clientX - rect.left - token.x, offsetY: event.clientY - rect.top - token.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveToken(event, token) {
    if (drag.current?.id !== token.id) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - 48, event.clientX - rect.left - drag.current.offsetX));
    const y = Math.max(0, Math.min(rect.height - 40, event.clientY - rect.top - drag.current.offsetY));
    setTokens(all => ({
      ...all,
      [problemIndex]: (all[problemIndex] || []).map(item => item.id === token.id ? { ...item, x, y } : item),
    }));
  }

  function clearWork() {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    delete drawings.current[problemIndex];
    setWorkText(all => ({ ...all, [problemIndex]: '' }));
    setTokens(all => ({ ...all, [problemIndex]: [] }));
  }

  function reviewAnswer(event) {
    event.preventDefault();
    if (!current) return;
    let evaluation = null;
    if (current.verification?.status === 'verified' && Number.isFinite(Number(current.expected_value))) {
      const matches = String(answers[problemIndex] || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
      const submitted = matches?.length ? Number(matches[matches.length - 1]) : NaN;
      const expected = Number(current.expected_value);
      const tolerance = Math.max(Number(current.tolerance || 0), Math.abs(expected) * 1e-9, 1e-9);
      evaluation = Number.isFinite(submitted) && Math.abs(submitted - expected) <= tolerance
        ? { status: 'correct', message: 'Correct — the result matches the independently checked calculation.' }
        : { status: 'retry', message: 'Not yet. Compare your setup with the worked solution, then try the next variation.' };
    }
    setEvaluations(all => ({ ...all, [problemIndex]: evaluation }));
    setRevealed(all => ({ ...all, [problemIndex]: true }));
  }

  if (!guide && !error) {
    return <div className="practice-loading"><AILoadingSphere size={92} /><p>Loading practice workspace…</p></div>;
  }

  return (
    <main className="practice-page fade-in">
      <header className="practice-header">
        <div>
          <button type="button" className="create-back-link" onClick={() => router.push('/guide/' + guideId)}>Back to study guide</button>
          <h1>Practice workspace</h1>
          <p>{practiceInfo?.subjectArea ? `${practiceInfo.subjectArea} practice` : 'Work through 10 source-grounded activities without leaving your material.'}</p>
        </div>
        <div className="practice-source-actions">
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.pptx,.txt" onChange={event => useUploadedFile(event.target.files?.[0])} />
          <button type="button" className="btn-outline" onClick={() => fileRef.current?.click()} disabled={extracting}>
            {extracting ? 'Reading file…' : 'Use another file'}
          </button>
          <button type="button" className="btn" onClick={generateProblems} disabled={loading || !sourceText}>
            {loading ? 'Creating 10 problems…' : problems.length ? 'Regenerate problems' : 'Generate 10 problems'}
          </button>
        </div>
      </header>

      {error && <div className="retain-action-error" role="alert">{error}</div>}

      <section className="practice-layout">
        <article className="practice-problem-panel">
          <div className="practice-problem-heading">
            <div>
              <span>Problem {problems.length ? problemIndex + 1 : 0} of {problems.length || 10}</span>
              {current?.practice_type && <small className="practice-kind">{current.practice_type.replace('_', ' ')}</small>}
              <h2>{current?.prompt || 'Generate a set to begin.'}</h2>
              {current?.starter_code && <pre className="practice-code"><code>{current.starter_code}</code></pre>}
              {current?.test_cases?.length > 0 && (
                <div className="practice-tests">
                  <strong>Acceptance tests</strong>
                  <ul>{current.test_cases.map((test, index) => <li key={index}><code>{test}</code></li>)}</ul>
                </div>
              )}
            </div>
            {problems.length > 0 && (
              <div className="practice-nav">
                <button type="button" onClick={() => changeProblem(problemIndex - 1)} disabled={problemIndex === 0} aria-label="Previous problem">←</button>
                <button type="button" onClick={() => changeProblem(problemIndex + 1)} disabled={problemIndex === problems.length - 1} aria-label="Next problem">→</button>
              </div>
            )}
          </div>

          <div className="practice-toolbar" aria-label="Workspace tools">
            <button type="button" className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}>Draw</button>
            <button type="button" className={tool === 'type' ? 'active' : ''} onClick={() => setTool('type')}>Type</button>
            <span className="practice-toolbar-divider" />
            {SYMBOLS.map(symbol => <button type="button" key={symbol} onClick={() => addSymbol(symbol)} aria-label={`Add ${symbol}`}>{symbol}</button>)}
            <button type="button" className="practice-clear" onClick={clearWork}>Clear</button>
          </div>

          <div ref={boardRef} className="practice-board" data-tool={tool}>
            <textarea
              aria-label="Typed work"
              value={workText[problemIndex] || ''}
              onChange={event => setWorkText(all => ({ ...all, [problemIndex]: event.target.value }))}
              placeholder={tool === 'type' ? 'Type your work here…' : ''}
              readOnly={tool !== 'type'}
            />
            <canvas
              ref={canvasRef}
              aria-label="Drawing workspace"
              onPointerDown={beginDraw}
              onPointerMove={moveDraw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
            />
            {currentTokens.map(token => (
              <button
                type="button"
                key={token.id}
                className="practice-token"
                style={{ left: token.x, top: token.y }}
                onPointerDown={event => beginTokenDrag(event, token)}
                onPointerMove={event => moveToken(event, token)}
                onPointerUp={() => { drag.current = null; }}
                aria-label={`Drag ${token.value}`}
              >{token.value}</button>
            ))}
          </div>
        </article>

        <aside className="practice-source-panel">
          <header>
            <span>Source material</span>
            <h2>{sourceTitle}</h2>
          </header>
          <div className="practice-source-copy">{sourceText || 'No readable source material is available.'}</div>
          <form className="practice-answer" onSubmit={reviewAnswer}>
            <label htmlFor="practice-answer-input">Your answer</label>
            <textarea
              id="practice-answer-input"
              value={answers[problemIndex] || ''}
              onChange={event => setAnswers(all => ({ ...all, [problemIndex]: event.target.value }))}
              placeholder={current?.answer_format || 'Enter your answer and reasoning…'}
              disabled={!current}
            />
            <button type="submit" className="btn" disabled={!current || !answers[problemIndex]?.trim()}>
              {current?.verification?.status === 'verified' ? 'Check answer' : 'Review answer'}
            </button>
            {revealed[problemIndex] && (
              <div className="practice-solution" role="status">
                {evaluations[problemIndex] && (
                  <div className={`practice-evaluation ${evaluations[problemIndex].status}`}>{evaluations[problemIndex].message}</div>
                )}
                <div className="practice-verification-row">
                  <strong>{current.verification?.label || 'Source-grounded reference'}</strong>
                  <span>{current.practice_type?.replace('_', ' ')}</span>
                </div>
                <p>{current.answer}</p>
                {current.worked_solution && <p className="practice-worked"><strong>Why:</strong> {current.worked_solution}</p>}
                {current.source_basis && <blockquote>Source basis: “{current.source_basis}”</blockquote>}
                {current.verification?.detail && <small>{current.verification.detail}</small>}
              </div>
            )}
            {practiceInfo?.truthNote && <p className="practice-truth-note">{practiceInfo.truthNote}</p>}
          </form>
        </aside>
      </section>
    </main>
  );
}
