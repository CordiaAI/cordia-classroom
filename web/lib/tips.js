import { getProgress, updateProgress } from './progress';

// Four one-time tips (glass pill, 3 words max), each at its moment. A tap dismisses
// it for good; at most one per session, never during a walkthrough.
export const TIPS = {
  ask: { text: 'Ask why', icon: 'MessageCircle' },
  calendar: { text: 'Add deadlines', icon: 'CalendarDays' },
  break: { text: 'Take a break', icon: 'Timer' },
  insights: { text: 'Your weak spots', icon: 'ChartColumn' },
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
