// Tutor voice mode (components/VoiceMode.js, lib/useVoiceMode.js): the rules, kept pure so they can be tested in
// Node (web/tests/voice-mode.test.mjs).
//   1. Listening: the turn ends after about 800ms of silence (createTurnDetector), then the audio is written
//      down by the Whisper path (/api/lectures/transcribe) or, without it, by the browser's speech recognition.
//   2. Thinking: the normal Tutor request with voice: true (lib/useTutorChat.js sendVoice); T4b's lines show
//      as captions and are never spoken.
//   3. Speaking: the reply, made speakable (speakableReply), sentence by sentence (splitSentences), in the cloud
//      voice for Pro and trial accounts (POST /tutor/speak) or the browser's best English voice (pickBrowserVoice).
//   4. Interrupting: talking (bargeIn) or a tap stops the voice at once and listens.

export const SILENCE_MS = 800;
export const PUT_IN_CHAT = "I've put that in the chat.";
const MAX_SENTENCE = 280; // /tutor/speak takes up to 600 characters
const MIN_SENTENCE = 14; // shorter pieces ("Yes.", "1.") join the next sentence

// ---- What is spoken ----

const ALREADY_SAID = /\b(?:i['’]ve|i have) put (?:that|it|them|those|the \w+) in the chat\b/i;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;
const MARK = '\u0000';

// The reply as it should be heard: no markdown, no diagram or code, no link read out. Links and code are left in
// the chat, so the voice says "I've put that in the chat." where they were (once per reply, and not at all when
// the reply already says so). Every word kept is the reply's own, in order: /tutor/speak checks that.
export function speakableReply(text) {
  let out = String(text || '').replace(/\r/g, '');
  out = out.replace(/```[\s\S]*?(?:```|$)/g, `\n${MARK}\n`);
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  out = out.replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))+\)/g, '$1');
  out = out.replace(URL, MARK);
  // Inline code: a short word or name is said ("the `len` function"); anything longer is left in the chat.
  out = out.replace(/`([^`\n]*)`/g, (_, code) => (/^[\w .'-]{1,24}$/.test(code.trim()) ? code.trim() : MARK));
  out = out.split('\n').map(line => {
    let row = line.trim();
    if (!row) return '';
    if (/^\|?\s*:?-{2,}/.test(row)) return ''; // a table's divider row
    if (row.includes('|')) row = row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()).filter(Boolean).join(', ');
    row = row.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/, '');
    row = row.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2').replace(/[*#>`]/g, '');
    // A line on its own (a heading, a list item) is its own sentence.
    return /[.!?:;,]$/.test(row) || row === MARK ? row : `${row}.`;
  }).filter(Boolean).join(' ');
  const said = ALREADY_SAID.test(out);
  let marked = false;
  out = out.replace(new RegExp(`${MARK}(?:[\\s.,;:]*${MARK})*`, 'g'), () => {
    if (said || marked) return ' ';
    marked = true;
    return ` ${PUT_IN_CHAT} `;
  });
  return out.replace(/\s+([.,;:!?])/g, '$1').replace(/([.,;:!?])(?:\s*[.,;:])+/g, '$1').replace(/\s+/g, ' ').trim();
}

const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|dr|mr|mrs|ms|prof|st|no|fig|approx|cf|al)\.$/i;

// Sentences, in order, ready to speak one at a time: a very short piece joins the next one, and a very long
// sentence is cut at a comma or semicolon (else a space) so each fits one request.
export function splitSentences(text) {
  const pieces = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9À-ÖØ-Þ])/);
  const joined = [];
  for (const piece of pieces) {
    const last = joined[joined.length - 1];
    if (last && (last.length < MIN_SENTENCE || ABBREVIATION.test(last))) joined[joined.length - 1] = `${last} ${piece}`;
    else if (piece) joined.push(piece);
  }
  return joined.flatMap(sentence => cutLong(sentence)).filter(Boolean);
}

