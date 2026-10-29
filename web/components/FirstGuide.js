import { useState } from 'react';
import { useRouter } from 'next/router';
import { BookOpen, GraduationCap, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { SAMPLE_GUIDE } from '../lib/sampleGuide';
import { firstGuideClasses } from '../lib/studySet.mjs';
import CordiaLoader from './CordiaLoader';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// A new student with nothing to study yet: one tap brings in their class's latest module from
// Canvas (or a sample), and Learn opens on it. Learn makes the questions from the notes itself.
export default function FirstGuide({ canvas, coursework, onDismiss }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const classes = canvas?.connected ? firstGuideClasses(canvas.courses, coursework?.upcoming) : [];

  async function sample() {
    setBusy('sample');
    setError('');
    const saved = await apiFetch('/guides', { method: 'POST', body: JSON.stringify(SAMPLE_GUIDE) });
    if (saved?.guide?.id) { router.push('/learn/' + saved.guide.id); return; }
    setBusy('');
    setError(apiErrorMessage(saved?.detail, "The sample didn't open. Try again."));
  }

  // The class is imported if it isn't yet, its module files come in, and the newest one opens.
  async function bringIn(course) {
    setBusy(String(course.id));
    setError('');
    const fail = detail => { setBusy(''); setError(apiErrorMessage(detail, 'Canvas could not be reached. Try again.')); };
    if (!course.imported) {
      const status = await apiFetch(`/canvas/courses/${course.id}`, { method: 'PUT', body: JSON.stringify({ imported: true }), timeoutMs: 120000 });
      if (!status?.courses) { fail(status?.detail); return; }
    }
    const auto = await apiFetch(`/canvas/courses/${course.id}/auto-import`, { method: 'PUT', body: JSON.stringify({ on: true }), timeoutMs: 120000 });
    if (!Array.isArray(auto?.auto_import)) { fail(auto?.detail); return; }
    const list = await apiFetch('/guides?fields=summary&limit=50');
    // Newest first: the last file brought in is from the latest module reached.
    const imports = (list?.guides || []).filter(guide => guide.source_type === 'canvas_module');
    const latest = imports.find(guide => course.name && String(guide.source_title || '').startsWith(course.name)) || imports[0];
    if (latest) { router.push('/learn/' + latest.id); return; }
    setBusy('');
    setError(`${course.code || course.name} has no module files or pages Cordia can read yet. Try another class or the sample.`);
  }

  return (
    <section className="c-card first-guide" aria-labelledby="first-guide-title">
      <div className="first-guide-head">
        <GraduationCap {...ICON} />
        <h2 id="first-guide-title" className="c-section-title">Start studying</h2>
        <button type="button" className="c-icon-btn" onClick={onDismiss} aria-label="Dismiss"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      {classes.length > 0 ? (
        <>
          <p className="c-meta">Pick a class: Cordia brings in its latest module and turns it into questions to learn.</p>
          <div className="first-guide-classes">
            {classes.slice(0, 4).map((course, index) => (
              <button key={course.id} type="button" className={'c-btn ' + (index === 0 ? 'c-btn--primary' : 'c-btn--secondary')} disabled={Boolean(busy)} onClick={() => bringIn(course)}>
                {busy === String(course.id) ? <><CordiaLoader size={20} label="" />Bringing it in…</> : course.code || course.name}
              </button>
            ))}
          </div>
          <button type="button" className="c-btn c-btn--quiet first-guide-sample" disabled={Boolean(busy)} onClick={sample}><BookOpen {...ICON} />{busy === 'sample' ? 'Opening…' : 'Or try a sample'}</button>
        </>
      ) : (
        <>
          <p className="c-meta">See how Learn works on a short sample about how memory works. It takes two minutes.</p>
          <button type="button" className="c-btn c-btn--primary first-guide-try" disabled={Boolean(busy)} onClick={sample}>
            {busy === 'sample' ? <><CordiaLoader size={20} label="" />Opening…</> : <><BookOpen {...ICON} />Try a sample</>}
          </button>
        </>
      )}
      {error && <p className="first-guide-error" role="alert">{error}</p>}
      <style jsx>{`
        .first-guide { display: grid; gap: 12px; padding: 18px 20px; }
        .first-guide p { margin: 0; }
        .first-guide-head { display: flex; align-items: center; gap: 10px; }
        .first-guide-head :global(.lucide) { color: var(--olive-ink); }
        .first-guide-head h2 { flex: 1; margin: 0; }
        .first-guide-classes { display: flex; flex-wrap: wrap; gap: 8px; }
        .first-guide-try, .first-guide-sample { justify-self: start; }
        .first-guide-error { color: var(--error); font: 600 15px/1.4 var(--font-sans); }
      `}</style>
    </section>
  );
}
