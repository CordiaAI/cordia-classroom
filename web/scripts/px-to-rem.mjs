#!/usr/bin/env node
// Text size (T10, DESIGN-SPEC 3.5): converts font sizes written in px to rem (N/16), so <html data-size> scales
// every text size, not only the ones already in rem. At the default root size (16px) every computed size is the
// same as before.
//
// What it converts, and nothing else:
//   - `font-size: Npx` (also inside clamp(), calc(), min() and max())
//   - the size and a px line height in a `font:` shorthand (`font: 600 15px/20px var(--font-sans)`)
//   - `line-height: Npx` (a px line height would clip text once the size grows)
// It never touches widths, paddings, radii, borders or anything else, and it skips:
//   - `font-size: 16px !important` on fields: iOS zooms into any field under 16px, so that one stays px
//   - JavaScript outside styled-jsx blocks (canvas `ctx.font` strings, inline style objects)
//
// Where: web/styles/*.css and every <style jsx> block in web/components and web/pages.
// Usage: node web/scripts/px-to-rem.mjs [--write]   (without --write it only reports)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const write = process.argv.includes('--write');

const rem = px => {
  const value = Number(px) / 16;
  return `${Number(value.toFixed(5))}rem`;
};
const pxToRem = text => text.replace(/(-?\d*\.?\d+)px\b/g, (_, n) => (Number(n) === 0 ? '0' : rem(n)));

// One declaration value: font-size, line-height or the font shorthand.
const DECLARATION = /(^|[\s{;(])(font-size|line-height|font)(\s*:\s*)([^;{}]*?)(\s*(?:;|}|$))/gm;

function convertCss(css) {
  let count = 0;
  const out = css.replace(DECLARATION, (whole, lead, prop, colon, value, end) => {
    if (!/\dpx\b/.test(value)) return whole;
    // Fields keep 16px so iOS never zooms into them.
    if (prop === 'font-size' && /^16px\s*!important$/.test(value.trim())) return whole;
    // ${...} interpolations in styled-jsx stay as they are.
    if (value.includes('${')) return whole;
    let next = value;
    if (prop === 'font') {
      // Only the size (and the line height after a slash) are lengths in the shorthand; a family name never ends in px.
      next = value.replace(/(-?\d*\.?\d+)px(\s*\/\s*(-?\d*\.?\d+)px)?/g, (_, size, slash, line) => (slash ? `${rem(size)}/${rem(line)}` : rem(size)));
    } else {
      next = pxToRem(value);
    }
    if (next === value) return whole;
    count += 1;
    return `${lead}${prop}${colon}${next}${end}`;
  });
  return { out, count };
}

// styled-jsx: only the template inside <style jsx> ... </style>.
function convertJs(source) {
  let count = 0;
  const out = source.replace(/(<style jsx(?: global)?>\{`)([\s\S]*?)(`\}<\/style>)/g, (whole, open, css, close) => {
    const result = convertCss(css);
    count += result.count;
    return open + result.out + close;
  });
  return { out, count };
}

function files(dir, test) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...files(path, test));
    else if (test(path)) found.push(path);
  }
  return found;
}

const targets = [
  ...files(join(WEB, 'styles'), path => path.endsWith('.css')),
  ...files(join(WEB, 'components'), path => path.endsWith('.js')),
  ...files(join(WEB, 'pages'), path => path.endsWith('.js')),
];

let total = 0;
for (const path of targets) {
  const source = readFileSync(path, 'utf8');
  const { out, count } = path.endsWith('.css') ? convertCss(source) : convertJs(source);
  if (!count) continue;
  total += count;
  console.log(`${String(count).padStart(4)}  ${relative(WEB, path)}`);
  if (write) writeFileSync(path, out);
}
console.log(`${total} declarations ${write ? 'converted' : 'to convert (dry run; pass --write)'}`);
