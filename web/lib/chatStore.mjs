// Saved chats (docs/redesign/PLAN.md T5): the one place that knows how this page load reaches the
// student's chats. The chat page (pages/home.js, also at /chat/[id]), the sidebar's Recent chats
// and a class page's Chats tab all read and change chats through here (the browser copy is
// lib/chats.js). Pure, with the request function passed in, so every backend state and every
// "another tab changed it" case can be tested in Node (web/tests/saved-chats.test.mjs).
//
// The backend has three states, told apart from the responses, once per page load:
//   - GET /chats answers 404: only the Tutor's own calls exist (GET /tutor/chats, GET /tutor/session,
//     POST /tutor/session/new). The live conversation's id is the Tutor session's id; a saved chat
//     opens by moving it back into the session; nothing can be renamed, moved or deleted.
//   - GET /chats answers with editable false: the /chats API is there but its columns are not yet,
//     so rename, move, delete and restore answer 503 { code: 'chats_not_available' }.
//   - GET /chats answers with editable true: everything works.
// Callers only see `editable` and plain results ({ ok, reason, message }); nothing else needs to know.
//
// A chat, as every caller gets it (the backend's own summary shape):
//   { id, title, guide_id, class_id, live, created_at, updated_at }
// title is '' until the chat has a first message (callers show chatTitle(messages) or "Tutor chat").

import { chatTitle } from './shellTools.mjs';

export const LIST_LIMIT = 30;
// The most the backend lists at once (GET /chats limit 1-100, no paging): "Show more" asks for this
// many, and a class's Chats tab always does.
export const MAX_LIMIT = 100;
// The Undo toast after a delete stays this long (at least 5 seconds; the Library's Undo uses 6).
export const UNDO_MS = 6000;
export const MESSAGE_MS = 5000;

// What a result means for the student, in plain words. `reason` is what callers branch on.
export const MESSAGES = {
  gone: 'This chat was deleted or moved in another tab.',
  moved: 'This conversation moved on in another tab.',
  busy: 'The Tutor is still answering. Wait for it to finish, then try again.',
  missing: 'The class or material you picked was deleted in another tab. Pick another and try again.',
  purged: "This chat can't come back. It was deleted for good.",
  network: "Couldn't reach Classroom. Check your connection and try again.",
  unavailable: "You can't rename, move or delete chats yet.",
  limit: "You've reached your plan's Tutor limit.",
  error: 'Classroom hit a temporary problem. Try again.',
};

const RENAME_FAILED = {
  network: "Couldn't reach Classroom, so the chat keeps its old title.",
  error: "The chat couldn't be renamed, so it keeps its old title.",
};
const MOVE_FAILED = {
  network: "Couldn't reach Classroom, so the chat stays where it was.",
  error: "The chat couldn't be moved, so it stays where it was.",
};
const DELETE_FAILED = {
  network: "Couldn't reach Classroom, so the chat wasn't deleted.",
  error: "The chat couldn't be deleted. Try again.",
};

// The meaning of one response. request() answers with the body plus its HTTP status (apiFetch's
// withStatus), or { failed } when the request never got an answer. Every 404 and 409 another tab
// can cause (docs/redesign/T5-backend-notes.md, "Stale tabs"):
//   404 "Chat not found" / "That chat is already gone." / "That chat was deleted in another tab." -> gone
//   404 "Class not found" / "Guide not found" (the class or material was deleted)  -> missing
//   409 "Wait for Cordia Tutor to finish..." / "Cordia Tutor is already working..." -> busy
//   409 "Tutor conversation changed. Refresh and try again."                       -> moved
const BUSY = /wait for cordia tutor|already working on a request|received another request first/i;
const MISSING = /^(class|guide) not found/i;
export function outcome(response) {
  if (!response || response.failed) return 'network';
  const status = Number(response.httpStatus) || 0;
  const detail = typeof response.detail === 'string' ? response.detail : '';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404 && MISSING.test(detail)) return 'missing';
  if (status === 404 || status === 400) return 'gone';
  if (status === 409) return BUSY.test(detail) ? 'busy' : 'moved';
  if (status === 402) return 'limit';
  if (status === 503 && response.code === 'chats_not_available') return 'unavailable';
  return 'error';
}

