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
  return collapseLoops(text)
    .replace(FILLERS, ' ')
    .replace(/\b(\w+)(?: \1\b)+/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

// Whisper invents text over music, games and noise: loops ("Tm. Tm. Tm."), runs of a music
// marker ("音楽 音楽", Japanese for "music") and lines in another language. These keep only speech.

// What Whisper writes for music or noise rather than words.
const MUSIC_MARK = '(?:音楽|音樂|音乐|♪|♫|\\[(?:music|applause|laughter|noise|silence)\\]|\\((?:music|applause|laughter|noise|silence)\\))';
const ONLY_MARKS = new RegExp(`^(?:[\\s.,!?、。…~-]|${MUSIC_MARK})*$`, 'iu');
const MARK_RUNS = new RegExp(`(?:${MUSIC_MARK}[\\s.,、。…]*){2,}`, 'giu');

// Whisper's own confidence for one segment (verbose_json). Drops what it marks as unreliable:
// text repetitive enough to be a loop, low confidence, or probably not speech.
// The first two are OpenAI's Whisper cut-offs; the last catches confident text over music.
export function keepWhisperSegment(segment) {
  const text = String(segment?.text || '').trim();
  if (!text || ONLY_MARKS.test(text)) return false;
  const ratio = Number(segment.compression_ratio);
  const logprob = Number(segment.avg_logprob);
  const silent = Number(segment.no_speech_prob);
  if (ratio > 2.4 || logprob < -1) return false;
  if (silent >= 0.8 || (silent > 0.6 && logprob < -0.5)) return false;
  return true;
}

// A phrase of one to four words said three or more times in a row becomes one; runs of music
// markers go. Someone saying "no, no, no" keeps one "no"; a minute of "Tm. Tm. Tm." keeps one.
export function collapseLoops(text) {
  return String(text || '')
    .replace(MARK_RUNS, ' ')
    .replace(/(?<!\S)(\S+(?:\s+\S+){0,3}?)(?:[\s,]+\1(?!\S)){2,}/giu, '$1')
    .replace(/(\p{L}{1,6}?)\1{3,}/gu, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// One Whisper reply to text: the kept segments when it sent them (verbose_json), else its text.
export function whisperText(data) {
  const segments = Array.isArray(data?.segments) ? data.segments : null;
  const text = segments ? segments.filter(keepWhisperSegment).map(segment => String(segment.text).trim()).join(' ') : String(data?.text || '');
  const kept = collapseLoops(text);
  return ONLY_MARKS.test(kept) ? '' : kept;
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
