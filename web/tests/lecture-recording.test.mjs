// Lecture recording contract: real audio capture (not the Web Speech API), a microphone the
// site is allowed to use, and a chunked recorder whose stop() waits for the last chunk.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const read = path => readFileSync(join(web, path), 'utf8');

const config = read('next.config.js');
assert.match(config, /microphone=\(self\)/, 'Permissions-Policy must allow the microphone for this site');
assert.doesNotMatch(config, /microphone=\(\)/, 'Permissions-Policy must not block the microphone');

const sheet = read('components/NewSheet.js');
assert.doesNotMatch(sheet, /SpeechRecognition/, 'Record must not use the Web Speech API');
assert.match(sheet, /<LectureRecorder /, 'Record mode renders LectureRecorder');
assert.match(sheet, /sourceType: 'lecture'/, 'recordings build guides with sourceType lecture');

const recorder = read('lib/lectureRecorder.js');
assert.match(recorder, /export const CHUNK_MS = 20000/);
assert.match(recorder, /export const OVERLAP_MS = 2000/);
assert.match(recorder, /audio\/webm;codecs=opus/, 'Chrome records Opus in WebM');
assert.match(recorder, /'audio\/mp4'/, 'Safari records AAC in MP4');
assert.match(recorder, /wakeLock/, 'the screen stays awake while recording');
assert.match(recorder, /Promise\.resolve\([^)]*this\.onChunk/, 'stop() waits for the last chunk to be queued');

const uploads = read('lib/lectureUploads.js');
assert.match(uploads, /indexedDB\.open/, 'chunks are buffered in IndexedDB');
assert.match(uploads, /X-Prompt/, 'each chunk sends the transcript tail and class terms as the prompt');
assert.match(uploads, /\/api\/lectures\/chunk/, 'chunks go to the web server route (works on Preview without a backend deploy)');
assert.match(uploads, /drained\(\{ timeoutMs/, 'Stop waits for uploads with a time limit, never forever');

const ui = read('components/LectureRecorder.js');
for (const text of ['I have permission to record this lecture', 'Upload recording', 'Keep audio', 'min left', 'beforeunload']) {
  assert.ok(ui.includes(text), `LectureRecorder is missing "${text}"`);
}

console.log('lecture recording contract ok');
