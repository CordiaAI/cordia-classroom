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

  // Module files and pages of an imported class come into its Library folder on their own.
  async function setAuto(course, on) {
    setBusy(`auto-${course.id}`);
    setError('');
    const data = await apiFetch(`/canvas/courses/${course.id}/auto-import`, { method: 'PUT', body: JSON.stringify({ on }), timeoutMs: 120000 });
    setBusy(null);
    if (!Array.isArray(data?.auto_import)) { setError(apiErrorMessage(data?.detail, 'Canvas could not be reached.')); return; }
    const status = await apiFetch('/canvas/status');
    if (status?.courses) onChange?.(status);
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
            {course.imported && (
              <span className="ccl-auto">
                <Toggle checked={Boolean(course.auto_import)} disabled={busy === `auto-${course.id}`} onChange={value => setAuto(course, value)}
                  label={busy === `auto-${course.id}` ? 'Bringing in files…' : 'Bring module files into Library'} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="ccl-error" role="alert">{error}</p>}
      <style jsx global>{`
        .ccl { list-style: none; margin: 0; padding: 0; display: grid; }
        .ccl-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 16px; min-height: 60px; border-bottom: 1px solid var(--line); }
        .ccl-auto { flex: 1 0 100%; padding-bottom: 6px; }
        .ccl-auto .c-toggle { width: 100%; justify-content: space-between; font: 500 14px/1.3 var(--font-sans); color: var(--muted); }
        .ccl-row:last-child { border-bottom: 0; }
        .ccl-name { display: grid; gap: 2px; min-width: 0; }
        .ccl-name strong { font: 600 15px/1.3 var(--font-sans); }
        .ccl-error { margin: 8px 0 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
      `}</style>
    </>
  );
}
