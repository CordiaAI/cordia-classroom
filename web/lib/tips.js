import { readUserValue, writeUserValue } from './userStore';

// One feature tip at a time, at the moment it is useful. Each tip points at an
// element marked data-tip="<id>", shows at most once per session, and a tap
// dismisses it for good. Help in the avatar menu replays any of them.
export const TIPS = {
  quiz: { text: 'Quiz yourself', icon: 'Brain', route: 'guide' },
  ask: { text: 'Ask why', icon: 'MessageCircle', route: null },
  cards: { text: 'Cards due', icon: 'Layers', route: '/dashboard' },
  explain: { text: 'Explain simpler', icon: 'Sparkles', route: 'guide' },
  canvas: { text: 'Show your work', icon: 'PencilRuler', route: '/practice' },
  calendar: { text: 'Add deadlines', icon: 'CalendarDays', route: '/dashboard' },
  break: { text: 'Take a break', icon: 'Timer', route: '/dashboard' },
  insights: { text: 'Your weak spots', icon: 'ChartColumn', route: '/dashboard' },
};

export const TIP_EVENT = 'cordia:tip';

function dismissed() {
  return readUserValue('cordiaTipsDismissed', []) || [];
}

export function isTipDismissed(id) {
  return dismissed().includes(id);
}

export function dismissTip(id) {
  const list = dismissed();
  if (!list.includes(id)) writeUserValue('cordiaTipsDismissed', [...list, id]);
}

function shownThisSession() {
  try { return sessionStorage.getItem('cordiaTipShown'); } catch { return null; }
}

// Ask for a tip. It appears only if never dismissed and no other tip ran this session.
export function requestTip(id, text) {
  if (typeof window === 'undefined' || !TIPS[id] || isTipDismissed(id)) return;
  const shown = shownThisSession();
  if (shown && shown !== id) return;
  window.dispatchEvent(new CustomEvent(TIP_EVENT, { detail: { id, text } }));
}

export function markTipShown(id) {
  try { sessionStorage.setItem('cordiaTipShown', id); } catch {}
}

// Help → replay: ignores dismissal and the one-per-session rule.
export function replayTip(id) {
  if (typeof window === 'undefined' || !TIPS[id]) return;
  window.dispatchEvent(new CustomEvent(TIP_EVENT, { detail: { id, replay: true } }));
}
