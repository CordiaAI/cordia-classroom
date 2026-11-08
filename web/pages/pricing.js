import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { apiFetch, getToken, openUpgrade } from '../lib/api';
import { FREE_SUMMARY, TIERS, isPaid } from '../lib/plans';
import { FREE_PLAN_TEXT, PLANS, planByKey } from '../lib/brand.mjs';

const { trial } = PLANS;
const pro = planByKey('pro');
const weapon = planByKey('weapon');

// Every answer comes from the code: plans and the trial (lib/plans.js, entitlements.py,
// billing.py), file and link types (NewSheet), the Canvas connection and the Honor Code.
const PRICING_FAQ = [
  {
    question: 'Is Cordia Classroom free?',
    answer: `Yes. The Free plan includes ${FREE_PLAN_TEXT}.`,
  },
  {
    question: 'How much do the paid plans cost?',
    answer: `${pro.name} costs $${pro.price} a month and ${weapon.name} costs $${weapon.price} a month. Both are billed monthly; there is no semester plan.`,
  },
  {
    question: 'Is there a free trial?',
    answer: `Yes. A new account can try ${trial.plan} free for ${trial.days} days with no card, once per account. The trial ends on its own and you go back to the Free plan; nothing is charged.`,
  },
  {
    question: 'What can I turn into a study guide?',
    answer: 'Upload PDFs, PowerPoint (.pptx) and Word (.docx) files, text or Markdown files, and photos or screenshots of notes, up to 5 files at a time, or paste text. You can also add a link to a web page, PDF or YouTube video (YouTube needs the Chrome extension), make a guide from a recorded lecture, and capture Canvas, Blackboard and Moodle pages or Google Docs and Slides with the Chrome extension.',
  },
  {
    question: 'Does it work with Canvas?',
    answer: "Yes. Connect Canvas with an access token and Cordia reads your classes, deadlines, grades and course files; it only reads and never changes anything in Canvas. If you can't use a token, paste your Canvas Calendar Feed link (it ends in .ics) to bring in your deadlines instead.",
  },
  {
    question: 'Can I use Cordia during an exam?',
    answer: 'No. Cordia is a study aid, and its Honor Code forbids using it during live exams or handing in its output as your own work.',
  },
];

// Signed out: the public page with "Start free". Signed in: the same three plans inside the app
// (pages/_app.js adds the app nav), with the student's own plan marked "Current plan".
export default function Pricing() {
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    setSignedIn(true);
    apiFetch('/billing/status').then(data => { if (data?.plan) setStatus(data); });
  }, []);

  const currentTier = isPaid(status) && !status.on_trial ? status.tier : status ? 'free' : '';
  const current = <span className="pricing-btn is-current" aria-disabled="true">Current plan</span>;
  const plans = (
    <>
      <h1 className="pricing-title">Cordia Classroom pricing</h1>
      <div className="pricing-grid">
        <section className="pricing-card" aria-labelledby="plan-free">
          <h2 id="plan-free">Free</h2>
          <p className="pricing-price">$0<span>/month</span></p>
          <ul>{FREE_SUMMARY.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
          {signedIn ? (currentTier === 'free' ? current : null) : <Link href="/signup" className="pricing-btn is-secondary">Start free</Link>}
        </section>
        {Object.entries(TIERS).map(([key, tier]) => (
          <section key={key} className={'pricing-card' + (key === 'weapon' ? ' is-pro' : '')} aria-labelledby={`plan-${key}`}>
            <h2 id={`plan-${key}`}>{tier.name}</h2>
            <p className="pricing-price">{tier.price}<span>/{tier.per}</span></p>
            <p className="pricing-alt">{tier.pitch}</p>
            <ul>{tier.benefits.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
            {signedIn
              ? (currentTier === key ? current : <button type="button" className="pricing-btn" onClick={() => openUpgrade({ tier_choice: key })}>Get {tier.name}</button>)
              : <Link href="/signup" className="pricing-btn">Get {tier.name}</Link>}
          </section>
        ))}
      </div>
      <style jsx>{`
        .pricing-title { margin: 0 0 32px; font:600 40px/1.15 var(--font-display); color: var(--ink); }
        .pricing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; max-width: 1180px; }
        .pricing-card { display: grid; gap: 16px; align-content: start; padding: 28px; border-radius:20px; color: var(--ink); background: var(--lg-card); border: 1px solid var(--lg-edge); -webkit-backdrop-filter: var(--lg-filter); backdrop-filter: var(--lg-filter); box-shadow: var(--lg-highlight), var(--lg-shadow); }
        .pricing-card.is-pro { box-shadow: 0 0 0 2px var(--olive), var(--lg-highlight), var(--lg-shadow); }
        .pricing-card h2 { margin: 0; font:600 17px/1.15 var(--font-sans); color: var(--ink); }
        .pricing-price { margin: 0; font:600 40px/1 var(--font-sans); }
        .pricing-price span { font-size: 15px; font-weight:500; }
        .pricing-alt { margin: -8px 0 0; color: var(--muted); font:500 13px/1.4 var(--font-sans); }
        .pricing-card ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .pricing-card li { display: flex; gap: 8px; align-items: flex-start; font:500 15px/1.5 var(--font-sans); }
        .pricing-card li :global(.lucide) { color: var(--olive-ink); margin-top: 2px; flex: 0 0 auto; }
        .pricing-card :global(.pricing-btn) { display: inline-flex; align-items: center; justify-content: center; height: 44px; border: 0; border-radius:999px; background: var(--olive); color: var(--on-olive); font:600 15px/1 var(--font-sans); text-decoration: none; cursor: pointer; }
        .pricing-card :global(.pricing-btn.is-secondary) { background: var(--glass); color: var(--ink); border: 1px solid var(--line); }
        .pricing-card :global(.pricing-btn.is-current) { background: transparent; color: var(--ink); border: 1px solid var(--line); cursor: default; }
        @media (max-width: 960px) { .pricing-grid { grid-template-columns: 1fr; max-width: 520px; } }
      `}</style>
    </>
  );

  if (signedIn) return <div className="c-page">{plans}</div>;
  return (
    <PublicPage path="/pricing" faq={PRICING_FAQ}>
      {plans}
    </PublicPage>
  );
}
