import { useEffect } from 'react';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { walkthroughEvent } from '../lib/walkthrough';
import CalendarDashboard from '../components/CalendarDashboard';

// The Calendar: Week, Board, Month and Agenda over study blocks and lecture to-dos always, plus
// every Canvas deadline once Canvas is connected (it doesn't need Canvas to open). The header with
// its title, range and view switch is CalendarDashboard's (components/calendar/CalendarViews.js).
export default function CalendarPage() {
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  useEffect(() => { if (ready) walkthroughEvent('calendar-opened'); }, [ready]);

  if (!ready) return null;
  return (
    <div className="c-page calendar-page">
      <CalendarDashboard />
    </div>
  );
}
