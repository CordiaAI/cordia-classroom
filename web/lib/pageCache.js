import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserId } from './api';

// Page data cache (stale-while-revalidate): a page shows its last data instantly, refreshes in
// the background, and updates values in place. Kept in memory and in sessionStorage per account.
const memory = new Map();

function storageKey(key) {
  return `cordiaPage:${getUserId() || 'anon'}:${key}`;
}

export function readPageCache(key) {
  const full = storageKey(key);
  if (memory.has(full)) return memory.get(full);
  try {
    const raw = sessionStorage.getItem(full);
    if (raw) {
      const value = JSON.parse(raw);
      memory.set(full, value);
      return value;
    }
  } catch { /* storage blocked */ }
  return undefined;
}

export function writePageCache(key, value) {
  const full = storageKey(key);
  memory.set(full, value);
  try { sessionStorage.setItem(full, JSON.stringify(value)); } catch { /* full or blocked */ }
}

// load() resolves to the page's whole data object at once. Returns { data, ready, refresh, update }.
export function useCachedPage(key, load, { enabled = true } = {}) {
  const [data, setData] = useState(() => (typeof window === 'undefined' ? undefined : readPageCache(key)));
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    const next = await loadRef.current();
    if (next !== undefined) {
      setData(next);
      writePageCache(key, next);
    }
    return next;
  }, [key]);
  const update = useCallback(change => {
    setData(current => {
      const next = typeof change === 'function' ? change(current) : change;
      writePageCache(key, next);
      return next;
    });
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    const cached = readPageCache(key);
    if (cached !== undefined) setData(cached);
    refresh();
  }, [key, enabled, refresh]);
  return { data, ready: data !== undefined, refresh, update };
}
