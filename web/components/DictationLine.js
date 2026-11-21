import { useLayoutEffect, useRef } from 'react';

// The line under a dictation box (lib/useDictation.js): the words still being recognized, shown
// apart from the box, or one plain line when the microphone failed. It holds its one line whenever
// the browser can dictate (`available`), empty while idle, so the box never moves when it fills.
// The words stay on one line and the newest are the ones in view, with the left edge fading out
// while earlier words are scrolled off it.
export default function DictationLine({ available, listening, interim, error }) {
  const lineRef = useRef(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return undefined;
    // The newest words stay in view and the left edge fades once earlier words run past it. The
    // box can change width while it shows (rotating the phone, the drawer opening), so the fade is
    // worked out again whenever the line is resized, not only when the words change.
    const place = () => {
      line.scrollLeft = line.scrollWidth;
      line.dataset.clipped = String(line.scrollLeft > 0);
    };
    place();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(line);
    return () => observer.disconnect();
  }, [interim, listening, error]);
  if (!available) return null;
  return (
    <div className="dictation-slot">
      {error
        ? <p className="dictation-interim is-error" role="alert">{error}</p>
        : listening && <p ref={lineRef} className={'dictation-interim' + (interim ? ' is-heard' : '')} role="status" aria-live="off">{interim || 'Listening…'}</p>}
    </div>
  );
}