function failure(reason, messages = {}) {
  return { ok: false, reason, message: messages[reason] || MESSAGES[reason] || MESSAGES.error };
}

const clean = value => String(value || '').split(/\s+/).filter(Boolean).join(' ');

export function chatSummary(raw = {}) {
  return {
    id: String(raw.id),
    title: clean(raw.title).slice(0, 120),
    guide_id: raw.guide_id || null,
    class_id: raw.class_id || null,
    live: Boolean(raw.live),
    created_at: raw.created_at || raw.updated_at || null,
    updated_at: raw.updated_at || raw.created_at || null,
  };
}

// Newest activity first. The live conversation with no time yet counts as now.
export function newestFirst(list) {
  const time = chat => Date.parse(chat.updated_at || '') || (chat.live ? Number.MAX_SAFE_INTEGER : 0);
  return [...list].sort((a, b) => time(b) - time(a));
}

// The live Tutor session as a chat (the first state: its id is the session's).
function liveChat(session, classes = {}) {
  return chatSummary({
    id: session.id, title: chatTitle(session.messages), guide_id: session.active_guide_id || null,
    class_id: classes[session.active_guide_id] || null, live: true,
    created_at: session.created_at || session.updated_at, updated_at: session.updated_at,
  });
}

const hasQuestion = messages => (messages || []).some(message => message?.role === 'user');

// The first state's list: the saved chats (GET /tutor/chats) and the live conversation when it has
// messages. A guide's chat counts as in the guide's class (classes: { guideId: classId }).
export function tutorChatList(saved, session, classes = {}) {
  const rows = (Array.isArray(saved) ? saved : []).filter(chat => chat?.id)
    .map(chat => chatSummary({ ...chat, class_id: classes[chat.guide_id] || null, live: false }));
  if (session?.id && hasQuestion(session.messages) && !rows.some(chat => chat.id === String(session.id))) rows.push(liveChat(session, classes));
  return newestFirst(rows);
}

// Whether the Tutor session still holds the conversation this chat showed: the same first question
// (or the chat had none yet). Another tab that started or opened a different chat changes it.
export function sameConversation(chatMessages, sessionMessages) {
  const first = list => (list || []).find(message => message?.role === 'user')?.text;
  const before = first(chatMessages);
  return !before || before === first(sessionMessages);
}

