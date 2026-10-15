import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import CalendarDashboard from '../components/CalendarDashboard';

export default function CalendarPage() {
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  if (!ready) return null;
  return (
    <div className="c-page">
      <header className="c-page-head"><h1 className="c-title">Calendar</h1></header>
      <CalendarDashboard />
    </div>
  );
}
