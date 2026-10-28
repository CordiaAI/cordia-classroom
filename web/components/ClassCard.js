import { useEffect, useState } from 'react';
import Link from 'next/link';
import Menu from './Menu';
import CordiaLoader from './CordiaLoader';
import { classLabel } from '../lib/classLabel';
import { currentTheme } from './MermaidDiagram';

// A class in Library's card view: its Napkin cover (or its course code until there is one),
// name, and how much is in it. The whole card opens the class; the menu holds the rest.
export default function ClassCard({ name, href, count, cover, drawing = false, menuItems, dropProps = {}, isDrop = false }) {
  const { title, code } = classLabel(name);
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    setTheme(currentTheme());
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  // A cover drawn in the other theme is recoloured, so it never glares on a dark page.
  const inverted = cover?.theme && cover.theme !== theme;
  const mark = (code || title).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => (code ? word : word[0])).join(' ').toUpperCase();
  const body = (
    <>
      <span className="cc-cover" aria-hidden={cover?.url ? undefined : 'true'}>
        {cover?.url ? <img className={'cc-image' + (inverted ? ' is-inverted' : '')} src={cover.url} alt={cover.alt || ''} loading="lazy" />
          : drawing ? <span className="cc-drawing"><CordiaLoader label="Drawing cover" /></span>
          : <span className="cc-mark">{mark}</span>}
      </span>
      <span className="cc-body">
        {code && code !== title && <span className="cc-code">{code}</span>}
        <span className="cc-title">{title}</span>
        <span className={'cc-count' + (count ? '' : ' is-empty')}>{count ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}</span>
      </span>
    </>
  );
  return (
    <article className={'c-card cc' + (isDrop ? ' is-drop' : '')} {...dropProps} aria-label={name}>
      {href ? <Link href={href} className="cc-link">{body}</Link> : <div className="cc-link">{body}</div>}
      {menuItems?.length > 0 && <div className="cc-menu"><Menu label={`More for ${name}`} items={menuItems} /></div>}
      <style jsx global>{`
        .cc { position: relative; display: block; padding: 0; overflow: hidden; }
        .cc.is-drop { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .cc-link { display: grid; color: var(--ink); text-decoration: none; }
        .cc-link:hover { text-decoration: none; }
        .cc-link:focus-visible { outline: 2px solid var(--olive); outline-offset: -2px; border-radius: inherit; }
        .cc-cover { display: grid; place-items: center; aspect-ratio: 16 / 10; padding: 14px; background: var(--draw-paper); border-bottom: 1px solid var(--hairline); overflow: hidden; }
        .cc-image { display: block; max-width: 100%; max-height: 100%; object-fit: contain; transition: transform var(--dur) var(--ease); }
        .cc-image.is-inverted { filter: invert(1) hue-rotate(180deg); }
        .cc-link:hover .cc-image { transform: scale(1.03); }
        .cc-mark { max-width: 100%; color: var(--olive-ink); font: 500 30px/1.05 'Newsreader', Georgia, serif; letter-spacing: -0.01em; text-align: center; overflow-wrap: anywhere; opacity: .8; }
        .cc-drawing { display: grid; place-items: center; }
        .cc-body { display: grid; gap: 4px; padding: 14px 16px 16px; min-width: 0; }
        .cc-code { color: var(--muted); font: 600 13px/1.2 var(--font-sans); letter-spacing: .02em; }
        .cc-title { font: 600 17px/1.25 var(--font-sans); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .cc-count { justify-self: start; margin-top: 4px; display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .cc-count.is-empty { padding: 0; background: transparent; color: var(--muted); font-weight: 500; }
        .cc-menu { position: absolute; top: 8px; right: 8px; border-radius: 999px; background: var(--surface-raised); }
        @media (max-width: 767px) {
          .cc-body { padding: 10px 12px 12px; }
          .cc-title { font-size: 15px; }
          .cc-mark { font-size: 21px; }
          .cc-cover { padding: 10px 40px 10px 10px; }
        }
      `}</style>
    </article>
  );
}
