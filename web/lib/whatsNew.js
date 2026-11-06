// What's new: the seen state (announced, opened, dismissed) and who the student is, shared by the
// Dashboard card, the pointer tip, Help's list and Learn Cordia. Rules live in featureReleases.js.
//
// Saved on the server in onboarding_progress.features (GET/PUT /onboarding/features). Until
// migration 20261120120000 runs the server answers stored: false, and the lists live in this
// browser instead (per account). A local copy is always kept, so nothing flickers back.
import { useEffect, useState } from 'react';
import { apiFetch, getUserId } from './api';
import { markUsed } from './progress';
import { CLASSROOMS_ON, LEARN_LADDER_V2, PER_VIEWER_PROGRESS } from './featureFlags';
import { EMPTY_SEEN, FEATURE_RELEASES, mergeSeen } from './featureReleases';

// Flag names a release can name (featureReleases.js `flag`). Unknown names count as off.
export const FLAGS = {
  CLASSROOMS: CLASSROOMS_ON,
  LEARN_LADDER_V2,
  PER_VIEWER_PROGRESS,
  DISCOVER: process.env.NEXT_PUBLIC_DISCOVER === '1',
};

const LOCAL = 'cordiaWhatsNew';
const CARD_SESSION = 'cordiaWhatsNewCard';
let state = { ready: false, stored: false, seen: EMPTY_SEEN, user: null };
let loadingFor = '';
const listeners = new Set();

function key() {
  const id = getUserId();
  return id ? `${LOCAL}:${id}` : '';
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(key()) || 'null') || EMPTY_SEEN; } catch { return EMPTY_SEEN; }
}

function writeLocal(seen) {
  try { if (key()) localStorage.setItem(key(), JSON.stringify(seen)); } catch { /* private window */ }
}

function publish(next) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
}

export async function loadWhatsNew() {
  const id = getUserId();
  if (!id || loadingFor === id) return state;
  loadingFor = id;
  const local = readLocal();
  publish({ seen: mergeSeen(state.seen, local) });
  const data = await apiFetch('/onboarding/features').catch(() => null);
  const account = data?.account || {};
  const seen = mergeSeen(local, data?.stored ? data.features : null);
  writeLocal(seen);
  publish({
    ready: Boolean(data && !data.detail),
    stored: Boolean(data?.stored),
    seen,
    user: { createdAt: account.created_at || null, plan: account.plan || 'free', canvas: Boolean(account.canvas), nursing: Boolean(account.nursing) },
  });
  return state;
}

function record(kind, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(item => item && !state.seen[kind].includes(item));
  if (!list.length) return;
  const seen = mergeSeen(state.seen, { [kind]: list });
  writeLocal(seen);
  publish({ seen });
  if (state.stored) apiFetch('/onboarding/features', { method: 'PUT', body: JSON.stringify({ [kind]: list }) }).catch(() => {});
}

export const markAnnounced = ids => record('announced', ids);
export const dismissFeature = ids => record('dismissed', ids);

// Using a feature (visiting its page) also ticks its Learn Cordia item.
export function markOpened(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  list.forEach(id => markUsed(id));
  record('opened', list);
}

export function useWhatsNew() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    loadWhatsNew();
    return () => listeners.delete(setCurrent);
  }, []);
  return { ...current, releases: FEATURE_RELEASES, flags: FLAGS };
}

// One announcement surface at a time: the card or a pointer tip, never both.
let surface = null;
export function claimSurface(name) {
  if (surface && surface !== name) return false;
  surface = name;
  return true;
}
export function releaseSurface(name) {
  if (surface === name) surface = null;
}
export function surfaceTaken(except) {
  return Boolean(surface && surface !== except);
}

// The Dashboard card shows at most one feature per session.
export function cardShownThisSession() {
  try { return sessionStorage.getItem(CARD_SESSION); } catch { return null; }
}
export function markCardShown(id) {
  try { sessionStorage.setItem(CARD_SESSION, id); } catch { /* blocked: shows again next time */ }
}

// Where "Show me" goes: the walkthrough when there is one, else the feature's page.
export function featureHref(release, lastGuideId) {
  const route = release.where?.route;
  if (route === 'guide') return lastGuideId ? `/guide/${lastGuideId}` : '/library';
  return route || '/dashboard';
}
