import { useState } from 'react';
import { apiFetch, apiErrorMessage } from '../lib/api';
import Toggle from './Toggle';

// Classes found in Canvas, each with an import toggle.
export default function CanvasCourseList({ courses = [], onChange }) {
  const [busy, setBusy] = useState(null);
  const [pending, setPending] = useState({});
  const [error, setError] = useState('');

  async function toggle(course, imported) {
    setBusy(course.id);
    setPending(current => ({ ...current, [course.id]: imported }));
    setError('');
    const data = await apiFetch(`/canvas/courses/${course.id}`, { method: 'PUT', body: JSON.stringify({ imported }) });
    setBusy(null);
    setPending(current => { const next = { ...current }; delete next[course.id]; return next; });
    if (data?.courses) onChange?.(data);
    else setError(apiErrorMessage(data?.detail, 'Canvas could not be reached.'));
  }

  if (!courses.length) return <p className="c-meta">No active classes</p>;
  return (
    <>
      <ul className="ccl" aria-label="Canvas classes">
        {courses.map(course => (
          <li key={course.id} className="ccl-row">
            <span className="ccl-name">
              <strong className="c-truncate">{course.code || course.name}</strong>
              <span className="c-meta c-truncate">{[course.code ? course.name : '', course.term].filter(Boolean).join(' · ')}</span>
            </span>
            <Toggle checked={pending[course.id] ?? course.imported} disabled={busy === course.id} onChange={value => toggle(course, value)} label={`Import ${course.code || course.name}`} hideLabel />
          </li>
        ))}
      </ul>
      {error && <p className="ccl-error" role="alert">{error}</p>}
      <style jsx global>{`
        .ccl { list-style: none; margin: 0; padding: 0; display: grid; }
        .ccl-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 60px; border-bottom: 1px solid var(--line); }
        .ccl-row:last-child { border-bottom: 0; }
        .ccl-name { display: grid; gap: 2px; min-width: 0; }
        .ccl-name strong { font: 600 15px/1.3 var(--font-sans); }
        .ccl-error { margin: 8px 0 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
      `}</style>
    </>
  );
}
