// Compare two layout captures (tests/qa/layout-capture.cjs): every element that exists in both
// is matched by tag/class/text in order, and any move or resize over 2px is reported.
//   node tests/qa/layout-compare.cjs <baseline-dir> <after-dir> [--all]
const fs = require('fs');
const path = require('path');

const [baseDir, afterDir] = process.argv.slice(2);
const showAll = process.argv.includes('--all');
const base = JSON.parse(fs.readFileSync(path.join(baseDir, 'layout.json'), 'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(afterDir, 'layout.json'), 'utf8'));
const TOLERANCE = 2;

let pagesChanged = 0;
for (const name of Object.keys(base)) {
  const a = base[name];
  const b = after[name];
  if (!b) { console.log(`MISSING ${name}`); continue; }
  // Match in order: each baseline element takes the next unused element with the same key and text.
  const used = new Set();
  const byId = new Map();
  b.items.forEach((item, index) => {
    const id = `${item.key}|${item.text}`;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(index);
  });
  const moved = [];
  let unmatched = 0;
  for (const item of a.items) {
    const list = byId.get(`${item.key}|${item.text}`) || [];
    const index = list.find(i => !used.has(i));
    if (index === undefined) { unmatched += 1; continue; }
    used.add(index);
    const other = b.items[index];
    const delta = Math.max(Math.abs(other.x - item.x), Math.abs(other.y - item.y), Math.abs(other.w - item.w), Math.abs(other.h - item.h));
    if (delta > TOLERANCE) moved.push({ item, other, delta });
  }
  const added = b.items.length - used.size;
  const heightDelta = b.height - a.height;
  if (moved.length || unmatched || added || Math.abs(heightDelta) > TOLERANCE || showAll) {
    pagesChanged += 1;
    console.log(`\n${name}: ${moved.length} moved/resized, ${unmatched} gone, ${added} new, page height ${heightDelta >= 0 ? '+' : ''}${heightDelta}px`);
    moved.slice(0, 8).forEach(({ item, other }) => console.log(`   ${item.key} "${item.text}" ${item.x},${item.y} ${item.w}x${item.h} -> ${other.x},${other.y} ${other.w}x${other.h}`));
  }
}
console.log(`\n${pagesChanged} of ${Object.keys(base).length} screens differ.`);
