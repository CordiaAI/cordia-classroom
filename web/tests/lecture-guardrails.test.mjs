// A recording only ends on Stop: a recorder error starts a new one, a dead microphone is reported
// so it can be reopened, and the reopened stream takes over without losing what was recorded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const source = readFileSync(join(web, 'lib/lectureRecorder.js'), 'utf8');

class FakeRecorder {
  static made = [];
  constructor(stream) { this.stream = stream; this.state = 'inactive'; FakeRecorder.made.push(this); }
  start() { if (!this.stream.live) throw new Error('dead stream'); this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 10 } }); this.onstop?.(); }
  // As in browsers: an error stops the recorder, which still hands over its data and fires stop.
  fail() { this.state = 'inactive'; this.onerror?.(new Event('error')); this.ondataavailable?.({ data: { size: 10 } }); this.onstop?.(); }
}
const stream = () => {
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  return { track, get live() { return track.readyState === 'live'; }, getAudioTracks: () => [track], getTracks: () => [track] };
};

globalThis.MediaRecorder = FakeRecorder;
globalThis.Blob = class { constructor(parts, { type }) { this.size = parts.length * 10; this.type = type; } };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
const { ChunkedRecorder } = await import('data:text/javascript,' + encodeURIComponent(source));

function recorderWith(mic) {
  const problems = [];
  const chunks = [];
  const rec = new ChunkedRecorder(mic, { mimeType: 'audio/webm', onChunk: chunk => chunks.push(chunk), onProblem: reason => problems.push(reason) });
  rec.start();
  clearInterval(rec.ticker); // driven by hand below
  return { rec, problems, chunks };
}
const recording = rec => rec.active.filter(segment => segment.recorder.state === 'recording').length;

test('a recorder error hands over to a new one at once', () => {
  FakeRecorder.made = [];
  const { rec, problems, chunks } = recorderWith(stream());
  FakeRecorder.made[0].fail();
  assert.deepEqual(problems, ['recorder']);
  assert.equal(recording(rec), 1, 'still recording');
  assert.equal(chunks.length, 1, 'what the failed recorder had is kept');
});

test('a dead microphone is reported, and a reopened one takes over', async () => {
  FakeRecorder.made = [];
  const mic = stream();
  const { rec, problems, chunks } = recorderWith(mic);
  mic.track.stop();
  rec.checkedAt = 0;
  rec.watchdog();
  assert.deepEqual(problems, ['stream']);
  let released = false;
  const fresh = stream();
  rec.replaceStream(fresh, () => { released = true; });
  assert.equal(recording(rec), 1);
  assert.equal(rec.active[0].recorder.stream, fresh);
  assert.equal(chunks.length, 1, 'the old segment was written');
  await rec.stop();
  assert.ok(released, 'Stop releases the new microphone too');
});

test('a stalled recorder is restarted by the watchdog', () => {
  FakeRecorder.made = [];
  const { rec, problems } = recorderWith(stream());
  FakeRecorder.made[0].state = 'inactive'; // stopped without telling anyone
  rec.checkedAt = 0;
  rec.watchdog();
  assert.deepEqual(problems, ['stalled']);
  assert.equal(recording(rec), 1);
});

test('the New sheet never unmounts a recording, and the minutes limit never stops one', () => {
  const sheet = readFileSync(join(web, 'components/NewSheet.js'), 'utf8');
  assert.match(sheet, /if \(recordingRef\.current\) \{ setMinimized\(false\); return; \}/);
  assert.match(sheet, /enabled: open && status === 'idle' && !recording/);
  const ui = readFileSync(join(web, 'components/LectureRecorder.js'), 'utf8');
  assert.doesNotMatch(ui, /onLimit: \(\) => \{ if \(recorder\.current\) finish\(\)/);
  assert.match(ui, /reconnectMic/);
  const uploads = readFileSync(join(web, 'lib/lectureUploads.js'), 'utf8');
  assert.match(uploads, /this\.held = true/);
});
