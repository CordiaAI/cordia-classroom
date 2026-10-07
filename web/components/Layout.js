import Sidebar from './Sidebar';
import StreakCounter from './StreakCounter';
import StudyTimer from './StudyTimer';
import TutorDrawer from './TutorDrawer';
import GuideJobIndicator from './GuideJobIndicator';
import { useRouter } from 'next/router';

export default function Layout({ children, timerState, setTimerState }) {
  const router = useRouter();
  const pageOwnsTools = ['/dashboard', '/smartnotes', '/flashcards', '/create', '/guide/[id]', '/settings'].includes(router.pathname)
    || router.pathname.startsWith('/practice');
  const pageOwnsTutor = router.pathname === '/dashboard' && !router.query.view;
  const activeGuideId = router.query.guideId || (router.pathname === '/guide/[id]' ? router.query.id : '');
  const activeNoteId = router.pathname === '/smartnotes' ? router.query.id : '';

  return (
    <div className={`app-shell${router.pathname === '/dashboard' && !router.query.view ? ' is-study-home' : ''}`}>
      <Sidebar />
      <main id="classroom-main" className="main-content">
        <div key={router.asPath} className="workspace-route">
        {children}
        {!pageOwnsTools && (
          <section className="workspace-tools" aria-label="Study tools">
            <StreakCounter />
            <StudyTimer timerState={timerState} setTimerState={setTimerState} />
          </section>
        )}
        </div>
      </main>
      <GuideJobIndicator />
      {!pageOwnsTutor && <TutorDrawer preferredGuideId={activeGuideId} preferredNoteId={activeNoteId} />}
    </div>
  );
}
