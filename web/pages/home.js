import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CalendarCheck, FolderInput, GraduationCap, Layers, PenLine, Trash2 } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { useCachedPage } from '../lib/pageCache';
import { loadHome } from '../lib/homeData';
import { homeHeadline, homeSuggestions } from '../lib/homeText.mjs';
import { useTutorChat } from '../lib/useTutorChat';
import { refreshShell, shellActive, shellFlag, useNewShell } from '../lib/useNewShell';
import { invalidateFolders, latestFolders, loadFolders, onFoldersChanged } from '../lib/folders';
import { useProgress } from '../lib/progress';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { dayOneFinished, startWalkthrough } from '../lib/walkthrough';
import { chatTitle } from '../lib/shellTools.mjs';
import { HOME_ROUTE } from '../lib/newShell.mjs';
import { pageTitle } from '../lib/pageTitle';
import { MESSAGES, outcome, sameConversation } from '../lib/chatStore.mjs';
import {
  chatHref, deleteChat, getChat, keepOpenChat, loadChats, moveChat, openChat, renameChat, showChatMessage, startChat, tutorPageFor, useChats,
} from '../lib/chats';
import { sidebarClasses } from '../components/Sidebar';
import { LoadGate } from '../components/CordiaLoader';
import Composer, { buildGuideFrom } from '../components/Composer';
import ClassPicker from '../components/ClassPicker';
import Menu from '../components/Menu';
import TutorMessages from '../components/TutorMessages';
import AssignmentSheet from '../components/AssignmentSheet';

const PILL_ICONS = { learn: GraduationCap, cards: Layers, plan: CalendarCheck };
// Home to chat: the composer moves in place to the bottom (an on-screen move: ease-in-out). The
// same move runs back when the first message can't be sent (a plan limit), so nothing snaps.
const MOVE = { duration: 280, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' };
const CHAT_ROUTE = '/chat/[id]';
// Answers that mean another tab changed things (lib/chatStore.mjs outcome).
const STALE = ['gone', 'moved', 'busy', 'missing'];
const safe = promise => promise.catch(() => null);
const one = value => (Array.isArray(value) ? value[0] : value);

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Where an element sits in the page's layout, ignoring any transform still running on it.
function layoutTop(element) {
  let top = 0;
  for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
  return top;
}

// The chat home (DESIGN-SPEC 4.1) and a chat (4.3, the chat column): one page at /home and at
// /chat/[id] (pages/chat/[id].js), shown with the new shell on (lib/newShell.mjs). The home is an
// empty chat: the headline, the composer and up to three suggestions. The first message turns it
// into its chat in place (the headline and suggestions go, the composer moves to the bottom) and the
// address becomes /chat/<id>, without reloading. A chat has a 52px header (its title, its class and
// a ⋯ menu: Rename, Move to class, Delete), the conversation, and the composer. Chats are read and
// changed through lib/chats.js, which the sidebar's Recent chats share.
export default function ChatHome() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const progress = useProgress();
  const onChat = router.pathname === CHAT_ROUTE;
  const routeId = onChat ? String(one(router.query.id) || '') : '';
  const [allowed, setAllowed] = useState(null);

  // Without the new shell showing, a chat opens on the Tutor page (the live one as it is, a saved
  // one through its resume), or the Dashboard when it can't be found.
  const leave = useCallback(() => {
    if (!onChat) { router.replace('/dashboard'); return; }
    tutorPageFor(routeId).then(({ href, keep }) => {
      if (keep) try { sessionStorage.setItem('cordiaTutorKeep', '1'); } catch { /* storage blocked */ }
      router.replace(href);
    });
  }, [onChat, routeId]);

  // With the switch off, students land on the Dashboard as before.
  // With no answer on this device yet, the server is asked first (lib/useNewShell.js).
  useEffect(() => {
    if (!ready || !router.isReady) return;
    let live = true;
    const decide = on => {
      if (!live) return;
      // A chat also needs the window at least 768px wide (phones keep the Tutor page).
      const shown = Boolean(on) && (!onChat || shellActive());
      setAllowed(shown);
      if (!shown) leave();
    };
    if (shellFlag()) decide(true);
    else refreshShell().then(decide);
    return () => { live = false; };
  }, [ready, router.isReady, onChat]);

  // Narrowed below 768px while a chat is open: it moves to the Tutor page.
  const shell = useNewShell();
  useEffect(() => { if (onChat && allowed && shell === false) { setAllowed(false); leave(); } }, [shell, onChat, allowed]);

  // The page stays mounted from /home to /chat/<id> (components/Layout.js), so the move is one move.
  // It remounts its screen when a different chat opens; not when it changes its own address.
  const handoff = useRef(null);
  const [screen, setScreen] = useState({ key: 1, id: routeId });
  if (router.isReady && screen.id !== routeId) {
    const own = handoff.current === routeId;
    handoff.current = null;
    setScreen({ key: own ? screen.key : screen.key + 1, id: routeId });
  }
  const goTo = useCallback(id => {
    handoff.current = id || '';
    router.replace(id ? chatHref(id) : HOME_ROUTE, undefined, { scroll: false });
  }, [router]);

  if (!ready || !allowed || !router.isReady) return null;
  return <ChatScreen key={screen.key} routeId={screen.id} goTo={goTo} progress={progress} />;
}

