import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CalendarCheck, GraduationCap, Layers } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { useCachedPage } from '../lib/pageCache';
import { loadHome } from '../lib/homeData';
import { homeHeadline, homeSuggestions } from '../lib/homeText.mjs';
import { useTutorChat } from '../lib/useTutorChat';
import { shellFlag } from '../lib/useNewShell';
import { latestFolders, loadFolders, onFoldersChanged } from '../lib/folders';
import { useProgress } from '../lib/progress';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { dayOneFinished, startWalkthrough } from '../lib/walkthrough';
import { chatTitle } from '../lib/shellTools.mjs';
import { sidebarClasses } from '../components/Sidebar';
import { LoadGate } from '../components/CordiaLoader';
import Composer, { buildGuideFrom } from '../components/Composer';
import ClassPicker from '../components/ClassPicker';
import TutorMessages from '../components/TutorMessages';
import AssignmentSheet from '../components/AssignmentSheet';

const PILL_ICONS = { learn: GraduationCap, cards: Layers, plan: CalendarCheck };
// Home to chat: the composer moves in place to the bottom (an on-screen move: ease-in-out).
const MOVE = { duration: 280, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' };
const safe = promise => promise.catch(() => null);

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The chat home (DESIGN-SPEC 4.1): where signed-in students land with the new shell on
// (lib/newShell.mjs). An empty chat: the headline, the composer and up to three suggestions. The
// first message turns it into the chat in place (4.3): the headline and suggestions go, the message
// shows and the composer moves to the bottom. The conversation is the Tutor's own session, so it
// shows under Recent chats and opens on the Tutor page from there.
export default function ChatHome() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const progress = useProgress();
  const [allowed, setAllowed] = useState(null);
  // With the switch off, students land on the Dashboard as before.
  useEffect(() => {
    if (!ready) return;
    const on = shellFlag();
    setAllowed(on);
    if (!on) router.replace('/dashboard');
  }, [ready]);

  const [classId, setClassId] = useState('');
  const tutor = useTutorChat({ freshOnSend: true, scopeClassId: classId });
  const [planning, setPlanning] = useState(null);

  // Everything the empty home shows loads together; returning shows the saved copy at once. New
  // students start the day-one walkthrough here, as they did on the Dashboard.
  const { data, ready: loaded } = useCachedPage('home', async () => {
    const [home, onboarding] = await Promise.all([loadHome(), safe(loadOnboarding())]);
    if (onboarding && !onboarding.completed && !home.guideCount && !progress.wt && !dayOneFinished()) startWalkthrough('day1');
    else if (onboarding && !onboarding.completed && home.guideCount) saveOnboardingStep('done');
    return home;
  }, { enabled: Boolean(ready && allowed) });

  // The classes for the pickers, again whenever one is added, renamed or deleted.
  const [classes, setClasses] = useState(() => (latestFolders() ? sidebarClasses(latestFolders()) : []));
  useEffect(() => {
    let live = true;
    const load = () => loadFolders().then(result => { if (live && Array.isArray(result?.folders)) setClasses(sidebarClasses(result.folders)); });
    load();
    const off = onFoldersChanged(load);
    return () => { live = false; off(); };
  }, []);

  // /home?class=<id> opens with that class picked (a class's own page links here with it).
  useEffect(() => {
    const wanted = typeof router.query.class === 'string' ? router.query.class : '';
    if (wanted && classes.some(item => String(item.id) === wanted)) setClassId(wanted);
  }, [router.query.class, classes.length]);

  // The rail's Make guide builds from the files already in the composer, through the New sheet.
  useEffect(() => {
    const onMake = event => {
      const files = tutor.attachments.map(file => file.file).filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      buildGuideFrom({ mode: 'upload' }, { files, folderId: classId });
      tutor.setAttachments([]);
    };
    window.addEventListener('cordia:make-guide', onMake);
    return () => window.removeEventListener('cordia:make-guide', onMake);
  }, [tutor.attachments, classId]);

  const chatting = tutor.sentHere && tutor.messages.length > 0;

  // Home to chat: the composer slides from where it was to the bottom (MOVE);
  // the conversation fades in. Reduced motion: it is simply there.
  const composerRef = useRef(null);
  const lastTop = useRef(null);
  useLayoutEffect(() => {
    if (!chatting && composerRef.current) lastTop.current = composerRef.current.getBoundingClientRect().top;
  });
  useLayoutEffect(() => {
    const element = composerRef.current;
    if (!chatting || !element || lastTop.current === null || reducedMotion()) return;
    const delta = lastTop.current - element.getBoundingClientRect().top;
    lastTop.current = null;
    if (Math.abs(delta) > 1) element.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], MOVE);
  }, [chatting]);

  if (!ready || !allowed) return null;

  const headline = homeHeadline(data?.exam, data?.plan, data?.className);
  const pills = homeSuggestions({
    learn: data?.exam ? { title: data.exam.title, guideId: data.exam.guideId, date: data.exam.date } : null,
    due: data?.due || 0,
    deadline: data?.deadline || null,
  });
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const picked = classes.find(item => String(item.id) === classId);

  return (
    <LoadGate ready={loaded} label="Loading your home">
      <div ref={tutor.rootRef} className={'chat-home' + (chatting ? ' is-chat' : '') + (tutor.attachDropActive ? ' is-drop' : '')}>
        <header className="chat-home-top">
          {chatting ? (
            <>
              <h1 className="chat-home-title c-truncate">{chatTitle(tutor.messages)}</h1>
              {picked && <span className="chat-home-chip"><span className="c-class-dot" style={{ '--dot': `var(--cover-ink-${picked.tone})` }} aria-hidden="true" />{picked.code}</span>}
            </>
          ) : (
            <>
              <ClassPicker classes={classes} value={classId} onChange={setClassId} />
              <span className="chat-home-date">{today}</span>
            </>
          )}
        </header>

        <div className="chat-home-stage">
          {chatting ? (
            <div className="cordia-tutor-messages chat-home-thread" aria-live="polite">
              <div className="chat-home-column">
                <TutorMessages tutor={tutor} avatar />
                <div ref={tutor.endRef} />
              </div>
            </div>
          ) : (
            <div className="chat-home-hero">
              <h1 className="chat-home-headline">{headline.title}</h1>
              {headline.line && <p className="chat-home-line">{headline.line}</p>}
            </div>
          )}

          <div ref={composerRef} className="chat-home-composer">
            <Composer tutor={tutor} classes={classes} classId={classId} onClassChange={setClassId} variant={chatting ? 'chat' : 'home'} showError={!chatting} autoFocus />
          </div>

          {!chatting && pills.length > 0 && (
            <div className="chat-home-pills" role="group" aria-label="Suggestions">
              {pills.map(pill => {
                const Icon = PILL_ICONS[pill.icon];
                const body = <><Icon size={18} strokeWidth={1.75} aria-hidden="true" />{pill.label}</>;
                return pill.href
                  ? <Link key={pill.key} href={pill.href} className="chat-home-pill">{body}</Link>
                  : <button key={pill.key} type="button" className="chat-home-pill" onClick={() => setPlanning(data.deadline)}>{body}</button>;
              })}
            </div>
          )}
        </div>

        <p className="chat-home-note">The Tutor answers from your class material. Check anything that matters before you rely on it.</p>
        {planning && <AssignmentSheet item={planning} onClose={() => setPlanning(null)} />}
      </div>
    </LoadGate>
  );
}
