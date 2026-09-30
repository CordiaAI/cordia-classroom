import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '../lib/api';

function Row({ item }) {
  return <li><span>{item.label}</span><strong>{item.correct}/{item.total}</strong></li>;
}

// What the student gets right and wrong most often, and what research suggests doing about it.
export default function StudyInsights({ compact = false }) {
  const router = useRouter();
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    let active = true;
    apiFetch('/stats/insights').then(data => { if (active) setInsights(data && Array.isArray(data.tips) ? data : { answered: 0, strengths: [], needs_work: [], tips: [] }); });
    return () => { active = false; };
  }, []);

  if (!insights) return <div className="study-insights"><strong>Your study insights</strong><p>Loading…</p></div>;

  const { answered, strengths, needs_work: needsWork, tips } = insights;
  const hasPatterns = strengths.length > 0 || needsWork.length > 0;
  const shownTips = compact ? tips.slice(0, 1) : tips;

  return (
    <div className={`study-insights${compact ? ' compact' : ''}`}>
      <strong>Your study insights</strong>
      {answered === 0 ? (
        <p>Take a quiz, a Retain round, or a Practice set and I&apos;ll show what you&apos;re strongest at and what to work on.</p>
      ) : !hasPatterns ? (
        <p>Nice start! Answer a few more questions and I&apos;ll show your strengths and the spots to work on.</p>
      ) : (
        <>
          {strengths.length > 0 && (
            <div className="study-insights-group good">
              <span>You usually get right</span>
              <ul>{(compact ? strengths.slice(0, 1) : strengths).map(item => <Row key={item.kind} item={item} />)}</ul>
            </div>
          )}
          {needsWork.length > 0 && (
            <div className="study-insights-group work">
              <span>Worth more practice</span>
              <ul>{(compact ? needsWork.slice(0, 1) : needsWork).map(item => <Row key={item.kind} item={item} />)}</ul>
            </div>
          )}
        </>
      )}
      {shownTips.length > 0 && (
        <div className="study-insights-tips">
          <span>Try this</span>
          {shownTips.map(tip => <p key={tip.text}>{tip.text} <small>{tip.source}</small></p>)}
        </div>
      )}
      {compact && answered > 0 && (
        <button type="button" className="study-insights-more" onClick={() => router.push('/settings?section=learning')}>See all insights</button>
      )}
    </div>
  );
}
