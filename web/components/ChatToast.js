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

// The saved-chats toast (lib/chats.js): "Chat deleted" with Undo for 6 seconds, or one plain line
// (a rename the server refused, a chat that can't come back) for 5. Mounted once, by the sidebar.
export default function ChatToast() {
  const { toast } = useChats();
  const [working, setWorking] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!toast) return undefined;
    setWorking(false);
    const timer = setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) focusChatRow('');
      dismissChatToast(toast.id);
    }, toast.kind === 'deleted' ? UNDO_MS : MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  if (!toast) return null;

  async function undo() {
    if (working) return;
    setWorking(true);
    const result = await restoreChat(toast.chatId);
    setWorking(false);
    focusChatRow(result.ok ? toast.chatId : '');
  }

  return (
    <div ref={ref} className="c-toast c-chat-toast" role="status">
      <span>{toast.text}</span>
      {toast.kind === 'deleted' && <button type="button" className="c-btn c-btn--quiet" onClick={undo} aria-disabled={working || undefined}>Undo</button>}
    </div>
  );
}
