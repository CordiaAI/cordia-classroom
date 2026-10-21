import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from '../lib/api';
import NapkinVisual from './NapkinVisual';
import ExplanationPreference from './ExplanationPreference';
import { ArrowUp, BookOpen, Layers, ListTree, MessageCircle, MessagesSquare, Paperclip, PencilRuler, Plus, SlidersHorizontal, X as CloseIcon } from 'lucide-react';
import { lastGuide } from '../lib/userStore';
import { walkthroughEvent } from '../lib/walkthrough';
import TutorSelect from './TutorSelect';
import CordiaLoader from './CordiaLoader';
import { inlineParts, parseTutorAnswer } from '../lib/tutorFormat.mjs';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';

// Tutor replies may include ```mermaid blocks; render them as diagrams and keep the rest as text.
// A reply's diagram is drawn by Napkin from the reply's explanation.
function TutorMessageText({ text, plain = false }) {
  if (plain) return <span className="cordia-tutor-text">{text}</span>;
  const parts = String(text || '').split(/```mermaid\s*\n([\s\S]*?)```/);
  const explanation = speakableText(text).slice(0, 2000);
  return parts.map((part, index) => (index % 2 === 1
    ? <NapkinVisual key={index} text={explanation} name="tutor-visual" />
    : part.trim() && <TutorAnswer key={index} text={part} />));
}

function TutorInline({ text }) {
  return inlineParts(text).map((part, index) => (part.bold ? <strong key={index}>{part.text}</strong> : part.text));
}

const ONE_TIME_SKILLS = ['organize'];
const TUTOR_LINE_CLASS = { paragraph: '', bullet: 'tutor-bullet', note: 'tutor-note', work: 'tutor-work' };

// Bold main points, numbered steps with the work beneath, bullets, and plain-language notes.
function TutorAnswer({ text }) {
  const line = (block, index) => <p key={index} className={TUTOR_LINE_CLASS[block.type] || undefined}><TutorInline text={block.text} /></p>;
  return (
    <div className="cordia-tutor-answer">
      {parseTutorAnswer(text).map((block, index) => (block.type === 'step' ? (
        <div key={index} className="tutor-step">
          <span className="tutor-step-number">{block.number}</span>
          <div>
            <p className="tutor-step-title"><TutorInline text={block.title} /></p>
            {block.children.map(line)}
          </div>
        </div>
      ) : line(block, index)))}
    </div>
  );
}

