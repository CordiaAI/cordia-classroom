import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { addGrowth, addRing } from '../lib/progress';
import { recordStudy } from '../lib/activity';
import { apiFetch } from '../lib/api';
import { canvasKnownAvailable } from '../lib/canvas';
import { useCountUp } from '../lib/motion';
import Confetti from './Confetti';

// Accuracy as a ring that fills while the number counts up.
function ScoreRing({ value }) {
  const shown = useCountUp(value);
  const size = 112;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = value >= 90 ? 'is-great' : value >= 60 ? 'is-good' : 'is-low';
  return (
    <div className={'finish-ring ' + tone} role="img" aria-label={`${Math.round(value)}% accuracy`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="finish-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle className="finish-ring-fill" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shown / 100)} />
      </svg>
      <span aria-hidden="true"><strong>{Math.round(shown)}%</strong><small>accuracy</small></span>
      <style jsx>{`
        .finish-ring { position: relative; width: ${size}px; height: ${size}px; display: grid; place-items: center; }
        .finish-ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
        .finish-ring-track { stroke: var(--hairline); }
        .finish-ring-fill { stroke: var(--olive); }
        .is-great .finish-ring-fill { stroke: var(--success); }
        .is-low .finish-ring-fill { stroke: var(--warning); }
        .finish-ring span { display: grid; gap: 2px; justify-items: center; }
        .finish-ring strong { font: 600 28px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .finish-ring small { color: var(--muted); font: 500 var(--fs-13)/1 var(--font-sans); }
      `}</style>
    </div>
  );
}

function CountUp({ value }) {
  return <>{Math.round(useCountUp(value, 700))}</>;
}

// The end of every session: three numbers and what to do next. (Study time per guide is still
// recorded for the Progress page; the grove of trees is hidden for now.)
export default function SessionFinish({ guideId, guideTitle, cards, accuracy, minutes, kind, onRestart, onDone, doneSpot, doneLabel = 'Done', children }) {
  useEffect(() => {
    recordStudy({ guideId, guideTitle, minutes, cards, right: Math.round((accuracy / 100) * cards), total: cards, kind });
    if (guideId) addGrowth(guideId, minutes);
    // Saved class sets count you as a studier (ranking only); other guides no-op on the server.
    if (guideId && canvasKnownAvailable() !== false) apiFetch(`/sharing/guides/${guideId}/studied`, { method: 'POST', body: JSON.stringify({ accuracy: Math.round(accuracy) }) });
    if (guideId) addRing(guideId);
  }, []);

  return (
    <section className="c-card finish" aria-labelledby="finish-title">
      {/* A perfect round gets a short burst of confetti; nothing else does, so it stays special. */}
      {cards > 0 && Math.round(accuracy) >= 100 && <Confetti />}
      <h2 id="finish-title" className="c-title">{Math.round(accuracy) >= 100 && cards > 0 ? 'Perfect' : 'Done'}</h2>
      <ScoreRing value={Math.max(0, Math.min(100, accuracy))} />
      <ul className="finish-stats">
        <li><strong><CountUp value={cards} /></strong><span>cards</span></li>
        <li><strong><CountUp value={Math.max(1, Math.round(minutes))} /></strong><span>min</span></li>
      </ul>
      {/* Spacing works better than it feels, so say what happens next. */}
      <p className="c-meta finish-next">{accuracy < 100 ? 'Study this guide again soon to lock in the ones you missed.' : 'All known. A quick review in a few days keeps it that way.'}</p>
      {children}
      <div className="c-row finish-actions">
        {onRestart && <button type="button" className="c-btn c-btn--secondary" onClick={onRestart}><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />Restart</button>}
        <button type="button" className="c-btn c-btn--primary" data-spot={doneSpot} onClick={onDone}>{doneLabel}</button>
      </div>
      <style jsx>{`
        .finish { display: grid; justify-items: center; gap: 16px; padding: 32px 24px; text-align: center; }
        .finish-next { margin: 0; font-size: 15px; }
        .finish-stats { list-style: none; margin: 0; padding: 0; display: flex; gap: 40px; }
        .finish-stats li { display: grid; gap: 4px; }
        .finish-stats strong { font:600 28px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .finish-actions { justify-content: center; flex-wrap: wrap; }
        @media (max-width: 767px) { .finish-stats { gap: 24px; } }
      `}</style>
    </section>
  );
}
