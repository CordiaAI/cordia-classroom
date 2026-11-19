import { useId, useLayoutEffect, useRef } from 'react';
import { ArrowUp, FileText, Mic, Paperclip, X } from 'lucide-react';
import ClassPicker from './ClassPicker';
import CordiaLoader from './CordiaLoader';
import { UPLOAD_ACCEPT } from '../lib/uploadTypes.mjs';
import { MAX_ATTACHMENTS } from '../lib/useTutorChat';
import { openNewSheet } from '../lib/newSheet';
import { composerAction } from '../lib/homeText.mjs';

const LINE = 25.5; // 17px at 1.5
const PAD = 14; // 10px above the text, 4px below
const MAX_HEIGHT = LINE * 8 + PAD;

// Hands the composer's material to the New sheet, which builds the guide exactly as its own Create
// does (same upload, limits, errors and result): files, a link or pasted notes.
export function buildGuideFrom(action, { files = [], folderId = '' } = {}) {
  const options = { folderId: folderId || undefined, create: true };
  if (action.mode === 'upload') openNewSheet('upload', { ...options, files });
  else if (action.mode === 'link') openNewSheet('link', { ...options, url: action.url });
  else if (action.mode === 'paste') openNewSheet('paste', { ...options, text: action.text });
}

// The composer (DESIGN-SPEC 4.2): the message box, then attach, voice, the class picker and Send.
// No tool chips: the Tutor reads intent from the message, and "make a guide" with files, a link or
// pasted notes goes to the New sheet. Talks to the Tutor through tutor (lib/useTutorChat.js).
// variant: 'home' (88px box) or 'chat' (52px box, at the bottom of a chat).
// showError: the Tutor's last error shows here (the home before it has a chat to show it in).
// quietBusy: the page already says the Tutor is busy (a notice), so this doesn't say it again.
export default function Composer({ tutor, classes = [], classId = '', onClassChange, variant = 'home', autoFocus = false, showError = false, quietBusy = false }) {
  const id = useId();
  const boxRef = useRef(null);
  const caretRef = useRef(null); // the box's selection, so dictation goes where the student left the caret
  const {
    input, setInput, attachments, setAttachments, removeAttachment, attachFiles, extracting, attachDropActive, fileRef, combinedAttachments, contextKey,
    sendMessage, session, busy, canSubmit, remaining, Recognition, listening, interim, toggleMic, localError,
  } = tutor;
  const minHeight = variant === 'home' ? 88 : 52;
  const hasSomething = Boolean(input.trim()) || attachments.length > 0;
  const blocked = extracting || busy || !session || remaining <= 0;

  // The box grows with the message up to 8 lines, then scrolls. Typing shows on the next frame.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    const needed = box.scrollHeight;
    box.style.height = `${Math.max(minHeight, Math.min(needed, MAX_HEIGHT))}px`;
    box.style.overflowY = needed > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [input, minHeight]);

  useLayoutEffect(() => { if (autoFocus) boxRef.current?.focus({ preventScroll: true }); }, [autoFocus]);

  function submit() {
    if (!hasSomething || blocked) return;
    const action = composerAction(input, attachments.length);
    if (action.kind === 'guide') {
      buildGuideFrom(action, { files: attachments.map(file => file.file).filter(Boolean), folderId: classId });
      setInput('');
      setAttachments([]);
      return;
    }
    if (action.kind === 'new-sheet') {
      openNewSheet('', { folderId: classId || undefined });
      setInput('');
      return;
    }
    if (action.kind === 'ask') sendMessage();
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  // Pasted files attach; pasted text and links go in the box as they are.
  function onPaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  }

  const full = attachments.length >= MAX_ATTACHMENTS;
  const hint = !session ? 'Connecting to the Tutor. If this stays, refresh the page.'
    : remaining <= 0 ? 'This chat is full. Start a new chat from the sidebar.'
      : input.trim() && !canSubmit && !attachments.length ? 'This Tutor mode needs material. Attach a file or pick a class.'
        : busy && input.trim() && !quietBusy ? 'The Tutor is still answering your last message.'
          : '';

  return (
    <form className={`composer is-${variant}${attachDropActive ? ' is-drop' : ''}`} onSubmit={event => { event.preventDefault(); submit(); }}>
      <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} multiple hidden onChange={event => attachFiles(event.target.files)} />
      {attachments.length > 0 && (
        <ul className="composer-files" aria-label="Attached files">
          {attachments.map(file => (
            <li key={file.id}>
              <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="c-truncate">{file.title}</span>
              <button type="button" className="composer-file-remove" onClick={() => removeAttachment(file.id)} aria-label={`Remove ${file.title}`}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor={id}>Message the Tutor</label>
      <textarea
        id={id}
        ref={boxRef}
        className="composer-box"
        value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onSelect={event => { caretRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
        placeholder="Ask the Tutor, or drop in slides, a PDF or a lecture"
        rows={1}
        style={{ height: minHeight }}
      />
      <div className="composer-row">
        <button type="button" className="composer-icon" onClick={() => fileRef.current?.click()} disabled={extracting || full}
          aria-label={extracting ? 'Reading files' : full ? `${MAX_ATTACHMENTS} files attached` : 'Attach files'}>
          {extracting ? <CordiaLoader size={20} label="Reading files" /> : <Paperclip size={20} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        {Recognition && (
          <button type="button" className={'composer-icon' + (listening ? ' is-on' : '')} onClick={() => toggleMic(caretRef.current || {})} disabled={blocked && !listening}
            aria-label={listening ? 'Stop listening' : 'Talk to the Tutor'} aria-pressed={listening}>
            <Mic size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        <ClassPicker classes={classes} value={classId} onChange={onClassChange} size="sm" />
        <span className="composer-spacer" />
        <button type="submit" className={'composer-send' + (hasSomething && !blocked ? ' is-ready' : '')} aria-label="Send" aria-disabled={!hasSomething || blocked}>
          <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {listening && (
        <p className={'dictation-interim' + (interim ? ' is-heard' : '')} role="status" aria-live="off">{interim || 'Listening…'}</p>
      )}
      {contextKey === 'attachment' && combinedAttachments.trimmed.length > 0 && (
        <p className="composer-note" role="status">Too long to read whole, so the Tutor reads part of: {combinedAttachments.trimmed.join(', ')}</p>
      )}
      {showError && localError && <p className="composer-note is-error" role="alert">{localError}</p>}
      {hint && <p className="composer-note" role="status">{hint}</p>}
    </form>
  );
}
