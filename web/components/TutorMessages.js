import { Trash2 } from 'lucide-react';
import NapkinVisual from './NapkinVisual';
import CordiaLoader from './CordiaLoader';
import AcademicInfinityMark from './AcademicInfinityMark';
import StudyPlanActions from './StudyPlanActions';
import { inlineParts, parseTutorAnswer } from '../lib/tutorFormat.mjs';
import { speakableText } from '../lib/useTutorChat';

// Tutor replies may include ```mermaid blocks; render them as diagrams and keep the rest as text.
// A reply's diagram is drawn by Napkin from the reply's explanation.
export function TutorMessageText({ text, plain = false }) {
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

// The conversation: each message with its source, visual, Listen, evidence, the place it opened
// and a delete to confirm, then "thinking" while the Tutor works and any error. Shared by the Tutor
// panel (components/AIChatWidget.js) and the chat home (pages/home.js, with `avatar`: the Tutor's
// mark beside each reply, DESIGN-SPEC 4.3). tutor: lib/useTutorChat.js.
export default function TutorMessages({ tutor, avatar = false }) {
  const { router, messages, canSpeak, speakingIndex, toggleSpeech, openSource, deleteFromTutor, busy, progressLabel, localError } = tutor;
  return (
    <>
    {messages.map((message, index) => (
      <div key={`${index}-${message.role}`} className={`cordia-tutor-message ${message.role}${message.visual?.text ? ' has-visual' : ''}`}>
        {avatar && message.role !== 'user' && <span className="cordia-tutor-avatar" aria-hidden="true"><AcademicInfinityMark title="" /></span>}
        {message.source?.type === 'general' ? (
          <span className="cordia-tutor-source is-general">{message.source.title}</span>
        ) : message.source && (
          <button type="button" className="cordia-tutor-source" onClick={() => openSource(message.source)} disabled={message.source.type === 'file'}>
            Based on {message.source.title}
          </button>
        )}
        <TutorMessageText text={message.text} plain={message.role === 'user'} />
        {/* A visual the student described: the Tutor wrote its text, Napkin draws it (cached, so reopening is free). */}
        {message.visual?.text && (
          <div className="cordia-tutor-visual">
            <NapkinVisual text={message.visual.text} context={message.visual.title || ''} auto name={(message.visual.title || 'tutor-visual').replace(/[^a-z0-9]+/gi, '-').toLowerCase()} />
          </div>
        )}
        {/* A study plan's buttons come straight after it: they are the next step. */}
        {message.study_plan && <StudyPlanActions plan={message.study_plan} tutor={tutor} latest={index === messages.length - 1} />}
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
        {message.link ? (
          <button type="button" className="cordia-tutor-guide-link" onClick={() => router.push(message.link.href)}>
            Open {message.link.label}
          </button>
        ) : message.guide?.title && (
          <button type="button" className="cordia-tutor-guide-link" onClick={() => router.push('/guide/' + message.guide.id)}>
            Open {message.guide.title}
          </button>
        )}
        {message.confirm?.kind === 'delete_guide' && index === messages.length - 1 && (
          <button type="button" className="c-btn c-btn--secondary cordia-tutor-confirm is-danger" onClick={() => deleteFromTutor(message.confirm)} disabled={busy}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />Delete {message.confirm.title}
          </button>
        )}
      </div>
    ))}
    {busy && messages.at(-1)?.role === 'user' && (
      <div className="cordia-tutor-message ai tutor-thinking">
        {avatar && <span className="cordia-tutor-avatar" aria-hidden="true"><AcademicInfinityMark title="" /></span>}
        <CordiaLoader size={20} label="Thinking" />
        <span>{progressLabel}</span>
      </div>
    )}
    {localError && <div className="cordia-tutor-message error">{localError}</div>}
    </>
  );
}
