import { useRouter } from 'next/router';
import { useProgress } from '../lib/progress';
import { showMe } from '../lib/showMe';
import { FEATURE_LIST, featureUsed } from '../lib/features';

// A small olive dot on a feature not used yet. Tap it for a 2-3 step walkthrough.
// It disappears after first use. Static: nothing pulses outside the onboarding target.
export default function PulseDot({ feature, className = '' }) {
  const router = useRouter();
  const progress = useProgress();
  const walking = progress.wt?.status === 'active';
  const label = FEATURE_LIST.find(item => item.id === feature)?.label || feature;
  if (walking || !progress.day1Status || featureUsed(progress, feature)) return null;
  return (
    <button
      type="button"
      className={'feature-dot ' + className}
      onClick={event => { event.preventDefault(); event.stopPropagation(); showMe(router, feature); }}
      aria-label={`Show me ${label}`}
      title={`Show me ${label}`}
    >
      <span aria-hidden="true" />
      <style jsx>{`
        .feature-dot { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: 0 0 auto; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
        .feature-dot span { width: 8px; height: 8px; border-radius: 50%; background: var(--olive); }
        :global([data-theme='dark']) .feature-dot span { background: var(--hover); }
      `}</style>
    </button>
  );
}
