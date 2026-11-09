// The Markdown a comparison page is written in (web/content/<slug>.md), parsed on the server by
// the page's getStaticProps into plain blocks that components/ComparisonArticle.js renders as React
// (never as HTML strings). Inline links and **bold** use lib/guides/markdown.mjs inline().
//   front matter between --- lines (ignored)   # H1   ## section   ### FAQ question
//   paragraphs   - bullet   1. numbered step (indented lines continue it; ![alt](src) is an image)
//   | table | rows |
// Under "## Frequently asked questions", each ### question's first paragraph is its answer, word
// for word, so the FAQPage JSON-LD can be checked against it; a list there renders below the FAQ.

const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
export const FAQ_HEADING = 'Frequently asked questions';

function withoutFrontMatter(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return lines;
  const end = lines.indexOf('---', 1);
  return end === -1 ? lines : lines.slice(end + 1);
}

// [{type: 'h1'|'h2'|'h3'|'p', text}, {type: 'ul', items}, {type: 'ol', items: [{text, images}]},
//  {type: 'table', head, rows}]
export function parseBlocks(text) {
  const lines = withoutFrontMatter(text);
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index++; continue; }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: `h${heading[1].length}`, text: heading[2].trim() });
      index++;
    } else if (line.startsWith('- ')) {
      const items = [];
      while (index < lines.length && lines[index].trim().startsWith('- ')) items.push(lines[index++].trim().slice(2).trim());
      blocks.push({ type: 'ul', items });
    } else if (/^\d+\. /.test(line)) {
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        if (/^\d+\. /.test(current.trim())) {
          items.push({ text: current.trim().replace(/^\d+\. /, ''), images: [] });
          index++;
        } else if (!current.trim() && (/^\s+\S/.test(lines[index + 1] || '') || /^\d+\. /.test(lines[index + 1] || ''))) {
          index++;
        } else if (/^\s+\S/.test(current) && items.length) {
          const image = IMAGE.exec(current.trim());
          const item = items[items.length - 1];
          if (image) item.images.push({ alt: image[1], src: image[2] });
          else item.text = `${item.text} ${current.trim()}`;
          index++;
        } else break;
      }
      blocks.push({ type: 'ol', items });
    } else if (line.startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(cells(lines[index++]));
      const [head, , ...body] = rows; // the second row is the |---| separator
      blocks.push({ type: 'table', head, rows: body });
    } else {
      const words = [];
      while (index < lines.length && lines[index].trim() && !/^(#{1,3} |- |\d+\. |\|)/.test(lines[index].trim())) words.push(lines[index++].trim());
      blocks.push({ type: 'p', text: words.join(' ') });
    }
  }
  return blocks;
}

// The page in parts: the H1, everything before the FAQ, the FAQ items (question and answer), what
// sits below the FAQ list (links), and everything after the FAQ section.
export function parseComparison(text) {
  const blocks = parseBlocks(text);
  const h1 = blocks.find(block => block.type === 'h1')?.text || '';
  const body = blocks.filter(block => block.type !== 'h1');
  const start = body.findIndex(block => block.type === 'h2' && block.text === FAQ_HEADING);
  if (start === -1) return { h1, before: body, faq: [], faqAfter: [], after: [] };
  const end = body.findIndex((block, i) => i > start && block.type === 'h2');
  const section = body.slice(start + 1, end === -1 ? body.length : end);
  const faq = [];
  const faqAfter = [];
  section.forEach((block, i) => {
    if (block.type === 'h3') faq.push({ question: block.text, answer: section[i + 1]?.type === 'p' ? section[i + 1].text : '' });
    else if (!(block.type === 'p' && section[i - 1]?.type === 'h3')) faqAfter.push(block);
  });
  return { h1, before: body.slice(0, start), faq, faqAfter, after: end === -1 ? [] : body.slice(end) };
}
