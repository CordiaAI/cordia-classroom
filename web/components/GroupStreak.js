import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { loadGroupStreak } from '../lib/socialActivity';

// A classroom's group streak (Stage 10): days in a row when at least half the members studied, and
// how today is going. Counts only: it never says who studied.
export default function GroupStreak({ classroomId }) {
  const [data, setData] = useState(null);
  useEffect(() => { loadGroupStreak(classroomId).then(setData); }, [classroomId]);
  if (!data || !data.today?.members) return null;
  const { streak, today } = data;
  const left = Math.max(0, today.needed - today.studied);
  return (
    <section className="c-card gs" aria-label="Group streak">
      <span className="gs-icon" aria-hidden="true"><Flame size={20} strokeWidth={1.75} /></span>
      <span className="gs-main">
        <strong>{streak === 1 ? '1-day group streak' : `${streak}-day group streak`}</strong>
        <span className="c-meta">
          {today.counts
            ? `Today counts: ${today.studied} of ${today.members} studied.`
            : `Today: ${today.studied} of ${today.members} studied. ${left} more ${left === 1 ? 'keeps' : 'keep'} it going.`}
        </span>
      </span>
      <style jsx>{`
        .gs { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
        .gs-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .gs-main { display: grid; gap: 2px; min-width: 0; }
        .gs-main strong { font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .gs-main .c-meta { overflow-wrap: anywhere; }
      `}</style>
    </section>
  );
}
