import Link from 'next/link';
import Menu from './Menu';
import CoverArt from './CoverArt';
import { classLabel } from '../lib/classLabel';
import { coverFor } from '../lib/coverDesign.mjs';

// A class in Library's card view: its cover (colour and subject icons), name, and how much is in
// it. The whole card opens the class; the menu holds the rest.
export default function ClassCard({ folder, name, href, count, titles = [], menuItems, dropProps = {}, isDrop = false }) {
  const { title, code } = classLabel(name);
  const cover = coverFor(folder || { name }, titles);
  const body = (
    <>
      <span className="cc-cover"><CoverArt color={cover.color} icons={cover.icons} /></span>
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
        .cc-cover { position: relative; display: block; aspect-ratio: 16 / 9; }
        .cc-body { display: grid; gap: 4px; padding: 14px 16px 16px; min-width: 0; }
        .cc-code { color: var(--muted); font: 600 13px/1.2 var(--font-sans); letter-spacing: .02em; }
        .cc-title { font: 600 17px/1.25 var(--font-sans); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .cc-count { justify-self: start; margin-top: 4px; display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .cc-count.is-empty { padding: 0; background: transparent; color: var(--muted); font-weight: 500; }
        .cc-menu { position: absolute; top: 8px; right: 8px; z-index: 2; border-radius: 999px; background: var(--surface-raised); }
        @media (max-width: 767px) {
          .cc-body { padding: 10px 12px 12px; }
          .cc-title { font-size: 15px; }
        }
      `}</style>
    </article>
  );
}
