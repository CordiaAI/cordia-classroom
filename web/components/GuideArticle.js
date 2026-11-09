import Link from 'next/link';
import PublicPage from './PublicPage';
import { inline } from '../lib/guides/markdown.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-11-09" -> "November 9, 2026", the same on the server and in every browser.
const longDate = iso => { const [year, month, day] = iso.split('-').map(Number); return `${MONTHS[month - 1]} ${day}, ${year}`; };

// Inline parts from lib/guides/markdown.mjs as React: site links through next/link, outside
// links in a new tab. Text is always a text node, never HTML.
function Inline({ text }) {
  return inline(text).map((part, index) => {
    if (part.bold) return <strong key={index}>{part.bold}</strong>;
    if (!part.link) return part.text;
    return part.href.startsWith('/')
      ? <Link key={index} href={part.href}>{part.link}</Link>
      : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.link}</a>;
  });
}

function Block({ block }) {
  if (block.type === 'h2') return <h2>{block.text}</h2>;
  if (block.type === 'ul') return <ul>{block.items.map(item => <li key={item}><Inline text={item} /></li>)}</ul>;
  if (block.type === 'table') {
    return (
      <div className="ga-table-wrap">
        <table>
          <thead><tr>{block.head.map(cell => <th key={cell} scope="col"><Inline text={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map(row => <tr key={row.join('|')}>{row.map((cell, index) => (index ? <td key={index}><Inline text={cell} /></td> : <th key={index} scope="row"><Inline text={cell} /></th>))}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <p><Inline text={block.text} /></p>;
}

// One guide (`blocks` from lib/guides/markdown.mjs parseGuide), in a fixed order: breadcrumb, H1, byline, last updated, the answer-first opening
// (the body's paragraphs before its first heading), question sections, Sources, then related
// links. `related` is resolved by the page (pages/guides/[slug].js) so drafts never link to
// guides a production visitor can't open. Published guides get their head and Article markup
// from lib/publicPages.mjs; a draft passes its own and shows a banner.
export default function GuideArticle({ guide, blocks, author, path, related }) {
  const firstHeading = blocks.findIndex(block => block.type === 'h2');
  const opening = blocks.slice(0, firstHeading === -1 ? blocks.length : firstHeading);
  const rest = firstHeading === -1 ? [] : blocks.slice(firstHeading);
  const article = guide.draft ? { headline: guide.title, author, published: guide.datePublished, modified: guide.dateModified, crumb: guide.crumb } : null;
  return (
    <PublicPage path={path} title={`${guide.topic} | Cordia Classroom`} description={guide.description} article={article}>
      <article className="ga">
        {guide.draft && <p className="ga-draft" role="note">Draft: only visible in development and on preview deployments.</p>}
        <nav aria-label="Breadcrumb" className="ga-crumbs">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/guides">Guides</Link></li>
            <li aria-current="page">{guide.crumb}</li>
          </ol>
        </nav>

        <h1 className="ga-title">{guide.title}</h1>
        <p className="ga-byline">By <span className="ga-author">{author.name}</span> · {author.role}</p>
        <p className="ga-updated">Last updated <time dateTime={guide.dateModified}>{longDate(guide.dateModified)}</time></p>

        <div className="ga-lede">{opening.map((block, index) => <Block key={index} block={block} />)}</div>
        <div className="ga-body">{rest.map((block, index) => <Block key={index} block={block} />)}</div>

        <section className="ga-sources" aria-labelledby="ga-sources">
          <h2 id="ga-sources">Sources</h2>
          <ol>{guide.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ol>
        </section>

        {related.length > 0 && (
          <nav className="ga-related" aria-label="Related">
            <h2>Related</h2>
            <ul>{related.map(item => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
          </nav>
        )}
      </article>
      <style jsx>{`
        .ga { width: min(var(--page-max), 100%); margin: 0 auto; color: var(--ink); }
        .ga-draft { margin: 0 0 16px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--lg-card); color: var(--ink); font: 600 var(--fs-13)/1.5 var(--font-sans); }
        .ga-crumbs ol { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .ga-crumbs li + li::before { content: '›'; margin-right: 8px; color: var(--muted); }
        .ga-crumbs :global(a) { color: var(--muted); }
        .ga-title { margin: 0; max-width: 22em; }
        .ga-byline { margin: 16px 0 0; color: var(--text-secondary); font: 500 var(--fs-15)/1.5 var(--font-sans); }
        .ga-author { color: var(--ink); font-weight: 600; }
        .ga-updated { margin: 4px 0 0; color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .ga-lede { max-width: 42em; margin-top: 24px; }
        .ga-lede :global(p) { margin: 0 0 12px; color: var(--ink); font: 500 var(--fs-17)/1.55 var(--font-sans); }
        .ga-body, .ga-sources, .ga-related { max-width: 46em; }
        .ga-body :global(h2), .ga-sources h2, .ga-related h2 { margin: 40px 0 0; }
        .ga-body :global(p), .ga-body :global(li), .ga-sources li, .ga-related li { color: var(--text-secondary); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .ga-body :global(p) { margin: 12px 0 0; }
        .ga-body :global(ul), .ga-sources ol, .ga-related ul { display: grid; gap: 8px; margin: 12px 0 0; padding-left: 20px; }
        .ga-body :global(strong) { color: var(--ink); }
        .ga-body :global(.ga-table-wrap) { margin-top: 16px; overflow-x: auto; }
        .ga-body :global(table) { width: 100%; border-collapse: collapse; font: 500 var(--fs-15)/1.5 var(--font-sans); }
        .ga-body :global(th), .ga-body :global(td) { padding: 10px 12px; border-bottom: 1px solid var(--hairline); text-align: left; vertical-align: top; color: var(--text-secondary); }
        .ga-body :global(thead th) { color: var(--ink); font-weight: 600; border-bottom: 1px solid var(--line); }
        .ga-body :global(tbody th) { color: var(--ink); font-weight: 600; white-space: nowrap; }
        .ga-sources { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--hairline); }
      `}</style>
    </PublicPage>
  );
}
