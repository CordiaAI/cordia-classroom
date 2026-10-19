// Lecture transcript text: overlap removal between chunks, filler clean-up, and joining timed
// segments into one transcript. Shared by the recorder (browser) and its tests.

const WORD = /[\p{L}\p{N}'’]+/gu;
const FILLERS = /,?\s*\b(?:um+|uh+|erm+|hmm+|mm+|uh-huh)\b[,.]?(?=\s|$)/gi;

const normWords = text => (String(text || '').match(WORD) || []).map(word => word.toLowerCase().replace(/’/g, "'"));

// Drop the opening words of `next` that repeat the end of `previous` (chunks overlap by ~2 s).
// Finds the longest run of 2-30 words where previous ends the way next begins.
export function mergeOverlap(previous, next, maxWords = 30) {
  const text = String(next || '').trim();
  const tail = normWords(previous).slice(-maxWords);
  const head = normWords(text).slice(0, maxWords);
  let best = 0;
  for (let size = Math.min(tail.length, head.length); size >= 2; size -= 1) {
    if (tail.slice(-size).join(' ') === head.slice(0, size).join(' ')) { best = size; break; }
  }
  if (!best) return text;
  const matches = [...text.matchAll(WORD)];
  const cut = matches[best - 1].index + matches[best - 1][0].length;
  return text.slice(cut).replace(/^[\s,.;:\-–—]+/, '').trim();
}

// Remove spoken fillers, doubled words ("the the") and extra spaces; keeps every real word.
export function cleanSpokenText(text) {
  return String(text || '')
    .replace(FILLERS, ' ')
    .replace(/\b(\w+)(?: \1\b)+/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

// Timed segments ({ seq, start_ms, text }) in order, each with the overlap against the one
// before it removed. Chunks can arrive out of order, so this always works from the full list.
export function mergedSegments(segments) {
  const ordered = [...(segments || [])].filter(item => String(item?.text || '').trim()).sort((a, b) => (a.start_ms - b.start_ms) || ((a.seq ?? 0) - (b.seq ?? 0)));
  const out = [];
  for (const item of ordered) {
    const previous = out[out.length - 1];
    const text = cleanSpokenText(previous ? mergeOverlap(previous.raw, item.text) : item.text);
    out.push({ ...item, raw: item.text, text });
  }
  return out.filter(item => item.text).map(({ raw, ...item }) => item);
}

// The whole lecture as readable text: paragraphs every ~6 segments (about 2 minutes).
export function transcriptText(segments) {
  const merged = mergedSegments(segments);
  const paragraphs = [];
  for (let i = 0; i < merged.length; i += 6) paragraphs.push(merged.slice(i, i + 6).map(item => item.text).join(' '));
  return paragraphs.join('\n\n').trim();
}

// Sentence-cased fallback title when the AI title is not available.
export function fallbackTitle(date = new Date()) {
  return `Lecture ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
