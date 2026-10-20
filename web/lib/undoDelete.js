import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getToken } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const UNDO_MS = 6000;

// Delete with a 6-second Undo: the item disappears at once, the request is sent only
// when the toast runs out (or right away if the page closes first).
export function useUndoDelete(onUndo) {
  const [pending, setPending] = useState(null); // { id, title, path? } (path defaults to the guide)
  const timer = useRef(null);
  const pendingRef = useRef(null);

  const commit = useCallback(item => {
    if (!item) return;
    apiFetch(item.path || '/guides/' + item.id, { method: 'DELETE' });
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const item = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    commit(item);
  }, [commit]);

  useEffect(() => {
    const onUnload = () => {
      const item = pendingRef.current;
      if (!item) return;
      fetch(API + (item.path || '/guides/' + item.id), { method: 'DELETE', keepalive: true, headers: { Authorization: 'Bearer ' + getToken() } });
      pendingRef.current = null;
    };
    window.addEventListener('pagehide', onUnload);
    return () => { window.removeEventListener('pagehide', onUnload); flush(); };
  }, [flush]);

  function remove(item) {
    if (pendingRef.current) flush();
    pendingRef.current = item;
    setPending(item);
    timer.current = setTimeout(flush, UNDO_MS);
  }

  function undo() {
    clearTimeout(timer.current);
    const item = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    onUndo?.(item);
  }

  return { pending, remove, undo };
}
