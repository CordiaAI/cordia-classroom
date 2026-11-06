import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { apiFetch, getToken, openUpgrade } from '../lib/api';
import { FREE_SUMMARY, TIERS, isPaid } from '../lib/plans';

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
      <h1 className="pricing-title">Pricing</h1>
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
    <PublicPage title="Pricing — Cordia Classroom" description="Cordia Classroom Free, Pro and Academic Weapon plans." path="/pricing">
      {plans}
    </PublicPage>
  );
}
