import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ChevronDown } from 'lucide-react';
import CordiaLoader from './CordiaLoader';
import UserChip from './UserChip';
import { studiedBy } from '../lib/discover.mjs';

// The pieces Discover's three tabs share: the page-wide states (loading, empty, failed) and a public
// set's card. Pure layout; the data and the rules about who may be shown live in the backend.

const SHOW_MARK_AFTER = 200; // never flash the mark for a quick answer (DESIGN-SPEC 6.1)

// The page is waiting for data. Fixed height, so nothing jumps when the list arrives; the breathing
// Cordia mark appears only if the wait passes 200ms. No skeletons, no spinners.
export function DiscoverLoading({ label = 'Loading' }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_MARK_AFTER);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="dp-loading" aria-busy="true">
      {shown && <CordiaLoader label={label} />}
      <style jsx>{`
        .dp-loading { display: grid; place-items: center; min-height: 240px; }
      `}</style>
    </div>
  );
}

// One short sentence and one clear action, padded and centered in a pane of glass. No picture.
// `action` is { label, href } or { label, onClick }. `alert` is for a failure.
export function DiscoverEmpty({ message, action, alert = false }) {
  return (
    <div className="c-card dp-empty">
      <p className="dp-empty-message" role={alert ? 'alert' : 'status'}>{message}</p>
      {action && (action.href
        ? <Link href={action.href} className="c-btn c-btn--secondary">{action.label}</Link>
        : <button type="button" className="c-btn c-btn--secondary" onClick={action.onClick}>{action.label}</button>)}
      <style jsx>{`
        .dp-empty { display: grid; justify-items: center; gap: 16px; padding: 48px 24px; text-align: center; }
        .dp-empty-message { margin: 0; max-width: 34ch; color: var(--ink); font: 500 var(--fs-17)/1.45 var(--font-sans); text-wrap: balance; }
        @media (max-width: 480px) { .dp-empty { padding: 36px 20px; } }
      `}</style>
    </div>
  );
}

// A load that failed is a plain sentence and a retry, never an empty list.
export function DiscoverRetry({ what, onRetry }) {
  return <DiscoverEmpty alert message={`Couldn’t load ${what}.`} action={{ label: 'Try again', onClick: onRetry }} />;
}

// A public set: its title, a line of the outline, who made it, and where it comes from. `compact`
// is the short form under an empty search (no outline, no "similar").
export function SetCard({ guide, compact = false }) {
  const [open, setOpen] = useState(false);
  const facts = [guide.course ? [guide.course.code, guide.course.school].filter(Boolean).join(', ') : '', guide.term,
    `${guide.question_count} ${guide.question_count === 1 ? 'question' : 'questions'}`, studiedBy(guide.studied_by)].filter(Boolean).join(' · ');
  return (
    <li className="c-card exg-card">
      <Link href={'/sets/' + guide.id} className="exg-title">{guide.title}</Link>
      {!compact && guide.outline?.[0] && <p className="exg-outline">{guide.outline[0]}</p>}
      <div className="exg-meta">
        {guide.author ? <UserChip person={guide.author} /> : <span className="c-meta">Anonymous</span>}
        {guide.verified && <span className="exg-badge"><BadgeCheck size={16} strokeWidth={1.75} aria-hidden="true" />Verified instructor</span>}
      </div>
      <p className="c-meta exg-facts">{facts}</p>
      {!compact && guide.similar?.length > 0 && (
        <div className="exg-similar">
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            +{guide.similar.length} similar<ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={open ? 'exg-flip' : ''} />
          </button>
          {open && (
            <ul className="exg-similar-list">
              {guide.similar.map(item => <li key={item.id}><Link href={'/sets/' + item.id}>{item.title}</Link></li>)}
            </ul>
          )}
        </div>
      )}
      <style jsx>{`
        .exg-card { display: grid; gap: 8px; padding: 16px; min-width: 0; }
        .exg-card :global(.exg-title) { font: 600 var(--fs-17)/1.3 var(--font-sans); color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
        .exg-outline { margin: 0; color: var(--muted-ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .exg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
        .exg-badge { display: inline-flex; align-items: center; gap: 4px; font: 600 var(--fs-13)/1.3 var(--font-sans); color: var(--meter-ink); }
        .exg-facts { margin: 0; overflow-wrap: anywhere; }
        .exg-similar { display: grid; gap: 4px; justify-items: start; }
        .exg-similar :global(.exg-flip) { transform: rotate(180deg); }
        .exg-similar-list { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
        .exg-similar-list :global(a) { color: var(--ink); overflow-wrap: anywhere; }
      `}</style>
    </li>
  );
}

// A titled list of sets: "Popular public sets", "From your classmates".
export function SetGroup({ id, title, sets, compact = false }) {
  return (
    <section className="dp-group" aria-labelledby={id}>
      <h2 id={id} className="dp-group-title">{title}</h2>
      <ul className="dp-group-list" aria-label={title}>
        {sets.map(guide => <SetCard key={guide.id} guide={guide} compact={compact} />)}
      </ul>
      <style jsx>{`
        .dp-group { display: grid; gap: 10px; }
        .dp-group-title { margin: 0; color: var(--ink); font: 600 var(--fs-15)/1.3 var(--font-sans); }
        .dp-group-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
      `}</style>
    </section>
  );
}
