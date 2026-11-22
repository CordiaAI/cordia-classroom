import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowUpRight, BookOpenCheck, CalendarCheck, GraduationCap, Timer } from 'lucide-react';
import ProgressRing from './ProgressRing';
import Menu from './Menu';
import { buildExamReview, buildReview } from '../lib/studyPlans';
import { dayKey } from '../lib/learnEngine.mjs';
import { examPace } from '../lib/homeText.mjs';
import { examWhen } from '../lib/classPage.mjs';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// The class page's exam card (DESIGN-SPEC 4.4): the next exam, its date and time, Learn's readiness
// ring for its review set with ideas left and today's pace, "Start today's N" (Learn on the review set,
// paced to the exam date) and "Timed practice test". An exam without a review set offers to build one,
// as its assignment sheet does; with no exam coming up, a class with guides can still build a review
// set from them. A class with neither shows no card.
// exam: lib/classPage.mjs classExam, plus { percent, plan } from Learn when it has a review set.
// The card's ⋯ (top right, F3) opens the review set and the exam's assignment sheet (onPlan).
export default function ClassExamCard({ exam, folderId, className, hasGuides, onPlan }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!exam && !hasGuides) return null;

  async function build() {
    setBusy(true);
    setError('');
    const result = exam?.itemId
      ? await buildExamReview(exam.itemId)
      : await buildReview({ folderId, title: `${className || 'Class'}: review` });
    setBusy(false);
    const date = exam ? dayKey(result?.due_at || exam.dueAt || exam.date) : '';
    if (result?.guide?.id) router.push(`/learn/${encodeURIComponent(result.guide.id)}${date ? `?test=${date}` : ''}`);
    else setError(result?.detail || "That didn't work. Try again.");
  }

  const buildButton = (
    <button type="button" className="c-btn c-btn--secondary cls-exam-btn" onClick={build} disabled={busy}>
      <BookOpenCheck {...ICON} />{busy ? 'Gathering…' : 'Build review set'}
    </button>
  );

  if (!exam) {
    return (
      <section className="cls-exam" aria-labelledby="cls-exam-title">
        <div className="cls-exam-head">
          <h2 id="cls-exam-title" className="cls-exam-title">No exam coming up</h2>
          <p className="cls-exam-line">Gather this class’s guides into one review set and learn it before the next test.</p>
        </div>
        {buildButton}
        {error && <p className="cls-exam-error" role="alert">{error}</p>}
        <ExamStyles />
      </section>
    );
  }

  const ready = Boolean(exam.guideId) && Number.isFinite(exam.percent);
  const learnHref = ready ? `/learn/${encodeURIComponent(exam.guideId)}?test=${exam.date}` : '';
  const pace = ready ? examPace(exam.plan) : '';
  const perDay = exam.plan && !exam.plan.past ? exam.plan.perDay : 0;
  const menu = [
    ...(exam.guideId ? [{ label: 'Open review set', icon: ArrowUpRight, onSelect: () => router.push('/guide/' + encodeURIComponent(exam.guideId)) }] : []),
    ...(exam.item && onPlan ? [{ label: 'Plan it', icon: CalendarCheck, onSelect: () => onPlan(exam.item) }] : []),
  ];
  return (
    <section className="cls-exam" aria-labelledby="cls-exam-title">
      <div className="cls-exam-head">
        <h2 id="cls-exam-title" className="cls-exam-title">{exam.title}</h2>
        <span className="c-meta">{examWhen(exam)}</span>
        {menu.length > 0 && <Menu label={`More for ${exam.title}`} items={menu} triggerClassName="c-icon-btn cls-more" />}
      </div>
      {ready ? (
        <>
          <div className="cls-exam-ready">
            <span className="cls-exam-ring">
              <ProgressRing value={exam.percent / 100} size={112} stroke={8} label={false} title={`${exam.percent}% ready for the next exam`} />
              <span className="cls-exam-pct" aria-hidden="true">{exam.percent}%</span>
            </span>
            {pace && <p className="cls-exam-line">{pace}</p>}
          </div>
          <div className="cls-exam-actions">
            <Link href={learnHref} className="c-btn c-btn--primary cls-exam-btn">
              <GraduationCap {...ICON} />{perDay > 0 ? `Start today’s ${perDay}` : 'Review in Learn'}
            </Link>
            <Link href={`${learnHref}&mode=timed`} className="c-btn c-btn--secondary cls-exam-btn"><Timer {...ICON} />Timed practice test</Link>
          </div>
        </>
      ) : (
        <>
          <p className="cls-exam-line">No review set for this exam yet. Build one from this class’s guides, paced to the exam date.</p>
          {buildButton}
          {error && <p className="cls-exam-error" role="alert">{error}</p>}
        </>
      )}
      <ExamStyles />
    </section>
  );
}

function ExamStyles() {
  return (
    <style jsx global>{`
      /* strong glass (DESIGN-SPEC 2.3, 4.4): glass-fill-strong, 28px corners, 24px padding */
      .cls-exam {
        position: relative; isolation: isolate; box-sizing: border-box; display: flex; flex-direction: column; gap: 18px;
        padding: 24px; border-radius: 28px; background: var(--glass-sheen), var(--glass-fill-strong);
        -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--glass-shadow);
      }
      .cls-exam::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none; background: var(--glass-grain) repeat; background-size: 180px 180px; opacity: var(--glass-grain-opacity); }
      .cls-exam::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: var(--glass-rim); -webkit-mask: var(--glass-rim-mask-webkit); -webkit-mask-composite: xor; mask: var(--glass-rim-mask); }
      .cls-exam :is(.c-btn, .c-icon-btn) { -webkit-backdrop-filter: none; backdrop-filter: none; }
      .cls-exam-head { position: relative; display: grid; gap: 4px; }
      .cls-exam-head:has(.cls-more) { padding-right: 44px; }
      .cls-exam-head > .c-menu-wrap { position: absolute; top: -8px; right: -8px; }
      .cls-exam h2.cls-exam-title { margin: 0; color: var(--ink); font: 600 1.75rem/1.15 var(--font-display) !important; letter-spacing: -0.015em !important; overflow-wrap: anywhere; }
      .cls-exam-ready { display: flex; align-items: center; gap: 20px; }
      .cls-exam-ring { position: relative; flex: none; width: 112px; height: 112px; }
      .cls-exam-ring .c-ring-track { stroke: var(--ring-track); }
      .cls-exam-pct { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink); font: 600 2.125rem/1 var(--font-display); letter-spacing: -0.015em; font-variant-numeric: tabular-nums; pointer-events: none; }
      .cls-exam-line { margin: 0; color: var(--ink); font: 500 0.9375rem/1.5 var(--font-sans); font-variant-numeric: tabular-nums; text-wrap: pretty; }
      .cls-exam-actions { display: grid; gap: 8px; }
      .cls-exam .cls-exam-btn { width: 100%; height: 44px; min-height: 44px; }
      .cls-exam-error { margin: 0; color: var(--error); font: 600 0.875rem/1.4 var(--font-sans); }
      @media (prefers-reduced-transparency: reduce) { .cls-exam { background: var(--surface-raised); -webkit-backdrop-filter: none; backdrop-filter: none; } }
    `}</style>
  );
}
