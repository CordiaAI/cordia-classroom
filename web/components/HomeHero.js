import { useEffect, useState } from 'react';

// The chat home's headline and the line under it (DESIGN-SPEC 4.1). When the words change (a
// different class picked, or the day's data arriving) the old ones fade out as the new ones fade in,
// 150ms, laid over each other so the column keeps its place. Reduced motion, and a change made from
// the keyboard (DESIGN-SPEC 6.1): the words just change, on the next frame. So do the words the clock
// changes (a new time of day, a deadline passing) while the page sits open: nobody asked for them, so
// nothing moves.
// Only the new words are a heading and are read out; the fading copy is hidden from assistive tech.
// The old copy is taken away when its animation ends; the timer is only a fallback (the animation
// starts a frame or two after the copy is drawn, so it is given a little more than its own length).
export const HERO_FADE_MS = 150;
export const HERO_FALLBACK_MS = HERO_FADE_MS + 50;

// Was the last thing the student did a key press (choosing the class with Enter) rather than a pointer?
const lastInput = { keyboard: false };
const quiet = () => typeof window !== 'undefined' && (lastInput.keyboard || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export default function HomeHero({ title, line = '', clock = 0 }) {
  const key = `${title}\n${line}`;
  const [seen, setSeen] = useState({ key, title, line, clock, previous: null });
  // clock counts the page's clock checks: a change that arrives with a new count is the clock's own.
  if (seen.key !== key || seen.clock !== clock) {
    const fade = seen.key !== key && seen.clock === clock && !quiet();
    setSeen({ key, title, line, clock, previous: fade ? { key: seen.key, title: seen.title, line: seen.line } : seen.key === key ? seen.previous : null });
  }
  const { previous } = seen;
  useEffect(() => {
    const onKey = () => { lastInput.keyboard = true; };
    const onPointer = () => { lastInput.keyboard = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer, true); };
  }, []);
  const dropPrevious = leavingKey => setSeen(current => (current.previous?.key === leavingKey ? { ...current, previous: null } : current));
  useEffect(() => {
    if (!previous) return undefined;
    const timer = setTimeout(() => dropPrevious(previous.key), HERO_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [previous]);
  return (
    <div className="chat-home-hero chat-home-hero--headline">
      <div className="chat-home-copy-stack">
        {previous && (
          <div key={'out:' + previous.key} className="chat-home-copy is-leaving" aria-hidden="true" onAnimationEnd={() => dropPrevious(previous.key)}>
            <h1 className="chat-home-headline">{previous.title}</h1>
            {previous.line && <p className="chat-home-line">{previous.line}</p>}
          </div>
        )}
        <div key={key} className={'chat-home-copy' + (previous ? ' is-entering' : '')}>
          <h1 className="chat-home-headline">{title}</h1>
          {line && <p className="chat-home-line">{line}</p>}
        </div>
      </div>
    </div>
  );
}
