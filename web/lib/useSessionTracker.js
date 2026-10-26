import { useEffect, useRef } from 'react';
import { apiFetch, getToken } from './api';
import { addGrowth } from './progress';
import { recordStudy } from './activity';
import { activeClock } from './activeClock';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Tracks time spent on a page and logs sessions for streak/minutes tracking.
 * - On mount: logs a 0-duration session (updates streak immediately)
 * - On unmount/beforeunload: sends the active time (visible, not idle) via sendBeacon
 */
export default function useSessionTracker(sessionType = 'browse', guideId = null) {
  const loggedRef = useRef(false);

  useEffect(() => {
    loggedRef.current = false;
    const clock = activeClock();
    // Active time on a guide grows its tree and joins the local study log.
    let grown = false;
    function grow() {
      if (grown || !guideId || sessionType !== 'read') return;
      grown = true;
      const minutes = clock.seconds() / 60;
      if (minutes >= 0.25) { addGrowth(guideId, minutes); recordStudy({ guideId, minutes, kind: 'read' }); }
    }

    // Log initial session to update streak
    const body = { session_type: sessionType, duration_seconds: 0 };
    if (guideId) body.guide_id = guideId;
    apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    function sendBeacon() {
      if (loggedRef.current) return;
      loggedRef.current = true;

      const elapsed = clock.seconds();
      if (elapsed < 3) return; // Don't log trivial visits

      const token = getToken();
      if (!token) return;

      const payload = {
        authorization: 'Bearer ' + token,
        session_type: sessionType,
        duration_seconds: elapsed,
      };
      if (guideId) payload.guide_id = guideId;

      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(API + '/stats/beacon', blob);
    }

    function onUnload() { grow(); sendBeacon(); }
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      grow();
      sendBeacon();
      clock.stop();
    };
  }, [sessionType, guideId]);
}
