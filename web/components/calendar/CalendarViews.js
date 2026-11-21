import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowRight, CalendarCheck } from 'lucide-react';
import SegmentedControl from '../SegmentedControl';
import AssignmentSheet from '../AssignmentSheet';
import { addDays, monthLabel, PHONE_MAX, pickView, sameDay, span, startOfWeek, VIEW_LABELS, VIEWS, weekRangeLabel } from '../../lib/calendarViews.mjs';
import { addBlock, findTime, moveBlock } from '../../lib/calendarData';
import { scheduleNotice } from '../../lib/studyPlans';
import { ICON, SharedStyles } from './parts';
import WeekView from './WeekView';
import BoardView from './BoardView';
import MonthView from './MonthView';
import AgendaView from './AgendaView';

const VIEW_KEY = 'cordiaCalendarView';
const UNDO_MS = 6000;

// Undo puts focus back on the block it moved (the toast's button goes away with the toast).
function focusBlock(id) {
  const find = () => document.querySelector(`[data-block="${CSS.escape(String(id))}"]`);
  requestAnimationFrame(() => find()?.focus({ preventScroll: true }));
}

function savedView() {
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}
function saveView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window: the default next time */ }
}

// Wide (768px and up) shows the four views; a phone shows Agenda only.
function useWide() {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(`(min-width: ${PHONE_MAX + 1}px)`).matches));
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${PHONE_MAX + 1}px)`);
    const change = () => setWide(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return wide;
}

// The clock the views draw "now" from, moved on every minute.
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// The Calendar: one header (title, range, back / Today / next, the view switch, Plan my week) over
// Week, Board, Month or Agenda. The views share the model (lib/calendarViews.mjs) and the writes
// here: moving and adding study time (with Undo or a clear error) and Find time.
// loading: what shows under the title until the data is in (the title itself never moves).
export default function CalendarViews({ deadlines = [], blocks = [], needs = [], readiness = {}, readinessIn = true, setRawBlocks, reloadBlocks, tools, below, loading = null }) {
  const wide = useWide();
  const now = useNow();
  const router = useRouter();
  const [chosen, setChosen] = useState(() => (typeof window === 'undefined' ? null : savedView()));
  const view = pickView(chosen, wide);
  const [anchor, setAnchor] = useState(() => new Date());
  const weekStart = startOfWeek(anchor);
  const [toast, setToast] = useState(null); // { text, undo?, undoText?, error? }
  const toastTimer = useRef(null);
  const toastNow = useRef(null); // the toast on screen, for say() to read without a stale closure
  const [saving, setSaving] = useState(() => new Set());
  const [finding, setFinding] = useState(false);
  const [sheet, setSheet] = useState(null);

  const choose = next => { setChosen(next); saveView(next); };
  // A refusal or error while a move's Undo is still up keeps that Undo, with the move it undoes on a
  // second line, so saying why one move stopped never takes back the chance to undo the last.
  const show = useCallback(next => { toastNow.current = next; setToast(next); }, []);
  const say = useCallback((text, { undo = null, error = false } = {}) => {
    clearTimeout(toastTimer.current);
    const live = toastNow.current;
    const kept = !undo && live?.undo ? { undo: live.undo, undoText: live.undoText || live.text } : { undo, undoText: '' };
    show({ text, error, ...kept, key: Date.now() });
    toastTimer.current = setTimeout(() => show(null), error ? 8000 : UNDO_MS);
  }, [show]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const busy = (id, on) => setSaving(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });

  // Optimistic: the block moves at once; a failed save puts it back and says why.
  const move = useCallback(async (block, next, { quiet = false } = {}) => {
    const before = { start: block.start, end: block.end };
    const place = ({ start, end }) => setRawBlocks(list => list.map(row => (row.id === block.id ? { ...row, starts_at: start.toISOString(), ends_at: end.toISOString() } : row)));
    place(next);
    busy(block.id, true);
    const { block: saved, error } = await moveBlock(block.id, next.start, next.end);
    busy(block.id, false);
    if (error) {
      place(before);
      say(error, { error: true });
      return false;
    }
    setRawBlocks(list => list.map(row => (row.id === block.id ? { ...row, ...saved } : row)));
    if (!quiet) {
      const day = next.start.toLocaleDateString('en-US', { weekday: 'short' });
      say(`${block.title} moved to ${day}, ${span(next.start, next.end)}`, {
        undo: () => { focusBlock(block.id); return move({ ...block, ...next }, before, { quiet: true }).then(() => focusBlock(block.id)); },
      });
    }
    return true;
  }, [say, setRawBlocks]);

  const add = useCallback(async (deadline, day) => {
    busy(deadline.id, true);
    const { block, error } = await addBlock(deadline.id, { day });
    busy(deadline.id, false);
    if (error) { say(error, { error: true }); return; }
    setRawBlocks(list => [...list, block]);
    const start = new Date(block.starts_at);
    say(`Study time for ${deadline.title}: ${start.toLocaleDateString('en-US', { weekday: 'short' })}, ${span(start, new Date(block.ends_at))}`);
  }, [say, setRawBlocks]);

  const find = useCallback(async items => {
    const keys = items.filter(item => !item.internal).map(item => item.id);
    if (!keys.length) return;
    setFinding(true);
    const { result, error } = await findTime(keys);
    setFinding(false);
    if (error) { say(error, { error: true }); return; }
    say(scheduleNotice(result, { where: 'to your calendar', covered: 'These already have study time.' }));
    reloadBlocks();
  }, [reloadBlocks, say]);

  // Start (study time), Review now (an exam): Learn on the review set when there is one, else the
  // assignment's plan (steps, rubric, the Tutor, Make a review set).
  const open = useCallback(entry => {
    const deadline = entry.kind === 'study' ? entry.deadline : entry;
    const ready = deadline && readiness[deadline.id];
    if ((entry.kind === 'study' ? entry.review : entry.exam) && ready?.guideId) { router.push(`/learn/${ready.guideId}`); return; }
    if (deadline?.internal && deadline.url) { router.push(deadline.url); return; }
    if (deadline) { setSheet(deadline.source); return; }
    router.push('/week');
  }, [readiness, router]);

  const step = view === 'month' ? null : 7;
  const go = direction => setAnchor(current => {
    if (step) return addDays(current, direction * step);
    return new Date(current.getFullYear(), current.getMonth() + direction, 1);
  });
  const isNow = view === 'month' ? anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear() : sameDay(weekStart, startOfWeek(now));
  const range = view === 'month' ? monthLabel(anchor) : weekRangeLabel(weekStart);

  const shared = { deadlines, blocks, needs, readiness, readinessIn, now, weekStart, saving, onOpen: open, onFind: find, finding };
  return (
    <div className="cal">
      <header className="cal-head">
        <div className="cal-head-main">
          <h1 className="c-title cal-title">Calendar</h1>
          {!loading && <p className="cal-range" aria-live="polite">{range}</p>}
          {!loading && <div className="cal-nav">
            <button type="button" className="c-icon-btn" onClick={() => go(-1)} aria-label={view === 'month' ? 'Previous month' : 'Previous week'}><ArrowLeft {...ICON} /></button>
            <button type="button" className="c-btn c-btn--quiet cal-today" onClick={() => setAnchor(new Date())} aria-pressed={isNow}>Today</button>
            <button type="button" className="c-icon-btn" onClick={() => go(1)} aria-label={view === 'month' ? 'Next month' : 'Next week'}><ArrowRight {...ICON} /></button>
          </div>}
        </div>
        {!loading && <div className="cal-head-actions">
          {wide && (
            <SegmentedControl kind="tabs" label="Calendar view" className="cal-switch">
              {VIEWS.map(name => (
                <button key={name} type="button" role="tab" aria-selected={view === name} aria-controls="cal-view" id={`cal-tab-${name}`} onClick={() => choose(name)}>{VIEW_LABELS[name]}</button>
              ))}
            </SegmentedControl>
          )}
          <Link href="/week" className="c-btn c-btn--primary cal-plan"><CalendarCheck {...ICON} />Plan my week</Link>
        </div>}
      </header>

      {loading || <div id="cal-view" role={wide ? 'tabpanel' : undefined} aria-labelledby={wide ? `cal-tab-${view}` : undefined} className={`cal-view cal-view--${view}`}>
        {view === 'week' && <WeekView {...shared} onMove={move} onRefuse={text => say(text, { error: true })} />}
        {view === 'board' && <BoardView {...shared} onAdd={add} />}
        {view === 'month' && <MonthView {...shared} anchor={anchor} onPickMonth={setAnchor} />}
        {view === 'agenda' && <AgendaView {...shared} wide={wide} onJump={day => setAnchor(day)} />}
      </div>}

      {tools}
      {below}

      {toast && (
        <div key={toast.key} className="c-toast cal-toast" role={toast.error ? 'alert' : 'status'}>
          <span className="cal-toast-text">{toast.text}{toast.undoText && <span className="cal-toast-prior">{toast.undoText}</span>}</span>
          {toast.undo && <button type="button" className="c-btn c-btn--quiet" aria-label={toast.undoText ? `Undo: ${toast.undoText}` : undefined}
            onClick={() => { const undo = toast.undo; clearTimeout(toastTimer.current); show(null); undo(); }}>Undo</button>}
        </div>
      )}
      {sheet && <AssignmentSheet item={sheet} onClose={() => { setSheet(null); reloadBlocks(); }} />}

      <SharedStyles />
      <style jsx>{`
        .cal { display: grid; gap: 1rem; min-width: 0; }
        .cal-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; }
        .cal-head-main { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.875rem; min-width: 0; }
        .cal-title { font-size: 2.25rem; line-height: 1.1; }
        .cal-range { margin: 0; color: var(--muted); font: 600 1.0625rem/1.3 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cal-nav { display: flex; align-items: center; gap: 0.125rem; }
        .cal-nav :global(.cal-today) { padding: 0 0.75rem; color: var(--ink); font-weight: 600; }
        .cal-nav :global(.c-icon-btn) { color: var(--ink); }
        .cal-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
        .cal-head-actions :global(.cal-switch) { flex: 0 0 auto; }
        .cal-head-actions :global(.cal-plan) { white-space: nowrap; }
        .cal-view { min-width: 0; }
        .cal :global(.cal-toast) { max-width: calc(100vw - 2rem); }
        .cal :global(.cal-toast > span) { min-width: 0; }
        .cal-toast-text { display: grid; gap: 0.125rem; }
        .cal-toast-prior { color: var(--muted); font-size: 0.875rem; }
        @media (max-width: 767px) {
          .cal-title { font-size: 1.75rem; }
          .cal-head { align-items: flex-start; }
          .cal-head-actions { width: 100%; }
          .cal-head-actions :global(.cal-plan) { flex: 1; justify-content: center; min-height: 2.75rem; }
          .cal-nav :global(.c-icon-btn) { width: 2.75rem; height: 2.75rem; }
        }
      `}</style>
    </div>
  );
}
