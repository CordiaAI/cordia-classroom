import { useEffect, useState } from 'react';
import { SectionLoader } from './CordiaLoader';
import { useRouter } from 'next/router';
import { ChartColumn, TrendingDown, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { walkthroughEvent } from '../lib/walkthrough';

function Row({ item, icon: Icon, tone }) {
  return (
    <li className={`insight-row ${tone}`}>
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <span className="c-truncate">{item.label}</span>
      <span className="c-meta">{item.correct}/{item.total}</span>
    </li>
  );
}

// What the student gets right most and least often.
// Pass `data` when the page already loaded it (Today), so the card never pops in on its own.
export default function StudyInsights({ compact = false, data }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(null);
  const normalize = value => (value && Array.isArray(value.tips) ? value : { answered: 0, strengths: [], needs_work: [], tips: [] });
  const insights = data !== undefined ? normalize(data) : loaded;

  useEffect(() => {
    if (data !== undefined) return undefined;
    let active = true;
    apiFetch('/stats/insights').then(value => { if (active) setLoaded(normalize(value)); });
    return () => { active = false; };
  }, [data]);

  const strengths = insights?.strengths || [];
  const needsWork = insights?.needs_work || [];
  const limit = compact ? 2 : 10;

  return (
    <section className={`c-card insights-card${compact ? ' compact' : ''}`} aria-labelledby="insights-title" data-tip={compact ? 'insights' : undefined} data-spot={compact ? 'insights' : undefined}>
      <header className="c-row">
        <ChartColumn size={20} strokeWidth={1.75} aria-hidden="true" />
        <h2 id="insights-title" className="c-section-title">Insights</h2>
        {compact && <><span className="c-spacer" /><button type="button" className="c-btn c-btn--quiet" onClick={() => { walkthroughEvent('insights-opened'); router.push('/progress'); }}>Open</button></>}
      </header>
      {!insights ? (
        <SectionLoader height={72} label="Loading insights" />
      ) : !strengths.length && !needsWork.length ? (
        <button type="button" className="c-btn c-btn--quiet insights-empty" onClick={() => router.push('/library')}>Take a quiz</button>
      ) : (
        <ul className="insight-list">
          {needsWork.slice(0, limit).map(item => <Row key={'w' + item.kind} item={item} icon={TrendingDown} tone="work" />)}
          {strengths.slice(0, limit).map(item => <Row key={'s' + item.kind} item={item} icon={TrendingUp} tone="good" />)}
        </ul>
      )}
      {!compact && needsWork.length > 0 && (
        <button type="button" className="c-btn c-btn--secondary insights-practice" onClick={() => router.push('/library?tab=practice')}>Practice these</button>
      )}
      {!compact && insights?.tips?.length > 0 && (
        <ul className="insight-tips">
          {insights.tips.map(tip => <li key={tip.text}>{tip.text}</li>)}
        </ul>
      )}
      <style jsx>{`
        .insights-card { display: grid; gap: 12px; padding: 20px; align-content: start; }
        .insights-card :global(header .lucide) { color: var(--olive-ink); }
        .insight-list, .insight-tips { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .insights-card :global(.insight-row) { display: flex; align-items: center; gap: 10px; min-height: 36px; font:600 15px/1.5 var(--font-sans); }
        .insights-card :global(.insight-row span:nth-child(2)) { flex: 1; min-width: 0; }
        .insights-card :global(.insight-row.good .lucide) { color: var(--success); }
        .insights-card :global(.insight-row.work .lucide) { color: var(--warning); }
        .insight-tips li { padding: 10px 0; border-top: 1px solid var(--line); }
        .insights-empty, .insights-practice { justify-self: start; }
      `}</style>
    </section>
  );
}
