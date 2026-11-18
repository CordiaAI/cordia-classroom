import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { MessageCircle } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';

// The Tutor, one tap away on every page: a glass bubble in the bottom-right corner.
// Wide screens open it beside the page; phones open the full Tutor page.
// ownedBy: pages that show the Tutor themselves besides the Tutor page and the home (the new shell's
// class page, whose composer is the Tutor there: components/Sidebar.js passes it).
export default function TutorBubble({ ownedBy = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onVisibility = event => setOpen(Boolean(event.detail?.open));
    window.addEventListener('cordia:tutor-visibility', onVisibility);
    return () => window.removeEventListener('cordia:tutor-visibility', onVisibility);
  }, []);

  // The Tutor page and the chat home show the Tutor themselves.
  if (router.pathname === '/tutor' || router.pathname === '/home' || ownedBy.includes(router.pathname) || open) return null;

  function show() {
    walkthroughEvent('ask');
    if (window.matchMedia('(max-width: 767px)').matches) router.push('/tutor');
    else window.dispatchEvent(new Event('cordia:tutor-toggle'));
  }

  return (
    <button type="button" className="c-tutor-bubble" onClick={show} aria-label="Open Tutor" aria-controls="cordia-tutor-drawer" data-spot="nav-tutor">
      <MessageCircle size={24} strokeWidth={1.75} aria-hidden="true" />
      <span className="c-tutor-bubble-label">Tutor</span>
    </button>
  );
}
