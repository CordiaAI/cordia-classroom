import { useEffect, useState } from 'react';
import { apiFetch } from './api';

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
  const job = jobs.find(item => item.id === id);
  if (job?.serverId) apiFetch(`/study-set-jobs/${job.serverId}/seen`, { method: 'POST' });
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

// Study sets a connected app (Claude) asked Cordia to make show here too, once each, until the
// student opens or dismisses them (GET /study-set-jobs; at most once a minute).
const shownServerJobs = new Set();
let lastServerCheck = 0;

async function followServerJob(id, serverId) {
  for (let tries = 0; tries < 120; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const data = await apiFetch(`/study-set-jobs/${serverId}`);
    const status = data?.job?.status;
    if (status === 'done') return update(id, { status: 'done', guideId: data.job.study_set_id });
    if (status === 'failed') return update(id, { status: 'error', error: data.job.error || 'The study set could not be made.' });
  }
}

export async function showConnectedAppSets() {
  if (typeof window === 'undefined' || Date.now() - lastServerCheck < 60000) return;
  lastServerCheck = Date.now();
  const data = await apiFetch('/study-set-jobs');
  for (const job of Array.isArray(data?.jobs) ? data.jobs : []) {
    if (shownServerJobs.has(job.id)) continue;
    shownServerJobs.add(job.id);
    const id = `app-${job.id}`;
    const entry = { id, serverId: job.id, title: job.title || 'Study set', from: job.client_name || 'a connected app' };
    if (job.status === 'done') publish([...jobs, { ...entry, status: 'done', guideId: job.study_set_id }]);
    else if (job.status === 'failed') publish([...jobs, { ...entry, status: 'error', error: job.error || 'The study set could not be made.' }]);
    else {
      publish([...jobs, { ...entry, status: 'running', startedAt: Date.now() }]);
      followServerJob(id, job.id);
    }
  }
}
