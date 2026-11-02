// Markdown (a note a connected app saves) as a guide's outline text, the form the Outline page
// edits (lib/outlineDoc.js): "> overview", "## Heading", "- point", "  - detail", **bold**.
// Headings become sections (deeper ones bold points), list items points, nested items details, and
// every other line a point. The Outline page escapes everything it shows, so text stays text.

const inline = text => String(text)
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
  .replace(/__(.+?)__/g, '**$1**')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

export function markdownToOutline(markdown) {
  const lines = [];
  let fenced = false;
  let started = false;
  for (const raw of String(markdown || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (!raw.trim() || /^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) continue;
    if (fenced) { lines.push(`- ${raw.trim()}`); started = true; continue; }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const text = inline(heading[2]);
      if (!text) continue;
      lines.push(heading[1].length <= 2 ? `## ${text}` : `- **${text.replace(/\*\*/g, '')}**`);
      started = true;
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const text = inline(quote[1]);
      if (text) lines.push(started ? `- ${text}` : `> ${text}`);
      continue;
    }
    const item = raw.match(/^(\s*)(?:[-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    const text = inline(item ? item[2] : raw);
    if (!text) continue;
    const nested = item && item[1].replace(/\t/g, '  ').length >= 2;
    lines.push(nested ? `  - ${text}` : `- ${text}`);
    started = true;
  }
  return lines.join('\n');
}
