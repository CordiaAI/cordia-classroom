import BodyPortal from './BodyPortal';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch } from '../lib/api';

// Asked once per class, the first time a guide goes into it. Nothing preselected.
export default function ShareSheet({ classId, code, guideId, onDone }) {
  const [busy, setBusy] = useState(false);

  async function choose(share) {
    setBusy(true);
    const data = await apiFetch(`/classes/${classId}/share-default`, { method: 'POST', body: JSON.stringify({ share, guide_id: guideId }) });
    setBusy(false);
    onDone({ share, status: data?.status || null, visibility: data?.visibility || null });
  }

  return (
    <BodyPortal>
    <div className="c-scrim">
      <section className="c-sheet share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title" className="share-title">Share with {code}?</h2>
        <div className="share-actions">
          <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => choose(true)}>Share</button>
          <button type="button" className="c-btn c-btn--secondary" disabled={busy} onClick={() => choose(false)}>Keep private</button>
        </div>
        <Link href="/honor-code" className="share-honor" target="_blank">Honor code</Link>
        <style jsx global>{`
          .share-sheet { width: min(400px, 100%); display: grid; gap: 20px; justify-items: center; text-align: center; }
          .share-title { margin: 0; font: 500 28px/1.15 var(--font-display); }
          .share-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
          .share-honor { font: 600 13px/1 var(--font-sans); color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        `}</style>
      </section>
    </div>
    </BodyPortal>
  );
}
