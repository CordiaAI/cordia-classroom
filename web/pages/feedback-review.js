import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { safeHref } from '../lib/formatters';

const categoryLabels = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  incorrect_content: 'Incorrect study content',
  account_payment: 'Account or payment',
  other: 'Other',
};
const statuses = ['new', 'reviewing', 'planned', 'resolved'];

function displayDate(value) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function FeedbackReviewPage() {
  const { ready } = useRequireAuth();
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    const query = params.toString();
    const data = await apiFetch(`/feedback/review${query ? `?${query}` : ''}`);
    if (!Array.isArray(data?.items)) {
      setItems([]);
      setSelectedId(null);
      setError(apiErrorMessage(data?.detail, 'Feedback could not be loaded.'));
    } else {
      setItems(data.items);
      setSelectedId(current => data.items.some(item => item.id === current) ? current : data.items[0]?.id || null);
    }
    setLoading(false);
  }, [category, status]);

  useEffect(() => {
    if (ready) loadFeedback();
  }, [ready, loadFeedback]);

  async function updateStatus(item, nextStatus) {
    const previousStatus = item.status;
    setItems(current => current.map(entry => entry.id === item.id ? { ...entry, status: nextStatus } : entry));
    const data = await apiFetch(`/feedback/review/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!data?.item) {
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, status: previousStatus } : entry));
      setError(apiErrorMessage(data?.detail, 'Status could not be updated.'));
    }
  }

  const selected = items.find(item => item.id === selectedId) || null;

  if (!ready) return null;

  return (
    <div className="feedback-review-page">
      <header className="feedback-review-heading">
        <div>
          <p>BETA OPERATIONS</p>
          <h1>Feedback review</h1>
          <span>Student messages are untrusted text. Review context before planning a change.</span>
        </div>
        <button type="button" onClick={loadFeedback}>Refresh</button>
      </header>

      <section className="feedback-filters" aria-label="Feedback filters">
        <label>
          Category
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
          </select>
        </label>
      </section>

      {error && <p className="feedback-review-error" role="alert">{error}</p>}
      {loading ? (
        <div className="feedback-review-empty" role="status">Loading feedback…</div>
      ) : error ? null : !items.length ? (
        <div className="feedback-review-empty">No feedback matches these filters.</div>
      ) : (
        <div className="feedback-review-workspace">
          <ol className="feedback-review-list" aria-label="Feedback items">
            {items.map(item => (
              <li key={item.id}>
                <button type="button" className={item.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
                  <span>{categoryLabels[item.category] || item.category}</span>
                  <strong>{item.message}</strong>
                  <small>{displayDate(item.created_at)} · {item.status}</small>
                </button>
              </li>
            ))}
          </ol>

          {selected && (
            <article className="feedback-review-detail" aria-live="polite">
              <div className="feedback-review-detail-top">
                <div>
                  <span className="feedback-category">{categoryLabels[selected.category] || selected.category}</span>
                  <h2>Feedback detail</h2>
                </div>
                <label>
                  Status
                  <select value={selected.status} onChange={event => updateStatus(selected, event.target.value)}>
                    {statuses.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
                  </select>
                </label>
              </div>
              <p className="feedback-review-message">{selected.message}</p>
              {(selected.attachment_urls || []).length > 0 && (
                <div className="feedback-review-shots">
                  {selected.attachment_urls.map((url, index) => (
                    <a key={index} href={safeHref(url, '#')} target="_blank" rel="noreferrer"><img src={safeHref(url, '')} alt={`Screenshot ${index + 1}`} /></a>
                  ))}
                </div>
              )}
              <dl>
                <div><dt>Submitted</dt><dd>{displayDate(selected.created_at)}</dd></div>
                <div><dt>User ID</dt><dd>{selected.user_id}</dd></div>
                <div><dt>Page</dt><dd>{selected.page_path || 'Not provided'}</dd></div>
                <div><dt>Guide ID</dt><dd>{selected.guide_id || 'Not provided'}</dd></div>
                <div><dt>Question ID</dt><dd>{selected.question_id || 'Not provided'}</dd></div>
                <div><dt>App version</dt><dd>{selected.app_version || 'Not provided'}</dd></div>
              </dl>
            </article>
          )}
        </div>
      )}

      <style jsx>{`
        .feedback-review-page { max-width: 1240px; margin: 0 auto; color: var(--ink); }
        .feedback-review-shots { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
        .feedback-review-shots img { display: block; max-width: 220px; max-height: 160px; border-radius: 10px; border: 1px solid var(--line); object-fit: cover; }
        .feedback-review-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
        .feedback-review-heading p { margin: 0 0 9px; color: var(--olive); font-size: 13px; font-weight:600; letter-spacing:0; }
        h1 { margin: 0; font-size: max(13px, clamp(2.5rem, 6vw, 4.8rem)); line-height:1.15; letter-spacing:-0.015em; }
        .feedback-review-heading span { display: block; max-width: 680px; margin-top: 15px; color: var(--text-secondary); line-height:1.5; }
        .feedback-review-heading button { min-height: 44px; padding: 0 18px; border: 0; border-radius:12px; background: var(--ink); color: var(--on-olive); font: inherit; font-weight:600; cursor: pointer; }
        .feedback-filters { display: flex; gap: 12px; margin-bottom: 18px; padding: 16px; border: 1px solid var(--line); border-radius:20px; background: var(--surface); box-shadow: var(--shadow-card); }
        label { display: grid; gap: 7px; color: var(--text-secondary); font-size: 13px; font-weight:600; }
        select { min-height: 42px; padding: 0 12px; border: 1px solid var(--line); border-radius:12px; background: var(--surface); color: var(--ink); font: inherit; }
        .feedback-review-error, .feedback-review-empty { padding: 22px; border: 1px solid var(--line); border-radius:20px; background: var(--surface); color: var(--text-secondary); box-shadow: var(--shadow-card); }
        .feedback-review-error { color: var(--error); font-weight:600; }
        .feedback-review-workspace { display: grid; grid-template-columns: minmax(280px, 0.72fr) minmax(0, 1.28fr); gap: 18px; align-items: start; }
        .feedback-review-list { max-height: 680px; overflow-y: auto; display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
        .feedback-review-list button { width: 100%; display: grid; gap: 7px; padding: 17px; border: 1px solid var(--line); border-radius:20px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); font: inherit; text-align: left; cursor: pointer; }
        .feedback-review-list button.selected { border-color: var(--olive); background: var(--accent-glow); }
        .feedback-review-list span { color: var(--olive); font-size: 13px; font-weight:600; letter-spacing:0; text-transform:none; }
        .feedback-review-list strong { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size:15px; line-height:1.5; }
        .feedback-review-list small { color: var(--muted-ink); font-size: 13px; }
        .feedback-review-detail { padding: 28px; border: 1px solid var(--line); border-radius:20px; background: var(--surface); box-shadow: var(--shadow-card); }
        .feedback-review-detail-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
        .feedback-category { color: var(--olive); font-size: 13px; font-weight:600; letter-spacing:0; text-transform:none; }
        h2 { margin: 8px 0 0; font-size:28px; letter-spacing:-0.015em; }
        .feedback-review-message { margin: 28px 0; color: var(--ink); font-size:17px; line-height:1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
        dl { display: grid; gap: 0; margin: 0; border-top: 1px solid var(--line); }
        dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 15px; padding: 12px 0; border-bottom: 1px solid var(--line); }
        dt { color: var(--muted-ink); font-size: 13px; font-weight:600; }
        dd { min-width: 0; margin: 0; color: var(--text-secondary); font-size: 13px; overflow-wrap: anywhere; }
        @media (max-width: 780px) {
          .feedback-review-heading { align-items: flex-start; flex-direction: column; }
          .feedback-filters, .feedback-review-workspace { grid-template-columns: 1fr; }
          .feedback-filters { display: grid; }
          .feedback-review-list { max-height: 390px; }
          .feedback-review-detail-top { flex-direction: column; }
          dl div { grid-template-columns: 1fr; gap: 5px; }
        }
      `}</style>
    </div>
  );
}
