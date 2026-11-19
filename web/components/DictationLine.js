import { useLayoutEffect, useRef } from 'react';

// The line under a dictation box (lib/useDictation.js): the words still being recognized, shown
// apart from the box, or one plain line when the microphone failed. It holds its one line whenever
// the browser can dictate (`available`), empty while idle, so the box never moves when it fills.
// The words stay on one line and the newest are the ones in view.
export default function DictationLine({ available, listening, interim, error }) {
  const lineRef = useRef(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (line) line.scrollLeft = line.scrollWidth;
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
