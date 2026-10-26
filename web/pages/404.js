import Link from 'next/link';
import { BookOpen, House, Search } from 'lucide-react';

// An unknown address: say so in the app's own type, and offer a way back (Next's default 404 was
// a bare line in a different font with no links).
export default function NotFound() {
  function openSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
  }
  return (
    <div className="c-page c-empty not-found">
      <p className="c-meta not-found-code">404</p>
      <h1 className="c-title">This page isn’t here</h1>
      <p className="c-meta not-found-why">The link may be old, or the page was moved or deleted.</p>
      <div className="c-row c-row--wrap not-found-actions">
        <Link href="/dashboard" className="c-btn c-btn--primary"><House size={20} strokeWidth={1.75} aria-hidden="true" />Dashboard</Link>
        <Link href="/library" className="c-btn c-btn--secondary"><BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />Library</Link>
        <button type="button" className="c-btn c-btn--quiet" onClick={openSearch}><Search size={20} strokeWidth={1.75} aria-hidden="true" />Search</button>
      </div>
      <style jsx>{`
        .not-found { min-height: 50vh; align-content: center; }
        .not-found-code { margin: 0; font: 600 15px/1 var(--font-sans); letter-spacing: 0.08em; }
        .not-found-why { margin: 0; font-size: 16px; }
        .not-found-actions { justify-content: center; }
      `}</style>
    </div>
  );
}
