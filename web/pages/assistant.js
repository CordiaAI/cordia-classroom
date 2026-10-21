import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import AssistantSettings from '../components/assistant/AssistantSettings';

// Cordia Assistant, Cordia's texting assistant: its own place in the nav. Everything on it
// loads from /assistant/api/* (the Assistant app, forwarded in next.config.js).
export default function AssistantPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  if (!ready) return null;
  return (
    <div className="c-page assistant-page">
      <header className="c-page-head"><h1 className="c-title">Assistant</h1></header>
      <AssistantSettings onOpenPlan={() => router.push('/settings?section=plan')} />
    </div>
  );
}