// Spoken text drops diagram code so read-aloud only says the explanation.
function speakableText(text) {
  return String(text || '').replace(/```mermaid[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
}

const MAX_ATTACHMENTS = 5;
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

export default function AIChatWidget({ guides: providedGuides = null, preferredGuideId = '', preferredNoteId = '' }) {
  const router = useRouter();
  const [loadedGuides, setLoadedGuides] = useState([]);
  const [notes, setNotes] = useState([]);
  const [classes, setClasses] = useState([]);
  const [contextKey, setContextKey] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [browserMaterial, setBrowserMaterial] = useState(null);
  const [session, setSession] = useState(null);
  const [skillOverride, setSkillOverride] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [input, setInput] = useState('');
  const [retainContext, setRetainContext] = useState(null);
  const [savedDraft, setSavedDraft] = useState('');
  const [loading, setLoading] = useState(false);
  // While a question is in flight the server copy of the session lags behind this one,
  // so background refreshes must not replace it (that erased the student's new message).
  const sendingRef = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [savedChats, setSavedChats] = useState(null);
  const [chatsError, setChatsError] = useState('');
  const [explainOpen, setExplainOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  const recognitionRef = useRef(null);
  // Read after mount: the server render has no browser speech APIs, and the first client
  // render must match it.
  const [speech, setSpeech] = useState({ Recognition: null, canSpeak: false });
  useEffect(() => setSpeech({ Recognition: window.SpeechRecognition || window.webkitSpeechRecognition || null, canSpeak: 'speechSynthesis' in window }), []);
  const { Recognition, canSpeak } = speech;

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  function toggleMic() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = event => {
      const spoken = Array.from(event.results).map(result => result[0].transcript).join(' ').trim();
      if (spoken) setInput(previous => (previous ? previous + ' ' : '') + spoken);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

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
        apiFetch('/folders'),
      ]).then(([guideData, noteData, folderData]) => {
        if (!active) return;
        if (Array.isArray(guideData?.guides)) setLoadedGuides(guideData.guides);
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
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
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
  const combinedAttachments = combineAttachments(attachments);
  const attachedMaterial = {
    title: attachments.map(file => file.title).join(' + ').slice(0, 300),
    content: combinedAttachments.content,
  };
  const materials = [
    ...guides.map(item => ({ ...item, kind: 'guide', key: `guide:${item.id}` })),
    ...notes.map(item => ({ ...item, kind: 'note', key: `note:${item.id}` })),
    ...(attachments.length ? [{ ...attachedMaterial, kind: 'attachment', key: 'attachment' }] : []),
    ...(session?.browser_content_available ? [{ ...(browserMaterial || {}), title: browserMaterial?.title || 'Captured browser material', kind: 'browser', key: 'browser' }] : []),
  ];

  // The material on screen always wins: each navigation re-applies it, so the chip
  // never keeps showing a guide from an earlier page.
  useEffect(() => { appliedPreferred.current = ''; }, [router.asPath, preferredGuideId, preferredNoteId]);
  useEffect(() => {
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
  }, [guides, notes, attachments.length, materials.length, contextKey, preferredGuideId, preferredNoteId, router.asPath]);

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
  const selectedSkillId = skillOverride || autoSkill;
  const selectedSkill = session?.skills?.find(item => item.id === selectedSkillId);
  const hasRequiredContext = (Boolean(material) && (material.kind !== 'browser' || Boolean(material.content))) || selectedSkill?.requires_context === false || (general && ['', 'explain'].includes(skillOverride));
  const needsTargetClass = selectedSkillId === 'organize';
  const canSubmit = hasRequiredContext && (!needsTargetClass || Boolean(targetClassId));
  const remaining = MAX_MESSAGES - messages.filter(message => message.role === 'user').length;
  const busy = loading || (session?.status && session.status !== 'idle');
  const progressLabel = SKILL_PROGRESS[session?.active_skill] || 'Cordia is working…';

  // "Explain" and "Ask why" send at once so the Tutor explains without another tap.
  useEffect(() => {
    if (!pendingSend.current || input !== pendingSend.current || !canSubmit || busy || !session?.id) return;
    pendingSend.current = '';
    sendMessage();
  }, [input, canSubmit, busy, session?.id, contextKey]);

  async function changeSkill(nextSkill) {
    setSkillOverride(nextSkill);
    if (!session?.id || !nextSkill) return;
    const next = await apiFetch('/tutor/session/skill', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: session.id, skill: nextSkill }),
    });
    if (next?.id) setSession(next);
    else setLocalError(next?.detail || 'Could not change Tutor skill.');
  }

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
        added.push({ id: `${file.name}:${file.size}:${file.lastModified}`, title: file.name, content: data.text });
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
    walkthroughEvent('ask');
    setChatsOpen(false);
    setInput('');
    setLocalError('');
    sendingRef.current = true;
    setLoading(true);
    setSession(current => ({
      ...current,
      status: 'running',
      messages: [...(current?.messages || []), { role: 'user', text: question }],
    }));
    const selectedContent = material?.kind === 'guide'
      ? (material.study_guide || material.notes || '')
      : material?.kind === 'note'
        ? (material.content || '')
        : (material?.content || '');
    const data = await apiFetch('/chat', {
      method: 'POST',
      timeoutMs: 120000,
      body: JSON.stringify({
        question,
        content: selectedContent,
        ...(material?.kind === 'guide' ? { guide_id: material.id } : {}),
        ...(material?.kind === 'note' ? { note_id: material.id } : {}),
        ...(['attachment', 'browser'].includes(material?.kind) ? { context_title: material.title } : {}),
        ...(material?.kind === 'browser' && material.url ? { context_url: material.url } : {}),
        session_id: session.id,
        conversation_version: session.conversation_version,
        skill: skillOverride || (autoSkill !== session.active_skill ? autoSkill : null),
        retain_context: retainContext || undefined,
        class_id: needsTargetClass ? targetClassId : material?.folder_id || undefined,
        mode: 'short',
        rich_text: true,
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
      setInput(question);
      setLocalError(data?.answer || data?.detail || 'Cordia could not answer that yet.');
      const refreshed = await apiFetch('/tutor/session');
      if (refreshed?.id) setSession(refreshed);
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

  async function startChat({ guideId = null, resume = null } = {}) {
    if (!session?.id || busy) return;
    setChatsError('');
    const next = await apiFetch('/tutor/session/new', {
      method: 'POST',
      body: JSON.stringify({ session_id: session.id, guide_id: guideId, resume_id: resume?.id || null }),
    });
    if (!next?.id) { setChatsError(next?.detail || 'Could not start a new chat.'); return; }
    const guide = resume ? resume.guide_id : guideId;
    setSession(next);
    setContextKey(guide && guides.some(item => item.id === guide) ? `guide:${guide}` : 'none');
    setSkillOverride('');
    setRetainContext(null);
    setLocalError('');
    setChatsOpen(false);
  }

  function openSource(source) {
    if (source?.type === 'study_guide') router.push('/guide/' + source.id);
    if (source?.type === 'smartnote') router.push('/smartnotes?id=' + source.id);
    if (source?.type === 'browser' && source.url) window.open(source.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <section ref={rootRef} className="cordia-tutor" aria-label="Cordia tutor">
      <header className="cordia-tutor-header">
        <div className="cordia-tutor-title-row">
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />
          <strong>Tutor</strong>
          <button type="button" className="c-btn c-btn--quiet tutor-chats-btn" aria-pressed={chatsOpen} onClick={() => setChatsOpen(open => !open)} disabled={!session}>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden="true" />Chats
          </button>
          {session?.browser_available && <span className="cordia-browser-status is-online" aria-label="Browser connected" title="Browser connected" />}
        </div>
        <div className="cordia-tutor-context" aria-label="Context">
          <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          <TutorSelect label="Study material" value={contextKey} onChange={setContextKey} options={[
            { value: 'none', label: 'No material · general chat' },
            ...guides.map(item => ({ value: `guide:${item.id}`, label: item.title || 'Untitled guide', group: 'Guides' })),
            ...notes.map(item => ({ value: `note:${item.id}`, label: item.title || 'Untitled note', group: 'Notes' })),
            ...(attachments.length ? [{ value: 'attachment', label: attachments.length === 1 ? attachments[0].title : `${attachments.length} files`, group: 'Files' }] : []),
            ...(session?.browser_content_available ? [{ value: 'browser', label: browserMaterial?.title || 'Browser page', group: 'Browser' }] : []),
          ]} />
        </div>
        <details className="tutor-context-controls" open={optionsOpen} onToggle={event => setOptionsOpen(event.currentTarget.open)}>
        <summary><SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />Options</summary>
        {/* Rendered only while Options is open: closed, these controls sat invisibly over "Ask anything". */}
        {optionsOpen && <>
        <TutorSelect label="Tutor skill" value={skillOverride} onChange={changeSkill} disabled={!session || busy} options={[
          { value: '', label: `Auto · ${session?.skills?.find(item => item.id === autoSkill)?.label || 'Explain'}` },
          // Only modes that work today are listed.
          ...(session?.skills || [{ id: 'explain', label: 'Explain' }]).filter(item => item.available !== false).map(item => ({ value: item.id, label: item.label })),
        ]} />
        {needsTargetClass && <TutorSelect label="Destination class" value={targetClassId} onChange={setTargetClassId} options={[
          { value: '', label: 'Choose destination class' },
          ...classes.map(item => ({ value: item.id, label: item.name })),
        ]} />}
        {!session?.browser_available && ['capture', 'find_material'].includes(selectedSkillId) && (
          <p className="cordia-browser-fallback">
            Browser unavailable. Open the Chrome side panel, choose an existing guide or SmartNote, or attach a file below.
          </p>
        )}
        {attachments.length > 0 && (
          <ul className="cordia-tutor-attachments" aria-label="Attached files">
            {attachments.map(file => (
              <li key={file.id}>
                <span>{file.title}</span>
                <button type="button" className="c-icon-btn" onClick={() => removeAttachment(file.id)} aria-label={`Remove ${file.title}`}><CloseIcon size={18} strokeWidth={1.75} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
        {contextKey === 'attachment' && combinedAttachments.trimmed.length > 0 && (
          <p className="cordia-tutor-attach-note" role="status">Trimmed: {combinedAttachments.trimmed.join(', ')}</p>
        )}
        <input ref={fileRef} type="file" accept="*" multiple onChange={event => attachFiles(event.target.files)} hidden />
        <button type="button" className={'cordia-tutor-attach' + (attachDropActive ? ' drop-target-active' : '')} onClick={() => fileRef.current?.click()} disabled={extracting || attachments.length >= MAX_ATTACHMENTS}>
          <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />{extracting ? 'Reading…' : attachDropActive ? 'Drop' : attachments.length >= MAX_ATTACHMENTS ? `${MAX_ATTACHMENTS} files` : 'Attach'}
        </button>
        <button type="button" className="cordia-tutor-explain-toggle" onClick={() => setExplainOpen(open => !open)} aria-expanded={explainOpen}>
          Explain style
        </button>
        {explainOpen && (
          <div className="cordia-tutor-explain-panel">
            <ExplanationPreference compact onSaved={() => setTimeout(() => setExplainOpen(false), 900)} />
          </div>
        )}
        </>}
        </details>
      </header>

      {chatsOpen ? (
        <div className="cordia-tutor-messages tutor-chats">
          <div className="tutor-chats-new">
            {material?.kind === 'guide' && (
              <button type="button" className="c-btn c-btn--primary" onClick={() => startChat({ guideId: material.id })} disabled={busy}>
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" /><span>New chat about {material.title || 'this guide'}</span>
              </button>
            )}
            <button type="button" className="c-btn c-btn--secondary" onClick={() => startChat()} disabled={busy}>
              <Plus size={18} strokeWidth={1.75} aria-hidden="true" /><span>New general chat</span>
            </button>
            {messages.length > 0 && <p className="c-meta">Your current chat is saved below when you start a new one.</p>}
          </div>
          <h3 className="tutor-chats-title">Saved chats</h3>
          {savedChats === null ? <CordiaLoader size={20} label="Loading chats" /> : savedChats.length === 0 && !chatsError ? (
            <p className="c-meta">Nothing here yet. Start a new chat and this one is saved here to pick up later.</p>
          ) : (
            <ul className="tutor-chats-list">
              {savedChats.map(chat => (
                <li key={chat.id}>
                  <button type="button" className="tutor-chat-row" onClick={() => startChat({ resume: chat })} disabled={busy}>
                    <span className="tutor-chat-row-title">{chat.title || 'Tutor chat'}</span>
                    <span className="c-meta">{guides.find(item => item.id === chat.guide_id)?.title || 'General'} · {new Date(chat.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chatsError && <p className="cordia-tutor-message error" role="alert">{chatsError}</p>}
        </div>
      ) : (
      <div className="cordia-tutor-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="tutor-welcome">
            <h2>Ask anything</h2>
            {general ? <p className="c-meta">A general chat, not tied to a guide. Pick a guide above to ask about your course material.</p> : <div className="tutor-starter-actions">
              {[
                { label: 'Explain', prompt: 'Explain the key concepts in this material in simple terms.', icon: MessageCircle },
                { label: 'Make guide', prompt: 'Create a study guide from this material.', icon: BookOpen },
                { label: 'Practice', prompt: 'Generate practice questions from this material.', icon: PencilRuler },
                { label: 'Flashcards', prompt: 'Make flashcards for the key points in this material.', icon: Layers },
                ...(material?.kind === 'guide' ? [{ label: 'Edit outline', prompt: 'Edit the outline: ', icon: ListTree, skill: 'edit_outline' }] : []),
              ].map(action => <button type="button" key={action.label} className="c-chip" onClick={() => { setInput(action.prompt); if (action.skill) setSkillOverride(action.skill); }}><action.icon size={16} strokeWidth={1.75} aria-hidden="true" />{action.label}</button>)}
            </div>}
          </div>
        )}
        {messages.map((message, index) => (
          <div key={`${index}-${message.role}`} className={`cordia-tutor-message ${message.role}`}>
            {message.source && (
              <button type="button" className="cordia-tutor-source" onClick={() => openSource(message.source)} disabled={message.source.type === 'file'}>
                Based on {message.source.title}
              </button>
            )}
            <TutorMessageText text={message.text} plain={message.role === 'user'} />
            {canSpeak && message.role !== 'user' && message.text && (
              <button type="button" className="cordia-tutor-speak" onClick={() => toggleSpeech(index, message.text)} aria-pressed={speakingIndex === index}>
                {speakingIndex === index ? 'Stop' : 'Listen'}
              </button>
            )}
            {(message.evidence || []).map(item => (
              <button key={item.url} type="button" className="cordia-tutor-evidence" onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}>
                {item.title || item.url}
              </button>
            ))}
            {message.guide && (
              <button type="button" className="cordia-tutor-guide-link" onClick={() => router.push('/guide/' + message.guide.id)}>
                Open {message.guide.title}
              </button>
            )}
          </div>
        ))}
        {busy && messages.at(-1)?.role === 'user' && (
          <div className="cordia-tutor-message ai tutor-thinking">
            <CordiaLoader size={20} label="Thinking" />
            <span>{progressLabel}</span>
          </div>
        )}
        {localError && <div className="cordia-tutor-message error">{localError}</div>}
        <div ref={endRef} />
      </div>
      )}

      <div className={`cordia-tutor-input${Recognition ? ' has-mic' : ''}`}>
        <textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          aria-label="Message"
          placeholder={!hasRequiredContext ? 'Pick material' : needsTargetClass && !targetClassId ? 'Pick a class' : 'Ask'}
          disabled={!canSubmit || busy || remaining <= 0 || !session}
          rows="2"
        />
        {Recognition && (
          <button
            type="button"
            className={`cordia-tutor-mic${listening ? ' is-listening' : ''}`}
            onClick={toggleMic}
            disabled={!canSubmit || busy || remaining <= 0 || !session}
            aria-label={listening ? 'Stop listening' : 'Ask by voice'}
            aria-pressed={listening}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="currentColor" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
          </button>
        )}
        {input.trim() && (
          <button type="button" className="cordia-tutor-send" onClick={sendMessage} disabled={!canSubmit || busy || remaining <= 0 || !session} aria-label="Send">
            <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      {remaining <= 3 && <small className="c-meta cordia-tutor-limit">{Math.max(remaining, 0)} left</small>}
      {input.trim() && !(canSubmit && !busy && remaining > 0 && session) && (
        <small className="c-meta cordia-tutor-limit" role="status">
          {!session ? "Connecting to the Tutor… If this stays, refresh the page."
            : busy ? 'Cordia is still answering your last message.'
              : remaining <= 0 ? 'This chat is full. Start a new chat in Chats.'
                : needsTargetClass ? 'Pick the class to put it in.'
                  : 'Pick a guide or attach a file above.'}
        </small>
      )}
    </section>
  );
}
