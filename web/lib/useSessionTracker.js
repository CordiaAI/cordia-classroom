import { useEffect } from 'react';
import { apiFetch, getToken } from './api';
import { addGrowth } from './progress';
import { recordStudy } from './activity';
import { activeClock } from './activeClock';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MIN_LOGGED_SECONDS = 3; // shorter visits aren't logged

/**
 * Tracks time spent on a page and logs sessions for streak/minutes tracking.
 * - On mount: logs a 0-duration session (updates streak immediately)
 * - When the tab is hidden, the page is left, or the screen unmounts: sends the active time since
 *   the last send (visible, not idle; lib/activeClock.js) via sendBeacon and starts counting again.
 *   Sending on hide means a tab closed from the background (no unload event on phones) still logs
 *   what was studied, and one forgotten tab can't pile up one long sitting.
 */
export default function useSessionTracker(sessionType = 'browse', guideId = null) {
  useEffect(() => {
    const clock = activeClock();

    // Log initial session to update streak
    const body = { session_type: sessionType, duration_seconds: 0 };
    if (guideId) body.guide_id = guideId;
    apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    function flush() {
      const elapsed = clock.seconds();
      if (elapsed < MIN_LOGGED_SECONDS) return;
      clock.reset();
      // Active time on a guide grows its tree and joins the local study log.
      if (guideId && sessionType === 'read' && elapsed >= 15) {
        addGrowth(guideId, elapsed / 60);
        recordStudy({ guideId, minutes: elapsed / 60, kind: 'read' });
      }
      const token = getToken();
      if (!token) return;
      const payload = {
        authorization: 'Bearer ' + token,
        session_type: sessionType,
        duration_seconds: elapsed,
      };
      if (guideId) payload.guide_id = guideId;
      navigator.sendBeacon(API + '/stats/beacon', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    }

    function onVisibility() { if (document.hidden) flush(); }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
      clock.stop();
    };
  }, [sessionType, guideId]);
}
