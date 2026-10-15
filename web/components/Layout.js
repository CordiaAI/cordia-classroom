import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import TutorDrawer from './TutorDrawer';
import GuideJobIndicator from './GuideJobIndicator';
import NewSheet from './NewSheet';
import TipHost from './TipHost';
import Walkthrough from './Walkthrough';
import TimerEngine from './TimerEngine';
import { LearnSheet } from './LearnCordia';

// Only the Notes editor and the Calendar grid go full width (same gutter).
const WIDE = ['/smartnotes', '/calendar'];

export default function Layout({ children, timerState, setTimerState }) {
  const router = useRouter();
  // The Tutor page shows the Tutor full size, so the side panel stays out of the way there.
  const pageOwnsTutor = router.pathname === '/tutor' || router.pathname === '/dashboard';
  const activeGuideId = router.query.guideId || (router.pathname === '/guide/[id]' ? router.query.id : '');
  const activeNoteId = router.pathname === '/smartnotes' ? router.query.id : '';
  // Remount the page when the material changes (guide A -> guide B), not on every query tweak.
  const routeKey = `${router.pathname}:${router.query.id || ''}:${router.query.guideId || ''}`;

  return (
    <div className="app-shell">
      <Sidebar />
      <main id="classroom-main" className="main-content">
        <div key={routeKey} className={'workspace-route' + (WIDE.includes(router.pathname) ? ' is-wide' : '')}>
          {children}
        </div>
      </main>
      <GuideJobIndicator />
      <NewSheet />
      <TipHost />
      <LearnSheet />
      <Walkthrough />
      <TimerEngine timerState={timerState} setTimerState={setTimerState} />
      {!pageOwnsTutor && <TutorDrawer preferredGuideId={activeGuideId} preferredNoteId={activeNoteId} />}
    </div>
  );
}
