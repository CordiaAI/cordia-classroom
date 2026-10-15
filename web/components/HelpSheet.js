import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Brain, CalendarDays, ChartColumn, Inbox, Layers, MessageCircle, MessageSquareText, PencilRuler, Puzzle, Sparkles, Timer, X,
} from 'lucide-react';
import { TIPS, replayTip } from '../lib/tips';
import { lastGuide } from '../lib/userStore';
import { EXTENSION_STORE_URL } from '../lib/extension';

const TIP_ICONS = { quiz: Brain, ask: MessageCircle, cards: Layers, explain: Sparkles, canvas: PencilRuler, calendar: CalendarDays, break: Timer, insights: ChartColumn };
const TIP_NAMES = { quiz: 'Quiz', ask: 'Ask', cards: 'Cards', explain: 'Explain', canvas: 'Practice', calendar: 'Calendar', break: 'Focus timer', insights: 'Insights' };

export default function HelpSheet({ onClose, onFeedback, canReviewFeedback }) {
  const router = useRouter();
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(document.documentElement.getAttribute('data-asai-extension') === 'ready');
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function replay(id) {
    onClose();
    const route = TIPS[id].route;
    const guide = lastGuide();
    let target = null;
    if (route === 'guide') target = guide ? `/guide/${guide.id}` : '/library';
    else if (route === '/practice') target = guide ? `/practice/${guide.id}` : '/practice';
    else if (route) target = route;
    if (id === 'ask') {
      window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: {} }));
    } else if (target && router.asPath.split('?')[0] !== target) {
      await router.push(target);
    }
    setTimeout(() => replayTip(id), 300);
  }

  return (
    <div className="c-scrim" onClick={onClose}>
      <section className="c-sheet" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}>
        <header className="c-sheet-head">
          <h2 id="help-title" className="c-title">Help</h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close help"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        <h3 className="c-section-title">Tips</h3>
        <div className="help-tips">
          {Object.keys(TIPS).map(id => {
            const Icon = TIP_ICONS[id];
            return (
              <button key={id} type="button" className="help-tip" onClick={() => replay(id)}>
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />{TIP_NAMES[id]}
              </button>
            );
          })}
        </div>
        <div className="help-actions">
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
        .help-tips { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 12px 0 24px; }
        .help-tip { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--r-input); background: var(--card); color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; }
        .help-tip:hover { border-color: var(--olive); }
        .help-tip :global(.lucide) { color: var(--olive-ink); }
        .help-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .help-links { display: flex; gap: 20px; margin-top: 24px; font: 600 13px/1 var(--font-sans); }
      `}</style>
    </div>
  );
}
