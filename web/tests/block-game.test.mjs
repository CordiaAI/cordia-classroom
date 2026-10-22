// Blocks: placing, clearing rows and columns, combos, dealing for right and wrong answers, and
// asking due cards first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AWKWARD, HANDY, HELPER, SIZE, choicesFor, deal, emptyBoard, fits, fitsAnywhere, place, questionOrder } from '../lib/blockGame.mjs';

const line = n => Array.from({ length: n }, (_, c) => [0, c]);
const seq = values => { let i = 0; return () => values[i++ % values.length]; };

test('a piece fits only on empty squares inside the board', () => {
  const board = emptyBoard();
  board[0][1] = 2;
  assert.equal(fits(board, line(2), 0, 0), false);
  assert.equal(fits(board, line(2), 1, 0), true);
  assert.equal(fits(board, line(2), 0, SIZE - 1), false);
  assert.equal(fits(board, line(2), -1, 0), false);
});

test('a full row and a full column clear together, and two lines score more than twice one', () => {
  const board = emptyBoard();
  for (let c = 1; c < SIZE; c++) board[3][c] = 1; // row 3 missing (3,0)
  for (let r = 0; r < SIZE; r++) if (r !== 3) board[r][0] = 4; // column 0 missing (3,0)
  const result = place(board, { cells: [[0, 0]], color: 2 }, 3, 0);
  assert.equal(result.lines, 2);
  assert.equal(result.cleared.length, SIZE * 2 - 1, 'the shared square counts once');
  assert.ok(result.board.every(row => row.every(cell => cell === null)));
  assert.equal(result.points, 1 + 40);
  const single = emptyBoard();
  for (let c = 1; c < SIZE; c++) single[0][c] = 1;
  assert.equal(place(single, { cells: [[0, 0]], color: 1 }, 0, 0).points, 1 + 10);
  assert.equal(place(single, { cells: [[0, 0]], color: 1 }, 0, 1), null, 'occupied squares refuse');
});

test('right answers deal handy pieces and a helper every third in a row; wrong ones deal awkward pieces plus one fair one', () => {
  const right = deal({ right: true, streak: 1, random: seq([0.1, 0.5, 0.9, 0.3]) });
  assert.equal(right.length, 3);
  assert.ok(right.every(piece => HANDY.includes(piece.cells)));
  assert.ok(right.every(piece => piece.color >= 1 && piece.color <= 5));
  const third = deal({ right: true, streak: 3, random: Math.random });
  assert.equal(third.length, 4);
  assert.equal(third[3].cells, HELPER);
  const wrong = deal({ right: false, streak: 0, random: Math.random });
  assert.ok(AWKWARD.includes(wrong[0].cells) && AWKWARD.includes(wrong[1].cells));
  assert.ok(HANDY.includes(wrong[2].cells));
});

test('the round ends when nothing fits', () => {
  const board = emptyBoard();
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if ((r + c) % 2) board[r][c] = 1;
  assert.equal(fitsAnywhere(board, line(2)), false);
  assert.equal(fitsAnywhere(board, HELPER), true);
});

test('due cards are asked first, and choices hold the right answer once among different backs', () => {
  const order = questionOrder(6, [4, 1, 9], seq([0.2, 0.7, 0.4, 0.9, 0.1]));
  assert.deepEqual(new Set(order.slice(0, 2)), new Set([4, 1]));
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
  const cards = [{ front: 'Tort', back: 'A civil wrong' }, { front: 'Sonnet', back: 'A 14-line poem' }, { front: 'Allele', back: 'A gene variant' }, { front: 'Dup', back: 'a civil wrong' }, { front: 'Mitosis', back: 'Cell division' }];
  const { answer, options } = choicesFor(cards, 0);
  assert.equal(answer, 'A civil wrong');
  assert.equal(options.filter(option => option.toLowerCase() === 'a civil wrong').length, 1, 'a duplicate back is never a second right answer');
  assert.equal(options.length, 4);
  assert.equal(choicesFor(cards.slice(0, 2), 1).options.length, 2);
});
