// A question with fewer than 3 choices is never multiple choice (guide-derived questions keep only
// related, fitting choices, so some have 2). Learn asks it Type it, or as a flashcard when the answer
// is long; Quiz re-asks it typed or written; a timed test types or writes it. 3 and 4 stay choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIAR, LEARNING, NEW, answer, askCard, cardFor, createRound, currentCard, formatDecision } from '../lib/learnEngine.mjs';
import { answerLadder, askLadder, createLadderRound, ladderDecision } from '../lib/learnLadder.mjs';
import { buildTest } from '../lib/timedTest.mjs';
import { MIN_CHOICES, canChoose, reaskType } from '../lib/retainEngine.mjs';

const TODAY = '2026-11-18';
const make = (question, right, wrong) => ({ question, options: [right, ...wrong], correct_index: 0 });
const LONG = 'Sellers compete for the same buyers, so each must offer a lower price to make a sale';

// One short and one long idea in each of five subjects, each with 2 choices, plus 3 and 4 choice ones.
const SUBJECTS = {
  nursing: [make('Which electrolyte rises in hyperkalemia?', 'Potassium', ['Sodium']), make('Why do T waves peak in hyperkalemia?', 'The raised potassium changes the resting potential, so repolarisation speeds up in the cardiac cells', ['Sodium channels close completely during every beat of the heart'])],
  art_history: [make('Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Raphael']), make('What is chiaroscuro?', 'A strong contrast of light and dark used to give a painted figure the look of volume', ['A flat style of painting that avoids shadows and keeps every colour even'])],
  business_law: [make('What binds a contract?', 'Consideration', ['Estoppel']), make('Why is an offer revocable?', 'Until it is accepted the offeror has made no promise that the law can enforce against them', ['Because the offeree has already paid for the right to accept it'])],
  literature: [make('What is the main verse of a sonnet?', 'Iambic pentameter', ['Blank verse']), make('What does a foil do?', 'It contrasts with another character to bring out that character\'s qualities more sharply for the reader', ['It narrates the plot from the point of view of the author alone'])],
  computer_science: [make('Which interface orders elements?', 'List', ['Set']), make('Why use a hash table?', 'It finds a value from its key in constant time on average by computing a position from the key', ['It keeps every key in sorted order so a range query is always cheap'])],
};
const three = make('Who wrote Hamlet?', 'Shakespeare', ['Marlowe', 'Jonson']);
const four = make('What is the DOM?', 'A tree model of a page', ['A style sheet', 'A network protocol', 'A database']);

test('canChoose: 3 and 4 choices are multiple choice, fewer are not', () => {
  assert.equal(MIN_CHOICES, 3);
  assert.equal(canChoose(three), true);
  assert.equal(canChoose(four), true);
  assert.equal(canChoose(make('Q?', 'A', ['B'])), false);
  assert.equal(canChoose(make('Q?', 'A', [])), false);
  assert.equal(canChoose({}), false);
  assert.equal(canChoose(null), false);
});

test('Learn: a 2-choice idea is Type it (short) or a flashcard (long), in every subject, new and familiar', () => {
  for (const [subject, [short, long]] of Object.entries(SUBJECTS)) {
    assert.equal(askCard(short, { l: NEW }, TODAY, ['mc', 'type']).type, 'fill', subject);
    assert.equal(askCard(long, { l: NEW }, TODAY, ['mc', 'type']).type, 'self', subject);
    assert.equal(askCard(short, { l: NEW }, TODAY, ['mc']).type, 'fill', `${subject}: only Choose is on`);
    assert.equal(askCard(long, { l: NEW }, TODAY, ['mc']).type, 'self', subject);
    assert.equal(askCard(short, { l: FAMILIAR }, TODAY, ['mc']).type, 'fill', `${subject}: recall order with only Choose on`);
    assert.equal(askCard(long, { l: FAMILIAR }, TODAY, ['mc']).type, 'self', subject);
    assert.equal(askCard(short, { l: NEW }, TODAY, ['mc', 'cloze']).type, 'fill', subject);
  }
});

test('Learn: 3 and 4 choice ideas stay multiple choice', () => {
  assert.equal(askCard(three, { l: NEW }, TODAY, ['mc', 'type']).type, 'mc');
  assert.equal(askCard(four, { l: NEW }, TODAY, ['mc']).type, 'mc');
  assert.equal(askCard(three, { l: NEW }, TODAY, ['mc']).noChoice, undefined);
});

test('Learn: a ways pick that is not Choose is unchanged for a 2-choice idea', () => {
  const [short, long] = SUBJECTS.nursing;
  assert.equal(askCard(short, { l: NEW }, TODAY, ['type']).type, 'fill');
  assert.equal(askCard(long, { l: NEW }, TODAY, ['type']).type, 'written');
  assert.equal(askCard(long, { l: NEW }, TODAY, ['self']).type, 'self');
});

