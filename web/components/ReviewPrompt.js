import { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { apiFetch } from '../lib/api';
import { readActivity } from '../lib/activity';
import { EXTENSION_STORE_URL } from '../lib/extension';
import { getProgress, updateProgress } from '../lib/progress';

const DAY = 86400000;
const MIN_ACTIVE_DAYS = 4;
const MIN_AGE_DAYS = 5;
const MAX_ASKS = 3;
const SNOOZE_DAYS = 14;

// "Enjoying Cordia?" for students who've used it a while: asked at the end of a session that
// went reasonably well, at most three times, two weeks apart, and never again once rated.
export function reviewDue(now = Date.now()) {
  const progress = getProgress();
  const review = progress.review || {};
  if (review.rated || (review.asked || 0) >= MAX_ASKS || (review.next || 0) > now) return false;
  if (!progress.first || now - progress.first < MIN_AGE_DAYS * DAY) return false;
  const activeDays = Object.values(readActivity()).filter(day => day.m > 0 || day.c > 0 || day.t > 0).length;
  return activeDays >= MIN_ACTIVE_DAYS;
}

function snooze() {
  updateProgress(current => ({ ...current, review: { ...(current.review || {}), asked: (current.review?.asked || 0) + 1, next: Date.now() + SNOOZE_DAYS * DAY } }));
}

// Every rating is kept as feedback (so it shows on the usage dashboard); low ones carry the reason.
function sendRating(stars, message = '') {
  return apiFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify({
      category: stars >= 4 ? 'other' : 'suggestion',
      message: `Rating ${stars}/5 (review prompt)${message ? `: ${message}` : ''}`,
      page_path: typeof window !== 'undefined' ? window.location.pathname : '',
    }),
  });
}

export default function ReviewPrompt({ onClose }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') later(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stars]);

  function rate(value) {
    setStars(value);
    updateProgress(current => ({ ...current, review: { ...(current.review || {}), rated: value, at: Date.now() } }));
    if (value >= 4) sendRating(value);
  }

  function later() {
    if (!stars) snooze();
    onClose();
  }

  async function sendNote(event) {
    event.preventDefault();
    await sendRating(stars, note.trim().slice(0, 2000));
    setSent(true);
    setTimeout(onClose, 1400);
  }

  return (
    <BodyPortal>
    <div className="c-scrim" onClick={later}>
      <section className="c-sheet review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={event => event.stopPropagation()}>
        <button type="button" className="c-icon-btn review-close" onClick={later} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        {!stars ? (
          <>
            <h2 id="review-title" className="c-title review-title">Enjoying Cordia?</h2>
            <p className="c-meta review-sub">You've been studying with Cordia for a while. How's it going?</p>
            <div className="review-stars" role="radiogroup" aria-label="Rate Cordia" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map(value => (
                <button key={value} type="button" role="radio" aria-checked={false} aria-label={`${value} star${value === 1 ? '' : 's'}`} className={'review-star' + (value <= hover ? ' is-on' : '')} onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onClick={() => rate(value)}>
                  <Star size={34} strokeWidth={1.5} aria-hidden="true" />
                </button>
              ))}
            </div>
            <button type="button" className="c-btn c-btn--quiet review-later" onClick={later}>Not now</button>
          </>
        ) : stars >= 4 ? (
          <>
            <h2 id="review-title" className="c-title review-title">Thank you!</h2>
            <p className="review-sub">Would you leave a quick review on the Chrome Web Store? It helps other students find Cordia.</p>
            <div className="review-actions">
              <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Maybe later</button>
              <a className="c-btn c-btn--primary" href={`${EXTENSION_STORE_URL}/reviews`} target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}>Leave a review</a>
            </div>
          </>
        ) : sent ? (
          <>
            <h2 id="review-title" className="c-title review-title">Thanks for telling us</h2>
            <p className="review-sub">We read every note and use them to decide what to fix next.</p>
          </>
        ) : (
          <form className="review-form" onSubmit={sendNote}>
            <h2 id="review-title" className="c-title review-title">What would make it better?</h2>
            <textarea className="c-input" value={note} onChange={event => setNote(event.target.value)} placeholder="What got in your way, or what you wish Cordia did" autoFocus />
            <div className="review-actions">
              <button type="button" className="c-btn c-btn--secondary" onClick={() => { sendRating(stars); onClose(); }}>Skip</button>
              <button type="submit" className="c-btn c-btn--primary" disabled={!note.trim()}>Send</button>
            </div>
          </form>
        )}
      </section>
      <style jsx>{`
        .review-sheet { position: relative; width: min(420px, 100%); display: grid; justify-items: center; gap: 12px; padding: 28px 24px 22px; text-align: center; }
        .review-close { position: absolute; top: 12px; right: 12px; }
        .review-title { margin: 0; }
        .review-sub { margin: 0; max-width: 34ch; }
        .review-stars { display: flex; gap: 4px; margin: 6px 0; }
        .review-star { display: grid; place-items: center; width: 52px; height: 52px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); cursor: pointer; transition: transform 140ms ease, color 140ms ease; }
        .review-star.is-on { color: var(--flame); transform: scale(1.08); }
        .review-star.is-on :global(svg) { fill: currentColor; }
        .review-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 6px; }
        .review-form { display: grid; gap: 12px; width: 100%; }
        .review-form :global(textarea) { min-height: 110px; }
        @media (prefers-reduced-motion: reduce) { .review-star { transition: none; } }
      `}</style>
    </div>
    </BodyPortal>
  );
}
