import { getProgress, updateProgress } from './progress';

// One-time tips (glass pill, a few words), each at the moment a feature is useful. A tap
// dismisses it for good; at most one per session, never during a walkthrough.
export const TIPS = {
  ask: { text: 'Ask why', icon: 'MessageCircle' },
  calendar: { text: 'Add deadlines', icon: 'CalendarDays' },
  insights: { text: 'Your weak spots', icon: 'ChartColumn' },
  highlight: { text: 'Highlight to explain', icon: 'Highlighter' },
  keys: { text: 'Space flips · 1 Again · 2 Got it', icon: 'Keyboard' },
  typing: { text: 'Typing shortcuts', icon: 'Keyboard' },
};

export const TIP_EVENT = 'cordia:tip';

export function isTipDismissed(id) {
  return getProgress().tips.includes(id);
}

export function dismissTip(id) {
  if (!isTipDismissed(id)) updateProgress(current => ({ tips: [...current.tips, id] }));
}

function shownThisSession() {
  try { return sessionStorage.getItem('cordiaTipShown'); } catch { return null; }
}

export function requestTip(id, text) {
  if (typeof window === 'undefined' || !TIPS[id] || isTipDismissed(id)) return;
  if (getProgress().wt?.status === 'active') return;
  const shown = shownThisSession();
  if (shown && shown !== id) return;
  window.dispatchEvent(new CustomEvent(TIP_EVENT, { detail: { id, text } }));
}

export function markTipShown(id) {
  try { sessionStorage.setItem('cordiaTipShown', id); } catch {}
}
