import { useRequireAuth } from '../lib/auth';
import AIChatWidget from '../components/AIChatWidget';
import { lastGuide } from '../lib/userStore';

// The Tutor at full size. Everywhere else it opens as a side panel from "Ask".
export default function TutorPage() {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return (
    <div className="tutor-page">
      <h1 className="sr-only">Tutor</h1>
      <div className="c-glass tutor-page-panel">
        <AIChatWidget preferredGuideId={lastGuide()?.id || ''} freshOnMount />
      </div>
      <style jsx>{`
        .tutor-page { display: grid; justify-items: center; }
        .tutor-page-panel { width: min(820px, 100%); height: calc(100vh - var(--bar-h) - 56px); min-height: 480px; border-radius:var(--r-card); overflow: hidden; display: flex; }
        .tutor-page-panel :global(.cordia-tutor) { flex: 1; min-width: 0; }
        @media (max-width: 767px) { .tutor-page-panel { height: calc(100vh - 56px - var(--tabbar-h) - 120px); } }
      `}</style>
    </div>
  );
}
