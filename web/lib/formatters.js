/**
 * Parse "Q1: ...\nA1: ..." text into [{index, question, answer}]
 */
export function parseQAPairs(text) {
  if (!text) return [];
  const pairs = [];
  const lines = text.split('\n');
  let currentQ = null;
  let lastPair = null;
  for (const line of lines) {
    const qMatch = line.match(/^Q(\d+):\s*(.+)/);
    const aMatch = line.match(/^A(\d+):\s*(.+)/);
    const imgMatch = line.match(/^\[IMG:(data:image\/.+)\]$/);
    if (qMatch) {
      currentQ = { index: parseInt(qMatch[1]), question: qMatch[2].trim() };
    } else if (aMatch && currentQ) {
      lastPair = { ...currentQ, answer: aMatch[2].trim(), image: null };
      pairs.push(lastPair);
      currentQ = null;
    } else if (imgMatch && lastPair) {
      lastPair.image = imgMatch[1];
    }
  }
  return pairs;
}

/**
 * Parse "- bullet\n- bullet" text into string[]
 */
// Notes as an outline: "## Heading" lines start a section, "- point" lines fill it. Older flat
// notes (points only) come back as one section without a heading.
export function parseOutline(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { current = { heading: line.slice(3).trim(), points: [] }; sections.push(current); }
    else if (line.startsWith('- ')) {
      if (!current) { current = { heading: '', points: [] }; sections.push(current); }
      current.points.push(line.slice(2).trim());
    }
  }
  return sections.filter(section => section.points.length);
}

// What the guide's Notes tab shows: the outline, or, until AI has written one, the key points
// the guide's own answers make (so Notes is never empty).
export function guideOutline(guide) {
  const outline = parseOutline(guide?.notes);
  if (outline.length) return outline;
  const points = parseQAPairs(guide?.study_guide).map(pair => pair.answer).filter(Boolean);
  return points.length ? [{ heading: 'Key points', points }] : [];
}

export function parseNotes(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.substring(2));
}

/**
 * Format ISO date string to readable format
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
