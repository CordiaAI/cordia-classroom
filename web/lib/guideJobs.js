import { useEffect, useState } from 'react';

// Study guides being built in the background. The store lives outside any page,
// so generation keeps going while the student moves around the app.
let jobs = [];
const listeners = new Set();
let nextId = 1;

function publish(next) {
  jobs = next;
  listeners.forEach(notify => notify(jobs));
}

function update(id, changes) {
  publish(jobs.map(job => (job.id === id ? { ...job, ...changes } : job)));
}

function warnBeforeLeaving(event) {
  if (!jobs.some(job => job.status === 'running')) return;
  event.preventDefault();
  event.returnValue = '';
}

// run() resolves to the saved guide ({ id, ... }) or throws an Error, optionally
// carrying an `upgrade` flag when the plan limit was reached.
export function startGuideJob({ title, run }) {
  const id = nextId++;
  if (typeof window !== 'undefined' && !jobs.length) window.addEventListener('beforeunload', warnBeforeLeaving);
  publish([...jobs, { id, title, status: 'running', startedAt: Date.now() }]);
  Promise.resolve()
    .then(run)
    .then(guide => update(id, { status: 'done', guideId: guide.id }))
    .catch(error => update(id, { status: 'error', error: error.message || 'Study guide generation failed.', upgrade: Boolean(error.upgrade) }));
  return id;
}

export function dismissGuideJob(id) {
  publish(jobs.filter(job => job.id !== id));
  if (!jobs.length && typeof window !== 'undefined') window.removeEventListener('beforeunload', warnBeforeLeaving);
}

export function useGuideJobs() {
  const [current, setCurrent] = useState(jobs);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(jobs);
    return () => listeners.delete(setCurrent);
  }, []);
  return current;
}
