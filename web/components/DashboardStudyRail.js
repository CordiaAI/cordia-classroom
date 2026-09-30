import StreakCounter from './StreakCounter';
import StudyTimer from './StudyTimer';
import StudyInsights from './StudyInsights';

export default function DashboardStudyRail({ timerState, setTimerState }) {
  return (
    <aside className="dashboard-study-rail" aria-label="Study tools">
      <section className="study-rail-card" aria-label="Study streak">
        <StreakCounter />
      </section>
      <section className="study-rail-card" aria-label="Focus timer">
        <StudyTimer timerState={timerState} setTimerState={setTimerState} />
      </section>
      <section className="study-rail-card study-insights-card" aria-label="Your study insights">
        <StudyInsights compact />
      </section>
    </aside>
  );
}
