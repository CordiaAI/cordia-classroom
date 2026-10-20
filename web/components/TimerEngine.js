import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '../lib/api';
import { addGrowth } from '../lib/progress';
import { recordStudy } from '../lib/activity';
import { lastGuide } from '../lib/userStore';

export const TIMER_MODES = {
  focus: { label: 'Focus', minutes: 25 },
  shortBreak: { label: 'Break', minutes: 5 },
  longBreak: { label: 'Long', minutes: 15 },
};

// Runs the Focus timer on every page. A focus minute grows the last guide's tree,
// but only while this tab is visible: leaving the tab pauses growth (nothing dies).
export default function TimerEngine({ timerState, setTimerState }) {
  const router = useRouter();
  const visibleSeconds = useRef(0);
  const running = Boolean(timerState?.isRunning);

  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(() => {
      if (timerState.mode === 'focus' && !document.hidden) {
        visibleSeconds.current += 1;
        // Guide pages already grow their own tree from reading time.
        if (visibleSeconds.current >= 60 && router.pathname !== '/guide/[id]') {
          visibleSeconds.current = 0;
          const guide = lastGuide();
          if (guide) addGrowth(guide.id, 1);
          recordStudy({ guideId: guide?.id, guideTitle: guide?.title, minutes: 1, kind: 'focus' });
        }
      }
      setTimerState(prev => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        if (prev.mode === 'focus') {
          apiFetch('/stats/log-session', {
            method: 'POST',
            body: JSON.stringify({ session_type: 'timer', duration_seconds: TIMER_MODES.focus.minutes * 60, metadata: { mode: 'pomodoro' } }),
          });
        }
        return { ...prev, isRunning: false, minutes: 0, seconds: 0 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, timerState?.mode, router.pathname]);

  return null;
}
