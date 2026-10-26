// The lecture outline's Markdown as safe HTML, shared by the server (the lecture's note) and the
// lecture page. No HTML from the model gets through: every line is escaped.
const escapeHtml = text => String(text || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const inline = text => escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// The outline's Markdown as note HTML: #..#### headings, nested * / - bullets and 1. lists
// (nesting by indent), other lines as paragraphs. Everything is escaped. headingShift moves every
// heading down (1: # becomes <h2>), for a page that already has its own <h1>.
export function outlineHtml(markdown, { headingShift = 0 } = {}) {
  const out = [];
  const stack = []; // open lists: { tag, indent }
  const closeTo = indent => {
    while (stack.length && stack[stack.length - 1].indent >= indent) out.push(`</li></${stack.pop().tag}>`);
  };
  for (const raw of String(markdown || '').replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, '    ').length;
    const line = raw.trim();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^(?:([*\-•])|(\d+)[.)])\s+(.*)$/);
    if (heading) {
      closeTo(-1);
      const level = Math.min(6, Math.min(4, heading[1].length) + headingShift);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      const tag = item[1] ? 'ul' : 'ol';
      const top = stack[stack.length - 1];
      if (top && indent > top.indent) {
        out.push(`<${tag}><li>`);
        stack.push({ tag, indent });
      } else {
        closeTo(indent + 1);
        const same = stack[stack.length - 1];
        if (same && same.indent === indent && same.tag === tag) out.push('</li><li>');
        else {
          if (same && same.indent === indent) out.push(`</li></${stack.pop().tag}>`);
          out.push(`<${tag}><li>`);
          stack.push({ tag, indent });
        }
      }
      out.push(inline(item[3]));
    } else {
      closeTo(-1);
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeTo(-1);
  return out.join('');
}

