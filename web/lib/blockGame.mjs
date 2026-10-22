// Blocks: the rules, with no drawing or input. An 8x8 board; pieces are lists of [row, col]
// cells. A full row or column clears; more lines at once score more. Answering a card earns the
// next three pieces: right answers deal handy shapes, wrong ones deal awkward ones, and three
// right in a row add a 1x1 helper. The round ends when no piece in the tray fits.

export const SIZE = 8;
export const COLORS = 5;

const shape = rows => rows.flatMap((row, r) => [...row].flatMap((cell, c) => (cell === '#' ? [[r, c]] : [])));

// Shapes that are easy to fit, dealt for a right answer.
export const HANDY = [
  ['##'], ['#', '#'], ['###'], ['#', '#', '#'], ['##', '##'],
  ['##', '#.'], ['##', '.#'], ['#.', '##'], ['.#', '##'],
  ['###', '.#.'], ['.#.', '###'], ['#.', '##', '#.'], ['.#', '##', '.#'],
].map(shape);

// Big or bent shapes, dealt for a wrong answer.
export const AWKWARD = [
  ['###', '###', '###'], ['#####'], ['#', '#', '#', '#', '#'],
  ['###', '#..', '#..'], ['###', '..#', '..#'], ['#..', '#..', '###'],
  ['##.', '.##'], ['.##', '##.'], ['#.', '##', '.#'], ['.#', '##', '#.'],
].map(shape);

export const HELPER = shape(['#']);

export function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function fits(board, cells, row, col) {
  return cells.every(([r, c]) => {
    const y = row + r;
    const x = col + c;
    return y >= 0 && y < SIZE && x >= 0 && x < SIZE && board[y][x] === null;
  });
}

export function fitsAnywhere(board, cells) {
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) if (fits(board, cells, row, col)) return true;
  return false;
}

// Points: one per cell placed, then 10 per line cleared times the number of lines (2 lines = 40).
export function lineScore(lines) {
  return lines * lines * 10;
}

// Puts a piece down and clears full lines. Returns the new board, the cleared cells and the points.
export function place(board, piece, row, col) {
  if (!fits(board, piece.cells, row, col)) return null;
  const next = board.map(line => [...line]);
  for (const [r, c] of piece.cells) next[row + r][col + c] = piece.color;
  const rows = [];
  const cols = [];
  for (let i = 0; i < SIZE; i++) {
    if (next[i].every(cell => cell !== null)) rows.push(i);
    if (next.every(line => line[i] !== null)) cols.push(i);
  }
  const cleared = [];
  for (const r of rows) for (let c = 0; c < SIZE; c++) cleared.push([r, c]);
  for (const c of cols) for (let r = 0; r < SIZE; r++) if (!rows.includes(r)) cleared.push([r, c]);
  for (const [r, c] of cleared) next[r][c] = null;
  const lines = rows.length + cols.length;
  return { board: next, cleared, lines, points: piece.cells.length + lineScore(lines) };
}

// `random` returns [0, 1). Three pieces, each with its own colour (1-5).
export function deal({ right, streak = 0, random = Math.random }) {
  const pool = right ? HANDY : AWKWARD;
  const pick = list => list[Math.floor(random() * list.length) % list.length];
  const pieces = Array.from({ length: 3 }, (_, index) => ({ id: `${Date.now().toString(36)}-${index}-${Math.floor(random() * 1e6)}`, cells: pick(pool), color: 1 + Math.floor(random() * COLORS) % COLORS }));
  // A wrong answer still gets one fair piece, so a round never ends on a single miss.
  if (!right) pieces[2] = { ...pieces[2], cells: pick(HANDY) };
  if (right && streak > 0 && streak % 3 === 0) pieces.push({ id: `helper-${streak}`, cells: HELPER, color: 3, helper: true });
  return pieces;
}

// Cards to ask, due and missed ones first (their order from the review schedule), then the rest.
export function questionOrder(count, dueFirst = [], random = Math.random) {
  const all = Array.from({ length: count }, (_, index) => index);
  const shuffle = list => {
    const items = [...list];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  const due = shuffle(dueFirst.filter(index => index >= 0 && index < count));
  return [...due, ...shuffle(all.filter(index => !due.includes(index)))];
}

// A multiple-choice question from card `index`: its back and up to three other, different backs.
export function choicesFor(cards, index, random = Math.random) {
  const answer = String(cards[index]?.back || '').trim();
  const seen = new Set([answer.toLowerCase()]);
  const others = [];
  for (const position of questionOrder(cards.length, [], random)) {
    const back = String(cards[position]?.back || '').trim();
    if (position === index || !back || seen.has(back.toLowerCase())) continue;
    seen.add(back.toLowerCase());
    others.push(back);
    if (others.length === 3) break;
  }
  const options = [answer, ...others];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { answer, options };
}
