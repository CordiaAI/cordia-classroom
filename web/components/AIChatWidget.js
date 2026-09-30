import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, authOnlyHeaders, responseJson } from '../lib/api';
import MermaidDiagram from './MermaidDiagram';
import { useLearningStyle } from '../lib/learningStyle';
import ExplanationPreference from './ExplanationPreference';

// Tutor replies may include ```mermaid blocks; render them as diagrams and keep the rest as text.
function TutorMessageText({ text }) {
  const parts = String(text || '').split(/```mermaid\s*\n([\s\S]*?)```/);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (index % 2 === 1
    ? <MermaidDiagram key={index} code={part.trim()} label="Tutor diagram" />
    : part.trim() && <span key={index} className="cordia-tutor-text">{part.trim()}</span>));
}

// Spoken text drops diagram code so read-aloud only says the explanation.
function speakableText(text) {
  return String(text || '').replace(/```mermaid[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
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
  const [attachment, setAttachment] = useState(null);
  const [browserMaterial, setBrowserMaterial] = useState(null);
  const [session, setSession] = useState(null);
  const [skillOverride, setSkillOverride] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [input, setInput] = useState('');
  const [retainContext, setRetainContext] = useState(null);
  const [savedDraft, setSavedDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [explainOpen, setExplainOpen] = useState(false);
  const { learningStyle } = useLearningStyle();
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  const recognitionRef = useRef(null);
  const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // Voice tools are for students who chose to study by listening and talking.
  const voice = learningStyle?.style === 'aural';

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
  const endRef = useRef(null);
  const appliedPreferred = useRef('');

  useEffect(() => {
    Promise.all([
      providedGuides ? null : apiFetch('/guides?limit=50'),
      apiFetch('/smart_notes'),
      apiFetch('/folders'),
    ]).then(([guideData, noteData, folderData]) => {
      if (Array.isArray(guideData?.guides)) setLoadedGuides(guideData.guides);
      if (Array.isArray(noteData?.notes)) setNotes(noteData.notes);
      if (Array.isArray(folderData?.folders)) setClasses(folderData.folders);
    });
  }, [providedGuides]);

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
      if (next?.id) {
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
  const materials = [
    ...guides.map(item => ({ ...item, kind: 'guide', key: `guide:${item.id}` })),
    ...notes.map(item => ({ ...item, kind: 'note', key: `note:${item.id}` })),
    ...(attachment ? [{ ...attachment, kind: 'attachment', key: 'attachment' }] : []),
    ...(session?.browser_content_available ? [{ ...(browserMaterial || {}), title: browserMaterial?.title || 'Captured browser material', kind: 'browser', key: 'browser' }] : []),
  ];

  useEffect(() => {
    const preferred = preferredGuideId ? `guide:${preferredGuideId}` : preferredNoteId ? `note:${preferredNoteId}` : '';
    if (preferred && preferred !== appliedPreferred.current && materials.some(item => item.key === preferred)) {
      appliedPreferred.current = preferred;
      setContextKey(preferred);
      return;
    }
    if (!materials.some(item => item.key === contextKey)) setContextKey(materials[0]?.key || '');
  }, [materials.length, contextKey, preferredGuideId, preferredNoteId]);

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
      }
    };
    window.addEventListener('cordia:tutor-prompt', prefill);
    return () => window.removeEventListener('cordia:tutor-prompt', prefill);
  }, []);

  const messages = session?.messages || [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  const material = materials.find(item => item.key === contextKey);
  const selectedSkillId = skillOverride || session?.active_skill || 'explain';
  const selectedSkill = session?.skills?.find(item => item.id === selectedSkillId);
  const hasRequiredContext = (Boolean(material) && (material.kind !== 'browser' || Boolean(material.content))) || selectedSkill?.requires_context === false;
  const needsTargetClass = selectedSkillId === 'organize';
  const canSubmit = hasRequiredContext && (!needsTargetClass || Boolean(targetClassId));
  const remaining = MAX_MESSAGES - messages.filter(message => message.role === 'user').length;
  const busy = loading || (session?.status && session.status !== 'idle');
  const progressLabel = SKILL_PROGRESS[session?.active_skill] || 'Cordia is working…';

  async function changeSkill(event) {
    const nextSkill = event.target.value;
    setSkillOverride(nextSkill);
    if (!session?.id || !nextSkill) return;
    const next = await apiFetch('/tutor/session/skill', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: session.id, skill: nextSkill }),
    });
    if (next?.id) setSession(next);
    else setLocalError(next?.detail || 'Could not change Tutor skill.');
  }

  async function attachFile(file) {
    if (!file) return;
    setExtracting(true);
    setLocalError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(API + '/extract-file-text', { method: 'POST', headers: authOnlyHeaders(), body: formData });
      const data = await responseJson(response);
      if (!response.ok || !data?.text) throw new Error(apiErrorMessage(data?.detail, 'Could not read this file.'));
      setAttachment({ title: file.name, content: data.text });
      setContextKey('attachment');
    } catch (error) {
      setLocalError(error.message || 'Could not read this file.');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || !canSubmit || busy || remaining <= 0 || !session?.id) return;
    setInput('');
    setLocalError('');
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
        skill: skillOverride || null,
        retain_context: retainContext || undefined,
        class_id: needsTargetClass ? targetClassId : material?.folder_id || undefined,
        mode: 'short',
      }),
    });
    if (data?.action === 'created_guide' && !providedGuides) {
      const refreshed = await apiFetch('/guides?limit=50');
      if (Array.isArray(refreshed?.guides)) {
        setLoadedGuides(refreshed.guides);
        setContextKey(`guide:${data.guide.id}`);
      }
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

  function openSource(source) {
    if (source?.type === 'study_guide') router.push('/guide/' + source.id);
    if (source?.type === 'smartnote') router.push('/smartnotes?id=' + source.id);
    if (source?.type === 'browser' && source.url) window.open(source.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <section className="cordia-tutor" aria-label="Cordia tutor">
      <header className="cordia-tutor-header">
        <div className="cordia-tutor-title-row">
          <strong>Cordia Tutor</strong>
          <span className={`cordia-browser-status${session?.browser_available ? ' is-online' : ''}`}>
            {session?.browser_available ? 'Browser available' : 'Browser unavailable'}
          </span>
        </div>
        <select value={skillOverride} onChange={changeSkill} aria-label="Tutor skill" disabled={!session || busy}>
          <option value="">Auto · {session?.skills?.find(item => item.id === session?.active_skill)?.label || 'Explain'}</option>
          {(session?.skills || [{ id: 'explain', label: 'Explain' }]).map(item => (
            <option key={item.id} value={item.id} disabled={item.available === false}>
              {item.available === false ? `${item.label} — coming soon` : item.label}
            </option>
          ))}
        </select>
        <select value={contextKey} onChange={event => setContextKey(event.target.value)} aria-label="Study material">
          {materials.length === 0 && <option value="">Choose study material</option>}
          {guides.length > 0 && <optgroup label="Study Guides">
            {guides.map(item => <option key={item.id} value={`guide:${item.id}`}>{item.title || 'Untitled guide'}</option>)}
          </optgroup>}
          {notes.length > 0 && <optgroup label="SmartNotes">
            {notes.map(item => <option key={item.id} value={`note:${item.id}`}>{item.title || 'Untitled note'}</option>)}
          </optgroup>}
          {attachment && <optgroup label="Attached file"><option value="attachment">{attachment.title}</option></optgroup>}
          {session?.browser_content_available && <optgroup label="Browser"><option value="browser">{browserMaterial?.title || 'Captured browser material'}</option></optgroup>}
        </select>
        {needsTargetClass && (
          <select value={targetClassId} onChange={event => setTargetClassId(event.target.value)} aria-label="Destination class">
            <option value="">Choose destination class</option>
            {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        {!session?.browser_available && ['capture', 'find_material'].includes(selectedSkillId) && (
          <p className="cordia-browser-fallback">
            Browser unavailable. Open the Chrome side panel, choose an existing guide or SmartNote, or attach a file below.
          </p>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.pptx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp" onChange={event => attachFile(event.target.files?.[0])} hidden />
        <button type="button" className="cordia-tutor-attach" onClick={() => fileRef.current?.click()} disabled={extracting}>
          {extracting ? 'Reading file…' : 'Attach study material'}
        </button>
        <button type="button" className="cordia-tutor-explain-toggle" onClick={() => setExplainOpen(open => !open)} aria-expanded={explainOpen}>
          How should I explain things?
        </button>
        {explainOpen && (
          <div className="cordia-tutor-explain-panel">
            <ExplanationPreference compact onSaved={() => setTimeout(() => setExplainOpen(false), 900)} />
          </div>
        )}
      </header>

      <div className="cordia-tutor-messages" aria-live="polite">
        {messages.length === 0 && (
          <p>{material
            ? `Ask about ${material.title || 'this material'}.`
            : selectedSkill?.requires_context === false
              ? 'Ask Cordia to work with the current browser page.'
              : 'Choose a guide, SmartNote, or file to begin.'}</p>
        )}
        {messages.map((message, index) => (
          <div key={`${index}-${message.role}`} className={`cordia-tutor-message ${message.role}`}>
            {message.source && (
              <button type="button" className="cordia-tutor-source" onClick={() => openSource(message.source)} disabled={message.source.type === 'file'}>
                Based on {message.source.title}
              </button>
            )}
            <TutorMessageText text={message.text} />
            {voice && canSpeak && message.role !== 'user' && message.text && (
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
        {busy && messages.at(-1)?.role === 'user' && <div className="cordia-tutor-message ai" role="status">{progressLabel}</div>}
        {localError && <div className="cordia-tutor-message error">{localError}</div>}
        <div ref={endRef} />
      </div>

      <div className={`cordia-tutor-input${voice && Recognition ? ' has-mic' : ''}`}>
        <textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={!hasRequiredContext ? 'Choose or attach study material' : needsTargetClass && !targetClassId ? 'Choose a destination class' : 'Ask Cordia…'}
          disabled={!canSubmit || busy || remaining <= 0 || !session}
          rows="2"
        />
        {voice && Recognition && (
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
        <button type="button" onClick={sendMessage} disabled={!canSubmit || busy || !input.trim() || remaining <= 0 || !session} aria-label="Send">
          ↑
        </button>
      </div>
      {remaining <= 3 && <small className="cordia-tutor-limit">{Math.max(remaining, 0)} questions remaining</small>}
    </section>
  );
}
