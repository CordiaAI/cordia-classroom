import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import TutorDrawer from './TutorDrawer';
import GuideJobIndicator from './GuideJobIndicator';
import NewSheet from './NewSheet';
import TipHost from './TipHost';
import Walkthrough from './Walkthrough';
import TimerEngine from './TimerEngine';
import CanvasReminder from './CanvasReminder';

const WIDE = ['/guide/[id]', '/practice', '/practice/[guideId]', '/smartnotes', '/calendar', '/tutor'];
// Study screens run in focus mode: no top bar or tab bar, just the screen's own exit.
const FOCUS = ['/session', '/flashcards/study', '/quiz/[guideId]', '/nclex/[guideId]', '/practice/[guideId]'];

export default function Layout({ children, timerState, setTimerState }) {
  const router = useRouter();
  // The Tutor page shows the Tutor full size, so the side panel stays out of the way there.
  const pageOwnsTutor = router.pathname === '/tutor';
  const activeGuideId = router.query.guideId || (router.pathname === '/guide/[id]' ? router.query.id : '');
  const activeNoteId = router.pathname === '/smartnotes' ? router.query.id : '';
  // Remount the page when the material changes (guide A -> guide B), not on every query tweak.
  const routeKey = `${router.pathname}:${router.query.id || ''}:${router.query.guideId || ''}`;

  return (
    <div className={'app-shell' + (FOCUS.includes(router.pathname) ? ' is-focus' : '')}>
      <Sidebar timerState={timerState} setTimerState={setTimerState} />
      <main id="classroom-main" className="main-content">
        <div key={routeKey} className={'workspace-route' + (WIDE.includes(router.pathname) && !(router.pathname === '/smartnotes' && !router.query.id) ? ' is-wide' : '')}>
          {children}
        </div>
      </main>
      <GuideJobIndicator />
      <NewSheet />
      <TipHost />
      <CanvasReminder />
      <Walkthrough />
      <TimerEngine timerState={timerState} setTimerState={setTimerState} />
      {!pageOwnsTutor && <TutorDrawer preferredGuideId={activeGuideId} preferredNoteId={activeNoteId} />}
    </div>
  );
}
