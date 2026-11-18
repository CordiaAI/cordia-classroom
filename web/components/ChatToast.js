import { useEffect, useRef, useState } from 'react';
import { MESSAGE_MS, UNDO_MS } from '../lib/chatStore.mjs';
import { dismissChatToast, restoreChat, useChats } from '../lib/chats';

// Puts focus somewhere sensible when the thing that had it goes away: the chat's row in Recent
// chats, else the folded sidebar's chats button, else New chat.
export function focusChatRow(id) {
  requestAnimationFrame(() => {
    const row = id ? document.querySelector(`[data-chat-row="${CSS.escape(String(id))}"] .c-side-chat`) : null;
    const target = [row, document.querySelector('.c-side-chats-icon'), document.querySelector('.c-side-new')]
      .find(element => element && element.offsetParent !== null);
    target?.focus({ preventScroll: true });
  });
}

const EXIT_MS = 200; // tokens.css --dur-exit
const MIN_LEFT_MS = 2000; // after the pointer or focus leaves, at least this long to act
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mac = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
// A text box that holds text keeps its own Undo (typing); an empty one has nothing to undo.
const editing = target => {
  if (!target || target.nodeType !== 1) return false;
  if (target.isContentEditable) return true;
  if (target.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])')) return Boolean(target.value);
  return false;
};

// The saved-chats toast (lib/chats.js): "Chat deleted" with Undo for 6 seconds, or one plain line
// (a rename the server refused, a chat that can't come back) for 5. Mounted once, by the sidebar.
// The time stops while the pointer or keyboard focus is on it. Undo also answers to Ctrl+Z (Command+Z
// on a Mac) for as long as the toast stays, from anywhere except a box that holds text; a screen
// reader hears the toast and that shortcut (the live region is always on the page).
export default function ChatToast() {
  const { toast } = useChats();
  const [shown, setShown] = useState(null); // the toast on screen, kept for its exit
  const [leaving, setLeaving] = useState(false);
  const [working, setWorking] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);
  const left = useRef(0);
  const since = useRef(0);
  const holds = useRef({ pointer: false, focus: false });
  const current = useRef(null);
  current.current = toast;

  function expire(id) {
    if (ref.current?.contains(document.activeElement)) focusChatRow('');
    dismissChatToast(id);
  }
  function arm(ms) {
    clearTimeout(timer.current);
    left.current = ms;
    since.current = Date.now();
    const id = current.current?.id;
    timer.current = setTimeout(() => expire(id), ms);
  }
  function hold(kind) {
    if (!holds.current.pointer && !holds.current.focus) {
      clearTimeout(timer.current);
      left.current -= Date.now() - since.current;
    }
    holds.current[kind] = true;
  }
  function release(kind) {
    holds.current[kind] = false;
    if (current.current && !holds.current.pointer && !holds.current.focus) arm(Math.max(left.current, MIN_LEFT_MS));
  }

  // A new toast: shown at once, its time starts (a toast that is held keeps waiting).
  useEffect(() => {
    clearTimeout(timer.current);
    if (!toast) return undefined;
    setShown(toast);
    setLeaving(false);
    setWorking(false);
    const total = toast.kind === 'deleted' ? UNDO_MS : MESSAGE_MS;
    left.current = total;
    since.current = Date.now();
    if (holds.current.pointer || holds.current.focus) return undefined;
    arm(total);
    return () => clearTimeout(timer.current);
  }, [toast?.id]);

  // It went (timed out, dismissed, undone): a short fade, then it leaves the page.
  useEffect(() => {
    if (toast || !shown) return undefined;
    holds.current = { pointer: false, focus: false };
    if (reducedMotion()) { setShown(null); return undefined; }
    setLeaving(true);
    const gone = setTimeout(() => { setShown(null); setLeaving(false); }, EXIT_MS);
    return () => clearTimeout(gone);
  }, [toast, shown]);

  async function undo() {
    const target = current.current;
    if (working || !target || target.kind !== 'deleted') return;
    setWorking(true);
    const result = await restoreChat(target.chatId);
    setWorking(false);
    focusChatRow(result.ok ? target.chatId : '');
  }
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Ctrl+Z / Command+Z: Undo, while the delete toast is up.
  useEffect(() => {
    if (toast?.kind !== 'deleted') return undefined;
    const onKey = event => {
      if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.defaultPrevented) return;
      if (editing(event.target)) return;
      event.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast?.id, toast?.kind]);

  const text = toast ? toast.text + (toast.kind === 'deleted' ? `. Press ${mac() ? 'Command' : 'Control'} Z to undo.` : '') : '';

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{text}</div>
      {shown && (
        <div ref={ref} className="c-toast c-chat-toast" data-leaving={leaving || undefined}
          onMouseEnter={() => hold('pointer')} onMouseLeave={() => release('pointer')}
          onFocus={() => hold('focus')} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) release('focus'); }}>
          <span>{shown.text}</span>
          {shown.kind === 'deleted' && <button type="button" className="c-btn c-btn--quiet" onClick={undo} aria-disabled={working || undefined} aria-keyshortcuts="Control+Z Meta+Z">Undo</button>}
        </div>
      )}
    </>
  );
}