test('Learn: a missed recall of a 2-choice idea is not dropped back to multiple choice', () => {
  const [short] = SUBJECTS.computer_science;
  const questions = [short];
  let levels = { 0: { l: FAMILIAR, at: null } };
  let round = createRound(questions, levels, TODAY, ['mc', 'type']);
  const card = currentCard(round);
  assert.equal(card.type, 'fill');
  ({ round } = answer(levels, round, card, 0, { today: TODAY }));
  assert.equal(round.queue.at(-1).type, 'fill', 'the retry is typed too');
  // the same miss on a 4-choice idea still comes back as choices
  levels = { 0: { l: FAMILIAR, at: null } };
  round = createRound([make('What is X?', 'Alpha', ['B', 'C', 'D'])], levels, TODAY, ['mc', 'type']);
  ({ round } = answer(levels, round, currentCard(round), 0, { today: TODAY }));
  assert.equal(round.queue.at(-1).type, 'mc');
});

test('Learn: the decision log says why Choose was ruled out', () => {
  const [short] = SUBJECTS.art_history;
  const decision = formatDecision(short, { l: NEW }, TODAY, ['mc', 'type']);
  assert.equal(decision.chosen, 'fill');
  assert.equal(decision.mask.mc, 'few_choices');
  assert.ok(!decision.eligible.includes('mc'));
  assert.ok(formatDecision(three, { l: NEW }, TODAY, ['mc', 'type']).eligible.includes('mc'));
});

test('format ladder: same rule for recognition, final-days choices and the log', () => {
  for (const [subject, [short, long]] of Object.entries(SUBJECTS)) {
    const ctx = { types: ['mc', 'fill', 'written'], today: TODAY, fillAvailable: true };
    assert.equal(askLadder(short, { l: NEW }, ctx).type, 'fill', subject);
    assert.equal(askLadder(long, { l: NEW }, ctx).type, 'self', subject);
    const free = askLadder(short, { l: NEW }, { ...ctx, fillAvailable: false });
    assert.equal(free.type, 'written', `${subject}: Fill in is Pro`);
    assert.equal(free.fallback, false, 'no upgrade note for a question that has no choices');
    const final = { ...ctx, testFormat: 'mc', testDate: '2026-11-19' };
    assert.notEqual(askLadder(short, { l: FAMILIAR }, final).type, 'mc', subject);
    assert.notEqual(askLadder(long, { l: FAMILIAR }, { ...final, index: 0 }).type, 'mc', subject);
  }
  const ctx = { types: ['mc', 'fill', 'written'], today: TODAY };
  assert.equal(askLadder(three, { l: NEW }, ctx).type, 'mc');
  assert.equal(askLadder(four, { l: NEW }, ctx).type, 'mc');
  assert.equal(ladderDecision(SUBJECTS.nursing[0], { l: NEW }, ctx).mask.mc, 'few_choices');
});

test('format ladder: the retry of a missed 2-choice idea is not multiple choice', () => {
  const [short, long] = SUBJECTS.business_law;
  const questions = [short, long];
  const levels = { 0: { l: NEW, at: null }, 1: { l: NEW, at: null } };
  const ctx = { types: ['mc', 'fill', 'written'], today: TODAY, questions };
  const round = createLadderRound(questions, levels, ctx);
  assert.deepEqual(round.queue.map(card => card.type), ['fill', 'self']);
  const missed = answerLadder(levels, round, currentCard(round), 0, { today: TODAY, ctx });
  const retries = [...missed.round.queue, ...missed.round.carry.map(concept => ({ concept }))].filter(card => card.again || card.concept === 0);
  assert.ok(retries.every(card => card.type !== 'mc'));
});

test('timed test: a 2-choice idea is typed or written, 3 and 4 stay choices', () => {
  for (const [subject, [short, long]] of Object.entries(SUBJECTS)) {
    assert.deepEqual(buildTest([short], ['mc'], 1).map(item => item.type), ['fill'], subject);
    assert.deepEqual(buildTest([long], ['mc'], 1).map(item => item.type), ['written'], subject);
  }
  assert.deepEqual(buildTest([three, four], ['mc'], 1).map(item => item.type), ['mc', 'mc']);
  assert.equal(cardFor('mc', three), 'mc');
  assert.equal(cardFor('mc', make('Q?', 'A', ['B'])), 'fill');
});

test('Quiz: a missed 2-choice idea comes back typed (Fill in on) or written, never as choices', () => {
  for (const [subject, [short, long]] of Object.entries(SUBJECTS)) {
    for (let again = 0; again < 4; again += 1) {
      assert.notEqual(reaskType(short, 'fill', again, ['mc', 'fill']), 'mc', subject);
      assert.notEqual(reaskType(short, 'written', again, ['mc']), 'mc', subject);
      assert.equal(reaskType(long, 'written', again, ['mc', 'written']), 'written', subject);
      assert.equal(reaskType(short, 'written', again, ['mc', 'fill']), 'written', subject);
    }
    assert.equal(reaskType(short, 'fill', 0, ['mc']), 'written', 'Fill in is a Pro type: not switched on for the student');
  }
  // 3 and 4 choices keep the existing re-ask cycle
  assert.equal(reaskType(three, 'mc', 0, ['mc']), 'mc');
  assert.equal(reaskType(make('Q?', 'Mitosis', ['B', 'C', 'D']), 'matching', 0, ['matching', 'fill']), 'fill');
});
