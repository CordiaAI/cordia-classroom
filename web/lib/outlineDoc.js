// A guide's Outline as an editable page. The text format is the one lib/formatters.js
// parseStudyNotes reads and lib/server/guideNotes.mjs writes:
//   > overview            -> <p class="oe-overview">
//   ## Heading            -> <h2>
//   - point               -> <li>
//     - detail            -> nested <li>
// with **bold** for key terms. Anything else a student types (a plain line) is saved as a point.

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inlineHtml = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function outlineToHtml(text) {
  const html = [];
  let list = null; // { items: [{ text, sub: [] }] }
  const closeList = () => {
    if (!list) return;
    html.push(`<ul>${list.items.map(item => `<li>${inlineHtml(item.text)}${item.sub.length ? `<ul>${item.sub.map(sub => `<li>${inlineHtml(sub)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`);
    list = null;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('> ')) { closeList(); html.push(`<p class="oe-overview">${inlineHtml(line.slice(2).trim())}</p>`); }
    else if (line.startsWith('## ')) { closeList(); html.push(`<h2>${inlineHtml(line.slice(3).trim())}</h2>`); }
    else {
      const point = line.startsWith('- ') ? line.slice(2).trim() : line;
      list = list || { items: [] };
      const last = list.items[list.items.length - 1];
      if (/^(\s{2,}|\t)- /.test(raw) && last) last.sub.push(point);
      else list.items.push({ text: point, sub: [] });
    }
  }
  closeList();
  return html.join('');
}

// Blocks -> outline text. A block is { kind: 'overview' | 'heading' | 'point' | 'detail', text }.
export function blocksToOutline(blocks) {
  const lines = [];
  for (const block of blocks) {
    const text = String(block.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (block.kind === 'overview') lines.push(`> ${text}`);
    else if (block.kind === 'heading') lines.push(`## ${text}`);
    else if (block.kind === 'detail') lines.push(`  - ${text}`);
    else lines.push(`- ${text}`);
  }
  return lines.join('\n');
}

// The text of one element with <strong>/<b> written back as **bold**, leaving out nested lists.
function inlineText(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += child.nodeValue;
    else if (child.nodeType === 1) {
      const tag = child.tagName;
      if (tag === 'UL' || tag === 'OL') continue;
      if (tag === 'BR') { out += ' '; continue; }
      const inner = inlineText(child);
      out += (tag === 'STRONG' || tag === 'B') && inner.trim() ? `**${inner.trim()}**` : inner;
    }
  }
  return out;
}

// What an edited page (or an old note's HTML) says, as blocks. Images and figures are skipped.
export function blocksFromDom(root) {
  const blocks = [];
  const listItems = (list, depth) => {
    for (const item of list.children) {
      if (item.tagName !== 'LI') continue;
      blocks.push({ kind: depth ? 'detail' : 'point', text: inlineText(item) });
      for (const nested of item.children) if (nested.tagName === 'UL' || nested.tagName === 'OL') listItems(nested, depth + 1);
    }
  };
  for (const node of root.childNodes) {
    if (node.nodeType === 3) { blocks.push({ kind: 'point', text: node.nodeValue }); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (tag === 'UL' || tag === 'OL') listItems(node, 0);
    else if (/^H[1-6]$/.test(tag)) blocks.push({ kind: 'heading', text: inlineText(node) });
    else if (tag === 'P' && node.classList?.contains('oe-overview')) blocks.push({ kind: 'overview', text: inlineText(node) });
    else if (tag === 'FIGURE' || tag === 'IMG') continue;
    else if (tag === 'DIV' && node.querySelector?.('ul,ol,h1,h2,h3,p')) blocks.push(...blocksFromDom(node));
    else blocks.push({ kind: 'point', text: inlineText(node) });
  }
  return blocks;
}

export const domToOutline = root => blocksToOutline(blocksFromDom(root));
