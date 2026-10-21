import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Sparkles } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { SectionLoader } from './CordiaLoader';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'quiz', 'exam', 'test', 'assignment', 'homework', 'week', 'unit', 'chapter', 'module', 'part']);

function words(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !STOP.has(word)));
}

// The guide in this class that best matches an assignment's name, if any word lines up.
function matchGuide(name, guides) {
  const wanted = words(name);
  let best = null;
  let bestScore = 0;
  for (const guide of guides) {
    const shared = [...words(guide.title)].filter(word => wanted.has(word)).length;
    if (shared > bestScore) { best = guide; bestScore = shared; }
  }
  return best;
}

function points(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dueLabel(iso) {
  if (!iso) return 'No due date';
  return 'Due ' + new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function goalLine(goal, total, kind) {
  if (!goal?.letter || goal.points === undefined) return null;
  if (kind === 'keep') {
    return goal.already ? `Your ${goal.letter} is safe on this one` : `${points(goal.points)}/${points(total)} (${goal.percent}%) keeps your ${goal.letter}`;
  }
  if (goal.already) return null;
  return goal.reachable
    ? `${points(goal.points)}/${points(total)} (${goal.percent}%) gets you an ${goal.letter === 'A' ? 'A' : goal.letter}`
    : `Even a perfect score won’t reach ${goal.letter === 'A' ? 'an' : 'a'} ${goal.letter} on this one alone`;
}

// A class's grade from Canvas, and what each upcoming assignment would take.
export default function ClassGrades({ courseId, guides = [], onMakeGuide }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiFetch(`/canvas/courses/${courseId}/grades`).then(result => {
      if (!live) return;
      if (result && Array.isArray(result.upcoming)) setData(result);
      else setError(apiErrorMessage(result?.detail, 'Canvas could not send your grade.'));
    });
    return () => { live = false; };
  }, [courseId]);

  if (error) return <p className="cg-error" role="alert">{error}</p>;
  if (!data) return <SectionLoader height={160} label="Loading your grade" />;

  const score = data.canvas_score ?? data.score;
  const shownLetter = data.canvas_letter || data.letter;

  return (
    <div className="c-stack cg">
      <section className="c-card cg-now" aria-label="Current grade">
        {score === null || score === undefined ? (
          <p className="cg-none">No graded work yet.</p>
        ) : (
          <>
            <span className="cg-letter">{shownLetter || '—'}</span>
            <span className="cg-score">
              <strong>{Number(score).toFixed(1)}%</strong>
              <span className="c-meta">Current grade in Canvas</span>
            </span>
          </>
        )}
      </section>

      {data.upcoming.length > 0 ? (
        <ul className="c-card cg-list">
          {data.upcoming.map(item => {
            const guide = matchGuide(item.name, guides);
            const up = goalLine(item.up, item.points, 'up');
            const keep = goalLine(item.keep, item.points, 'keep');
            return (
              <li key={item.id} className="cg-row">
                <div className="cg-main">
                  <strong className="cg-name">{item.name}</strong>
                  <span className="c-meta">{[dueLabel(item.due_at), `${points(item.points)} pts`, item.group && (item.weight ? `${item.group} · ${item.weight}%` : item.group)].filter(Boolean).join(' · ')}</span>
                  {up && <span className="cg-goal is-up">{up}</span>}
                  {keep && <span className="cg-goal">{keep}</span>}
                </div>
                {guide
                  ? <Link href={'/guide/' + guide.id} className="c-btn c-btn--secondary c-btn--sm"><BookOpen {...ICON} />Study {guide.title.length > 24 ? 'guide' : guide.title}</Link>
                  : onMakeGuide && <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={onMakeGuide}><Sparkles {...ICON} />Make a guide</button>}
              </li>
            );
          })}
        </ul>
      ) : <p className="c-meta">Nothing ungraded coming up.</p>}

      <p className="c-meta cg-note">An estimate on an A 90 · B 80 · C 70 · D 60 scale. Your teacher’s scale, dropped scores or extra credit can change it.</p>

      <style jsx>{`
        .cg-now { display: flex; align-items: center; gap: 20px; padding: 20px 24px; }
        .cg-letter { display: grid; place-items: center; min-width: 64px; height: 64px; padding: 0 12px; border-radius: 18px; background: var(--olive-tint); color: var(--olive-ink); font: 600 var(--fs-28)/1 var(--font-display); }
        .cg-score { display: grid; gap: 2px; }
        .cg-score strong { font: 600 var(--fs-28)/1.1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .cg-none { margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .cg-list { list-style: none; margin: 0; padding: 4px 20px; display: grid; }
        .cg-row { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--line); }
        .cg-row:last-child { border-bottom: 0; }
        .cg-main { flex: 1; min-width: 0; display: grid; gap: 4px; }
        .cg-name { font: 600 17px/1.3 var(--font-sans); overflow-wrap: anywhere; }
        .cg-goal { font: 500 15px/1.4 var(--font-sans); color: var(--ink); }
        .cg-goal.is-up { color: var(--olive-ink); font-weight: 600; }
        .cg-note, .cg-error { margin: 0; }
        .cg-error { color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        @media (max-width: 767px) { .cg-row { flex-wrap: wrap; } .cg-row :global(.c-btn) { width: 100%; justify-content: center; } }
      `}</style>
    </div>
  );
}