function ChatScreen({ routeId, goTo, progress }) {
  const router = useRouter();
  const store = useChats();
  const [classId, setClassId] = useState('');
  // The open chat: its summary and the messages it had when it was loaded (a saved chat shows these
  // until it is continued). null on the home until the first message makes one.
  const [chat, setChat] = useState(null);
  const [phase, setPhase] = useState(routeId ? 'loading' : 'ready'); // loading | ready | failed | gone
  // Something another tab did: { reason: 'gone' | 'moved' | 'network', text }.
  const [notice, setNotice] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [planning, setPlanning] = useState(null);
  const chatRef = useRef(null);
  chatRef.current = chat;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // The live conversation as this chat last showed it (see `trusted` below).
  const seen = useRef(null);
  const menuButton = useRef(null);
  const createdHere = useRef(false);

  // Something another tab did (a 404 or 409): one plain line above the composer with the way
  // forward, and the list looked at again. The typed text stays where it is. When the conversation
  // moved on, the chat is read again first, so carrying on opens it properly (lib/chats.js openChat).
  const reload = useRef(null);
  const report = useCallback(result => {
    const reason = result.reason;
    if (!STALE.includes(reason)) { if (reason !== 'limit') showChatMessage(result.message); return; }
    const show = () => { if (alive.current) setNotice({ reason, text: result.message || MESSAGES[reason] }); };
    if (reason === 'missing') invalidateFolders();
    loadChats({ fresh: true });
    if (reason === 'moved' && chatRef.current?.id) reload.current(chatRef.current.id, { again: true }).then(done => { if (done === 'ok') show(); });
    else show();
  }, []);

  // A new chat for the first message (from the home, or after this chat was deleted elsewhere).
  async function startNew({ session, material, question }) {
    const result = await startChat({ session, guideId: material?.kind === 'guide' ? material.id : null, classId: classId || null });
    if (!alive.current) return { ok: false };
    if (!result.ok) {
      const stale = STALE.includes(result.reason);
      if (stale) report(result);
      return { ok: false, message: stale || result.reason === 'limit' ? '' : result.message };
    }
    createdHere.current = true;
    const next = { ...result.chat, class_id: result.chat.class_id || classId || null };
    setChat(next);
    setNotice(null);
    keepOpenChat({ ...next, title: chatTitle([{ role: 'user', text: question }]) });
    goTo(next.id);
    return { session: result.session };
  }

  // A saved chat carries on: it becomes the Tutor's conversation first (lib/chats.js openChat).
  async function openSaved({ session }) {
    const result = await openChat(chatRef.current.id, { session });
    if (!alive.current) return { ok: false };
    if (!result.ok) {
      report(result);
      return { ok: false, message: [...STALE, 'limit'].includes(result.reason) ? '' : result.message };
    }
    setChat(result.chat);
    setNotice(null);
    if (result.chat.id !== chatRef.current?.id) goTo(result.chat.id);
    return { session: result.session };
  }

  const onSendFailed = useCallback(({ status, detail }) => {
    const reason = outcome({ httpStatus: status, detail });
    if (STALE.includes(reason)) { report({ reason, message: MESSAGES[reason] }); return; }
    // The first message from the home didn't go through (a plan limit, or no connection): the page
    // goes back to the home it was, the same move in reverse, with the question still in the box.
    if (createdHere.current) {
      createdHere.current = false;
      setChat(null);
      keepOpenChat(null);
      goTo('');
    }
  }, [goTo, report]);

  const starting = !chat || notice?.reason === 'gone' ? startNew : !chat.live ? openSaved : null;
  const tutor = useTutorChat({
    freshOnSend: true,
    scopeClassId: classId,
    startWith: starting,
    startMessages: starting === openSaved ? chat?.messages || [] : [],
    onSendFailed,
  });

  // A chat at /chat/<id>: load it. Only Tutor calls on this backend: a saved chat opens by moving
  // back into the Tutor (its address becomes the live conversation's).
  // One load at a time per chat (development runs effects twice; opening a saved chat on the first
  // backend moves it into the Tutor, so it must not run twice).
  const loadingChat = useRef('');
  const loadChat = useCallback(async (id, { again = false } = {}) => {
    if (loadingChat.current === id) return 'pending';
    loadingChat.current = id;
    try {
      const result = await getChat(id);
      if (!alive.current) return 'left';
      if (result.ok && result.mustOpen) {
        const opened = await openChat(id, {});
        if (!alive.current) return 'left';
        if (opened.ok) {
          setChat(opened.chat);
          setClassId(opened.chat.class_id || '');
          setNotice(null);
          setPhase('ready');
          if (opened.chat.id !== id) goTo(opened.chat.id);
          return 'ok';
        }
        Object.assign(result, opened);
      }
      if (!result.ok) {
        const reason = result.reason === 'network' || result.reason === 'error' ? 'network' : 'gone';
        if (!chatRef.current) setPhase(reason === 'gone' ? 'gone' : 'failed');
        else setNotice({ reason, text: reason === 'gone' ? MESSAGES.gone : result.message });
        if (reason === 'gone') loadChats({ fresh: true });
        return reason;
      }
      seen.current = null;
      setChat(result.chat);
      if (!again) setClassId(result.chat.class_id || '');
      setNotice(null);
      setPhase('ready');
      return 'ok';
    } finally { loadingChat.current = ''; }
  }, [goTo]);
  reload.current = loadChat;
  useEffect(() => { if (routeId) loadChat(routeId); }, []);

  // While this chat is live its messages are the Tutor's conversation. If another tab moves the
  // Tutor to a different conversation, this chat is checked again and shown as it was saved.
  const sessionMessages = tutor.messages;
  const trusted = Boolean(chat?.live) && (tutor.loading || sameConversation(seen.current || chat.messages, sessionMessages));
  useEffect(() => { if (trusted && sessionMessages.length) seen.current = sessionMessages; }, [trusted, sessionMessages]);
  const checked = useRef(null);
  const version = tutor.session?.conversation_version;
  useEffect(() => {
    if (!chat?.live || trusted || tutor.loading || checked.current === version) return;
    checked.current = version;
    getChat(chat.id).then(result => {
      if (!alive.current || chatRef.current?.id !== chat.id) return;
      if (!result.ok) { report(result.reason === 'moved' ? result : { ...result, reason: result.reason === 'network' ? 'network' : 'gone' }); return; }
      seen.current = null;
      setChat(result.chat);
      setNotice({ reason: 'moved', text: MESSAGES.moved });
      loadChats({ fresh: true });
    });
  }, [chat?.id, chat?.live, trusted, version, tutor.loading]);

  // Once the Tutor has answered, the chat is a chat: a later failure no longer sends the page home.
  useEffect(() => { if (createdHere.current && tutor.messages.some(message => message.role !== 'user')) createdHere.current = false; }, [tutor.messages]);

  const messages = !chat ? tutor.messages
    : chat.live ? (trusted ? sessionMessages : seen.current || chat.messages || [])
      : tutor.loading ? sessionMessages : chat.messages || [];

  // Everything the empty home shows loads together; returning shows the saved copy at once. New
  // students start the day-one walkthrough here, as they did on the Dashboard.
  const { data, ready: loaded } = useCachedPage('home', async () => {
    const [home, onboarding] = await Promise.all([loadHome(), safe(loadOnboarding())]);
    if (onboarding && !onboarding.completed && !home.guideCount && !progress.wt && !dayOneFinished()) startWalkthrough('day1');
    else if (onboarding && !onboarding.completed && home.guideCount) saveOnboardingStep('done');
    return home;
  }, { enabled: !routeId });

  // The classes for the pickers, again whenever one is added, renamed or deleted.
  const [classes, setClasses] = useState(() => (latestFolders() ? sidebarClasses(latestFolders()) : []));
  useEffect(() => {
    let live = true;
    const load = () => loadFolders().then(result => {
      if (!live || !Array.isArray(result?.folders)) return;
      const next = sidebarClasses(result.folders);
      setClasses(next);
      // A class deleted in another tab can't stay picked.
      setClassId(picked => (picked && !next.some(item => String(item.id) === picked) ? '' : picked));
    });
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

  const chatting = Boolean(chat) || Boolean(routeId) || (tutor.sentHere && tutor.messages.length > 0);
  const row = chat ? (store.chats || []).find(item => item.id === chat.id) : null;
  const title = row?.title || chat?.title || chatTitle(messages);
  const chipId = chat ? (row && store.editable ? row.class_id : chat.class_id) : classId;
  const chip = classes.find(item => String(item.id) === String(chipId || ''));

  // The open chat stays in Recent chats, marked current, while it is open.
  const gone = notice?.reason === 'gone';
  useEffect(() => { keepOpenChat(chat && !gone ? { ...chat, title: chat.title || chatTitle(messages) } : null); }, [chat?.id, chat?.title, chat?.class_id, chat?.live, messages[0]?.text, gone]);
  useEffect(() => () => keepOpenChat(null), []);

  // Home to chat, and back: the composer slides from where it was to where it is now; the
  // conversation fades in. Reduced motion: it is simply there.
  const composerRef = useRef(null);
  const lastTop = useRef(null);
  const wasChatting = useRef(chatting);
  useLayoutEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    const top = layoutTop(element);
    if (wasChatting.current !== chatting && lastTop.current !== null && !reducedMotion()) {
      const delta = lastTop.current - top;
      if (Math.abs(delta) > 1) element.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], MOVE);
    }
    wasChatting.current = chatting;
    lastTop.current = top;
  });

  // Rename in place: Enter saves, Escape cancels, an empty title keeps the old one.
  const renameDone = useRef(false);
  function beginRename() {
    renameDone.current = false;
    setRenaming(true);
  }
  async function finishRename(value, save = true) {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(false);
    requestAnimationFrame(() => menuButton.current?.focus({ preventScroll: true }));
    const next = String(value || '').split(/\s+/).filter(Boolean).join(' ');
    if (!save || !next || next === title || !chat) return;
    const before = chat.title;
    setChat(current => ({ ...current, title: next }));
    const result = await renameChat(chat.id, next);
    if (!alive.current) return;
    if (!result.ok) {
      setChat(current => (current ? { ...current, title: before } : current));
      report(result);
    }
  }

  async function moveTo(target) {
    const before = chat.class_id;
    setChat(current => ({ ...current, class_id: target }));
    const result = await moveChat(chat.id, target);
    if (!alive.current) return;
    if (!result.ok) {
      setChat(current => (current ? { ...current, class_id: before } : current));
      report(result);
    }
  }

  // Delete: the chat leaves the list at once with Undo in a toast (components/ChatToast.js); this
  // page goes to the home, whose composer takes focus.
  async function removeChat() {
    const result = await deleteChat(chat.id);
    if (!alive.current) return;
    if (result.ok) { keepOpenChat(null); router.replace(HOME_ROUTE); }
    else report(result);
  }

  const editable = store.editable;
  const dot = tone => function ClassDot() {
    return <span className={'c-class-dot' + (tone ? '' : ' is-none')} style={tone ? { '--dot': `var(--cover-ink-${tone})` } : undefined} aria-hidden="true" />;
  };
  const menuItems = [
    { key: 'rename', label: 'Rename', icon: PenLine, disabled: !editable, onSelect: beginRename },
    {
      key: 'move', label: 'Move to class', icon: FolderInput, disabled: !editable,
      items: [
        { key: 'none', label: 'No class', icon: dot(0), current: !chipId, onSelect: () => moveTo(null) },
        ...classes.map(item => ({ key: String(item.id), label: item.code, meta: item.name !== item.code ? item.name : undefined, icon: dot(item.tone), current: String(chipId || '') === String(item.id), onSelect: () => moveTo(String(item.id)) })),
      ],
    },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: editable, disabled: !editable, onSelect: removeChat },
  ];

  // After a notice's button goes away, focus goes back to the message box.
  const focusComposer = () => requestAnimationFrame(() => tutor.rootRef.current?.querySelector('.composer-box')?.focus({ preventScroll: true }));

  const headline = homeHeadline(data?.exam, data?.plan, data?.className);
  const pills = homeSuggestions({
    learn: data?.exam ? { title: data.exam.title, guideId: data.exam.guideId, date: data.exam.date } : null,
    due: data?.due || 0,
    deadline: data?.deadline || null,
  });
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const shown = { ...tutor, messages, localError: notice ? '' : tutor.localError };
  const pageReady = routeId ? phase !== 'loading' : loaded;

  return (
    <LoadGate ready={pageReady} label={routeId ? 'Loading this chat' : 'Loading your home'}>
      {chat && <Head><title>{pageTitle(title)}</title></Head>}
      <div ref={tutor.rootRef} className={'chat-home' + (chatting ? ' is-chat' : '') + (tutor.attachDropActive ? ' is-drop' : '')}>
        <header className="chat-home-top">
          {chatting ? (
            <>
              {renaming ? (
                <input className="chat-home-rename" defaultValue={title} aria-label="Chat title" maxLength={120} autoFocus
                  onFocus={event => event.currentTarget.select()}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); finishRename(event.currentTarget.value); }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishRename('', false); }
                  }}
                  onBlur={event => finishRename(event.currentTarget.value)} />
              ) : <h1 className="chat-home-title c-truncate">{phase === 'ready' ? title : 'Chat'}</h1>}
              {chip && !renaming && <span className="chat-home-chip"><span className="c-class-dot" style={{ '--dot': `var(--cover-ink-${chip.tone})` }} aria-hidden="true" />{chip.code}</span>}
              {chat && phase === 'ready' && (
                <span className="chat-home-menu">
                  <Menu label="Chat options" items={menuItems} note={editable ? '' : MESSAGES.unavailable} triggerRef={menuButton} />
                </span>
              )}
            </>
          ) : (
            <>
              <ClassPicker classes={classes} value={classId} onChange={setClassId} />
              <span className="chat-home-date">{today}</span>
            </>
          )}
        </header>

        {phase === 'gone' || phase === 'failed' ? (
          <div className="chat-home-stage">
            <div className="chat-home-hero chat-home-missing" role="alert">
              <p className="chat-home-line">{phase === 'gone' ? MESSAGES.gone : "Couldn't load this chat. Check your connection and try again."}</p>
              <div className="chat-notice-actions">
                {phase === 'failed' && <button type="button" className="c-btn c-btn--secondary" onClick={() => { setPhase('loading'); loadChat(routeId); }}>Try again</button>}
                <Link href={HOME_ROUTE} className="c-btn c-btn--secondary">Go to the home</Link>
                {phase === 'gone' && <button type="button" className="c-btn c-btn--quiet" onClick={() => loadChat(routeId)}>Reload the chat</button>}
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-home-stage">
            {chatting ? (
              <div className="cordia-tutor-messages chat-home-thread" aria-live="polite">
                <div className="chat-home-column">
                  <TutorMessages tutor={shown} avatar />
                  <div ref={tutor.endRef} />
                </div>
              </div>
            ) : (
              <div className="chat-home-hero">
                <h1 className="chat-home-headline">{headline.title}</h1>
                {headline.line && <p className="chat-home-line">{headline.line}</p>}
              </div>
            )}

            {notice && (
              <div className="chat-notice" role="status">
                <span className="chat-notice-text">{notice.text}</span>
                <span className="chat-notice-actions">
                  {['gone', 'moved'].includes(notice.reason) && (chat || routeId) && (
                    <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => { loadChat(chat?.id || routeId, { again: true }); focusComposer(); }}>Reload the chat</button>
                  )}
                  {notice.reason === 'network' && (
                    <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => { loadChat(chat?.id || routeId, { again: true }); focusComposer(); }}>Try again</button>
                  )}
                  {['gone', 'moved'].includes(notice.reason) && (chat || routeId)
                    ? <Link href={HOME_ROUTE} className="c-btn c-btn--quiet c-btn--sm">Go to the home</Link>
                    : <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => { setNotice(null); focusComposer(); }}>Dismiss</button>}
                </span>
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
        )}

        <p className="chat-home-note">The Tutor answers from your class material. Check anything that matters before you rely on it.</p>
        {planning && <AssignmentSheet item={planning} onClose={() => setPlanning(null)} />}
      </div>
    </LoadGate>
  );
}
