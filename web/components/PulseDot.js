import { useRouter } from 'next/router';
import { useProgress } from '../lib/progress';
import { showMe } from '../lib/showMe';
import { FEATURE_LIST } from '../lib/features';

// A pulsing olive dot on a feature the student has not used yet. Tap: mini walkthrough.
export default function PulseDot({ feature }) {
  const router = useRouter();
  const progress = useProgress();
  const walking = progress.wt?.status === 'active';
  const label = FEATURE_LIST.find(item => item.id === feature)?.label || feature;
  if (walking || progress.used.includes(feature)) return null;
  return (
    <button
      type="button"
      className="pulse-dot"
      onClick={event => { event.preventDefault(); event.stopPropagation(); showMe(router, feature); }}
      aria-label={`Show me ${label}`}
    >
      <span aria-hidden="true" />
      <style jsx>{`
        .pulse-dot { position: relative; display: inline-grid; place-items: center; width: 24px; height: 24px; flex: 0 0 auto; padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 50%; }
        .pulse-dot span { width: 10px; height: 10px; border-radius: 50%; background: var(--olive); box-shadow: 0 0 0 0 rgba(83, 97, 73, .5); animation: pulse 1.8s ease-out infinite; }
        [data-theme='dark'] .pulse-dot span { background: var(--olive-ink); }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(83, 97, 73, .5); } 70% { box-shadow: 0 0 0 10px rgba(83, 97, 73, 0); } 100% { box-shadow: 0 0 0 0 rgba(83, 97, 73, 0); } }
        @media (prefers-reduced-motion: reduce) { .pulse-dot span { animation: none; box-shadow: 0 0 0 3px rgba(83, 97, 73, .25); } }
      `}</style>
    </button>
  );
}
