import { BadgeCheck } from 'lucide-react';

// A verified instructor (confirmed school email on a course opt-out; services/instructors.py).
// `label` shows the words; otherwise the check alone, with the words for screen readers and a tooltip.
export default function VerifiedBadge({ label = false }) {
  return (
    <span className={'vb' + (label ? ' has-label' : '')} title="Verified instructor">
      <BadgeCheck size={label ? 16 : 15} strokeWidth={2} aria-hidden="true" />
      {label ? <span>Verified instructor</span> : <span className="sr-only">Verified instructor</span>}
      <style jsx>{`
        .vb { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--olive-ink); vertical-align: middle; }
        .vb.has-label { padding: 2px 10px 2px 8px; border-radius: var(--r-pill); background: var(--olive-tint); font: 600 13px/1.4 var(--font-sans); }
      `}</style>
    </span>
  );
}
