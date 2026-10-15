import Link from 'next/link';
import { Check } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { FREE_SUMMARY, PRICES, PRO_BENEFITS } from '../lib/plans';

export default function Pricing() {
  return (
    <PublicPage title="Pricing — CordiaClassroom" description="CordiaClassroom Free and Pro plans." path="/pricing">
      <h1 className="pricing-title">Pricing</h1>
      <div className="pricing-grid">
        <section className="pricing-card" aria-labelledby="plan-free">
          <h2 id="plan-free">Free</h2>
          <p className="pricing-price">$0<span>/month</span></p>
          <ul>{FREE_SUMMARY.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
          <Link href="/signup" className="pricing-btn is-secondary">Start free</Link>
        </section>
        <section className="pricing-card is-pro" aria-labelledby="plan-pro">
          <h2 id="plan-pro">Pro</h2>
          <p className="pricing-price">{PRICES.monthly.price}<span>/{PRICES.monthly.per}</span></p>
          <p className="pricing-alt">{PRICES.semester.price} / {PRICES.semester.label.toLowerCase()}</p>
          <ul>{PRO_BENEFITS.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}</ul>
          <Link href="/signup" className="pricing-btn">Get Pro</Link>
        </section>
      </div>
      <style jsx>{`
        .pricing-title { margin: 0 0 32px; font: 600 clamp(32px, 5vw, 56px)/1.05 var(--font-display); color: #171B18; }
        .pricing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; max-width: 880px; }
        .pricing-card { display: grid; gap: 16px; align-content: start; padding: 28px; border-radius: 20px; background: #FFFFFC; border: 1px solid rgba(34, 49, 41, .12); box-shadow: 0 8px 24px rgba(39, 54, 49, .08); }
        .pricing-card.is-pro { box-shadow: 0 0 0 2px #536149, 0 8px 24px rgba(39, 54, 49, .08); }
        .pricing-card h2 { margin: 0; font: 600 17px/1.2 var(--font-sans); }
        .pricing-price { margin: 0; font: 700 40px/1 var(--font-sans); }
        .pricing-price span { font-size: 15px; font-weight: 500; }
        .pricing-alt { margin: -8px 0 0; color: #636B65; font: 500 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .pricing-card ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .pricing-card li { display: flex; gap: 8px; align-items: flex-start; font: 500 15px/1.4 var(--font-sans); }
        .pricing-card li :global(.lucide) { color: #536149; margin-top: 2px; flex: 0 0 auto; }
        .pricing-card :global(.pricing-btn) { display: inline-flex; align-items: center; justify-content: center; height: 44px; border-radius: 999px; background: #536149; color: #fff; font: 600 15px/1 var(--font-sans); text-decoration: none; }
        .pricing-card :global(.pricing-btn.is-secondary) { background: rgba(255, 255, 252, .73); color: #171B18; border: 1px solid rgba(34, 49, 41, .2); }
        @media (max-width: 720px) { .pricing-grid { grid-template-columns: 1fr; } }
      `}</style>
    </PublicPage>
  );
}
