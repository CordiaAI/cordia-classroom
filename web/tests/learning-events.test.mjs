// Phase 1 logging on the client: the stored names, one answer's timing, and a send queue that
// never gets in the way of studying.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUEUED, MAX_TRIES, answerTimer, confidenceFor, createQueue, formatFor, itemFingerprint, outcomeFor,
} from '../lib/learningEvents.mjs';
import { FAMILIAR, NEW, fingerprint, formatDecision } from '../lib/learnEngine.mjs';

test('card types, results and confidence map to what the server stores', () => {
  assert.deepEqual(['mc', 'fill', 'written', 'self', 'matching', 'flashcard', 'practice'].map(formatFor),
    ['choice', 'typed', 'written', 'flashcard', 'pairs', 'flashcard', 'practice']);
  assert.equal(formatFor('blocks'), null);
  assert.deepEqual([1, 0.5, 0].map(credit => outcomeFor(credit, 'written')), ['right', 'partly', 'wrong']);
  assert.deepEqual([1, 0].map(credit => outcomeFor(credit, 'flashcard')), ['got_it', 'again']);
  assert.deepEqual(['sure', 'think', 'guess', ''].map(confidenceFor), ['sure', 'think_so', 'guess', null]);
});

test('every mode uses Learn\'s fingerprint for the idea', () => {
  assert.equal(itemFingerprint('What organelle makes ATP?'), fingerprint({ question: 'What organelle makes ATP?' }));
  assert.equal(itemFingerprint('What organelle makes ATP?'), 'what organelle makes atp');
  assert.equal(itemFingerprint(''), '');
});

test('an answer is timed to the first key and to the answer, without the hidden time counted twice', () => {
  let now = 1000;
  const timer = answerTimer(() => now);
  now = 1400; timer.key();
  now = 1500; timer.key(); // only the first key counts
  now = 2000; timer.visibility(true);
  now = 5000; timer.visibility(false);
  now = 6000;
  assert.deepEqual(timer.done(), { first_key_ms: 400, submit_ms: 5000, hidden_ms: 3000 });
  now = 9000;
  assert.deepEqual(timer.done(), { first_key_ms: 400, submit_ms: 5000, hidden_ms: 3000 }, 'the first answer is the one kept');
  const choice = answerTimer(() => now, true); // shown in a hidden tab
  now = 9500;
  assert.deepEqual(choice.done(), { first_key_ms: null, submit_ms: 500, hidden_ms: 500 });
});

function harness(responses) {
  const sent = [];
  let saved = [];
  const queue = createQueue({
    send: async body => { sent.push(body); const next = responses.shift(); if (next instanceof Error) throw next; return next; },
    save: items => { saved = items; },
    tzOffset: () => -300,
  });
  return { queue, sent, saved: () => saved };
}

test('a batch goes out with decisions first and leaves the queue when saved', async () => {
  const { queue, sent, saved } = harness([{ status: 200, data: { logged: true } }]);
  queue.event({ fingerprint: 'a' });
  queue.decision({ id: 'd1' });
  await queue.flush();
  assert.deepEqual(sent, [{ tz_offset: -300, decisions: [{ id: 'd1' }], events: [{ fingerprint: 'a' }] }]);
  assert.equal(queue.pending(), 0);
  assert.deepEqual(saved(), []);
});

test('a failed send is kept and retried, then given up after a few tries', async () => {
  const { queue, sent } = harness([new Error('offline'), { status: 503 }, { status: 200, data: { logged: true } }]);
  queue.event({ fingerprint: 'a' });
  await queue.flush();
  await queue.flush();
  assert.equal(queue.pending(), 1);
  await queue.flush();
  assert.equal(queue.pending(), 0);
  assert.equal(sent.length, 3);

  const failing = harness(Array.from({ length: MAX_TRIES }, () => ({ status: 0 })));
  failing.queue.event({ fingerprint: 'b' });
  for (let i = 0; i < MAX_TRIES; i += 1) await failing.queue.flush();
  assert.equal(failing.queue.pending(), 0);
});

test('a refused batch is dropped, and logging switched off on the server stops collecting', async () => {
  const refused = harness([{ status: 422 }]);
  refused.queue.event({ fingerprint: 'a' });
  await refused.queue.flush();
  assert.equal(refused.queue.pending(), 0);

  const off = harness([{ status: 200, data: { logged: false } }]);
  off.queue.event({ fingerprint: 'a' });
  await off.queue.flush();
  off.queue.event({ fingerprint: 'b' });
  assert.equal(off.queue.pending(), 0);
  assert.ok(off.queue.isOff());
});

test('the queue stays small, survives bad saved data and never throws', async () => {
  const { queue } = harness([]);
  for (let i = 0; i < MAX_QUEUED + 20; i += 1) queue.event({ n: i });
  assert.equal(queue.pending(), MAX_QUEUED);
  const restored = createQueue({ send: async () => ({ status: 200, data: { logged: true } }), load: () => [null, { kind: 'event', data: {}, tries: 0 }, 'junk'] });
  assert.equal(restored.pending(), 1);
  const broken = createQueue({ send: async () => ({ status: 200 }), load: () => { throw new Error('no storage'); }, save: () => { throw new Error('full'); } });
  broken.event({});
  await broken.flush();
  assert.equal(broken.pending(), 0);
});

const term = { question: 'What organelle makes ATP?', options: ['Mitochondria', 'x', 'y', 'z'], correct_index: 0 };
const long = { question: 'Why does the market price fall when supply rises?', options: ['Sellers compete for the same buyers, so each must offer a lower price to make a sale', 'x', 'y', 'z'], correct_index: 0 };

test('Learn\'s format decision records the candidates, what was ruled out and why', () => {
  const fresh = formatDecision(term, { l: NEW }, '2026-10-28', ['mc', 'fill', 'written']);
  assert.equal(fresh.chosen, 'mc');
  assert.deepEqual(fresh.candidates, ['mc', 'fill', 'written', 'self']);
  assert.deepEqual(fresh.mask, { self: 'turned_off' });
  assert.deepEqual(fresh.eligible, ['mc', 'fill', 'written']);
  assert.equal(fresh.source, 'rule');
  assert.equal(fresh.recall, false);

  const recall = formatDecision(long, { l: FAMILIAR }, '2026-10-28', ['mc', 'fill', 'written']);
  assert.equal(recall.chosen, 'written');
  assert.equal(recall.mask.fill, 'long_answer');
  assert.equal(recall.recall, true);

  const onlyChoice = formatDecision(long, { l: FAMILIAR }, '2026-10-28', ['mc']);
  assert.equal(onlyChoice.chosen, 'mc');
  assert.equal(onlyChoice.source, 'student', 'the student\'s own settings left one format');

  const again = formatDecision(term, { l: FAMILIAR }, '2026-10-28', ['mc', 'fill'], 'mc');
  assert.equal(again.chosen, 'mc', 'a repeat after a miss keeps the format it was asked in');
});
