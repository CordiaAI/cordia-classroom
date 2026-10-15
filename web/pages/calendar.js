import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { useEffect } from 'react';
import CalendarDashboard from '../components/CalendarDashboard';
import { walkthroughEvent } from '../lib/walkthrough';

export default function CalendarPage() {
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  useEffect(() => { if (ready) walkthroughEvent('calendar-opened'); }, [ready]);
  if (!ready) return null;
  return (
    <div className="c-page">
      <header className="c-page-head"><h1 className="c-title">Calendar</h1></header>
      <CalendarDashboard />
    </div>
  );
}
