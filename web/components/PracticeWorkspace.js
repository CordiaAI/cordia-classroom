import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import AILoadingSphere from './AILoadingSphere';
import GuidedTour from './GuidedTour';
import { saveOnboardingStep } from '../lib/onboarding';
import { PRACTICE_TOUR } from '../lib/tours';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SYMBOLS = ['+', '−', '×', '÷', '=', '√', 'π', 'Σ', '→'];
const drawingsKey = guideId => `practiceDrawings:${guideId}`;

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

// The Practice tab. /practice opens it with no guide chosen; /practice/{guideId} opens a guide.
export default function PracticeWorkspace() {
  const router = useRouter();
  const guideId = router.query.guideId || null;
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
  const [grading, setGrading] = useState(false);
  const [shownBlocks, setShownBlocks] = useState({});
  const [reported, setReported] = useState({});
  const [tidying, setTidying] = useState(false);
  const restoring = useRef(false);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [guideOptions, setGuideOptions] = useState(null);
  const touring = router.query.tour === '1';

  useEffect(() => {
    if (!ready) return;
    apiFetch('/guides?limit=50').then(data => setGuideOptions(Array.isArray(data?.guides) ? data.guides : []));
  }, [ready]);

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/guides/' + guideId).then(data => {
      if (data?.guide) setGuide(data.guide);
      else setError(apiErrorMessage(data?.detail, 'This study guide could not be loaded.'));
    });
  }, [ready, guideId]);

  useEffect(() => {
    if (!ready || !guideId) return;
    apiFetch('/practice/' + guideId + '/state').then(data => {
      const saved = data?.practice;
      if (!Array.isArray(saved?.problems) || saved.problems.length !== 10) return;
      const progress = saved.progress || {};
      restoring.current = true;
      setProblems(saved.problems);
      setPracticeInfo({ subjectArea: saved.subject_area, domain: saved.domain, truthNote: saved.truth_note });
      setProblemIndex(Math.min(9, Math.max(0, Number(progress.problemIndex) || 0)));
      setAnswers(progress.answers || {});
      setEvaluations(progress.evaluations || {});
      setRevealed(progress.revealed || {});
      setWorkText(progress.workText || {});
      setTokens(progress.tokens || {});
      setReported(progress.reported || {});
      try { drawings.current = JSON.parse(localStorage.getItem(drawingsKey(guideId)) || '{}'); } catch { drawings.current = {}; }
    });
  }, [ready, guideId]);

  // Save progress for guide-based sets (uploads are temporary) a moment after each change.
  useEffect(() => {
    if (upload || !guideId || problems.length !== 10) return;
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      apiFetch('/practice/' + guideId + '/state', {
        method: 'PUT',
        body: JSON.stringify({ progress: { problemIndex, answers, evaluations, revealed, workText, tokens, reported } }),
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [problemIndex, answers, evaluations, revealed, workText, tokens, reported, problems, upload, guideId]);

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
  const sourceBlocks = sourceText ? sourceText.split(/\n\s*\n/).filter(block => block.trim()) : [];

  async function finishTour() {
    await saveOnboardingStep('done');
    router.replace(guideId ? '/practice/' + guideId : '/practice', undefined, { shallow: true });
  }

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
      setReported({});
      drawings.current = {};
      try { localStorage.removeItem(drawingsKey(guideId)); } catch {}
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
    if (tool !== 'pen' && tool !== 'eraser') return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    const context = canvasRef.current.getContext('2d');
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = '#11120f';
    context.lineWidth = tool === 'eraser' ? 22 : 2.4;
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function moveDraw(event) {
    if (!drawing.current || (tool !== 'pen' && tool !== 'eraser')) return;
    const p = point(event);
    const context = canvasRef.current.getContext('2d');
    context.lineTo(p.x, p.y);
    context.stroke();
  }

  function saveDrawings() {
    try { localStorage.setItem(drawingsKey(guideId), JSON.stringify(drawings.current)); } catch {}
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    if (canvasRef.current) drawings.current[problemIndex] = canvasRef.current.toDataURL();
    saveDrawings();
  }

  function changeProblem(nextIndex) {
    if (canvasRef.current) drawings.current[problemIndex] = canvasRef.current.toDataURL();
    setProblemIndex(Math.max(0, Math.min(problems.length - 1, nextIndex)));
  }

  function addSymbol(symbol, kind = 'symbol') {
    const next = { id: Date.now() + Math.random(), kind, value: symbol, x: 48 + currentTokens.length * 12, y: 54 + currentTokens.length * 10 };
    setTokens(all => ({ ...all, [problemIndex]: [...(all[problemIndex] || []), next] }));
  }

  function updateToken(token, value) {
    setTokens(all => ({ ...all, [problemIndex]: (all[problemIndex] || []).map(item => item.id === token.id ? { ...item, value } : item) }));
  }

  function removeToken(token) {
    setTokens(all => ({ ...all, [problemIndex]: (all[problemIndex] || []).filter(item => item.id !== token.id) }));
  }

  // Turn the handwriting on this problem's canvas into typed text (vision model).
  async function tidyHandwriting() {
    const canvas = canvasRef.current;
    if (!canvas || !drawings.current[problemIndex]) return;
    const index = problemIndex;
    setTidying(true);
    setError('');
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    const data = await apiFetch('/practice/recognize', {
      method: 'POST',
      timeoutMs: 60000,
      body: JSON.stringify({ image: flat.toDataURL('image/png') }),
    });
    setTidying(false);
    if (typeof data?.text !== 'string') {
      setError(apiErrorMessage(data?.detail, 'Cordia could not read this drawing.'));
      return;
    }
    if (!data.text) return;
    setWorkText(all => ({ ...all, [index]: [all[index], data.text].filter(Boolean).join('\n') }));
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    delete drawings.current[index];
    saveDrawings();
    setTool('type');
  }

  function beginTokenDrag(event, token) {
    if (event.target.tagName === 'INPUT') return;
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
    saveDrawings();
    setWorkText(all => ({ ...all, [problemIndex]: '' }));
    setTokens(all => ({ ...all, [problemIndex]: [] }));
  }

  async function checkAnswer(event) {
    event.preventDefault();
    const studentAnswer = String(answers[problemIndex] || '').trim();
    if (!current || !studentAnswer) return;
    const index = problemIndex;
    setGrading(true);
    const data = await apiFetch('/practice/grade', {
      method: 'POST',
      body: JSON.stringify({
        prompt: current.prompt,
        reference: current.answer,
        worked_solution: current.worked_solution || '',
        student_answer: studentAnswer,
        work: workText[index] || '',
      }),
    });
    setGrading(false);
    if (typeof data?.correct !== 'boolean') {
      setEvaluations(all => ({ ...all, [index]: { status: 'retry', message: apiErrorMessage(data?.detail, 'Cordia could not check this answer. Please try again.') } }));
      return;
    }
    setEvaluations(all => ({ ...all, [index]: { status: data.correct ? 'correct' : 'retry', message: data.explanation } }));
    setRevealed(all => ({ ...all, [index]: true }));
    // The Tutor posts its reply to a missed answer; open it so the student sees it.
    if (!data.correct) window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { guideId, refresh: true } }));
  }

  async function reportGrade() {
    const evaluation = evaluations[problemIndex];
    if (!current || !evaluation || reported[problemIndex]) return;
    const index = problemIndex;
    const message = [
      'Practice grading reported as incorrect.',
      `Task: ${current.prompt}`,
      `Student answer: ${answers[index] || ''}`,
      `Reference answer: ${current.answer}`,
      `Cordia said: ${evaluation.status === 'correct' ? 'Right' : 'Not quite'}${evaluation.message ? ` — ${evaluation.message}` : ''}`,
    ].join('\n').slice(0, 2000);
    const data = await apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message,
        category: 'incorrect_content',
        page_path: '/practice/' + guideId,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION || null,
        context: { guide_id: guideId, question_id: `practice-${index + 1}` },
        client_request_id: crypto.randomUUID(),
      }),
    });
    if (data?.submitted) setReported(all => ({ ...all, [index]: true }));
    else setError(apiErrorMessage(data?.detail, 'Your report could not be sent. Please try again.'));
  }

  function chooseGuide(event) {
    const value = event.target.value;
    if (value === 'create') router.push('/create');
    else if (value) router.push('/practice/' + value);
  }

  if (guideId && !guide && !error) {
    return <div className="practice-loading"><AILoadingSphere /></div>;
  }

  return (
    <main className="practice-page fade-in">
      {touring && (guide || !guideId) && <GuidedTour steps={PRACTICE_TOUR} onFinish={finishTour} />}
      <header className="practice-header">
        <div>
          {guideId && <button type="button" className="create-back-link" onClick={() => router.push('/guide/' + guideId)}>Back to study guide</button>}
          <h1>Practice workspace</h1>
          <p>{practiceInfo?.subjectArea ? `${practiceInfo.subjectArea} practice` : 'Work through 10 source-grounded activities without leaving your material.'}</p>
        </div>
        <div className="practice-source-actions">
          <label className="practice-guide-picker">
            <span className="sr-only">Study guide</span>
            <select value={upload ? '' : guideId || ''} onChange={chooseGuide} disabled={!guideOptions}>
              <option value="" disabled>{!guideOptions ? 'Loading study guides…' : guideOptions.length ? 'Choose a study guide' : 'No study guides yet'}</option>
              {(guideOptions || []).map(option => <option key={option.id} value={option.id}>{option.title || 'Untitled guide'}</option>)}
              {guideOptions && guideOptions.length === 0 && <option value="create">Create guide or upload file</option>}
            </select>
          </label>
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
              <h2>{current?.prompt || (sourceText ? 'Generate a set to begin.' : 'Choose a study guide to begin.')}</h2>
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
            <button type="button" className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>Eraser</button>
            <button type="button" className={tool === 'type' ? 'active' : ''} onClick={() => setTool('type')}>Type</button>
            <span className="practice-toolbar-divider" />
            {SYMBOLS.map(symbol => <button type="button" key={symbol} onClick={() => addSymbol(symbol)} aria-label={`Add ${symbol}`}>{symbol}</button>)}
            <button type="button" onClick={() => addSymbol('', 'exp')} aria-label="Add exponent" title="Exponent: drag next to a number, then type the power">xⁿ</button>
            <button type="button" onClick={() => addSymbol('', 'text')} aria-label="Add text tile" title="Typed tile you can drag anywhere">Aa</button>
            <button type="button" onClick={tidyHandwriting} disabled={tidying || !current} title="Turn your handwriting into clean typed text">{tidying ? 'Reading…' : 'Tidy handwriting'}</button>
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
              <div
                key={token.id}
                className={`practice-token practice-token-${token.kind || 'symbol'}`}
                style={{ left: token.x, top: token.y }}
                onPointerDown={event => beginTokenDrag(event, token)}
                onPointerMove={event => moveToken(event, token)}
                onPointerUp={() => { drag.current = null; }}
                onDoubleClick={() => removeToken(token)}
                title="Drag to move · double-click to remove"
              >
                {token.kind === 'exp' || token.kind === 'text' ? (
                  <input
                    value={token.value}
                    onChange={event => updateToken(token, event.target.value)}
                    placeholder={token.kind === 'exp' ? 'n' : 'type'}
                    size={Math.max(1, token.value.length || 1)}
                    aria-label={token.kind === 'exp' ? 'Exponent' : 'Text tile'}
                    autoFocus
                  />
                ) : token.value}
              </div>
            ))}
          </div>

          <form className="practice-answer practice-answer-inline" onSubmit={checkAnswer}>
            <label htmlFor="practice-answer-input">Your answer</label>
            <textarea
              id="practice-answer-input"
              value={answers[problemIndex] || ''}
              onChange={event => setAnswers(all => ({ ...all, [problemIndex]: event.target.value }))}
              placeholder={current?.answer_format || 'Enter your answer…'}
              disabled={!current}
            />
            <button type="submit" className="btn" disabled={!current || grading || !answers[problemIndex]?.trim()}>
              {grading ? 'Checking…' : 'Check answer'}
            </button>
            {evaluations[problemIndex] && (
              <div className={`practice-evaluation ${evaluations[problemIndex].status}`} role="status">
                <strong>{evaluations[problemIndex].status === 'correct' ? 'Right!' : 'Not quite'}</strong>
                <span>{evaluations[problemIndex].status === 'correct'
                  ? (evaluations[problemIndex].message ? ` — ${evaluations[problemIndex].message}` : '')
                  : ' — your Tutor left you a note.'}</span>
                <button type="button" className="practice-report" onClick={reportGrade} disabled={reported[problemIndex]}>
                  {reported[problemIndex] ? 'Reported — thanks' : 'Report incorrect answer'}
                </button>
              </div>
            )}
            {revealed[problemIndex] && (
              <div className="practice-solution">
                <div className="practice-verification-row"><strong>Answer</strong></div>
                <p>{current.answer}</p>
                {current.worked_solution && <p className="practice-worked"><strong>Why:</strong> {current.worked_solution}</p>}
              </div>
            )}
          </form>
        </article>

        <aside className="practice-source-panel">
          <header>
            <span>Source material</span>
            <h2>{sourceTitle}</h2>
          </header>
          <p className="practice-source-hint">Double-click a section to reveal it.</p>
          <div className="practice-source-copy">
            {sourceBlocks.length ? sourceBlocks.map((block, index) => (
              <p
                key={index}
                className={shownBlocks[index] ? 'practice-source-block' : 'practice-source-block is-blurred'}
                onDoubleClick={() => setShownBlocks(all => ({ ...all, [index]: !all[index] }))}
                title={shownBlocks[index] ? 'Double-click to hide' : 'Double-click to reveal'}
              >{block}</p>
            )) : (guideId || upload ? 'No readable source material is available.' : 'Choose a study guide above, or upload a file, to see it here.')}
          </div>
        </aside>
      </section>
    </main>
  );
}
