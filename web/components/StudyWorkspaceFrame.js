import DashboardStudyRail from './DashboardStudyRail';

export default function StudyWorkspaceFrame({ children, section, timerState, setTimerState }) {
  return (
    <div className="reference-workspace" data-workspace-section={section}>
      <section className="reference-workspace-window">{children}</section>
      <details className="reference-study-tools">
        <summary>Study tools <span>⌄</span></summary>
        <DashboardStudyRail timerState={timerState} setTimerState={setTimerState} />
      </details>
    </div>
  );
}
