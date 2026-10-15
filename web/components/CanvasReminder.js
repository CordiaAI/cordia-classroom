import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { X } from 'lucide-react';
import { canvasStatus } from '../lib/canvas';

const SEEN = 'cordiaCanvasReminder';

// Once per session: a token that expires within 7 days, or one Canvas rejected.
// Checking status also lets the server start its 6-hour sync.
export default function CanvasReminder() {
  const router = useRouter();
  const [note, setNote] = useState(null);

  useEffect(() => {
    let seen = '';
    try { seen = sessionStorage.getItem(SEEN) || ''; } catch { /* storage blocked */ }
    if (seen) return;
    canvasStatus().then(status => {
      if (!status) return;
      try { sessionStorage.setItem(SEEN, '1'); } catch { /* storage blocked */ }
      if (status.status === 'needs_reconnect') setNote({ text: 'Reconnect Canvas' });
      else if (status.connected && status.remind) setNote({ text: status.expires_in_days === 0 ? 'Canvas token expires today' : `Canvas token expires in ${status.expires_in_days} day${status.expires_in_days === 1 ? '' : 's'}` });
    });
  }, []);

  if (!note || router.pathname === '/settings') return null;
  return (
    <div className="c-tip canvas-reminder" role="status">
      <button type="button" className="canvas-reminder-text" onClick={() => { setNote(null); router.push('/settings?section=canvas'); }}>{note.text}</button>
      <button type="button" className="c-icon-btn" onClick={() => setNote(null)} aria-label="Dismiss"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      <style jsx>{`
        .canvas-reminder { top: 80px; left: 50%; transform: translateX(-50%); }
        .canvas-reminder-text { border: 0; background: transparent; color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; padding: 0 2px; }
        .canvas-reminder :global(.c-icon-btn) { width: 32px; height: 32px; }
        @media (max-width: 767px) { .canvas-reminder { top: 64px; } }
      `}</style>
    </div>
  );
}
