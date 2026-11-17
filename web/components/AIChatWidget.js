import { BookOpen, Layers, ListTree, MessageCircle, MessagesSquare, Paperclip, PencilRuler, Plus, Trash2, X as CloseIcon, ArrowUp } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import TutorSelect from './TutorSelect';
import CordiaLoader from './CordiaLoader';
import TutorMessages from './TutorMessages';
import { UPLOAD_ACCEPT } from '../lib/uploadTypes.mjs';
import { MAX_ATTACHMENTS, useTutorChat } from '../lib/useTutorChat';

// The Tutor as a panel: the side panel (TutorDrawer) and the full Tutor page. Its logic, and the
// requests it makes, live in lib/useTutorChat.js, which the chat home's composer shares.
// freshOnMount: the full Tutor page opens on a new chat; the side panel starts one each time it opens.
// resumeChatId: the full Tutor page opens that saved chat instead (the sidebar's Recent chats).
export default function AIChatWidget(props) {
  const tutor = useTutorChat(props);
  const {
    rootRef, endRef, fileRef, working, setWorking, guides, notes, classes, material, general,
    contextKey, setContextKey, attachments, combinedAttachments, removeAttachment, attachFiles, extracting, attachDropActive,
    browserMaterial, session, messages, input, setInput, sendMessage, setSkillOverride, selectedSkillId,
    needsTargetClass, targetClassId, setTargetClassId, hasRequiredContext, canSubmit, remaining, busy,
    chatsOpen, setChatsOpen, savedChats, chatsError, deletingChat, setDeletingChat, deleteSavedChat, startChat,
    Recognition, listening, toggleMic,
  } = tutor;

  return (
    <section ref={rootRef} className="cordia-tutor" aria-label="Cordia tutor">
      <header className="cordia-tutor-header">
        <div className="cordia-tutor-title-row">
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />
          <strong>Tutor</strong>
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
        <button type="button" className="tutor-past-chats" aria-pressed={chatsOpen} onClick={() => setChatsOpen(open => !open)} disabled={!session}>
          <MessagesSquare size={16} strokeWidth={1.75} aria-hidden="true" />{chatsOpen ? 'Back to chat' : 'Past chats'}
        </button>
        {needsTargetClass && <TutorSelect label="Destination class" value={targetClassId} onChange={setTargetClassId} options={[
          { value: '', label: 'Choose destination class' },
          ...classes.map(item => ({ value: item.id, label: item.name })),
        ]} />}
        {!session?.browser_available && ['capture', 'find_material'].includes(selectedSkillId) && (
          <p className="cordia-browser-fallback">
            Browser unavailable. Open the Chrome side panel, choose an existing guide or note, or attach a file below.
          </p>
        )}
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
                <li key={chat.id} className="tutor-chat-item">
                  <button type="button" className="tutor-chat-row" onClick={() => startChat({ resume: chat })} disabled={busy}>
                    <span className="tutor-chat-row-title">{chat.title || 'Tutor chat'}</span>
                    <span className="c-meta">{guides.find(item => item.id === chat.guide_id)?.title || 'General'} · {new Date(chat.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </button>
                  <button type="button" className="c-icon-btn tutor-chat-delete" aria-label={`Delete “${chat.title || 'Tutor chat'}”`} onClick={() => setDeletingChat(chat)} disabled={busy}>
                    <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chatsError && <p className="cordia-tutor-message error" role="alert">{chatsError}</p>}
          {deletingChat && (
            <ConfirmDialog
              title="Delete this chat?"
              message={`“${deletingChat.title || 'Tutor chat'}” will be deleted for good. This can't be undone.`}
              onConfirm={() => deleteSavedChat(deletingChat)}
              onCancel={() => setDeletingChat(null)}
            />
          )}
        </div>
      ) : (
      <div className="cordia-tutor-messages" aria-live="polite">
        {working && (
          <div className="tutor-assignment" role="status">
            <span className="c-grow">Working on <strong>{working.title || 'an assignment'}</strong>. The Tutor has its instructions and rubric. Paste your draft or ask what's missing.</span>
            <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => setWorking(null)}>Clear</button>
          </div>
        )}
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
        <TutorMessages tutor={tutor} />
        <div ref={endRef} />
      </div>
      )}

      {attachments.length > 0 && (
        <div className="cordia-tutor-files">
          <ul className="cordia-tutor-attachments" aria-label="Attached files">
            {attachments.map(file => (
              <li key={file.id}>
                <span>{file.title}</span>
                <button type="button" className="c-icon-btn" onClick={() => removeAttachment(file.id)} aria-label={`Remove ${file.title}`}><CloseIcon size={18} strokeWidth={1.75} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          {contextKey === 'attachment' && combinedAttachments.trimmed.length > 0 && (
            <p className="cordia-tutor-attach-note" role="status">Trimmed: {combinedAttachments.trimmed.join(', ')}</p>
          )}
        </div>
      )}
      <div className={`cordia-tutor-input${Recognition ? ' has-mic' : ''}${attachDropActive ? ' drop-target-active' : ''}`}>
        <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} multiple onChange={event => attachFiles(event.target.files)} hidden />
        <button type="button" className="cordia-tutor-clip" onClick={() => fileRef.current?.click()} disabled={extracting || attachments.length >= MAX_ATTACHMENTS}
          aria-label={extracting ? 'Reading file' : attachments.length >= MAX_ATTACHMENTS ? `${MAX_ATTACHMENTS} files attached` : 'Attach files'} title="Attach files">
          {extracting ? <CordiaLoader size={16} label="Reading" /> : <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
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
              : remaining <= 0 ? 'This chat is full. Start a new chat in Past chats.'
                : needsTargetClass ? 'Pick the class to put it in.'
                  : 'Pick a guide or attach a file above.'}
        </small>
      )}
    </section>
  );
}
