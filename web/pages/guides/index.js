import Link from 'next/link';
import PublicPage from '../../components/PublicPage';
import { PUBLISHED_GUIDES, guidePath } from '../../lib/guides/index.mjs';

// /guides: the published guides, newest first. Until one is published it says so, and the page
// list (lib/publicPages.mjs) keeps it noindex. Drafts are never listed, even on previews.
export default function Guides() {
  const guides = [...PUBLISHED_GUIDES].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  return (
    <PublicPage path="/guides">
      <div className="guides">
        <h1>Guides</h1>
        <p className="guides-lede">How to study for college exams with your own course material: planning, recall, spaced review and AI help you can check.</p>
        {guides.length
          ? <ul className="guides-list">{guides.map(guide => (
            <li key={guide.slug}>
              <Link href={guidePath(guide)} className="guides-link">{guide.title}</Link>
              <p>{guide.description}</p>
            </li>
          ))}</ul>
          : <p className="guides-soon">Guides are coming soon.</p>}
      </div>
      <style jsx>{`
        .guides { width: min(var(--page-max), 100%); margin: 0 auto; color: var(--ink); }
        .guides-lede { max-width: 42em; margin: 16px 0 0; color: var(--text-secondary); font: 500 var(--fs-17)/1.55 var(--font-sans); }
        .guides-soon { margin: 32px 0 0; color: var(--muted); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .guides-list { display: grid; gap: 24px; max-width: 46em; margin: 32px 0 0; padding: 0; list-style: none; }
        .guides-list :global(.guides-link) { color: var(--ink); font: 600 var(--fs-17)/1.4 var(--font-sans); }
        .guides-list p { margin: 4px 0 0; color: var(--text-secondary); font: 500 var(--fs-15)/1.6 var(--font-sans); }
      `}</style>
    </PublicPage>
  );
}
