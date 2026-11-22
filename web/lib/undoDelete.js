import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getToken } from './api';
import { createUndoQueue, pathsOf, sendDelete } from './guideActions';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const UNDO_MS = 6000;

const NONE = { pending: null, hidden: new Set() };

// Delete with a 6-second Undo: the item disappears at once, the request is sent only when the toast
// runs out (or right away if the page closes first). The item stays hidden until the server answers:
// then onDeleted(item) says it is gone for good, or onFailed(item, message) says why it is back.
// pending: { id, title, path?, also? } (path defaults to the guide; also: more paths deleted with it)
// hidden: ids to leave out of the list (the one waiting and the ones being deleted)
export function useUndoDelete({ onUndo, onDeleted, onFailed } = {}) {
  const callbacks = useRef({});
  callbacks.current = { onUndo, onDeleted, onFailed };
  const queue = useMemo(() => {
    const subscribers = new Set();
    const made = createUndoQueue({
      send: sendDelete,
      delay: UNDO_MS,
      onChange: () => subscribers.forEach(listener => listener()),
      onDeleted: item => callbacks.current.onDeleted?.(item),
      onFailed: (item, message) => callbacks.current.onFailed?.(item, message),
    });
    return { ...made, subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); } };
  }, []);
  const state = useSyncExternalStore(queue.subscribe, queue.snapshot, () => NONE);

  useEffect(() => {
    const onUnload = () => {
      const item = queue.leave();
      if (!item) return;
      for (const path of pathsOf(item)) {
        fetch(API + path, { method: 'DELETE', keepalive: true, headers: { Authorization: 'Bearer ' + getToken() } });
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => { window.removeEventListener('pagehide', onUnload); queue.flush(); };
  }, [queue]);

  return {
    pending: state.pending,
    hidden: state.hidden,
    remove: queue.remove,
    undo() {
      const item = queue.undo();
      callbacks.current.onUndo?.(item);
    },
  };
}
