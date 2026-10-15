import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { apiFetch, getToken, openUpgrade } from '../lib/api';
import { FREE_SUMMARY, PRICES, PRO_BENEFITS } from '../lib/plans';

function Plans({ plan }) {
  const signedIn = plan !== null;
  const pro = plan === 'classroom_plus';
  return (
    <div className="pricing-grid">
      <section className="pricing-card" aria-labelledby="plan-free">
        <h2 id="plan-free">Free</h2>
        <p className="pricing-price">$0<span>/month</span></p>
        <ul>{FREE_SUMMARY.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
        {!signedIn ? <Link href="/signup" className="c-btn c-btn--secondary">Start free</Link>
          : !pro ? <span className="pricing-current" aria-current="true"><Check size={18} strokeWidth={2} aria-hidden="true" />Current plan</span> : null}
      </section>
      <section className="pricing-card is-pro" aria-labelledby="plan-pro">
        <h2 id="plan-pro">Pro</h2>
        <p className="pricing-price">{PRICES.monthly.price}<span>/{PRICES.monthly.per}</span></p>
        <p className="pricing-alt">{PRICES.semester.price} / {PRICES.semester.label.toLowerCase()} · <span className="pricing-save">{PRICES.semester.note}</span></p>
        <ul>{PRO_BENEFITS.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
        {!signedIn ? <Link href="/signup" className="c-btn c-btn--primary">Get Pro</Link>
          : pro ? <span className="pricing-current" aria-current="true"><Check size={18} strokeWidth={2} aria-hidden="true" />Current plan</span>
            : <button type="button" className="c-btn c-btn--primary" onClick={() => openUpgrade()}>Get Pro</button>}
      </section>
      <style jsx global>{`
        .pricing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; max-width: 880px; margin: 0 auto; }
        .pricing-card { display: grid; gap: 16px; align-content: start; padding: 28px; border-radius: var(--r-panel); background: var(--panel); border: 1px solid var(--glass-edge); box-shadow: inset 0 1px 0 var(--glass-top), var(--shadow); -webkit-backdrop-filter: blur(28px) saturate(170%); backdrop-filter: blur(28px) saturate(170%); color: var(--ink); }
        .pricing-card.is-pro { border: 2px solid var(--olive-ink); }
        .pricing-card h2 { margin: 0; font: 600 17px/1.2 var(--font-sans); color: var(--ink); }
        .pricing-price { margin: 0; font: 700 40px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .pricing-price span { font-size: 15px; font-weight: 500; }
        .pricing-alt { margin: -8px 0 0; color: var(--ink); font: 500 15px/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }
        .pricing-save { color: var(--olive-ink); font-weight: 700; }
        .pricing-card ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .pricing-card li { display: flex; gap: 8px; align-items: flex-start; font: 500 15px/1.4 var(--font-sans); }
        .pricing-card li .lucide { color: var(--olive-ink); margin-top: 2px; flex: 0 0 auto; }
        .pricing-current { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; border-radius: 999px; border: 1px solid var(--line); font: 600 15px/1 var(--font-sans); color: var(--ink); }
        .pricing-title { margin: 0; text-align: center; }
        @media (max-width: 1023px) { .pricing-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

export default function Pricing() {
  const [plan, setPlan] = useState(undefined);
  useEffect(() => {
    if (!getToken()) { setPlan(null); return; }
    apiFetch('/billing/status').then(data => setPlan(data?.plan || 'free'));
  }, []);

  if (plan === undefined) return null;
  if (plan !== null) {
    return (
      <div className="c-page">
        <h1 className="c-title pricing-title">Pricing</h1>
        <Plans plan={plan} />
      </div>
    );
  }
  return (
    <PublicPage title="Pricing — CordiaClassroom" description="CordiaClassroom Free and Pro plans." path="/pricing">
      <h1 className="c-title pricing-title">Pricing</h1>
      <Plans plan={null} />
    </PublicPage>
  );
}
