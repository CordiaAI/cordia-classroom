import Sidebar from './Sidebar';
import StreakCounter from './StreakCounter';
import StudyTimer from './StudyTimer';
import TutorDrawer from './TutorDrawer';
import ClassroomVisualSystem from './ClassroomVisualSystem';
import { useRouter } from 'next/router';

export default function Layout({ children, timerState, setTimerState }) {
  const router = useRouter();
  const pageOwnsTools = ['/dashboard', '/smartnotes', '/flashcards', '/create'].includes(router.pathname)
    || router.pathname.startsWith('/practice');
  const pageOwnsTutor = router.pathname === '/dashboard'
    && (!router.query.view || router.query.view === 'guides');
  const activeGuideId = router.query.guideId || (router.pathname === '/guide/[id]' ? router.query.id : '');
  const activeNoteId = router.pathname === '/smartnotes' ? router.query.id : '';

  return (
    <div className="app-shell">
      <ClassroomVisualSystem />
      <Sidebar />
      <main className="main-content fade-in">
        {children}
        {!pageOwnsTools && (
          <section className="workspace-tools" aria-label="Study tools">
            <StreakCounter />
            <StudyTimer timerState={timerState} setTimerState={setTimerState} />
          </section>
        )}
      </main>
      {!pageOwnsTutor && <TutorDrawer preferredGuideId={activeGuideId} preferredNoteId={activeNoteId} />}
    </div>
  );
}
