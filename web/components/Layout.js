import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import LegacySidebar from './LegacySidebar';
import ToolRail from './ToolRail';
import TutorDrawer from './TutorDrawer';
import GuideJobIndicator from './GuideJobIndicator';
import NewSheet from './NewSheet';
import TipHost from './TipHost';
import Walkthrough from './Walkthrough';
import FeatureOnboarding from './FeatureOnboarding';
import TimerEngine from './TimerEngine';
import CanvasReminder from './CanvasReminder';
import UsernameClaim from './UsernameClaim';
import AgeGate from './AgeGate';
import { useFileDragging } from '../lib/fileDrop';
import { FOCUS_ROUTES } from '../lib/featureReleases';
import { useNewShell } from '../lib/useNewShell';
import { WhatsNewWatcher } from './WhatsNew';

const WIDE = ['/guide/[id]', '/practice', '/practice/[guideId]', '/smartnotes', '/canvas', '/tutor'];
// Study screens run in focus mode: no top bar or tab bar, just the screen's own exit.
const FOCUS = FOCUS_ROUTES;
// Pages that show the Tutor themselves: the full Tutor page and the chat home.
const OWNS_TUTOR = ['/tutor', '/home'];

export default function Layout({ children, timerState, setTimerState }) {
  const router = useRouter();
  const dragging = useFileDragging();
  // The new shell (sidebar and tool rail) or today's navigation, by the switch in lib/newShell.mjs
  // and the window's width; null while the page hydrates (lib/useNewShell.js).
  const shell = useNewShell();
  // The Tutor page and the home show the Tutor full size, so the side panel stays out of the way there.
  // So does a class page in the new shell: its own composer talks to the Tutor (components/ClassProject.js).
  const pageOwnsTutor = OWNS_TUTOR.includes(router.pathname) || Boolean(shell && router.pathname === '/folder/[id]');
  const activeGuideId = router.query.guideId || (router.pathname === '/guide/[id]' ? router.query.id : '');
  const activeNoteId = router.pathname === '/smartnotes' ? router.query.id : '';
  // Remount the page when the material changes (guide A -> guide B), not on every query tweak.
  const routeKey = `${router.pathname}:${router.query.id || ''}:${router.query.guideId || ''}`;

  return (
    <div className={'app-shell' + (FOCUS.includes(router.pathname) ? ' is-focus' : '')}>
      {shell ? <Sidebar timerState={timerState} setTimerState={setTimerState} /> : (
        <div className="c-legacy-nav"><LegacySidebar timerState={timerState} setTimerState={setTimerState} /></div>
      )}
      {shell === null && <>
        <div className="c-glass c-shell-ghost is-side" aria-hidden="true" />
        <div className="c-glass c-shell-ghost is-rail" aria-hidden="true" />
      </>}
      <main id="classroom-main" className="main-content">
        <div key={routeKey} className={'workspace-route' + (WIDE.includes(router.pathname) && !(router.pathname === '/smartnotes' && !router.query.id) ? ' is-wide' : '')}>
          {children}
        </div>
      </main>
      {shell && <ToolRail />}
      {dragging && <div className="c-drop-hint" role="status">Drop to upload</div>}
      <GuideJobIndicator />
      <NewSheet />
      <TipHost />
      <WhatsNewWatcher />
      <CanvasReminder />
      <UsernameClaim />
      <AgeGate />
      <Walkthrough />
      <FeatureOnboarding />
      <TimerEngine timerState={timerState} setTimerState={setTimerState} />
      {!pageOwnsTutor && <TutorDrawer preferredGuideId={activeGuideId} preferredNoteId={activeNoteId} />}
    </div>
  );
}
