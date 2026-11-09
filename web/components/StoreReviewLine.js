import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { X } from 'lucide-react';
import { getToken } from '../lib/api';
import { extensionReady } from '../lib/extensionBridge';
import { FOCUS_ROUTES } from '../lib/featureReleases';
import { getProgress, updateProgress } from '../lib/progress';
import { STORE_LINE, STORE_REVIEWS_URL, storeLineDue } from '../lib/storeReview.mjs';

// After "Enjoying Cordia?" is answered, whatever the rating: one dismissible line asking students
// who use the extension for a Chrome Web Store review. It looks the same for every rating, offers
// nothing in return, and shows at most once per account (lib/storeReview.mjs).
export default function StoreReviewLine({ sessionFinished = false }) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const due = storeLineDue({
      answered: true,
      shownAt: getProgress().storeLine,
      extensionInstalled: extensionReady(),
      signedIn: Boolean(getToken()),
      onFocusScreen: FOCUS_ROUTES.includes(router.pathname),
      sessionFinished,
    });
    if (!due) return;
    updateProgress(() => ({ storeLine: Date.now() }));
    setShow(true);
  }, []);

  if (!show) return null;
  return (
    <p className="store-line" role="note">
      <a href={STORE_REVIEWS_URL} target="_blank" rel="noreferrer">{STORE_LINE}</a>
      <button type="button" className="c-icon-btn store-line-close" onClick={() => setShow(false)} aria-label="Dismiss">
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <style jsx>{`
        .store-line { display: flex; align-items: center; gap: 4px; width: 100%; margin: 4px 0 0; padding: 8px 4px 0 12px; border-top: 1px solid var(--hairline); text-align: left; font: 500 var(--fs-13)/1.4 var(--font-sans); }
        .store-line a { flex: 1; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        .store-line-close { flex: none; }
      `}</style>
    </p>
  );
}