// identify(): the signed-in account's id ('' when signed out). Everything this store holds belongs to
// one account: when the id changes (another account signs in, or this one signs out) the store is
// emptied at once, before anything is asked, and an answer to a question asked for the earlier
// account is dropped when it arrives (never shown, never stored).
export function createChatStore({ request: send, identify = () => '', onTutorChanged = () => {}, now = () => Date.now() }) {
  let owner = identify();
  let epoch = 0; // bumped each time the account changes
  const STALE = { failed: true, stale: true };
  const stale = data => Boolean(data?.stale);
  const lapsed = () => ({ ok: false, reason: 'stale', message: '' });
  async function request(path, options) {
    check();
    const mine = epoch;
    const data = await send(path, options);
    check();
    return mine === epoch ? data : STALE;
  }
  let mode = null; // 'chats' (the /chats API) or 'tutor' (only the Tutor's calls); settled once per page load
  let editable = false;
  let chats = null; // newest first; null until the first answer
  let failed = false;
  let loadedAt = 0;
  let loading = null;
  let lastFailure = null;
  let open = null; // the chat on screen, kept in the list (and so current in the sidebar) while it is open
  let limit = LIST_LIMIT; // how many the sidebar asks for ("Show more" raises it)
  let toast = null;
  let toastId = 0;
  let soon = null;
  let classMap = null;
  let classMapAt = 0;
  const removed = new Set(); // deleted here, waiting for the list to agree
  const edits = new Map(); // id -> fields changed here while the request is out
  const deleted = new Map(); // id -> { chat, index } for Undo
  const listeners = new Set();
  let snap = null;

  // The account changed: forget everything that was learned for the one before.
  function check({ silent = false } = {}) {
    const id = identify();
    if (id === owner) return false;
    owner = id;
    epoch += 1;
    mode = null; editable = false; chats = null; failed = false; loadedAt = 0; loading = null; lastFailure = null;
    open = null; toast = null; classMap = null; classMapAt = 0; limit = LIST_LIMIT;
    removed.clear(); edits.clear(); deleted.clear();
    clearTimeout(soon);
    snap = null;
    if (!silent) emit();
    return true;
  }

  function visible() {
    if (chats === null) return open ? [open] : null;
    let list = chats.filter(chat => !removed.has(chat.id)).map(chat => (edits.has(chat.id) ? { ...chat, ...edits.get(chat.id) } : chat));
    if (open && !removed.has(open.id)) {
      const index = list.findIndex(chat => chat.id === open.id);
      if (index < 0) list = [edits.has(open.id) ? { ...open, ...edits.get(open.id) } : open, ...list];
    }
    return list;
  }
  // more: the list may hold more than it shows ("Show more" in Recent chats). Only the /chats API
  // can: the Tutor-only list is whole, and 100 is the most the backend lists at once (limited).
  function build(failedNow) {
    const full = mode === 'chats' && chats !== null && chats.length >= limit;
    return { chats: visible(), editable, failed: failedNow && chats === null, loaded: chats !== null, toast, more: full && limit < MAX_LIMIT, limited: full && limit >= MAX_LIMIT };
  }
  function emit() {
    snap = build(failed);
    listeners.forEach(listener => listener(snap));
  }
  function snapshot() {
    check({ silent: true });
    if (!snap) snap = build(false);
    return snap;
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function setLocal(id, fields) {
    if (chats) chats = chats.map(chat => (chat.id === id ? { ...chat, ...fields } : chat));
    if (open?.id === id) open = { ...open, ...fields };
  }
  function drop(id) {
    if (chats) chats = chats.filter(chat => chat.id !== id);
    if (open?.id === id) open = null;
  }
  function say(text, extra = {}) {
    check();
    if (!text) return;
    toast = { id: ++toastId, kind: 'message', text, ...extra };
    emit();
  }
  function dismiss(id) {
    check();
    if (toast && (id === undefined || toast.id === id)) { toast = null; emit(); }
  }

  // { guideId: classId } from the student's guides, for the first state (a guide's chat is in its class).
  async function guideClasses() {
    if (classMap && now() - classMapAt < 30000) return classMap;
    const data = await request('/guides?fields=summary&limit=200');
    if (stale(data)) return {};
    if (!Array.isArray(data?.guides)) return classMap || {};
    classMap = Object.fromEntries(data.guides.filter(guide => guide?.id && guide.folder_id).map(guide => [String(guide.id), String(guide.folder_id)]));
    classMapAt = now();
    return classMap;
  }

  async function fetchList(classId = '') {
    if (mode !== 'tutor') {
      // A class's Chats tab lists as many as the backend allows; the sidebar starts with 30.
      const data = await request(`/chats?limit=${classId ? MAX_LIMIT : limit}${classId ? `&class_id=${encodeURIComponent(classId)}` : ''}`);
      if (stale(data)) return lapsed();
      if (Array.isArray(data?.chats)) {
        mode = 'chats';
        editable = data.editable === true;
        return { ok: true, chats: newestFirst(data.chats.filter(chat => chat?.id).map(chatSummary)) };
      }
      const status = Number(data?.httpStatus) || 0;
      if (mode === 'chats' || !(status === 404 || status === 405)) return failure(outcome(data));
      mode = 'tutor';
      editable = false;
    }
    const [saved, session, classes] = await Promise.all([request('/tutor/chats'), request('/tutor/session'), classId ? guideClasses() : Promise.resolve(classMap || {})]);
    if (stale(saved) || stale(session)) return lapsed();
    if (!Array.isArray(saved?.chats)) return failure(outcome(saved));
    const list = tutorChatList(saved.chats, session?.id ? session : null, classes);
    return { ok: true, chats: classId ? list.filter(chat => chat.class_id === String(classId)) : list };
  }

  // The list for the sidebar. Reuses an answer under 2 seconds old unless `fresh`.
  function load({ fresh = false, maxAge = 2000 } = {}) {
    check();
    if (loading) return loading;
    if (!fresh && chats !== null && now() - loadedAt < maxAge) return Promise.resolve(snapshot());
    const mine = epoch;
    loading = fetchList().then(result => {
      // The account changed while this was out: its answer belongs to nobody now.
      if (mine !== epoch) return snapshot();
      loading = null;
      if (result.ok) {
        chats = result.chats;
        failed = false;
        loadedAt = now();
        // Deleted here and now gone from the server's list too: nothing left to hide.
        for (const id of [...removed]) if (!chats.some(chat => chat.id === id)) removed.delete(id);
      } else { failed = true; lastFailure = result; }
      emit();
      return snapshot();
    });
    return loading;
  }
  // "Show more": ask for the most the backend lists at once, from now on. If that can't be read the
  // list stays as it was (and the button stays), with a plain line.
  async function showMore() {
    check();
    if (limit >= MAX_LIMIT) return snapshot();
    const mine = epoch;
    if (loading) await loading; // an answer for the shorter list is already on its way
    if (mine !== epoch) return snapshot();
    limit = MAX_LIMIT;
    const answer = await load({ fresh: true });
    if (mine === epoch && failed) { limit = LIST_LIMIT; say(lastFailure?.message || MESSAGES.network); }
    return answer;
  }
  // Which backend this is isn't known until /chats has answered once; until then nothing else is tried
  // (a failed first answer must not fall through to the Tutor-only calls, which change things).
  const unready = async () => {
    if (!mode) await load();
    return mode ? null : lastFailure || failure('network');
  };

  function refreshSoon(delay = 400) {
    check();
    clearTimeout(soon);
    soon = setTimeout(() => load({ fresh: true }), delay);
  }

  // A class's chats, for its page's Chats tab: { chats, editable, failed }, newest first.
  async function classChats(classId) {
    if (await unready()) return { chats: [], editable, failed: true };
    const result = await fetchList(String(classId || ''));
    if (!result.ok) return { chats: [], editable, failed: true };
    return { chats: result.chats.filter(chat => !removed.has(chat.id)), editable, failed: false };
  }

  // One chat with its messages: { ok, chat: summary + messages [+ session_id, conversation_version
  // when live], editable, mustOpen }. mustOpen: this backend can only show a saved chat by opening it.
  async function getChat(id) {
    id = String(id || '');
    const notReady = await unready();
    if (notReady) return notReady;
    if (mode === 'chats') {
      const data = await request(`/chats/${encodeURIComponent(id)}`);
      if (stale(data)) return lapsed();
      const result = outcome(data);
      if (result !== 'ok' || !data?.chat?.id) {
        if (result === 'gone') { drop(id); emit(); refreshSoon(0); }
        return failure(result === 'ok' ? 'error' : result);
      }
      if (typeof data.editable === 'boolean') editable = data.editable;
      const chat = {
        ...chatSummary(data.chat),
        messages: Array.isArray(data.chat.messages) ? data.chat.messages : [],
        session_id: data.chat.session_id || null,
        conversation_version: data.chat.conversation_version ?? null,
      };
      return { ok: true, chat, editable, mustOpen: false };
    }
    const session = await request('/tutor/session');
    if (stale(session)) return lapsed();
    if (!session?.id) return failure(outcome(session) === 'ok' ? 'error' : outcome(session));
    if (String(session.id) === id) {
      const classes = await guideClasses();
      return {
        ok: true, editable: false, mustOpen: false,
        chat: { ...liveChat(session, classes), messages: session.messages || [], session_id: String(session.id), conversation_version: session.conversation_version ?? null },
      };
    }
    const saved = await request('/tutor/chats');
    if (stale(saved)) return lapsed();
    if (!Array.isArray(saved?.chats)) return failure(outcome(saved) === 'ok' ? 'error' : outcome(saved));
    const found = saved.chats.find(chat => String(chat?.id) === id);
    if (!found) { drop(id); emit(); return failure('gone'); }
    return { ok: true, editable: false, mustOpen: true, chat: { ...chatSummary({ ...found, live: false }), messages: null } };
  }

  // A new chat from a composer. The conversation it replaces is saved. { ok, chat, session }.
  async function startChat({ session = null, guideId = null, classId = null } = {}) {
    const notReady = await unready();
    if (notReady) return notReady;
    if (mode === 'chats') {
      const data = await request('/chats', { method: 'POST', body: JSON.stringify({ guide_id: guideId || null, class_id: classId || null, session_id: session?.id ? String(session.id) : null }) });
      if (stale(data)) return lapsed();
      const result = outcome(data);
      if (result !== 'ok' || !data?.chat?.id || !data?.session?.id) return failure(result === 'ok' ? 'error' : result);
      refreshSoon();
      return { ok: true, chat: { ...chatSummary(data.chat), messages: [] }, session: data.session };
    }
    // Only the Tutor's calls: the session is the chat. A conversation with messages is saved first.
    let next = session;
    if (!next?.id) {
      next = await request('/tutor/session');
      if (stale(next)) return lapsed();
      if (!next?.id) return failure(outcome(next) === 'ok' ? 'error' : outcome(next));
    }
    if ((next.messages || []).length) {
      next = await request('/tutor/session/new', { method: 'POST', body: JSON.stringify({ session_id: next.id, guide_id: guideId || null, resume_id: null }) });
      if (stale(next)) return lapsed();
      if (!next?.id) return failure(outcome(next) === 'ok' ? 'error' : outcome(next));
      onTutorChanged();
      refreshSoon();
    }
    return { ok: true, chat: { ...chatSummary({ id: next.id, guide_id: guideId, class_id: classId, live: true }), messages: [] }, session: next };
  }

  // Another tab changed things (a 404 or 409): look at the list again, so what shows is what is there.
  async function start(options) {
    const result = await startChat(options);
    if (!result.ok && result.reason !== 'network') refreshSoon(0);
    return result;
  }

  // Makes a saved chat the Tutor's current conversation, so the student can carry on in it. The
  // backend may give it a new id: callers go to the returned chat.id. { ok, chat, session }.
  async function openChat(id, { session = null } = {}) {
    id = String(id || '');
    check();
    const mine = epoch;
    const notReady = await unready();
    if (notReady) return notReady;
    if (mode === 'chats') {
      const data = await request(`/chats/${encodeURIComponent(id)}/open`, { method: 'POST' });
      if (stale(data)) return lapsed();
      const result = outcome(data);
      if (result !== 'ok' || !data?.chat?.id || !data?.session?.id) {
        if (result === 'gone') { drop(id); emit(); }
        refreshSoon(0);
        return failure(result === 'ok' ? 'error' : result);
      }
      refreshSoon();
      return { ok: true, chat: { ...chatSummary(data.chat), messages: data.session.messages || [] }, session: data.session };
    }
    let current = session;
    if (!current?.id) current = await request('/tutor/session');
    if (stale(current)) return lapsed();
    if (!current?.id) return failure(outcome(current) === 'ok' ? 'error' : outcome(current));
    const next = await request('/tutor/session/new', { method: 'POST', body: JSON.stringify({ session_id: current.id, guide_id: null, resume_id: id }) });
    if (stale(next)) return lapsed();
    const result = outcome(next);
    if (!next?.id) {
      if (result === 'gone') { drop(id); emit(); }
      refreshSoon(0);
      return failure(result === 'ok' ? 'error' : result);
    }
    onTutorChanged();
    refreshSoon();
    const classes = await guideClasses();
    if (epoch !== mine) return lapsed();
    return { ok: true, chat: { ...liveChat(next, classes), messages: next.messages || [] }, session: next };
  }

  function find(id) {
    return (visible() || []).find(chat => chat.id === id) || null;
  }

  async function edit(id, fields, messages) {
    id = String(id);
    check();
    if (!editable) return failure('unavailable', messages);
    edits.set(id, fields);
    emit();
    const data = await request(`/chats/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (stale(data)) return lapsed();
    edits.delete(id);
    const result = outcome(data);
    if (result === 'ok' && data?.chat?.id) {
      const chat = chatSummary(data.chat);
      setLocal(id, { title: chat.title, class_id: chat.class_id });
      emit();
      return { ok: true, chat };
    }
    if (result === 'gone') drop(id);
    if (result === 'unavailable') editable = false;
    emit();
    if (result !== 'network') refreshSoon(0);
    return failure(result === 'ok' ? 'error' : result, messages);
  }

  // Rename: the title shows at once; if the server refuses, the old title comes back.
  async function rename(id, title) {
    const next = clean(title).slice(0, 120);
    const before = find(String(id));
    if (!next || (before && next === before.title)) return { ok: true, unchanged: true };
    return edit(id, { title: next }, RENAME_FAILED);
  }

  // Move to a class (or out of one with null).
  async function move(id, classId) {
    const next = classId ? String(classId) : null;
    const before = find(String(id));
    if (before && (before.class_id || null) === next) return { ok: true, unchanged: true };
    return edit(id, { class_id: next }, MOVE_FAILED);
  }

  // Delete: gone from the list at once, then a toast with Undo (restore).
  async function remove(id) {
    id = String(id);
    check();
    if (!editable) return failure('unavailable', DELETE_FAILED);
    const list = visible() || [];
    const index = Math.max(0, list.findIndex(chat => chat.id === id));
    const before = find(id);
    removed.add(id);
    emit();
    const data = await request(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (stale(data)) return lapsed();
    const result = outcome(data);
    if (result === 'ok') {
      const chat = data?.chat?.id ? chatSummary(data.chat) : before;
      deleted.set(id, { chat: chat || before, index });
      if (open?.id === id) open = null;
      if (chat?.live || before?.live) onTutorChanged();
      toast = { id: ++toastId, kind: 'deleted', chatId: id, text: 'Chat deleted' };
      emit();
      return { ok: true };
    }
    removed.delete(id);
    if (result === 'gone') drop(id);
    if (result === 'unavailable') editable = false;
    emit();
    if (result !== 'network') refreshSoon(0);
    return failure(result, DELETE_FAILED);
  }

  // Undo: the chat comes back where it was in the list.
  async function restore(id) {
    id = String(id);
    check();
    const held = deleted.get(id);
    const data = await request(`/chats/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if (stale(data)) return lapsed();
    const result = outcome(data);
    if (result === 'ok') {
      deleted.delete(id);
      removed.delete(id);
      const chat = data?.chat?.id ? chatSummary(data.chat) : held?.chat;
      if (chat && chats) {
        const rest = chats.filter(item => item.id !== id);
        rest.splice(Math.min(held?.index ?? 0, rest.length), 0, chat);
        chats = rest;
      }
      if (toast?.chatId === id) toast = null;
      emit();
      refreshSoon();
      return { ok: true, chat };
    }
    deleted.delete(id);
    removed.delete(id);
    drop(id);
    const reason = result === 'gone' ? 'purged' : result;
    const answer = failure(reason, { network: "Couldn't reach Classroom, so the chat is still deleted.", error: "The chat couldn't be brought back. Try again in a moment." });
    say(answer.message);
    refreshSoon(0);
    return answer;
  }

  // The chat on screen: kept in the list while it is open, so the sidebar always marks it current.
  function keepOpen(chat) {
    check();
    const next = chat?.id ? { ...chatSummary(chat), ...(edits.get(String(chat.id)) || {}) } : null;
    if (JSON.stringify(next) === JSON.stringify(open)) return;
    open = next;
    emit();
  }

  return {
    subscribe, snapshot, load, refreshSoon, classChats, getChat, start, openChat, rename, move, remove, restore,
    keepOpen, say, dismiss, showMore, check,
    get editable() { return editable; },
  };
}
