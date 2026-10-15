import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/router';
import { useProgress } from '../lib/progress';
import { showMe } from '../lib/showMe';
import { FEATURE_LIST } from '../lib/features';

// Mounted dots register here; only the first unused feature (in Learn Cordia order) shows,
// so at most one hotspot dot is visible at a time.
const mounted = new Map();
const listeners = new Set();
let version = 0;
function emit() { version += 1; listeners.forEach(listener => listener()); }
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function snapshot() { return version; }

function visibleFeature(used) {
  const order = FEATURE_LIST.map(item => item.id);
  return [...mounted.keys()]
    .filter(feature => !used.includes(feature))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}

// A pulsing olive dot on a feature the student has not used yet. Tap: mini walkthrough.
export default function PulseDot({ feature }) {
  const router = useRouter();
  const progress = useProgress();
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    mounted.set(feature, (mounted.get(feature) || 0) + 1);
    emit();
    return () => {
      const count = (mounted.get(feature) || 1) - 1;
      if (count) mounted.set(feature, count); else mounted.delete(feature);
      emit();
    };
  }, [feature]);
  const walking = progress.wt?.status === 'active';
  const label = FEATURE_LIST.find(item => item.id === feature)?.label || feature;
  if (walking || progress.used.includes(feature) || visibleFeature(progress.used) !== feature) return null;
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
        .pulse-dot span { width: 8px; height: 8px; border-radius: 50%; background: var(--olive-ink); animation: pulse 1.8s var(--ease) infinite; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--olive-tint); } 70% { box-shadow: 0 0 0 8px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        @media (prefers-reduced-motion: reduce) { .pulse-dot span { animation: none; } }
      `}</style>
    </button>
  );
}
