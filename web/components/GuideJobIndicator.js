import { useRouter } from 'next/router';
import AILoadingSphere from './AILoadingSphere';
import { openUpgrade } from '../lib/api';
import { dismissGuideJob, useGuideJobs } from '../lib/guideJobs';

// Top-right status for study guides building in the background, on every page.
export default function GuideJobIndicator() {
  const router = useRouter();
  const jobs = useGuideJobs();
  if (!jobs.length) return null;

  const running = jobs.filter(job => job.status === 'running');
  const finished = jobs.filter(job => job.status !== 'running');

  return (
    <div className="guide-jobs" aria-live="polite">
      {running.length > 0 && (
        <div className="guide-job guide-job-running" role="status">
          <AILoadingSphere size={15} label="" />
          <span>Building “{running[0].title}”{running.length > 1 ? ` + ${running.length - 1} more` : ''}…</span>
        </div>
      )}
      {finished.map(job => (
        <div key={job.id} className={`guide-job guide-job-${job.status}`}>
          {job.status === 'done'
            ? <span>“{job.title}” is ready</span>
            : <span>{job.error}</span>}
          {job.status === 'done' && (
            <button type="button" className="guide-job-open" onClick={() => { dismissGuideJob(job.id); router.push('/guide/' + job.guideId); }}>Open</button>
          )}
          {job.status === 'error' && job.upgrade && (
            <button type="button" className="guide-job-open" onClick={() => { dismissGuideJob(job.id); openUpgrade({ feature: 'guide' }); }}>View plans</button>
          )}
          <button type="button" className="guide-job-dismiss" onClick={() => dismissGuideJob(job.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
      <style jsx>{`
        .guide-jobs { position: fixed; top: 86px; right: 20px; z-index: 95; display: grid; gap: 8px; justify-items: end; max-width: min(360px, calc(100vw - 32px)); }
        .guide-job { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-card, 0 10px 26px rgba(17, 18, 15, 0.12)); color: var(--ink); font-size: 0.78rem; font-weight: 640; }
        .guide-job span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .guide-job-running :global(.cordia-loader) { gap: 0; }
        .guide-job-running :global(.cordia-loader svg) { filter: none; }
        .guide-job-error span { white-space: normal; color: var(--red, #b42318); }
        .guide-job-open { flex: 0 0 auto; padding: 5px 11px; border: 0; border-radius: 999px; background: #11120f; color: #fff; font: inherit; font-size: 0.72rem; cursor: pointer; }
        .guide-job-dismiss { flex: 0 0 auto; border: 0; background: none; color: var(--muted-ink); font-size: 1rem; line-height: 1; cursor: pointer; }
        @media (max-width: 720px) { .guide-jobs { top: auto; bottom: 16px; right: 16px; } }
      `}</style>
    </div>
  );
}