function cutLong(sentence) {
  const out = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE) {
    const window = rest.slice(0, MAX_SENTENCE);
    const at = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '));
    const cut = at > MAX_SENTENCE / 3 ? at + 1 : Math.max(window.lastIndexOf(' '), 1);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ---- Listening ----

// How loud one frame of microphone samples is, 0 to 1 (the root mean square of the analyser's byte samples).
export function levelFrom(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = (samples[index] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

// Voice-activity detection for one turn. step(level, now) with a level each frame (about every 50ms) returns
// 'start' when the student starts talking (louder than the room for minSpeechMs), 'end' after silenceMs of
// quiet once they have talked, else null. The room's own noise is learned while nobody talks, so a fan or a
// busy café isn't taken for speech.
export function createTurnDetector({ silenceMs = SILENCE_MS, minSpeechMs = 200, threshold = 0.025, ratio = 2.5 } = {}) {
  let floor = threshold / ratio;
  let loudSince = null;
  let quietSince = null;
  let talking = false;
  const gate = () => Math.max(threshold, floor * ratio);
  return {
    get talking() { return talking; },
    reset() { loudSince = null; quietSince = null; talking = false; },
    step(level, now) {
      const loud = level > gate();
      if (!talking && !loud) floor = floor * 0.95 + level * 0.05;
      if (!talking) {
        if (!loud) { loudSince = null; return null; }
        if (loudSince === null) loudSince = now;
        if (now - loudSince < minSpeechMs) return null;
        talking = true;
        quietSince = null;
        return 'start';
      }
      if (loud) { quietSince = null; return null; }
      if (quietSince === null) quietSince = now;
      if (now - quietSince < silenceMs) return null;
      talking = false;
      loudSince = null;
      return 'end';
    },
  };
}

// While the Tutor speaks: the student talking over it (clearly louder than the room, and the echo the
// microphone's echo cancellation lets through, for holdMs) stops the voice. step(level, now) is true once.
export function createBargeIn({ threshold = 0.08, holdMs = 280 } = {}) {
  let since = null;
  return {
    reset() { since = null; },
    step(level, now) {
      if (level < threshold) { since = null; return false; }
      if (since === null) since = now;
      if (now - since < holdMs) return false;
      since = null;
      return true;
    },
  };
}

// The recording type this browser can make and the Whisper path reads (lib/server/lectures.mjs EXTENSIONS).
export function recordingType(isSupported) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => {
    try { return Boolean(isSupported?.(type)); } catch { return false; }
  }) || '';
}

// What stopped the microphone: 'blocked' (the student or the browser said no), 'missing' (no microphone),
// 'busy' (another app has it), or 'failed'.
export function micProblem(error) {
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'missing';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}

// How to let Cordia use the microphone again, in this browser's own words.
export function micHelp(userAgent = '') {
  const agent = String(userAgent);
  if (/iPhone|iPad|iPod/i.test(agent)) return ['Open the Settings app, then Safari › Microphone, and choose Allow.', 'Come back here and press Try again.'];
  if (/Firefox\//i.test(agent)) return ['Click the microphone icon in the address bar and clear the block.', 'Then press Try again.'];
  if (/Safari\//i.test(agent) && !/Chrome|Chromium|Edg\//i.test(agent)) return ['In the Safari menu, open Settings for this website.', 'Set Microphone to Allow, then press Try again.'];
  return ['Click the icon at the left of the address bar and turn Microphone on.', 'Then press Try again.'];
}

// ---- Speaking ----

// Novelty voices some systems ship (macOS): never the Tutor's voice.
const NOVELTY = /\b(?:albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy)\b/i;
const NATURAL = /\b(?:natural|neural|premium|enhanced|siri)\b/i;
const KNOWN_GOOD = /\b(?:google us english|google uk english female|samantha|ava|allison|aria|jenny|guy|zoe|evan|nathan|susan|serena|daniel|karen|moira|tessa)\b/i;

// The browser's best English voice: the student's language first (then any English), natural or premium voices
// before plain ones, well-known clear voices next. null when the browser has no English voice.
export function pickBrowserVoice(voices, lang = 'en-US') {
  const wanted = String(lang || 'en-US').toLowerCase();
  const scored = (voices || []).filter(voice => /^en(?:[-_]|$)/i.test(voice?.lang || '') && !NOVELTY.test(voice?.name || '')).map(voice => {
    const voiceLang = String(voice.lang).toLowerCase().replace('_', '-');
    let score = voiceLang === wanted ? 4 : voiceLang === 'en-us' ? 3 : 2;
    if (NATURAL.test(voice.name)) score += 3;
    if (KNOWN_GOOD.test(voice.name)) score += 2;
    if (voice.default) score += 0.5;
    return { voice, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.voice || null;
}

// Whether this account speaks with the cloud voice: Pro and trial accounts with voice characters left.
export function cloudVoiceAllowed(status) {
  if (!status || typeof status !== 'object') return false;
  if (status.unlimited) return true;
  return Number(status.features?.voice_characters?.remaining) > 0;
}

// The one-line note when the cloud voice can't speak and the browser's voice takes over.
export function fallbackNote(reason) {
  if (reason === 'limit') return "You've used this month's Tutor voice, so your browser's voice is speaking.";
  if (reason === 'unavailable') return "The Tutor's voice isn't available right now, so your browser's voice is speaking.";
  return '';
}

// When the Whisper path stops writing the student's turns down: 'limit' (this month's voice listening is used up,
// a 402 with feature voice_turns) or 'rate' (too many turns in a minute, a 429). One line each.
// note: the browser's own speech recognition wrote this turn down. error: nothing could, so the student is told why.
export function listenFallback(reason, heardByBrowser) {
  if (reason === 'limit') {
    return heardByBrowser
      ? { note: "You've used this month's voice listening, so your browser is writing down what you say." }
      : { error: "You've used this month's voice listening. Type your message instead." };
  }
  return heardByBrowser
    ? { note: 'That was a lot of voice turns in a minute, so your browser wrote this one down.' }
    : { error: 'That was a lot of voice turns in a minute. Wait a moment and try again, or type instead.' };
}

export const PRIVACY_NOTE = 'Voice audio is transcribed and not stored.';
