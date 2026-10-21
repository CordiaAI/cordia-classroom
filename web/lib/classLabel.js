// Canvas names classes like "MUL 101 MUL-101-102: Introduction to Music". In menus the name
// reads first and the course code sits under it: { title: 'Introduction to Music', code: 'MUL 101' }.
export function classLabel(name) {
  const text = String(name || '').trim();
  const colon = text.indexOf(': ');
  if (colon < 0) return { title: text, code: '' };
  const before = text.slice(0, colon);
  const code = before.match(/^[A-Z]{2,5}\s?\d{2,4}[A-Z]?/)?.[0] || before;
  return { title: text.slice(colon + 2).trim() || text, code };
}
