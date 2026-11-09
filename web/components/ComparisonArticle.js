import Link from 'next/link';
import PublicPage from './PublicPage';
import Faq from './Faq';
import { inline } from '../lib/guides/markdown.mjs';

// Inline parts (links and **bold**) as React: site links through next/link, outside links in a new
// tab. Text is always a text node, never HTML.
function Inline({ text }) {
  return inline(text).map((part, index) => {
    if (part.bold) return <strong key={index}>{part.bold}</strong>;
    if (!part.link) return part.text;
    return part.href.startsWith('/')
      ? <Link key={index} href={part.href}>{part.link}</Link>
      : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.link}</a>;
  });
}

function Block({ block, images }) {
  if (block.type === 'h2') return <h2>{block.text}</h2>;
  if (block.type === 'h3') return <h3>{block.text}</h3>;
  if (block.type === 'ul') return <ul>{block.items.map(item => <li key={item}><Inline text={item} /></li>)}</ul>;
  if (block.type === 'ol') {
    return (
      <ol className="cmp-steps">
        {block.items.map(item => (
          <li key={item.text}>
            <p><Inline text={item.text} /></p>
            {item.images.map(image => {
              const [width, height] = images[image.src] || [];
              return <img key={image.src} className="cmp-shot" src={image.src} alt={image.alt} width={width} height={height} loading="lazy" decoding="async" />;
            })}
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === 'table') {
    return (
      <div className="cmp-table-wrap">
        <table>
          <thead><tr>{block.head.map(cell => <th key={cell} scope="col"><Inline text={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => (index ? <td key={index}><Inline text={cell} /></td> : <th key={index} scope="row"><Inline text={cell} /></th>))}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <p><Inline text={block.text} /></p>;
}

// A comparison page (lib/comparisons/) from its parsed Markdown (lib/comparisons/markdown.mjs):
// breadcrumb, H1, the body before the FAQ, the FAQ (the same text as the page's FAQPage JSON-LD),
// the links below it, then the rest. The head and JSON-LD come from PublicPage, with `jsonLd`
// read from web/content/ by the page.
export default function ComparisonArticle({ page, path, parts, jsonLd }) {
  const blocks = list => list.map((block, index) => <Block key={index} block={block} images={page.images} />);
  return (
    <PublicPage path={path} jsonLd={jsonLd}>
      <article className="cmp">
        <nav aria-label="Breadcrumb" className="cmp-crumbs">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li aria-current="page">{page.crumb}</li>
          </ol>
        </nav>
        <h1 className="cmp-title">{parts.h1}</h1>
        <div className="cmp-body">
          {blocks(parts.before)}
          <Faq items={parts.faq} />
          {blocks(parts.faqAfter)}
          {blocks(parts.after)}
        </div>
      </article>
      <style jsx>{`
        .cmp { width: min(var(--page-max), 100%); margin: 0 auto; color: var(--ink); }
        .cmp-crumbs ol { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .cmp-crumbs li + li::before { content: '›'; margin-right: 8px; color: var(--muted); }
        .cmp-crumbs :global(a) { color: var(--muted); }
        .cmp-title { margin: 0; max-width: 22em; }
        .cmp-body { max-width: 52em; }
        .cmp-body :global(h2) { margin: 40px 0 0; }
        .cmp-body :global(h3) { margin: 24px 0 0; }
        .cmp-body :global(p), .cmp-body :global(li) { color: var(--text-secondary); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .cmp-body :global(p) { margin: 12px 0 0; }
        .cmp-body :global(ul), .cmp-body :global(ol) { display: grid; gap: 8px; margin: 12px 0 0; padding-left: 20px; }
        .cmp-body :global(strong) { color: var(--ink); }
        .cmp-body :global(.cmp-steps) { gap: 20px; }
        .cmp-body :global(.cmp-steps p) { margin: 0; }
        .cmp-body :global(.cmp-shot) { display: block; width: 100%; height: auto; margin-top: 12px; border: 1px solid var(--hairline); border-radius: 12px; }
        .cmp-body :global(.cmp-table-wrap) { margin-top: 16px; overflow-x: auto; }
        .cmp-body :global(table) { width: 100%; border-collapse: collapse; font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .cmp-body :global(th), .cmp-body :global(td) { padding: 10px 12px; border-bottom: 1px solid var(--hairline); text-align: left; vertical-align: top; color: var(--text-secondary); }
        .cmp-body :global(thead th) { color: var(--ink); font-weight: 600; border-bottom: 1px solid var(--line); }
        .cmp-body :global(tbody th) { color: var(--ink); font-weight: 600; white-space: nowrap; }
        .cmp-body :global(.faq) { margin-top: 40px; }
      `}</style>
    </PublicPage>
  );
}
