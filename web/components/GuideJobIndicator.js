import { useEffect } from 'react';
import { useRouter } from 'next/router';
import CordiaLoader from './CordiaLoader';
import { openUpgrade } from '../lib/api';
import { dismissGuideJob, useGuideJobs } from '../lib/guideJobs';
import { newGuideHref } from '../lib/checkYourself';

// How long a "… is ready" notice stays before it clears itself (the set is in the Library).
const DONE_NOTICE_MS = 20000;

// Top-right status for study guides building in the background, on every page.
// Every notice wraps to fit the screen, so its Open and × buttons are always reachable.
export default function GuideJobIndicator() {
  const router = useRouter();
  const jobs = useGuideJobs();
  const doneKey = jobs.filter(job => job.status === 'done').map(job => `${job.id}:${job.guideId}`).join(',');

  // A finished set's notice clears itself after a while, and at once on that set's own page.
  useEffect(() => {
    const done = jobs.filter(job => job.status === 'done');
    const here = typeof router.query.id === 'string' && router.pathname.startsWith('/guide/') ? router.query.id : '';
    done.filter(job => job.guideId && job.guideId === here).forEach(job => dismissGuideJob(job.id));
    const timers = done.filter(job => job.guideId !== here).map(job => setTimeout(() => dismissGuideJob(job.id), DONE_NOTICE_MS));
    return () => timers.forEach(clearTimeout);
  }, [doneKey, router.asPath]);

  if (!jobs.length) return null;

  const running = jobs.filter(job => job.status === 'running');
  const finished = jobs.filter(job => job.status !== 'running');

  return (
    <div className="guide-jobs" aria-live="polite">
      {running.length > 0 && (
        <div className="guide-job guide-job-running" role="status">
          <CordiaLoader size={20} label="Making your guide" />
          <span>Building “{running[0].title}”{running.length > 1 ? ` + ${running.length - 1} more` : ''}…</span>
        </div>
      )}
      {finished.map(job => (
        <div key={job.id} className={`guide-job guide-job-${job.status}`}>
          {job.status === 'done'
            ? <span>“{job.title}” is ready{job.from ? ` (from ${job.from})` : ''}</span>
            : <span>{job.error}</span>}
          {job.status === 'done' && (
            <button type="button" className="guide-job-open" onClick={() => { dismissGuideJob(job.id); router.push(newGuideHref(job.guideId)); }}>Open</button>
          )}
          {job.status === 'error' && job.upgrade && (
            <button type="button" className="guide-job-open" onClick={() => { dismissGuideJob(job.id); openUpgrade({ feature: 'guide' }); }}>View plans</button>
          )}
          <button type="button" className="guide-job-dismiss" onClick={() => dismissGuideJob(job.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
      <style jsx>{`
        .guide-jobs { position: fixed; top: 86px; right: 20px; z-index: 95; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; justify-items: end; width: max-content; max-width: min(380px, calc(100vw - 32px)); }
        .guide-job { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 8px 10px 8px 14px; border: 1px solid var(--line); border-radius:12px; background: var(--surface); box-shadow:var(--shadow-card); color: var(--ink); font-size: 13px; font-weight:600; }
        .guide-job span { flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
        .guide-job-running :global(.cordia-loader) { gap: 0; flex: 0 0 auto; }
        .guide-job-running :global(.cordia-loader svg) { filter: none; }
        .guide-job-error span { color: var(--error); }
        .guide-job-open { flex: 0 0 auto; padding: 5px 11px; border: 0; border-radius:999px; background: var(--olive); color: var(--on-olive); font: inherit; font-size: 13px; cursor: pointer; }
        .guide-job-dismiss { flex: 0 0 auto; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: none; color: var(--muted-ink); font-size:17px; line-height:1; cursor: pointer; }
        .guide-job-dismiss:hover { background: var(--lift-pane); color: var(--ink); }
        @media (max-width: 720px) { .guide-jobs { top: auto; bottom: calc(var(--tabbar-h, 0px) + 80px); left: 16px; right: 16px; width: auto; max-width: none; } }
      `}</style>
    </div>
  );
}
