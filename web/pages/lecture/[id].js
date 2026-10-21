import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, BookOpen, CalendarCheck, CalendarPlus, Check, MessageCircle, NotebookPen, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { LoadingArea, Reveal, SectionLoader, useLoadGate } from '../../components/CordiaLoader';
import Menu from '../../components/Menu';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import useSessionTracker from '../../lib/useSessionTracker';
import { startGuideJob } from '../../lib/guideJobs';
import { generateAndSave, newRequestId } from '../../lib/guideCreate';
import { analyzeLecture, clock, deleteLecture, dueLabel, getLecture, updateLecture, updateTodo } from '../../lib/lectures';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const WHY = { exam: 'On the exam', mistake: 'Common mistake', emphasis: 'Stressed', requirement: 'Required' };
const KIND = { assignment: 'Assignment', reading: 'Reading', exam: 'Exam', other: 'To do' };

function dateLong(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '';
}

// One lecture: what it covered, what to watch for, what to do, and the transcript behind it all.
export default function LecturePage() {
  const router = useRouter();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  useSessionTracker('read', null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [folders, setFolders] = useState([]);
  const [renaming, setRenaming] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [find, setFind] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState('');
  const [making, setMaking] = useState(false);
  const [notes, setNotes] = useState('idle'); // idle | writing | failed | unavailable
  const notesAsked = useRef(false);
  const gate = useLoadGate(Boolean(data) || Boolean(error));

  useEffect(() => {
    if (!ready || !id) return;
    getLecture(id).then(result => {
      if (result?.lecture) setData(result);
      else setError(result?.detail || "This lecture couldn't be loaded.");
    });
    apiFetch('/folders').then(result => setFolders(result?.folders || []));
  }, [ready, id]);

  // Every lecture gets notes: written here if AI didn't run when it was saved, and filed in Notes.
  async function writeNotes() {
    setNotes(data?.lecture?.analysis?.analyzed ? 'idle' : 'writing');
    const result = await analyzeLecture(id);
    if (result?.analysis) setData(current => ({ ...current, lecture: { ...current.lecture, analysis: result.analysis }, todos: result.todos || current.todos }));
    setNotes(result?.analysis?.analyzed ? 'idle' : result?.reason === 'not_configured' ? 'unavailable' : 'failed');
  }

  useEffect(() => {
    const current = data?.lecture?.analysis;
    if (!data?.lecture || notesAsked.current || (current?.analyzed && current?.note_id)) return;
    notesAsked.current = true;
    writeNotes();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const lecture = data?.lecture;
  const analysis = lecture?.analysis || {};
  const segments = useMemo(() => (lecture?.segments?.length ? lecture.segments : lecture?.transcript ? [{ start_ms: 0, text: lecture.transcript }] : []), [lecture]);
  const timed = segments.length > 1 || (segments[0]?.start_ms || 0) > 0;
  const shownSegments = find.trim() ? segments.filter(segment => segment.text.toLowerCase().includes(find.trim().toLowerCase())) : segments;

  function patchLecture(change) {
    setData(current => ({ ...current, lecture: { ...current.lecture, ...change } }));
    updateLecture({ id, ...change });
  }

  function saveTitle(event) {
    event?.preventDefault();
    const title = (renaming || '').trim();
    setRenaming(null);
    if (title && title !== lecture.title) patchLecture({ title });
  }

  async function changeTodo(todo, change) {
    setData(current => ({ ...current, todos: current.todos.map(item => (item.id === todo.id ? { ...item, ...change, ...(change.due_date !== undefined ? { due_at: change.due_date ? `${change.due_date}T23:59:00Z` : null } : {}) } : item)).filter(item => item.status !== 'dismissed') }));
    const result = await updateTodo({ id: todo.id, ...change });
    if (result?.failed) setToast("Couldn't save that. Try again.");
    else if (change.status === 'confirmed') setToast('Added to your calendar');
  }

  // Jump to the transcript line a point came from.
  function jump(at) {
    setShowTranscript(true);
    setFind('');
    setTimeout(() => {
      const target = [...document.querySelectorAll('[data-at]')].filter(node => Number(node.dataset.at) <= at).pop();
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.classList.add('is-flash');
      setTimeout(() => target?.classList.remove('is-flash'), 1600);
    }, 50);
  }

  function makeGuide() {
    setMaking(true);
    const title = lecture.title;
    startGuideJob({
      title,
      run: async () => {
        const guide = await generateAndSave({
          source: lecture.transcript, requestId: newRequestId(), title, sourceTitle: title, sourceType: 'lecture', sourceUrl: '',
          externalSourceId: '', folderId: lecture.folder_id || '', notes: true, flashcards: true, manualPairs: null,
        });
        await updateLecture({ id: lecture.id, guide_id: guide.id });
        setData(current => (current ? { ...current, lecture: { ...current.lecture, guide_id: guide.id } } : current));
        setMaking(false);
        return guide;
      },
    });
    setToast('Building a study guide. It shows at the top right.');
  }

  function askTutor() {
    const summary = (analysis.summary || []).join(' ');
    window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { guideId: lecture.guide_id || null, prompt: `Help me understand my lecture "${lecture.title}". ${summary}`.trim(), send: false } }));
  }

  async function remove() {
    setConfirmDelete(false);
    await deleteLecture(id);
    router.push('/library?tab=lectures');
  }

  if (error) {
    return (
      <div className="c-page">
        <div className="c-empty"><span className="c-section-title">{error}</span><Link className="c-btn c-btn--secondary" href="/library?tab=lectures">Back to lectures</Link></div>
      </div>
    );
  }
  if (!lecture || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading lecture" />;

  const folder = folders.find(item => item.id === lecture.folder_id);
  const todos = data.todos || [];
  const meta = [dateLong(lecture.lecture_date), lecture.duration_ms > 60000 ? `${Math.round(lecture.duration_ms / 60000)} min` : '', lecture.source === 'notes' ? 'From notes' : lecture.source === 'upload' ? 'Uploaded recording' : 'Recorded'].filter(Boolean);

  return (
    <Reveal phase={gate}>
    <article className="c-page lecture">
      <header className="lecture-head">
        <button type="button" className="c-icon-btn" onClick={() => router.push('/library?tab=lectures')} aria-label="Back"><ArrowLeft {...ICON} /></button>
        {renaming !== null ? (
          <form className="lecture-rename" onSubmit={saveTitle}>
            <input className="c-input" value={renaming} onChange={event => setRenaming(event.target.value)} onBlur={saveTitle} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Lecture title" autoFocus />
          </form>
        ) : (
          <h1 className="c-title lecture-title">{lecture.title}</h1>
        )}
        <Menu
          label="Lecture actions"
          items={[
            { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(lecture.title) },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </header>

      <div className="lecture-meta">
        <span className="c-meta">{meta.join(' · ')}</span>
        {folders.length > 0 && (
          <select className="c-select lecture-class" value={lecture.folder_id || ''} onChange={event => patchLecture({ folder_id: event.target.value || null })} aria-label="Class">
            <option value="">No class</option>
            {folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        <span className="c-spacer" />
        <button type="button" className="c-btn c-btn--secondary" onClick={askTutor}><MessageCircle {...ICON} />Ask</button>
        {lecture.guide_id
          ? <Link className="c-btn c-btn--primary" href={'/guide/' + lecture.guide_id}><BookOpen {...ICON} />Study guide</Link>
          : <button type="button" className="c-btn c-btn--primary" onClick={makeGuide} disabled={making}><Sparkles {...ICON} />{making ? 'Building…' : 'Make study guide'}</button>}
      </div>

      {analysis.summary?.length > 0 && (
        <section className="c-card lecture-card" aria-labelledby="lecture-summary">
          <h2 id="lecture-summary" className="c-section-title">Summary</h2>
          <ul className="c-study lecture-points">{analysis.summary.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </section>
      )}

      <section className="c-card lecture-card" aria-labelledby="lecture-notes">
        <div className="lecture-item-head">
          <h2 id="lecture-notes" className="c-section-title">Notes</h2>
          {analysis.note_id && <Link className="c-btn c-btn--quiet c-btn--sm" href={'/smartnotes?id=' + analysis.note_id}><NotebookPen size={16} strokeWidth={1.75} aria-hidden="true" />Open in Notes</Link>}
        </div>
        {analysis.outline?.length > 0 ? analysis.outline.map((section, index) => (
          <div key={index} className="lecture-outline-section">
            <div className="lecture-item-head">
              <h3 className="lecture-outline-heading">{section.heading}</h3>
              {timed && <button type="button" className="c-btn c-btn--quiet c-btn--sm lecture-time" onClick={() => jump(section.at_ms)}>{clock(section.at_ms)}</button>}
            </div>
            {section.points?.length > 0 && <ul className="c-study lecture-points">{section.points.map((point, pointIndex) => <li key={pointIndex}>{point}</li>)}</ul>}
          </div>
        )) : notes === 'writing' || (notes === 'idle' && !analysis.analyzed) ? (
          <div className="lecture-notes-writing">
            <SectionLoader height={96} label="Writing your notes" />
            <p className="c-meta">Writing your notes from the lecture…</p>
          </div>
        ) : (
          <div className="lecture-notes-empty">
            <p className="c-meta">{notes === 'unavailable' ? "AI notes aren't set up on this site yet. The full transcript is below." : analysis.analyzed ? 'There was too little in this lecture to outline. The full transcript is below.' : "Couldn't write notes yet. The full transcript is below."}</p>
            {notes === 'failed' && <button type="button" className="c-btn c-btn--secondary" onClick={writeNotes}><Sparkles {...ICON} />Try again</button>}
          </div>
        )}
      </section>

      {analysis.watch_for?.length > 0 && (
        <section className="c-card lecture-card" aria-labelledby="lecture-watch">
          <h2 id="lecture-watch" className="c-section-title">What to watch for</h2>
          <ul className="lecture-items">
            {analysis.watch_for.map((item, index) => (
              <li key={index} className="lecture-item">
                <div className="lecture-item-head">
                  <strong>{item.point}</strong>
                  <span className="c-chip">{WHY[item.why] || 'Stressed'}</span>
                </div>
                <blockquote className="lecture-quote">“{item.quote}”</blockquote>
                {timed && <button type="button" className="c-btn c-btn--quiet c-btn--sm lecture-time" onClick={() => jump(item.at_ms)}>{clock(item.at_ms)}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {todos.length > 0 && (
        <section className="c-card lecture-card" aria-labelledby="lecture-todo">
          <h2 id="lecture-todo" className="c-section-title">To do</h2>
          <ul className="lecture-items">
            {todos.map(todo => (
              <li key={todo.id} className={'lecture-item lecture-todo' + (todo.status === 'done' ? ' is-done' : '')}>
                <div className="lecture-item-head">
                  <strong>{todo.title}</strong>
                  <span className="c-chip">{KIND[todo.kind] || 'To do'}</span>
                </div>
                <blockquote className="lecture-quote">“{todo.quote}”</blockquote>
                <div className="lecture-todo-row">
                  <label className="lecture-due">
                    <span className="c-meta">Due{todo.said ? ` (said: ${todo.said})` : ''}</span>
                    <input className="c-input" type="date" value={todo.due_at ? todo.due_at.slice(0, 10) : ''} onChange={event => changeTodo(todo, { due_date: event.target.value })} aria-label={`Due date for ${todo.title}`} />
                  </label>
                  <span className="c-spacer" />
                  {todo.status === 'suggested' && (
                    <>
                      <button type="button" className="c-btn c-btn--quiet" onClick={() => changeTodo(todo, { status: 'dismissed' })}><X {...ICON} />Not a to-do</button>
                      <button type="button" className="c-btn c-btn--primary" onClick={() => changeTodo(todo, { status: 'confirmed' })} disabled={!todo.due_at}><CalendarPlus {...ICON} />Add to calendar</button>
                    </>
                  )}
                  {todo.status === 'confirmed' && (
                    <>
                      <span className="c-meta lecture-on-cal"><CalendarCheck size={16} strokeWidth={1.75} aria-hidden="true" />On your calendar · {dueLabel(todo.due_at)}</span>
                      <button type="button" className="c-btn c-btn--secondary" onClick={() => changeTodo(todo, { status: 'done' })}><Check {...ICON} />Done</button>
                    </>
                  )}
                  {todo.status === 'done' && <span className="c-meta"><Check size={16} strokeWidth={1.75} aria-hidden="true" /> Done</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.terms?.length > 0 && (
        <section className="c-card lecture-card" aria-labelledby="lecture-terms">
          <h2 id="lecture-terms" className="c-section-title">Key terms</h2>
          <dl className="lecture-terms">
            {analysis.terms.map((item, index) => (
              <div key={index} className="lecture-term"><dt>{item.term}</dt><dd>{item.definition}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {analysis.questions?.length > 0 && (
        <section className="c-card lecture-card" aria-labelledby="lecture-questions">
          <h2 id="lecture-questions" className="c-section-title">Questions from class</h2>
          <ul className="c-study lecture-points">{analysis.questions.map((item, index) => <li key={index}>{item.question}</li>)}</ul>
        </section>
      )}

      <section className="c-card lecture-card" aria-labelledby="lecture-transcript">
        <div className="lecture-item-head">
          <h2 id="lecture-transcript" className="c-section-title">{lecture.source === 'notes' ? 'Your notes' : 'Transcript'}</h2>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setShowTranscript(value => !value)} aria-expanded={showTranscript}>{showTranscript ? 'Hide' : 'Show'}</button>
        </div>
        {showTranscript && (
          <>
            <input className="c-input" type="search" value={find} onChange={event => setFind(event.target.value)} placeholder="Find in transcript" aria-label="Find in transcript" />
            <div className="lecture-transcript">
              {shownSegments.length ? shownSegments.map((segment, index) => (
                <p key={index} data-at={segment.start_ms} className="lecture-line">
                  {timed && <span className="c-meta lecture-line-time">{clock(segment.start_ms)}</span>}
                  <span>{segment.text}</span>
                </p>
              )) : <p className="c-meta">No matches</p>}
            </div>
          </>
        )}
      </section>

      {confirmDelete && <ConfirmDialog title={`Delete ${lecture.title}?`} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />}
      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}

      <style jsx>{`
        .lecture { gap: 16px; }
        .lecture-head { display: flex; align-items: center; gap: 8px; }
        .lecture-title { flex: 1 1 auto; min-width: 0; text-wrap: balance; }
        .lecture-rename { flex: 1 1 auto; }
        .lecture-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .lecture-class { width: auto; min-width: 160px; }
        .lecture-notes-empty { display: grid; justify-items: start; gap: 12px; }
        .lecture-notes-empty .c-meta { margin: 0; }
        .lecture-notes-writing { display: grid; justify-items: center; gap: 4px; padding-bottom: 16px; }
        .lecture-notes-writing .c-meta { margin: 0; }
        .lecture-card { display: grid; gap: 16px; padding: 20px; }
        .lecture-card :global(.c-section-title) { margin: 0; }
        .lecture-points { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
        .lecture-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
        .lecture-item { display: grid; gap: 8px; padding-bottom: 16px; border-bottom: 1px solid var(--hairline); }
        .lecture-item:last-child { padding-bottom: 0; border-bottom: 0; }
        .lecture-item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .lecture-item-head strong { font: 600 var(--fs-17)/var(--lh-title) var(--font-sans); color: var(--ink); }
        .lecture-quote { margin: 0; padding-left: 12px; border-left: 2px solid var(--hairline); color: var(--muted); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); }
        .lecture-time { justify-self: start; font-variant-numeric: tabular-nums; }
        .lecture-todo-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
        .lecture-due { display: grid; gap: 4px; }
        .lecture-due .c-input { width: 180px; }
        .lecture-on-cal { display: inline-flex; align-items: center; gap: 4px; }
        .lecture-todo.is-done strong { text-decoration: line-through; color: var(--muted); }
        .lecture-outline-section { display: grid; gap: 8px; }
        .lecture-outline-heading { margin: 0; font: 600 var(--fs-17)/var(--lh-title) var(--font-sans); color: var(--ink); }
        .lecture-terms { margin: 0; display: grid; gap: 12px; }
        .lecture-term { display: grid; grid-template-columns: minmax(120px, 220px) 1fr; gap: 16px; }
        .lecture-term dt { font: 600 var(--fs-15)/var(--lh-body) var(--font-sans); color: var(--ink); }
        .lecture-term dd { margin: 0; font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); color: var(--ink); }
        .lecture-transcript { max-height: 480px; overflow: auto; display: grid; gap: 8px; }
        .lecture-line { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 4px 8px; border-radius: var(--r-input); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); color: var(--ink); transition: background var(--dur) var(--ease); }
        .lecture-line:not(:has(.lecture-line-time)) { grid-template-columns: 1fr; }
        .lecture-line-time { font-variant-numeric: tabular-nums; padding-top: 2px; }
        .lecture-line:global(.is-flash) { background: var(--olive-tint); }
        @media (max-width: 600px) { .lecture-term { grid-template-columns: 1fr; gap: 4px; } }
      `}</style>
    </article>
    </Reveal>
  );
}
