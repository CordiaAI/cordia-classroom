import { apiFetch, getToken } from './api';

// The student's classes (/folders), read by many screens. Callers at the same time share one
// request, and the answer is kept for a minute (per signed-in account). Anything that adds,
// renames, deletes or re-covers a class calls invalidateFolders(). Listeners (the sidebar) hear
// about both: a cleared list and a newly loaded one.
const TTL_MS = 60 * 1000;
let cached = null; // { at, token, promise }
let latest = null; // { token, folders }: the last list that loaded, so a remounted sidebar doesn't flash empty
const listeners = new Set();

// Resolves like apiFetch('/folders'): { folders } or, on failure, the error body or null.
export function loadFolders() {
  const token = getToken();
  if (cached && cached.token === token && Date.now() - cached.at < TTL_MS) return cached.promise;
  const entry = { at: Date.now(), token };
  const forget = () => { if (cached === entry) cached = null; };
  entry.promise = apiFetch('/folders').then(data => {
    if (Array.isArray(data?.folders)) {
      latest = { token, folders: data.folders };
      listeners.forEach(listener => listener());
    } else forget();
    return data;
  }, error => { forget(); throw error; });
  cached = entry;
  return entry.promise;
}

export function latestFolders() {
  return latest && latest.token === getToken() ? latest.folders : null;
}

// notify: false when only something listeners don't show changed (a class's cover).
export function invalidateFolders({ notify = true } = {}) {
  cached = null;
  if (notify) listeners.forEach(listener => listener());
}

export function onFoldersChanged(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
