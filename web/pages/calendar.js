import { useEffect } from 'react';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { walkthroughEvent } from '../lib/walkthrough';
import CalendarDashboard from '../components/CalendarDashboard';

// The week on its own page: study blocks from Plan my week and lecture to-dos always, plus every
// Canvas deadline once Canvas is connected (it no longer needs Canvas to open).
export default function CalendarPage() {
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  useEffect(() => { if (ready) walkthroughEvent('calendar-opened'); }, [ready]);

  if (!ready) return null;
  return (
    <div className="c-page calendar-page">
      <header className="c-page-head">
        <h1 className="c-title">Calendar</h1>
      </header>
      <CalendarDashboard />
    </div>
  );
}
