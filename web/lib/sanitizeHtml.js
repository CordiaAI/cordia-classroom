// Keeps formatting tags from AI-generated or saved HTML and drops anything that can run
// code (scripts, event handlers, javascript: links, embeds) before it reaches the page.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'mark',
  'span', 'div', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'sub', 'sup', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
]);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select']);

function escapeText(text) {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function clean(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue; }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
    clean(child, doc);
    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const keep = name === 'class'
        || (tag === 'a' && name === 'href' && /^(https?:|mailto:|#)/i.test(attr.value.trim()))
        || ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan'));
      if (!keep) child.removeAttribute(attr.name);
    }
    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

export function sanitizeHtml(html) {
  const source = String(html || '');
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return escapeText(source);
  const doc = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}
