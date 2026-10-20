import { useEffect, useRef, useState } from 'react';
import { cssVar } from '../lib/cssVar';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { LoadingArea, SectionLoader } from './CordiaLoader';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eraser, Eye, Flag, Hand, MessageCircle, PenLine, PencilRuler, RefreshCw, Sparkles, Trash2, Type, Undo2, Upload, Video, VideoOff, Wand2 } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';
import { drawLatestSegment, drawStroke, farEnough, finishStroke } from '../lib/airDraw.mjs';
import AirDraw from './AirDraw';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SYMBOLS = ['+', '−', '×', '÷', '=', '√', 'π', 'Σ', '→'];
const drawingsKey = guideId => `practiceDrawings:${guideId}`;
// Pen colours (tokens in styles/tokens.css, light and dark versions).
const PEN_COLORS = [
  { token: '--draw-ink', label: 'Ink' },
  { token: '--draw-olive', label: 'Olive' },
  { token: '--draw-blue', label: 'Blue' },
  { token: '--draw-red', label: 'Red' },
  { token: '--draw-orange', label: 'Orange' },
  { token: '--draw-purple', label: 'Purple' },
  { token: '--draw-teal', label: 'Teal' },
  { token: '--draw-graphite', label: 'Graphite' },
];

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
  // Drawing: every stroke (mouse, touch or hand) is kept per problem so Undo goes stroke by stroke.
  // Per-frame data lives in refs; only the toolbar uses state.
  const strokes = useRef([]);
  const live = useRef(null);
  const baseImage = useRef(null);
  const [penColor, setPenColor] = useState('--draw-ink');
  const [penSize, setPenSize] = useState(4);
  const pen = useRef({ color: penColor, size: penSize });
  pen.current = { color: penColor, size: penSize };
  const [canUndo, setCanUndo] = useState(false);
  const [handOn, setHandOn] = useState(false);
  const [handReady, setHandReady] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const [handError, setHandError] = useState('');
  const hasMaterial = Boolean(guide || upload);

  useEffect(() => {
    if (!ready) return;
    apiFetch('/guides?fields=summary&limit=500').then(data => setGuideOptions(Array.isArray(data?.guides) ? data.guides : []));
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
      // Each visit starts fresh: only problems already answered right keep their work.
      // Unsolved problems open blank, without the last answer or its "Not quite" result.
      const solved = Object.keys(progress.evaluations || {}).filter(index => progress.evaluations[index]?.status === 'correct');
      const keep = (map = {}) => Object.fromEntries(Object.entries(map).filter(([index]) => solved.includes(index)));
      const firstOpen = saved.problems.findIndex((_, index) => !solved.includes(String(index)));
      restoring.current = true;
      setProblems(saved.problems);
      setPracticeInfo({ subjectArea: saved.subject_area, domain: saved.domain, truthNote: saved.truth_note });
      setProblemIndex(firstOpen === -1 ? 0 : firstOpen);
      setAnswers(keep(progress.answers));
      setEvaluations(keep(progress.evaluations));
      setRevealed(keep(progress.revealed));
      setWorkText(keep(progress.workText));
      setTokens(keep(progress.tokens));
      setReported(progress.reported || {});
      try { drawings.current = keep(JSON.parse(localStorage.getItem(drawingsKey(guideId)) || '{}')); } catch { drawings.current = {}; }
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
    // Each problem opens with its saved drawing as the base and an empty stroke list.
    strokes.current = [];
    live.current = null;
    baseImage.current = null;
    setCanUndo(false);
    const snapshot = drawings.current[problemIndex] || '';
    if (snapshot) {
      const image = new Image();
      image.onload = () => { baseImage.current = image; redraw(); };
      image.src = snapshot;
    }
    const resize = () => {
      const rect = board.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
      redraw();
    };
    // Follow the board itself (not just the window): it grows when the problem text loads.
    const observer = new ResizeObserver(resize);
    observer.observe(board);
    return () => observer.disconnect();
    // hasMaterial: the board only exists once the guide or upload has loaded.
  }, [problemIndex, problems.length, hasMaterial]);

  const sourceTitle = upload?.title || guide?.title || 'Study material';
  const sourceText = readableText(upload?.content || guide?.study_guide || guide?.notes);
  const current = problems[problemIndex];
  const currentTokens = tokens[problemIndex] || [];
  const sourceBlocks = sourceText ? sourceText.split(/\n\s*\n/).filter(block => block.trim()) : [];

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
      try { localStorage.removeItem(drawingsKey(guideId)); } catch { /* storage blocked: nothing was saved */ }
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

  const colorOf = token => cssVar(token, cssVar('--paper-ink', 'black'));

  // Strokes after the last "clear"; the saved base drawing counts only if nothing cleared it.
  function visibleStrokes() {
    const lastClear = strokes.current.map(item => item.tool).lastIndexOf('clear');
    return { showBase: lastClear === -1 && Boolean(baseImage.current), list: strokes.current.slice(lastClear + 1) };
  }

  function redraw() {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return;
    const rect = board.getBoundingClientRect();
    const context = canvas.getContext('2d');
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, rect.width, rect.height);
    const { showBase, list } = visibleStrokes();
    if (showBase) context.drawImage(baseImage.current, 0, 0, rect.width, rect.height);
    list.forEach(item => drawStroke(context, item, colorOf(item.color)));
  }

  function saveDrawings() {
    try { localStorage.setItem(drawingsKey(guideId), JSON.stringify(drawings.current)); } catch { /* storage blocked or full: drawings stay for this visit */ }
  }

  function saveSnapshot() {
    const { showBase, list } = visibleStrokes();
    if (canvasRef.current && (showBase || list.length)) drawings.current[problemIndex] = canvasRef.current.toDataURL();
    else delete drawings.current[problemIndex];
    saveDrawings();
  }

  // One stroke API for mouse, touch and hand: start, move, end.
  function startStroke(kind, p) {
    if (!canvasRef.current || live.current) return;
    walkthroughEvent('practice-drew');
    const stroke = { tool: kind, color: pen.current.color, size: pen.current.size, points: [p] };
    live.current = stroke;
    drawLatestSegment(canvasRef.current.getContext('2d'), stroke, colorOf(stroke.color));
  }

  function extendStroke(p) {
    const stroke = live.current;
    if (!stroke || !canvasRef.current || !farEnough(stroke.points[stroke.points.length - 1], p)) return;
    stroke.points.push(p);
    drawLatestSegment(canvasRef.current.getContext('2d'), stroke, colorOf(stroke.color));
  }

  function endStroke() {
    const stroke = live.current;
    if (!stroke) return;
    live.current = null;
    if (canvasRef.current) finishStroke(canvasRef.current.getContext('2d'), stroke, colorOf(stroke.color));
    strokes.current.push(stroke);
    setCanUndo(true);
    saveSnapshot();
  }

  // Clearing is a step too, so Undo brings the drawing back.
  function clearDrawing() {
    endStroke();
    if (!visibleStrokes().showBase && !visibleStrokes().list.length) return;
    strokes.current.push({ tool: 'clear' });
    redraw();
    setCanUndo(true);
    saveSnapshot();
  }

  function undo() {
    if (live.current || !strokes.current.length) return;
    strokes.current.pop();
    redraw();
    setCanUndo(strokes.current.length > 0);
    saveSnapshot();
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = cssVar('--draw-paper', 'white');
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    flat.toBlob(blob => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `practice-${problemIndex + 1}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }, 'image/png');
  }

  function toggleHand() {
    if (handOn) { setHandOn(false); setHandReady(false); return; }
    setHandError('');
    setHandReady(false);
    setHandOn(true);
    if (tool === 'type') setTool('pen');
  }

  function beginDraw(event) {
    if (tool !== 'pen' && tool !== 'eraser') return;
    if (live.current) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    startStroke(tool === 'eraser' ? 'eraser' : 'pen', point(event));
  }

  function moveDraw(event) {
    if (!drawing.current) return;
    // Coalesced events keep fast strokes smooth on high-rate pens and mice.
    const events = event.nativeEvent.getCoalescedEvents?.() || [];
    (events.length ? events : [event]).forEach(item => extendStroke(point(item)));
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    endStroke();
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
    context.fillStyle = cssVar('--draw-paper', 'white');
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
    strokes.current = [];
    baseImage.current = null;
    setCanUndo(false);
    redraw();
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
    clearDrawing();
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

  if (guideId && !guide && !error) {
    return <LoadingArea label="Loading practice" />;
  }

  const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

  // Pick a guide first; the workspace appears only once there is material.
  if (!guideId && !upload) {
    return (
      <div className="c-page practice-pick">
        <header className="c-page-head">
          <h1 className="c-title">Practice</h1>
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.pptx,.txt" onChange={event => useUploadedFile(event.target.files?.[0])} />
          <button type="button" className="c-btn c-btn--secondary" onClick={() => fileRef.current?.click()} disabled={extracting}><Upload {...ICON} />{extracting ? 'Reading…' : 'Upload'}</button>
        </header>
        {error && <div className="retain-action-error" role="alert">{error}</div>}
        {!guideOptions ? (
          <SectionLoader height={240} label="Loading guides" />
        ) : guideOptions.length ? (
          <div className="practice-grid practice-guide-picker" data-spot="practice-picker">
            {guideOptions.map(option => (
              <Link key={option.id} href={'/practice/' + option.id} className="c-card practice-guide" onClick={() => walkthroughEvent('practice-guide')}>
                <PencilRuler size={24} strokeWidth={1.75} aria-hidden="true" />
                <span>{option.title || 'Untitled guide'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="c-empty"><button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/create')}>Create guide or upload file</button></div>
        )}
        <style jsx>{`
          .practice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
          :global(.practice-guide) { display: grid; align-content: space-between; gap: 16px; min-height: 112px; padding: 18px; color: var(--ink); text-decoration: none; font:600 17px/1.15 var(--font-display); }
          :global(.practice-guide:hover) { text-decoration: none; border-color: var(--olive); }
          :global(.practice-guide .lucide) { color: var(--olive-ink); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="practice-page">
      <header className="c-page-head practice-head">
        <div className="c-row practice-title-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push(guideId ? '/guide/' + guideId : '/practice')} aria-label="Back"><ArrowLeft {...ICON} /></button>
          <h1 className="c-title">Practice</h1>
          <span className="c-section-title c-truncate practice-source-name">{sourceTitle}</span>
        </div>
        <div className="c-row">
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.pptx,.txt" onChange={event => useUploadedFile(event.target.files?.[0])} />
          <button type="button" className="c-btn c-btn--quiet" onClick={() => fileRef.current?.click()} disabled={extracting}><Upload {...ICON} />{extracting ? 'Reading…' : 'Upload'}</button>
          <button type="button" className={'c-btn ' + (problems.length ? 'c-btn--secondary' : 'c-btn--primary')} onClick={generateProblems} disabled={loading || !sourceText}>
            {problems.length ? <RefreshCw {...ICON} /> : <Sparkles {...ICON} />}
            {loading ? 'Creating…' : problems.length ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </header>

      {error && <div className="retain-action-error" role="alert">{error}</div>}

      <section className="practice-layout">
        <article className="c-card practice-problem-panel">
          <div className="practice-problem-heading">
            <div>
              <div className="c-row">
                <span className="c-meta">{problems.length ? problemIndex + 1 : 0} / {problems.length || 10}</span>
                {current?.practice_type && <span className="c-meta practice-kind">{current.practice_type.replace('_', ' ')}</span>}
              </div>
              <h2 className="practice-prompt">{current?.prompt || (loading ? 'Creating…' : 'Generate')}</h2>
              {current?.starter_code && <pre className="practice-code"><code>{current.starter_code}</code></pre>}
              {current?.test_cases?.length > 0 && (
                <div className="practice-tests">
                  <strong>Tests</strong>
                  <ul>{current.test_cases.map((test, index) => <li key={index}><code>{test}</code></li>)}</ul>
                </div>
              )}
            </div>
            {problems.length > 0 && (
              <div className="c-row">
                <button type="button" className="c-icon-btn" onClick={() => changeProblem(problemIndex - 1)} disabled={problemIndex === 0} aria-label="Previous problem"><ChevronLeft {...ICON} /></button>
                <button type="button" className="c-icon-btn" onClick={() => changeProblem(problemIndex + 1)} disabled={problemIndex === problems.length - 1} aria-label="Next problem"><ChevronRight {...ICON} /></button>
              </div>
            )}
          </div>

          <div className="practice-toolbar" role="toolbar" aria-label="Workspace tools">
            <div className="c-seg" role="group" aria-label="Tool">
              <button type="button" className={tool === 'pen' ? 'is-active' : ''} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}><PenLine {...ICON} /> Draw</button>
              <button type="button" className={tool === 'eraser' ? 'is-active' : ''} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser {...ICON} /> Erase</button>
              <button type="button" className={tool === 'type' ? 'is-active' : ''} aria-pressed={tool === 'type'} onClick={() => setTool('type')}><Type {...ICON} /> Type</button>
            </div>
            <div className="practice-symbols">
              {SYMBOLS.map(symbol => <button type="button" className="c-icon-btn" key={symbol} onClick={() => addSymbol(symbol)} aria-label={`Add ${symbol}`}>{symbol}</button>)}
              <button type="button" className="c-icon-btn" onClick={() => addSymbol('', 'exp')} aria-label="Add exponent">xⁿ</button>
              <button type="button" className="c-icon-btn" onClick={() => addSymbol('', 'text')} aria-label="Add text tile">Aa</button>
            </div>
            <button type="button" className="c-btn c-btn--quiet" onClick={tidyHandwriting} disabled={tidying || !current}><Wand2 {...ICON} />{tidying ? 'Reading…' : 'Tidy'}</button>
            <button type="button" className="c-icon-btn" onClick={clearWork} aria-label="Clear work"><Trash2 {...ICON} /></button>
            <div className="practice-drawbar" role="group" aria-label="Drawing">
            <button type="button" className={'c-btn c-btn--sm practice-webcam ' + (handOn ? 'c-btn--primary' : 'c-btn--secondary')} aria-pressed={handOn} onClick={toggleHand}>
              <Hand {...ICON} />{handOn ? 'Stop webcam drawing' : 'Draw with webcam'}
            </button>
            {handOn && (
              <button type="button" className="c-icon-btn" aria-pressed={showCamera} onClick={() => setShowCamera(value => !value)} aria-label={showCamera ? 'Hide camera preview' : 'Show camera preview'}>
                {showCamera ? <Video {...ICON} /> : <VideoOff {...ICON} />}
              </button>
            )}
            <div className="practice-swatches" role="group" aria-label="Pen colour">
              {PEN_COLORS.map(color => (
                <button key={color.token} type="button" className={'practice-swatch' + (penColor === color.token ? ' is-active' : '')} style={{ '--swatch': `var(${color.token})` }} aria-pressed={penColor === color.token} aria-label={color.label} title={color.label} onClick={() => setPenColor(color.token)} />
              ))}
            </div>
            <label className="practice-size">
              <span className="c-meta">Size</span>
              <input type="range" min="1" max="24" step="1" value={penSize} onChange={event => setPenSize(Number(event.target.value))} aria-label="Brush size" />
            </label>
            <button type="button" className="c-icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 {...ICON} /></button>
            <button type="button" className="c-icon-btn" onClick={savePng} aria-label="Save drawing as PNG"><Download {...ICON} /></button>
            {handOn && <span className="c-meta" role="status">{handReady ? 'Pinch to draw' : 'Starting camera…'}</span>}
            </div>
          </div>
          {handError && <div className="retain-action-error" role="alert">{handError}</div>}

          <div ref={boardRef} className="practice-board" data-tool={tool} data-spot="practice-canvas">
            <textarea
              aria-label="Typed work"
              value={workText[problemIndex] || ''}
              onChange={event => setWorkText(all => ({ ...all, [problemIndex]: event.target.value }))}
              placeholder={tool === 'type' ? 'Type here' : ''}
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
            {handOn && (
              <AirDraw
                boardRef={boardRef}
                pen={pen}
                stroke={{ start: startStroke, move: extendStroke, end: endStroke, clear: clearDrawing }}
                showPreview={showCamera}
                onStarted={() => setHandReady(true)}
                onError={message => { setHandError(message); setHandOn(false); setHandReady(false); }}
              />
            )}
            {currentTokens.map(token => (
              <div
                key={token.id}
                className={`practice-token practice-token-${token.kind || 'symbol'}`}
                style={{ left: token.x, top: token.y }}
                onPointerDown={event => beginTokenDrag(event, token)}
                onPointerMove={event => moveToken(event, token)}
                onPointerUp={() => { drag.current = null; }}
                onDoubleClick={() => removeToken(token)}
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
              className="c-input"
              value={answers[problemIndex] || ''}
              onChange={event => setAnswers(all => ({ ...all, [problemIndex]: event.target.value }))}
              placeholder={current?.answer_format || 'Answer'}
              disabled={!current}
            />
            <button type="submit" className="c-btn c-btn--primary" disabled={!current || grading || !answers[problemIndex]?.trim()}>
              {grading ? 'Checking…' : 'Check answer'}
            </button>
            {evaluations[problemIndex] && (
              <div className={`practice-evaluation ${evaluations[problemIndex].status}`} role="status">
                <strong>{evaluations[problemIndex].status === 'correct' ? 'Right' : 'Not quite'}</strong>
                {evaluations[problemIndex].status === 'correct' && evaluations[problemIndex].message && <span>{evaluations[problemIndex].message}</span>}
                {evaluations[problemIndex].status !== 'correct' && (
                  <button type="button" className="c-btn c-btn--quiet" onClick={() => window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { guideId, refresh: true } }))}><MessageCircle {...ICON} />Ask</button>
                )}
                <button type="button" className="c-btn c-btn--quiet practice-report" onClick={reportGrade} disabled={reported[problemIndex]}>
                  <Flag {...ICON} />{reported[problemIndex] ? 'Reported' : 'Report'}
                </button>
              </div>
            )}
            {revealed[problemIndex] && (
              <div className="practice-solution">
                <strong>Answer</strong>
                <p>{current.answer}</p>
                {current.worked_solution && <p className="practice-worked"><strong>Why</strong> {current.worked_solution}</p>}
              </div>
            )}
          </form>
        </article>

        <aside className="c-card practice-source-panel" aria-label="Source material">
          <header className="c-row">
            <h2 className="c-section-title">Source</h2>
            <span className="c-spacer" />
            <button type="button" className="c-btn c-btn--quiet" onClick={() => setShownBlocks(all => (Object.keys(all).length >= sourceBlocks.length ? {} : Object.fromEntries(sourceBlocks.map((_, index) => [index, true]))))}><Eye {...ICON} />{Object.keys(shownBlocks).length >= sourceBlocks.length && sourceBlocks.length ? 'Hide' : 'Reveal'}</button>
          </header>
          <div className="practice-source-copy">
            {sourceBlocks.length ? sourceBlocks.map((block, index) => (
              <p
                key={index}
                className={shownBlocks[index] ? 'practice-source-block' : 'practice-source-block is-blurred'}
                onDoubleClick={() => setShownBlocks(all => ({ ...all, [index]: !all[index] }))}
                title={shownBlocks[index] ? 'Double-click to hide' : 'Double-click to reveal'}
              >{block}</p>
            )) : <p className="c-meta">0 sections</p>}
          </div>
        </aside>
      </section>
      <style jsx>{`
        .practice-page { display: grid; gap: 20px; }
        .practice-title-row { min-width: 0; flex: 1; }
        @media (max-width: 767px) { .practice-head { flex-wrap: wrap; } .practice-title-row { flex-basis: 100%; } }
        .practice-source-name { font-family: var(--font-display); min-width: 0; }
        .practice-prompt { margin: 8px 0 0; font:600 20px/1.15 var(--font-display); }
        .practice-kind { text-transform: capitalize; }
        .practice-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .practice-toolbar .c-seg button { display: inline-flex; align-items: center; gap: 6px; }
        .practice-symbols { display: flex; flex-wrap: wrap; gap: 2px; }
        .practice-symbols :global(.c-icon-btn) { font:600 15px/1 var(--font-sans); }
        .practice-drawbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex-basis: 100%; }
        .practice-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
        .practice-swatch { width: 28px; height: 28px; padding: 0; border: 2px solid transparent; border-radius: var(--r-pill); background: var(--swatch); box-shadow: inset 0 0 0 2px var(--surface-raised); cursor: pointer; transition: border-color var(--dur) var(--ease); }
        .practice-swatch.is-active { border-color: var(--olive); }
        .practice-swatch:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .practice-size { display: inline-flex; align-items: center; gap: 8px; }
        .practice-size input { width: 112px; accent-color: var(--olive); }
        .practice-evaluation { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      `}</style>
    </div>
  );
}
