// The small Markdown subset guide bodies are written in (lib/guides/*.mjs), parsed into plain
// blocks that components/GuideArticle.js renders as React elements (never as HTML strings):
//   ## Question heading     a paragraph (blank line between blocks)     - bullet item
//   | table | header |      [link text](/path or https://…)             **bold**
// HTML comments (<!-- … -->, on lines of their own) are editor notes: they stay in the source and
// never reach the page.

// Lines with HTML comments removed. Scanned with indexOf, not a regex: a comment may span lines.
function withoutComments(text) {
  const kept = [];
  let open = false;
  for (const line of text.split('\n')) {
    let rest = line;
    let out = '';
    while (rest) {
      if (open) {
        const end = rest.indexOf('-->');
        if (end === -1) { rest = ''; break; }
        rest = rest.slice(end + 3);
        open = false;
      } else {
        const start = rest.indexOf('<!--');
        if (start === -1) { out += rest; rest = ''; break; }
        out += rest.slice(0, start);
        rest = rest.slice(start + 4);
        open = true;
      }
    }
    // A line that was only a comment disappears instead of leaving a blank that splits a paragraph.
    if (out.trim() || line.trim() === '') kept.push(out);
  }
  return kept;
}

// The editor notes themselves (for tests and the PR's "comment spots" list).
export function editorNotes(text) {
  const notes = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('<!--', from);
    if (start === -1) return notes;
    const end = text.indexOf('-->', start + 4);
    if (end === -1) return notes;
    notes.push(text.slice(start + 4, end).trim());
    from = end + 3;
  }
}

// Inline text: [label](href) links and **bold**, as {text} / {bold} / {link, href} parts.
export function inline(text) {
  const parts = [];
  let rest = text;
  while (rest) {
    const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    const bold = /\*\*([^*]+)\*\*/.exec(rest);
    const next = [link, bold].filter(Boolean).sort((a, b) => a.index - b.index)[0];
    if (!next) { parts.push({ text: rest }); break; }
    if (next.index) parts.push({ text: rest.slice(0, next.index) });
    parts.push(next === link ? { link: next[1], href: next[2] } : { bold: next[1] });
    rest = rest.slice(next.index + next[0].length);
  }
  return parts;
}

const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

// Blocks: {type: 'h2', text}, {type: 'p', text}, {type: 'ul', items}, {type: 'table', head, rows}.
export function parseGuide(text) {
  const blocks = [];
  const lines = withoutComments(text);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index++; continue; }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      index++;
    } else if (line.startsWith('- ')) {
      const items = [];
      while (index < lines.length && lines[index].trim().startsWith('- ')) items.push(lines[index++].trim().slice(2).trim());
      blocks.push({ type: 'ul', items });
    } else if (line.startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(cells(lines[index++]));
      const [head, divider, ...body] = rows;
      if (!divider || !divider.every(cell => /^:?-{3,}:?$/.test(cell))) throw new Error(`Table needs a | --- | row under its header: ${line}`);
      blocks.push({ type: 'table', head, rows: body });
    } else {
      const words = [];
      while (index < lines.length && lines[index].trim() && !/^(## |- |\|)/.test(lines[index].trim())) words.push(lines[index++].trim());
      blocks.push({ type: 'p', text: words.join(' ') });
    }
  }
  return blocks;
}

// Plain words a reader sees (headings, paragraphs, list items and table cells), for word counts.
export function guideWords(text) {
  const plain = parseGuide(text).flatMap(block => block.type === 'table' ? [...block.head, ...block.rows.flat()] : block.type === 'ul' ? block.items : [block.text]);
  return plain.join(' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
}
