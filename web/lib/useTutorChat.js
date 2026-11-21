import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from './api';
import { loadFolders } from './folders';
import { lastGuide } from './userStore';
import { walkthroughEvent } from './walkthrough';
import { tutorMode } from './tutorPrefs';
import { unsupportedFileMessage, useFileDropZone } from './fileDrop';
import { loadSavedChats, reportTutorSession, tutorChatsChanged } from './tutorChats';
import useDictation from './useDictation';

// The Tutor client: one conversation with the server's Tutor session (GET /tutor/session,
// POST /chat), its material, attachments, modes, saved chats, voice and limits. The side panel and
// the full Tutor page (components/AIChatWidget.js) and the chat home's composer (pages/home.js)
// all talk to the Tutor through this one hook.

// Spoken text drops diagram code so read-aloud only says the explanation.
export function speakableText(text) {
  return String(text || '').replace(/```mermaid[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
}

// Skills done once (organizing into a class): afterwards Auto is Explain again.
const ONE_TIME_SKILLS = ['organize'];
export const MAX_ATTACHMENTS = 5;
// The Tutor model reads this much of the selected material (context[:25000] in backend/services/llm.py).
const TUTOR_CONTEXT_CHARS = 25_000;

// Gives every attached file a fair share of what the Tutor can read, so one long
// file cannot crowd out the others. Returns the combined text and trimmed file names.
function combineAttachments(files) {
  if (files.length === 1) return { content: files[0].content, trimmed: files[0].content.length > TUTOR_CONTEXT_CHARS ? [files[0].title] : [] };
  const headers = files.map(file => `${file.title}\n\n`);
  let budget = TUTOR_CONTEXT_CHARS - headers.join('').length - 2 * (files.length - 1);
  const shares = new Array(files.length).fill(0);
  // Shortest files first: each takes what it needs up to an even split of what is left.
  const order = files.map((_, index) => index).sort((a, b) => files[a].content.length - files[b].content.length);
  order.forEach((index, position) => {
    const share = Math.max(0, Math.floor(budget / (order.length - position)));
    shares[index] = Math.min(files[index].content.length, share);
    budget -= shares[index];
  });
  return {
    content: files.map((file, index) => headers[index] + file.content.slice(0, shares[index])).join('\n\n'),
    trimmed: files.filter((file, index) => shares[index] < file.content.length).map(file => file.title),
  };
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const MAX_MESSAGES = 30;
const SKILL_PROGRESS = {
  explain: 'Explaining material…',
  capture: 'Reading current page…',
  build_guide: 'Building guide…',
  practice: 'Creating practice problems…',
  retain: 'Strengthening recall…',
  plan: 'Planning study time…',
  find_material: 'Finding related material…',
  organize: 'Organizing study material…',
};

// freshOnMount: the full Tutor page opens on a new chat; the side panel starts one each time it opens.
// resumeChatId: the full Tutor page opens that saved chat instead (the sidebar's Recent chats).
// freshOnSend: the chat home; the sidebar's New chat empties it again.
// startWith: the chat page (pages/home.js): before the next message, start a new chat or open a saved
// one (lib/chats.js); resolves to { session } to send in, or { ok: false } to stop (the question
// goes back in the box). startMessages: what that conversation already holds, shown under the question.
// onSendFailed({ status, detail, failed, question }): the Tutor didn't answer (a 404 or 409 from another
// tab, a plan limit, no connection); the question is back in the box.
// scopeClassId: the class picked in the composer ('' for all classes).
// chatContext: { key, guideId } for a chat that was opened (not one just started here): its next
// questions go with its own guide (or with no guide when it has none), as they did when it was
// started, until the student picks other material.
// dropFiles: files dropped on the page attach here (off where another Tutor takes them).
export function useTutorChat({ guides: providedGuides = null, preferredGuideId = '', preferredNoteId = '', freshOnMount = false, resumeChatId = '', assignment = null, initialPrompt = '', freshOnSend = false, startWith = null, startMessages = null, onSendFailed = null, scopeClassId = '', chatContext = null, dropFiles = true } = {}) {
  // An assignment being worked on: its instructions and rubric go with every question until cleared.
  const [working, setWorking] = useState(assignment);
  useEffect(() => { setWorking(assignment); }, [assignment?.key]);
  const router = useRouter();
  const [loadedGuides, setLoadedGuides] = useState([]);
  const [guidesLoaded, setGuidesLoaded] = useState(Boolean(providedGuides));
  const [notes, setNotes] = useState([]);
  const [classes, setClasses] = useState([]);
  const [contextKey, setContextKey] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [browserMaterial, setBrowserMaterial] = useState(null);
  const [session, setSession] = useState(null);
  // The mode chosen in Settings › Tutor; Auto ('') picks from what the student asks.
  const [savedMode, setSavedMode] = useState('');
  const [skillOverride, setSkillOverride] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [input, setInput] = useState(initialPrompt || '');
  useEffect(() => { if (initialPrompt) setInput(initialPrompt); }, [initialPrompt]);
  const [retainContext, setRetainContext] = useState(null);
  const [savedDraft, setSavedDraft] = useState('');
  const [loading, setLoading] = useState(false);
  // While a question is in flight the server copy of the session lags behind this one,
  // so background refreshes must not replace it (that erased the student's new message).
  const sendingRef = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [localError, setLocalError] = useState('');
  // Set when the Tutor opens: the next session load starts a new chat (the last one is saved).
  const [freshPending, setFreshPending] = useState(false);
  const [resumePending, setResumePending] = useState('');
  // The chat home: whether a message was sent from here, and whether its new chat has started.
  const [sentHere, setSentHere] = useState(false);
  const startedRef = useRef(false);
  const keepRef = useRef(null); // opened to keep the current chat (the panel's expand, Recent chats)
  const [chatsOpen, setChatsOpen] = useState(false);
  const [savedChats, setSavedChats] = useState(null);
  const [chatsError, setChatsError] = useState('');
  const [deletingChat, setDeletingChat] = useState(null); // a saved chat waiting for "Delete" to be confirmed
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  // Dictation (lib/dictation.mjs): the words that are final go in the box, at the caret; what is
  // still being recognized (interim) shows apart from it.
  const { Recognition, listening, interim, error: dictationError, toggle: toggleMic, abort: stopDictation } = useDictation({ text: input, setText: setInput });
  // Read after mount: the server render has no browser speech APIs, and the first client
  // render must match it.
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => setCanSpeak('speechSynthesis' in window), []);
  // Another chat (a saved one from the sidebar, a new one) is another box: the mic goes off with the page.
  useEffect(() => { stopDictation(); }, [router.asPath, stopDictation]);

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  function toggleSpeech(index, text) {
    window.speechSynthesis.cancel();
    if (speakingIndex === index) { setSpeakingIndex(-1); return; }
    const utterance = new SpeechSynthesisUtterance(speakableText(text));
    utterance.rate = 0.95;
    utterance.onend = () => setSpeakingIndex(current => (current === index ? -1 : current));
    window.speechSynthesis.speak(utterance);
    setSpeakingIndex(index);
  }
  const fileRef = useRef(null);
  const rootRef = useRef(null);
  const endRef = useRef(null);
  // Files dropped on the Tutor, or anywhere on a page with no upload box of its
  // own, are attached here; a closed Tutor opens to show the attachment.
  const attachDropActive = useFileDropZone({
    priority: 1,
    enabled: dropFiles,
    getElement: () => rootRef.current,
    onFiles: (files, { direct }) => {
      if (!direct) window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: {} }));
      attachFiles(files);
    },
  });
  const appliedPreferred = useRef('');
  const pendingSend = useRef('');

  // The Tutor stays mounted across pages, so guides and notes made elsewhere (Create,
  // SmartNotes, the extension) are reloaded on navigation and when the tab regains focus.
  useEffect(() => {
    let active = true;
    let lastLoad = 0;
    function loadMaterials() {
      lastLoad = Date.now();
      Promise.all([
        providedGuides ? null : apiFetch('/guides?fields=summary&limit=200'),
        apiFetch('/smart_notes'),
        loadFolders(),
      ]).then(([guideData, noteData, folderData]) => {
        if (!active) return;
        if (Array.isArray(guideData?.guides)) { setLoadedGuides(guideData.guides); setGuidesLoaded(true); }
        if (Array.isArray(noteData?.notes)) setNotes(noteData.notes);
        if (Array.isArray(folderData?.folders)) setClasses(folderData.folders);
      });
    }
    function onFocus() {
      if (!document.hidden && Date.now() - lastLoad > 15000) loadMaterials();
    }
    loadMaterials();
    router.events.on('routeChangeComplete', loadMaterials);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      router.events.off('routeChangeComplete', loadMaterials);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [providedGuides, router.events]);

  // Poll fast only while a Tutor action is running; slow when idle; never while the tab is hidden.
  const sessionStatusRef = useRef('idle');
  const refreshSessionRef = useRef(null);
  useEffect(() => {
    let active = true;
    let timer = null;
    let inFlight = false;
    async function refresh() {
      window.clearTimeout(timer);
      if (document.hidden || inFlight) return;
      inFlight = true;
      const next = await apiFetch('/tutor/session');
      inFlight = false;
      if (!active) return;
      if (next?.id && !sendingRef.current) {
        sessionStatusRef.current = next.status || 'idle';
        setSession(next);
      }
      timer = window.setTimeout(refresh, sessionStatusRef.current === 'idle' ? 20000 : 3000);
    }
    refreshSessionRef.current = refresh;
    function onVisible() {
      if (!document.hidden) refresh();
    }
    refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Saved chats changed the conversation (lib/chats.js: a chat deleted, started or opened).
    window.addEventListener('cordia:tutor-refresh', onVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('cordia:tutor-refresh', onVisible);
    };
  }, []);

  useEffect(() => {
    const status = session?.status || 'idle';
    const wasIdle = sessionStatusRef.current === 'idle';
    sessionStatusRef.current = status;
    if (wasIdle && status !== 'idle') refreshSessionRef.current?.();
  }, [session?.status]);

  useEffect(() => {
    const observation = session?.browser_observation || {};
    if (!session?.browser_content_available) {
      setBrowserMaterial(null);
      return;
    }
    if (browserMaterial?.revision === session.browser_content_revision && browserMaterial?.content) return;
    apiFetch('/tutor/session/browser-content').then(data => {
      if (!data?.content) return;
      setBrowserMaterial({
        title: data.observation?.title || 'Captured browser material',
        url: data.observation?.url || '',
        content: data.content,
        revision: data.revision,
      });
    });
  }, [session?.browser_content_available, session?.browser_content_revision, session?.browser_observation?.url, browserMaterial?.revision, browserMaterial?.content]);

  const guides = providedGuides || loadedGuides;
  // A class picked in the composer (scopeClassId): only that class's guides and notes are offered,
  // and the question goes with the class (class_id), as when a guide in that class is picked.
  const chatGuideId = chatContext?.guideId ? String(chatContext.guideId) : '';
  const inScope = item => !scopeClassId || String(item?.folder_id || '') === String(scopeClassId);
  const combinedAttachments = combineAttachments(attachments);
  const attachedMaterial = {
    title: attachments.map(file => file.title).join(' + ').slice(0, 300),
    content: combinedAttachments.content,
  };
  const materials = [
    // An open chat's own guide stays offered even when the chat has since moved to another class.
    ...guides.filter(item => inScope(item) || (chatGuideId && String(item.id) === chatGuideId)).map(item => ({ ...item, kind: 'guide', key: `guide:${item.id}` })),
    ...notes.filter(inScope).map(item => ({ ...item, kind: 'note', key: `note:${item.id}` })),
    ...(attachments.length ? [{ ...attachedMaterial, kind: 'attachment', key: 'attachment' }] : []),
    ...(session?.browser_content_available ? [{ ...(browserMaterial || {}), title: browserMaterial?.title || 'Captured browser material', kind: 'browser', key: 'browser' }] : []),
  ];

  // The material on screen always wins: each navigation re-applies it, so the chip
  // never keeps showing a guide from an earlier page.
  useEffect(() => { appliedPreferred.current = ''; }, [router.asPath, preferredGuideId, preferredNoteId]);
  // An opened chat carries on about its own guide: set once per chat, as soon as that guide is
  // known, or no material when it has none or the guide is gone (never another guide's content).
  const chatKey = chatContext?.key ? String(chatContext.key) : '';
  const appliedChat = useRef('');
  const skipFallback = useRef(false);
  const chatMaterial = chatGuideId ? `guide:${chatGuideId}` : 'none';
  useEffect(() => {
    if (!chatKey || appliedChat.current === chatKey) return;
    if (chatMaterial === 'none' || materials.some(item => item.key === chatMaterial)) {
      appliedChat.current = chatKey;
      skipFallback.current = true;
      setContextKey(chatMaterial);
    } else if (guidesLoaded) {
      appliedChat.current = chatKey;
      skipFallback.current = true;
      setContextKey('none');
    }
  }, [chatKey, chatMaterial, guidesLoaded, materials.length]);
  useEffect(() => {
    if (skipFallback.current) { skipFallback.current = false; return; }
    if (chatKey && appliedChat.current !== chatKey) return;
    const preferred = preferredGuideId ? `guide:${preferredGuideId}` : preferredNoteId ? `note:${preferredNoteId}` : '';
    if (preferred && preferred !== appliedPreferred.current && materials.some(item => item.key === preferred)) {
      appliedPreferred.current = preferred;
      setContextKey(preferred);
      return;
    }
    if (contextKey !== 'none' && !materials.some(item => item.key === contextKey)) {
      const last = lastGuide();
      const fallback = last && materials.some(item => item.key === `guide:${last.id}`) ? `guide:${last.id}` : materials[0]?.key || '';
      setContextKey(fallback);
    }
  }, [guides, notes, attachments.length, materials.length, contextKey, preferredGuideId, preferredNoteId, router.asPath, scopeClassId]);

  useEffect(() => {
    const prefill = event => {
      const detail = event.detail || {};
      if (detail.refresh) refreshSessionRef.current?.();
      if (detail.guideId) setContextKey(`guide:${detail.guideId}`);
      if (detail.skill) setSkillOverride(detail.skill);
      if (detail.retainContext) setRetainContext(detail.retainContext);
      if (detail.prompt) {
        setInput(current => {
          if (detail.retainContext && current.trim() && current !== detail.prompt) setSavedDraft(current);
          return detail.prompt;
        });
        if (detail.send) pendingSend.current = detail.prompt;
      }
    };
    window.addEventListener('cordia:tutor-prompt', prefill);
    return () => window.removeEventListener('cordia:tutor-prompt', prefill);
  }, []);

  const messages = session?.messages || [];
  useEffect(() => {
    const container = endRef.current?.closest('.cordia-tutor-messages');
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages.length, loading, chatsOpen]);

  const material = materials.find(item => item.key === contextKey);
  // With no material chosen, Explain (or Auto) is a general chat answered from general knowledge.
  const general = !material && ['', 'none'].includes(contextKey);
  // Auto keeps the skill the Tutor was last using, except one-time actions (organizing into a
  // class): after one of those, Auto is Explain again, so the next question isn't asked for a class.
  const autoSkill = general || ONE_TIME_SKILLS.includes(session?.active_skill) ? 'explain' : session?.active_skill || 'explain';
  const selectedSkillId = skillOverride || savedMode || autoSkill;
  const selectedSkill = session?.skills?.find(item => item.id === selectedSkillId);
  const hasRequiredContext = (Boolean(material) && (material.kind !== 'browser' || Boolean(material.content))) || selectedSkill?.requires_context === false || (general && ['', 'explain'].includes(skillOverride));
  const needsTargetClass = selectedSkillId === 'organize';
  const canSubmit = hasRequiredContext && (!needsTargetClass || Boolean(targetClassId));
  // How many questions this chat has room for: counted on the conversation that is carried on. On the
  // chat page that is the chat being continued (a saved one's own messages, or none for a new chat),
  // not the Tutor's live conversation, which may belong to a different chat and be full.
  const counted = typeof startWith === 'function' ? startMessages || [] : messages;
  const remaining = MAX_MESSAGES - counted.filter(message => message.role === 'user').length;
  const busy = loading || freshPending || (session?.status && session.status !== 'idle');
  const progressLabel = SKILL_PROGRESS[session?.active_skill] || 'Cordia is working…';

  // "Explain" and "Ask why" send at once so the Tutor explains without another tap.
  useEffect(() => {
    if (!pendingSend.current || input !== pendingSend.current || !canSubmit || busy || !session?.id) return;
    pendingSend.current = '';
    sendMessage();
  }, [input, canSubmit, busy, session?.id, contextKey]);

  async function attachFiles(list) {
    const picked = Array.from(list || []);
    if (!picked.length || extracting) return;
    const problems = [];
    const readable = picked.filter(file => {
      const unsupported = unsupportedFileMessage(file);
      if (unsupported) problems.push(unsupported);
      return !unsupported;
    });
    const room = MAX_ATTACHMENTS - attachments.length;
    if (readable.length > room) problems.push(`The Tutor can hold up to ${MAX_ATTACHMENTS} files at a time.`);
    const toRead = readable.slice(0, Math.max(room, 0));
    setLocalError([...new Set(problems)].join(' '));
    if (fileRef.current) fileRef.current.value = '';
    if (!toRead.length) return;
    setExtracting(true);
    const added = [];
    for (const file of toRead) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const response = await fetch(API + '/extract-file-text', { method: 'POST', headers: authOnlyHeaders(), body: formData });
        const data = await responseJson(response);
        if (!response.ok || !data?.text) throw new Error(apiErrorMessage(data?.detail, 'Could not read this file.'));
        added.push({ id: `${file.name}:${file.size}:${file.lastModified}`, title: file.name, content: data.text, file });
      } catch (error) {
        problems.push(toRead.length > 1 ? 'Some files could not be read.' : 'This file could not be read.');
      }
    }
    setLocalError([...new Set(problems)].join(' '));
    if (added.length) {
      setAttachments(current => {
        const seen = new Set(current.map(file => file.id));
        return [...current, ...added.filter(file => !seen.has(file.id))].slice(0, MAX_ATTACHMENTS);
      });
      setContextKey('attachment');
    }
    setExtracting(false);
  }

  function removeAttachment(id) {
    setAttachments(current => current.filter(file => file.id !== id));
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || !canSubmit || busy || remaining <= 0 || !session?.id) return;
    stopDictation();
    walkthroughEvent('ask');
    setChatsOpen(false);
    setInput('');
    setLocalError('');
    sendingRef.current = true;
    setLoading(true);
    setSentHere(true);
    startedRef.current = true;
    // startWith (the chat page): this message starts a new chat, or carries on a saved one, first.
    const starting = typeof startWith === 'function';
    const asked = { role: 'user', text: question };
    setSession(current => ({
      ...current,
      status: 'running',
      messages: [...(starting ? startMessages || [] : current?.messages || []), asked],
    }));
    let current = session;
    if (starting) {
      const started = await startWith({ session, material, question });
      if (!started?.session?.id) {
        // No chat was made, so nothing was sent: everything goes back as it was in one step (the
        // page stays what it was, the question back in the box), then the session is read again.
        sendingRef.current = false;
        startedRef.current = false;
        setSentHere(false);
        setSession(session);
        setInput(question);
        if (started?.message) setLocalError(started.message);
        setLoading(false);
        const refreshed = await apiFetch('/tutor/session');
        if (refreshed?.id) setSession(refreshed);
        return;
      }
      current = started.session;
      setSession({ ...current, status: 'running', messages: [...(current.messages || []), asked] });
    }
    const selectedContent = material?.kind === 'guide'
      ? (material.study_guide || material.notes || '')
      : material?.kind === 'note'
        ? (material.content || '')
        : (material?.content || '');
    const data = await apiFetch('/chat', {
      method: 'POST',
      timeoutMs: 120000,
      withStatus: true,
      body: JSON.stringify({
        question,
        content: selectedContent,
        ...(material?.kind === 'guide' ? { guide_id: material.id } : {}),
        ...(material?.kind === 'note' ? { note_id: material.id } : {}),
        ...(['attachment', 'browser'].includes(material?.kind) ? { context_title: material.title } : {}),
        ...(material?.kind === 'browser' && material.url ? { context_url: material.url } : {}),
        session_id: current.id,
        conversation_version: current.conversation_version,
        skill: skillOverride || savedMode || (autoSkill !== current.active_skill ? autoSkill : null),
        retain_context: retainContext || undefined,
        class_id: needsTargetClass ? targetClassId : scopeClassId || material?.folder_id || undefined,
        assignment_key: working?.key || undefined,
        mode: 'short',
        rich_text: true,
        // The student's own day, so "tomorrow" and "Friday" in a study plan mean their days.
        local_date: localDay(),
      }),
    });
    sendingRef.current = false;
    if (data?.action === 'created_guide' && !providedGuides) {
      const refreshed = await apiFetch('/guides?fields=summary&limit=200');
      if (Array.isArray(refreshed?.guides)) {
        setLoadedGuides(refreshed.guides);
        setContextKey(`guide:${data.guide.id}`);
      }
    }
    // The Tutor opened something in the app ("open my BUS 101 class").
    if (data?.action === 'navigate' && data.link?.href) router.push(data.link.href);
    // A renamed guide that is open refreshes like an edited outline does.
    const renamedId = data?.action === 'renamed_guide' && data.link?.href?.match(/^\/guide\/([^/?]+)/)?.[1];
    if (renamedId) window.dispatchEvent(new CustomEvent('cordia:outline-updated', { detail: { guideId: renamedId } }));
    // The Tutor changed a guide's outline: the guide page refreshes it in place.
    if (data?.action === 'outline_updated' && data.guide?.id) {
      window.dispatchEvent(new CustomEvent('cordia:outline-updated', { detail: { guideId: data.guide.id } }));
    }
    if (data?.session?.id) {
      setSkillOverride('');
      setRetainContext(null);
      if (savedDraft) {
        setInput(savedDraft);
        setSavedDraft('');
      }
      setSession(data.session);
    } else {
      // The Tutor didn't answer. The session goes back to before the question and the question to the
      // box in the same step as the page's own reply (onSendFailed: the home first message goes back
      // to the home), so no frame shows a half-way layout; the session is read again after.
      setSession(current);
      setInput(question);
      setLocalError(data?.answer || apiErrorMessage(data?.detail, 'Cordia could not answer that yet.'));
      setLoading(false);
      onSendFailed?.({ status: data?.httpStatus || 0, detail: data?.detail, failed: data?.failed, question });
      const refreshed = await apiFetch('/tutor/session');
      if (refreshed?.id) setSession(refreshed);
      return;
    }
    setLoading(false);
  }

  // Chats: the live conversation is saved when a new one starts, and saved chats can be reopened.
  useEffect(() => {
    if (!chatsOpen) return;
    setChatsError('');
    apiFetch('/tutor/chats').then(data => {
      if (Array.isArray(data?.chats)) setSavedChats(data.chats);
      else { setSavedChats([]); setChatsError(data?.detail || 'Saved chats could not be loaded.'); }
    });
  }, [chatsOpen]);

  useEffect(() => {
    const readMode = () => setSavedMode(tutorMode());
    readMode();
    // Read once per mount (React's development double effects mustn't read it twice).
    if (keepRef.current === null) {
      keepRef.current = sessionStorage.getItem('cordiaTutorKeep') === '1';
      sessionStorage.removeItem('cordiaTutorKeep');
    }
    if (!resumeChatId && freshOnMount && !keepRef.current) setFreshPending(true);
    const onVisibility = event => { if (event.detail?.open) setFreshPending(true); };
    // The sidebar's New chat, pressed while the full Tutor page is already open.
    const onNew = () => {
      stopDictation();
      if (freshOnMount) setFreshPending(true);
      // The chat home empties again; its next message starts the new chat (freshOnSend).
      if (freshOnSend && !sendingRef.current) { startedRef.current = false; setSentHere(false); setInput(''); setAttachments([]); setLocalError(''); }
    };
    window.addEventListener('cordia:tutor-visibility', onVisibility);
    window.addEventListener('cordia:tutor-new', onNew);
    window.addEventListener('cordia:tutor-mode', readMode);
    return () => {
      window.removeEventListener('cordia:tutor-visibility', onVisibility);
      window.removeEventListener('cordia:tutor-new', onNew);
      window.removeEventListener('cordia:tutor-mode', readMode);
    };
  }, []);

  useEffect(() => { if (resumeChatId) setResumePending(resumeChatId); }, [resumeChatId]);

  // The sidebar's Recent chats: report this conversation as it changes.
  useEffect(() => { reportTutorSession(session?.messages); }, [session?.messages]);

  // Opened from Recent chats (/tutor?chat=<id>): move that saved chat back into the conversation,
  // the same as Past chats does, then drop the id from the address.
  useEffect(() => {
    if (!resumePending || !session?.id) return;
    let live = true;
    loadSavedChats().then(chats => {
      if (!live) return;
      const chat = chats.find(item => String(item.id) === resumePending);
      setResumePending('');
      const done = () => router.replace('/tutor', undefined, { shallow: true });
      if (chat) startChat({ resume: chat, opening: true }).finally(done);
      else { setLocalError('That chat is no longer saved.'); done(); }
    });
    return () => { live = false; };
  }, [resumePending, session?.id]);

  // Each time the Tutor opens it is on a new chat. The one before is saved under Past chats;
  // nothing is started while a reply is still being worked on, or when the chat is already empty.
  useEffect(() => {
    if (!freshPending || !session?.id) return;
    if (loading || (session.status && session.status !== 'idle') || !(session.messages || []).length) {
      setFreshPending(false);
      return;
    }
    const guide = contextKey.startsWith('guide:') ? contextKey.slice(6) : null;
    startChat({ guideId: guide, opening: true }).finally(() => setFreshPending(false));
  }, [freshPending, session?.id]);

  async function startChat({ guideId = null, resume = null, opening = false } = {}) {
    if (!session?.id || (busy && !opening)) return;
    stopDictation(); // words heard after this belong to nothing: the new chat starts with its own box
    setChatsError('');
    const next = await apiFetch('/tutor/session/new', {
      method: 'POST',
      body: JSON.stringify({ session_id: session.id, guide_id: guideId, resume_id: resume?.id || null }),
    });
    if (!next?.id) { setChatsError(next?.detail || 'Could not start a new chat.'); return; }
    const guide = resume ? resume.guide_id : guideId;
    setSession(next);
    tutorChatsChanged();
    setContextKey(guide && guides.some(item => item.id === guide) ? `guide:${guide}` : 'none');
    setSkillOverride('');
    setRetainContext(null);
    setLocalError('');
    setChatsOpen(false);
  }

  // Past chats: delete one saved chat (the student's own only; the server checks).
  async function deleteSavedChat(chat) {
    setDeletingChat(null);
    const done = await apiFetch(`/tutor/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
    if (Array.isArray(done?.chats)) { setSavedChats(done.chats); setChatsError(''); tutorChatsChanged(); }
    else setChatsError(done?.detail || `Could not delete “${chat.title || 'Tutor chat'}”.`);
  }

  async function deleteFromTutor(confirm) {
    const done = await apiFetch(`/guides/${confirm.guide_id}`, { method: 'DELETE' });
    if (!done?.deleted) { setLocalError(done?.detail || `Could not delete ${confirm.title}.`); return; }
    setLoadedGuides(current => current.filter(item => item.id !== confirm.guide_id));
    if (contextKey === `guide:${confirm.guide_id}`) setContextKey('none');
    setSession(current => ({
      ...current,
      messages: (current?.messages || []).map(message => (message.confirm?.guide_id === confirm.guide_id ? { ...message, confirm: null, text: `Deleted ${confirm.title}.` } : message)),
    }));
    if (router.asPath.startsWith(`/guide/${confirm.guide_id}`)) router.push('/library');
  }

  function openSource(source) {
    if (source?.type === 'study_guide') router.push('/guide/' + source.id);
    if (source?.type === 'smartnote') router.push('/smartnotes?id=' + source.id);
    if (source?.type === 'browser' && source.url) window.open(source.url, '_blank', 'noopener,noreferrer');
  }

  return {
    router, rootRef, endRef, fileRef,
    working, setWorking, guides, notes, classes, materials, material, general,
    contextKey, setContextKey, attachments, setAttachments, combinedAttachments, removeAttachment, attachFiles, extracting, attachDropActive,
    browserMaterial, session, messages, input, setInput, sendMessage, sentHere,
    savedMode, skillOverride, setSkillOverride, selectedSkillId, needsTargetClass, targetClassId, setTargetClassId,
    hasRequiredContext, canSubmit, remaining, busy, loading, progressLabel, localError, setLocalError,
    chatsOpen, setChatsOpen, savedChats, chatsError, deletingChat, setDeletingChat, deleteSavedChat, startChat,
    deleteFromTutor, openSource,
    Recognition, canSpeak, listening, interim, dictationError, toggleMic, speakingIndex, toggleSpeech,
  };
}
