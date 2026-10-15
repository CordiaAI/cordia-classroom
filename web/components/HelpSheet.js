import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Inbox, MessageSquareText, Play, Puzzle, X } from 'lucide-react';
import { EXTENSION_STORE_URL } from '../lib/extension';
import { setWalkthrough } from '../lib/walkthrough';
import LearnCordia from './LearnCordia';

export default function HelpSheet({ onClose, onFeedback, canReviewFeedback }) {
  const router = useRouter();
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(document.documentElement.getAttribute('data-asai-extension') === 'ready');
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function replayDayOne() {
    onClose();
    if (router.pathname !== '/dashboard') await router.push('/dashboard');
    // Replays skip "About you"; school details are already saved.
    setWalkthrough({ id: 'day1', step: 1, sub: 0, status: 'active' });
  }

  return (
    <div className="c-scrim" onClick={onClose}>
      <section className="c-sheet help-sheet" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}>
        <header className="c-sheet-head">
          <h2 id="help-title" className="c-title">Help</h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close help"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        <LearnCordia onBeforeShow={onClose} />
        <div className="help-actions">
          <button type="button" className="c-btn c-btn--secondary" onClick={replayDayOne}><Play size={20} strokeWidth={1.75} aria-hidden="true" />Replay tour</button>
          <button type="button" className="c-btn c-btn--secondary" onClick={onFeedback}><MessageSquareText size={20} strokeWidth={1.75} aria-hidden="true" />Feedback</button>
          {!installed && <a className="c-btn c-btn--secondary" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer"><Puzzle size={20} strokeWidth={1.75} aria-hidden="true" />Get extension</a>}
          {canReviewFeedback && <button type="button" className="c-btn c-btn--secondary" onClick={() => { onClose(); router.push('/feedback-review'); }}><Inbox size={20} strokeWidth={1.75} aria-hidden="true" />Review feedback</button>}
        </div>
        <nav className="help-links" aria-label="Policies">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/honor-code">Honor code</a>
        </nav>
      </section>
      <style jsx>{`
        .help-sheet { width: min(720px, 100%); }
        .help-sheet :global(.learn) { box-shadow: none; }
        .help-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
        .help-links { display: flex; gap: 20px; margin-top: 24px; font: 600 13px/1 var(--font-sans); }
      `}</style>
    </div>
  );
}
