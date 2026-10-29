import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { useRouter } from 'next/router';
import { apiFetch } from '../lib/api';
import { uploadFeedbackImage } from '../lib/cardImages';

const MAX_SHOTS = 3;

const categories = [
  ['bug', 'Bug'],
  ['suggestion', 'Suggestion'],
  ['incorrect_content', 'Incorrect study content'],
  ['account_payment', 'Account or payment'],
  ['other', 'Other'],
];

function currentPageContext(router) {
  const value = candidate => Array.isArray(candidate) ? candidate[0] : candidate;
  const guideRoute = ['/guide/[id]', '/practice/[guideId]', '/quiz/[guideId]', '/flashcards/study'].includes(router.pathname);
  return {
    page_path: (router.asPath || '/').split('?', 1)[0].split('#', 1)[0],
    context: {
      guide_id: guideRoute ? value(router.query.guideId || router.query.id) || null : null,
      question_id: value(router.query.questionId) || null,
    },
  };
}

export default function FeedbackModal({ onClose }) {
  const router = useRouter();
  const dialogRef = useRef(null);
  const submittingRef = useRef(false);
  const requestIdRef = useRef(null);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('bug');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // Screenshots: { id, preview, path, status: 'uploading' | 'ready' | 'failed' }
  const [shots, setShots] = useState([]);
  const [shotError, setShotError] = useState('');
  const fileRef = useRef(null);

  async function addShots(files) {
    const images = [...files].filter(file => file?.type?.startsWith('image/')).slice(0, MAX_SHOTS - shots.length);
    if (!images.length) return;
    setShotError('');
    const added = images.map(file => ({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), path: '', status: 'uploading' }));
    setShots(current => [...current, ...added]);
    await Promise.all(images.map(async (file, index) => {
      const id = added[index].id;
      try {
        const path = await uploadFeedbackImage(file);
        setShots(current => current.map(shot => (shot.id === id ? { ...shot, path, status: 'ready' } : shot)));
      } catch (caught) {
        setShots(current => current.filter(shot => shot.id !== id));
        setShotError(caught.message);
      }
    }));
  }

  function removeShot(id) {
    setShots(current => {
      const gone = current.find(shot => shot.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return current.filter(shot => shot.id !== id);
    });
  }

  // Paste a screenshot straight in (Cmd/Ctrl+V) anywhere in the dialog.
  function onPaste(event) {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); addShots(files); }
  }

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const focusable = () => Array.from(dialog?.querySelectorAll(
      'button:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    ) || []);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();

    const data = await apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message: normalizedMessage,
        category,
        ...currentPageContext(router),
        app_version: process.env.NEXT_PUBLIC_APP_VERSION || null,
        client_request_id: requestIdRef.current,
        attachments: shots.filter(shot => shot.status === 'ready').map(shot => shot.path),
      }),
    });

    if (data?.submitted) {
      setSubmitted(true);
      window.setTimeout(onClose, 1500);
    } else {
      setError(data?.detail || 'Feedback was not sent. Your draft is still here—please try again.');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <BodyPortal>
    <div className="feedback-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        aria-describedby="feedback-description"
        tabIndex={-1}
      >
        {submitted ? (
          <div className="feedback-success" role="status">
            <Check aria-hidden="true" />
            <h2>Feedback sent</h2>
            <p>Thank you for helping improve CordiaClassroom.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} onPaste={onPaste} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addShots(event.dataTransfer?.files || []); }}>
            <div className="feedback-heading">
              <div>
                <p className="feedback-kicker">BETA FEEDBACK</p>
                <h2 id="feedback-title">Tell us what you noticed</h2>
                <p id="feedback-description">Short and specific is perfect.</p>
              </div>
              <button type="button" className="feedback-close" onClick={onClose} aria-label="Close feedback form">×</button>
            </div>

            <label htmlFor="feedback-category">Category</label>
            <select id="feedback-category" className="c-select feedback-select" value={category} onChange={event => setCategory(event.target.value)}>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>

            <div className="feedback-message-label">
              <label htmlFor="feedback-message">Message</label>
              <span>{message.length}/2000</span>
            </div>
            <textarea
              id="feedback-message"
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder="What happened, or what would make this better?"
              rows={6}
              maxLength={2000}
              required
            />
            <div className="feedback-shots">
              {shots.map(shot => (
                <div key={shot.id} className={'feedback-shot' + (shot.status === 'uploading' ? ' is-uploading' : '')}>
                  {/* A local preview of the file being attached (blob: URL), never a remote address. */}
                  <img src={shot.preview} alt="Attached screenshot" />
                  <button type="button" className="feedback-shot-remove" onClick={() => removeShot(shot.id)} aria-label="Remove screenshot"><X size={14} strokeWidth={2} aria-hidden="true" /></button>
                </div>
              ))}
              {shots.length < MAX_SHOTS && (
                <button type="button" className="c-btn c-btn--secondary c-btn--sm feedback-add-shot" onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />Add screenshot
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={event => { addShots(event.target.files || []); event.target.value = ''; }} />
            </div>
            <p className="feedback-context">Paste or drop a screenshot here too. The page you're on is included; query details and private tokens are not.</p>
            {shotError && <p className="feedback-error" role="alert">{shotError}</p>}
            {error && <p className="feedback-error" role="alert">{error}</p>}
            <div className="feedback-actions">
              <button type="button" className="feedback-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="c-btn c-btn--primary feedback-submit" disabled={submitting || !message.trim() || shots.some(shot => shot.status === 'uploading')}>
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </section>

      <style jsx>{`
        .feedback-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: var(--scrim); }
        .feedback-modal { width: min(540px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; padding: 30px; border: 1px solid var(--line); border-radius:20px; background: var(--lg-panel); -webkit-backdrop-filter: var(--lg-filter); backdrop-filter: var(--lg-filter); border-color: var(--lg-edge); color: var(--ink); box-shadow: var(--lg-highlight), var(--lg-shadow); }
        .feedback-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
        .feedback-kicker { margin: 0 0 8px; color: var(--olive); font-size: 13px; font-weight:600; letter-spacing:0; }
        h2 { margin: 0; color: var(--ink); font-size: max(13px, clamp(1.65rem, 4vw, 2.15rem)); line-height:1.15; letter-spacing:-0.015em; }
        .feedback-heading p:last-child { margin: 9px 0 0; color: var(--text-secondary); font-size:15px; }
        .feedback-close { width: 38px; height: 38px; flex: 0 0 auto; border: 1px solid var(--line); border-radius:50%; background: var(--surface); color: var(--ink); font: inherit; font-size:20px; line-height:1; cursor: pointer; }
        label { display: block; margin-bottom: 8px; color: var(--ink); font-size: 13px; font-weight:600; }
        textarea { width: 100%; border: 1px solid var(--line); border-radius:12px; background: var(--surface); color: var(--ink); font: inherit; }
        /* The dropdown is the app's own (c-select): its chevron sits 14px in from the edge. */
        .feedback-select { width: 100%; min-height: 48px; margin-bottom: 20px; }
        textarea { padding: 14px; resize: none; line-height:1.5; }
        .feedback-select:focus-visible, textarea:focus, button:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .feedback-shots { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
        .feedback-shot { position: relative; width: 72px; height: 72px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); }
        .feedback-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .feedback-shot.is-uploading img { opacity: .45; }
        .feedback-shot-remove { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: var(--lg-menu); color: var(--ink); cursor: pointer; }
        .feedback-message-label { display: flex; align-items: center; justify-content: space-between; }
        .feedback-message-label span { color: var(--muted-ink); font-size: 13px; }
        .feedback-context { margin: 9px 0 0; color: var(--muted-ink); font-size: 13px; line-height:1.5; }
        .feedback-error { margin: 13px 0 0; color: var(--error); font-size:13px; font-weight:600; line-height:1.5; }
        .feedback-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
        .feedback-cancel { min-height: 46px; padding: 0 18px; border-radius:12px; font: inherit; font-size:13px; font-weight:600; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
        /* The app's primary button: its disabled state keeps a readable label (this one had white
           text on a white fill in dark mode). */
        .feedback-submit { min-height: 46px; }
        .feedback-success { display: grid; justify-items: center; padding: 24px 8px; text-align: center; }
        .feedback-success span { width: 50px; height: 50px; display: grid; place-items: center; border-radius:50%; background: var(--accent-glow); color: var(--olive); font-size:20px; font-weight:600; }
        .feedback-success h2 { margin-top: 16px; }
        .feedback-success p { margin: 9px 0 0; color: var(--text-secondary); }
        @media (max-width: 560px) {
          .feedback-overlay { align-items: end; padding: 0; }
          .feedback-modal { max-height: 92vh; padding: 24px 19px max(24px, env(safe-area-inset-bottom)); border-radius:20px 20px 0 0; }
          .feedback-actions { display: grid; grid-template-columns: 1fr 1fr; }
        }
        @media (prefers-reduced-motion: reduce) { .feedback-overlay, .feedback-modal { animation: none; transition: none; } }
      `}</style>
    </div>
    </BodyPortal>
  );
}
