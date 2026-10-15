import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Sheet } from './Overlay';
import { useRouter } from 'next/router';
import { apiFetch } from '../lib/api';

const categories = [
  ['bug', 'Bug'],
  ['suggestion', 'Suggestion'],
  ['incorrect_content', 'Incorrect study content'],
  ['account_payment', 'Account or payment'],
  ['other', 'Other'],
];

function currentPageContext(router) {
  const value = candidate => Array.isArray(candidate) ? candidate[0] : candidate;
  const guideRoute = ['/guide/[id]', '/practice/[guideId]', '/quiz/[guideId]', '/flashcards/[guideId]'].includes(router.pathname);
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
    <Sheet onClose={onClose} labelledBy="feedback-title" className="feedback-modal">
      {submitted ? (
        <div className="feedback-success" role="status">
          <Check size={24} strokeWidth={1.75} aria-hidden="true" />
          <h2 id="feedback-title" className="c-title">Sent</h2>
        </div>
      ) : (
        <form className="feedback-form" onSubmit={handleSubmit}>
          <header className="c-sheet-head">
            <h2 id="feedback-title" className="c-title">Feedback</h2>
            <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" title="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>
          <label className="c-field">
            <span>Category</span>
            <select className="c-input" value={category} onChange={event => setCategory(event.target.value)}>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="c-field">
            <span className="feedback-label-row"><span>Message</span><span className="c-meta">{message.length}/2000</span></span>
            <textarea className="c-input" value={message} onChange={event => setMessage(event.target.value)} rows={6} maxLength={2000} required autoFocus />
          </label>
          {error && <p className="feedback-error" role="alert">{error}</p>}
          <div className="feedback-actions">
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="c-btn c-btn--primary" disabled={submitting || !message.trim()}>{submitting ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      )}
      <style jsx global>{`
        .feedback-modal { width: min(540px, 100%); }
        .feedback-form { display: grid; gap: 16px; }
        .feedback-form .c-sheet-head { margin-bottom: 0; }
        .feedback-form textarea { min-height: 140px; padding-top: 12px; resize: vertical; }
        .feedback-label-row { display: flex; justify-content: space-between; }
        .feedback-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .feedback-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .feedback-success { display: grid; justify-items: center; gap: 12px; padding: 24px 8px; text-align: center; color: var(--ink); }
      `}</style>
    </Sheet>
  );
}
