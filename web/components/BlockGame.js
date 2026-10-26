import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import SessionFinish from './SessionFinish';
import { SIZE, choicesFor, deal, fits, fitsAnywhere, place, questionOrder } from '../lib/blockGame.mjs';
import { dueIndices } from '../lib/spacedReview.mjs';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { isCardImage } from '../lib/cardImages';
import { prefersReducedMotion } from '../lib/motion';
import { useActiveClock } from '../lib/activeClock';

const BEST_KEY = 'blocksBest';
const PAD = 8; // board padding
const GAP = 4; // space between squares
const EDGE = PAD + 1; // padding plus the 1px border, from the board's outer edge to its first square
const bounds = cells => ({ rows: Math.max(...cells.map(([r]) => r)) + 1, cols: Math.max(...cells.map(([, c]) => c)) + 1 });

function Piece({ cells, color, size, gap = 3 }) {
  const { rows, cols } = bounds(cells);
  const on = new Set(cells.map(([r, c]) => `${r}:${c}`));
  return (
    <span className="bg-piece" style={{ gap, gridTemplateColumns: `repeat(${cols}, ${size}px)`, gridTemplateRows: `repeat(${rows}, ${size}px)` }} aria-hidden="true">
      {Array.from({ length: rows * cols }, (_, i) => {
        const key = `${Math.floor(i / cols)}:${i % cols}`;
        return <span key={key} className={on.has(key) ? `bg-cell is-filled c${color}` : 'bg-cell is-gap'} />;
      })}
    </span>
  );
}

// Blocks: answer a card to earn three pieces, fit them on the board, clear full rows and columns.
// Right answers deal handy shapes, wrong ones awkward shapes (and show the answer); three right in
// a row add a 1x1 helper. Cards due for review are asked first, and the answers count as review.
export default function BlockGame({ guide, onResults, onDone }) {
  const cards = useMemo(() => (guide.flashcards || []).filter(card => card?.front && card?.back), [guide.flashcards]);
  const clock = useActiveClock(); // active time only
  const played = useRef(0);
  const order = useRef(questionOrder(cards.length, dueIndices(guide.flashcard_progress, cards.length)));
  const asked = useRef(0);
  const [board, setBoard] = useState(() => Array.from({ length: SIZE }, () => Array(SIZE).fill(null)));
  const [tray, setTray] = useState([]);
  const [phase, setPhase] = useState('ask'); // ask | play | over
  const [question, setQuestion] = useState(null);
  const [picked, setPicked] = useState(null); // the option chosen
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [streak, setStreak] = useState(0);
  const [known, setKnown] = useState([]);
  const [missed, setMissed] = useState([]);
  const [flash, setFlash] = useState([]);
  const [combo, setCombo] = useState('');
  const [selected, setSelected] = useState(null); // tray index, for tap or keyboard placing
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const [drag, setDrag] = useState(null); // { index, x, y, offsetX, offsetY, lift }
  const [best, setBest] = useState(0);
  const [pendingGo, setPendingGo] = useState(null); // what Continue does after a miss
  const dragRef = useRef(null);
  const boardRef = useRef(null);
  const continueRef = useRef(null);
  const rootRef = useRef(null);
  const keyboard = useRef(false); // the last placement came from the keyboard

  useEffect(() => { setBest(Number(readUserValue(BEST_KEY, 0)) || 0); }, []);

  // Keyboard players carry on where they were: the next piece, or the next question's first answer.
  useEffect(() => {
    if (!keyboard.current) return;
    const target = rootRef.current?.querySelector(phase === 'ask' ? '.bg-option:not([disabled])' : '.bg-tray-piece:not([disabled])');
    if (target) { target.focus(); keyboard.current = false; }
  }, [phase, tray]);

  const nextQuestion = useCallback(() => {
    const index = order.current[asked.current % order.current.length];
    asked.current += 1;
    setQuestion({ index, ...choicesFor(cards, index) });
    setPicked(null);
    setPhase('ask');
  }, [cards]);

  useEffect(() => { if (cards.length) nextQuestion(); }, [cards.length, nextQuestion]);

  const finish = useCallback(() => {
    setPhase('over');
    setBest(current => {
      const next = Math.max(current, score);
      writeUserValue(BEST_KEY, next);
      return next;
    });
  }, [score]);

  useEffect(() => {
    if (phase !== 'over') return;
    played.current = clock.current?.seconds() || 0;
    onResults?.({ known, missed, seconds: played.current });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(option) {
    if (picked !== null) return;
    const right = option === question.answer;
    setPicked(option);
    const nextStreak = right ? streak + 1 : 0;
    setStreak(nextStreak);
    if (right) setKnown(list => (list.includes(question.index) ? list : [...list, question.index]));
    else setMissed(list => (list.includes(question.index) ? list : [...list, question.index]));
    const pieces = deal({ right, streak: nextStreak });
    const go = () => {
      setTray(pieces);
      setSelected(null);
      if (!pieces.some(piece => fitsAnywhere(board, piece.cells))) finish();
      else setPhase('play');
    };
    // A right answer moves on by itself; a wrong one waits so the right answer can be read.
    if (right) setTimeout(go, prefersReducedMotion() ? 250 : 650);
    else setTimeout(() => continueRef.current?.focus(), 0);
    setPendingGo(() => go);
  }

  function drop(index, row, col) {
    const piece = tray[index];
    if (!piece) return false;
    const result = place(board, piece, row, col);
    if (!result) return false;
    const rest = tray.filter((_, i) => i !== index);
    setBoard(result.board);
    setScore(value => value + result.points);
    if (result.lines) {
      setLines(value => value + result.lines);
      setFlash(result.cleared.map(([r, c]) => `${r}:${c}`));
      setCombo(result.lines > 1 ? `${result.lines} lines! +${result.points - piece.cells.length}` : `+${result.points - piece.cells.length}`);
      setTimeout(() => { setFlash([]); setCombo(''); }, 900);
    }
    setTray(rest);
    setSelected(null);
    if (!rest.length) setTimeout(nextQuestion, 350);
    else if (!rest.some(item => fitsAnywhere(result.board, item.cells))) setTimeout(finish, 500);
    return true;
  }

  // The board's square-to-square step, from its real size (padding and gaps included).
  function pitch() {
    const box = boardRef.current?.getBoundingClientRect();
    return box ? { box, step: (box.width - EDGE * 2 + GAP) / SIZE } : null;
  }

  // Board square under a point on screen, for the piece's top-left square.
  function cellAt(x, y) {
    const at = pitch();
    if (!at) return null;
    return { row: Math.round((y - at.box.top - EDGE) / at.step), col: Math.round((x - at.box.left - EDGE) / at.step) };
  }

  function startDrag(event, index) {
    if (phase !== 'play') return;
    const size = pitch()?.step || 40;
    const piece = event.currentTarget.querySelector('.bg-piece')?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    const { rows, cols } = bounds(tray[index].cells);
    // Held by the point it was grabbed at, scaled to board size; on touch, lifted above the finger.
    const clamp = value => Math.max(0, Math.min(1, value));
    const offsetX = clamp((event.clientX - piece.left) / piece.width) * (cols * size - GAP);
    const offsetY = clamp((event.clientY - piece.top) / piece.height) * (rows * size - GAP);
    const lift = event.pointerType === 'touch' ? size * 1.6 : 0;
    const next = { index, x: event.clientX, y: event.clientY, offsetX, offsetY, lift, size, moved: false, startX: event.clientX, startY: event.clientY };
    dragRef.current = next; // the release handler reads this even before the next render
    setDrag(next);
  }

  // Bound once: the handlers read the drag from a ref and call the latest drop/cellAt.
  const latest = useRef({});
  latest.current = { drop, cellAt };
  useEffect(() => {
    const move = event => {
      const current = dragRef.current;
      if (!current) return;
      event.preventDefault();
      const next = { ...current, x: event.clientX, y: event.clientY, moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6 };
      dragRef.current = next;
      setDrag(next);
    };
    const up = event => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current) return;
      // A tap (no real movement) picks the piece up for tap-to-place instead.
      if (!current.moved) {
        setSelected(value => (value === current.index ? null : current.index));
        return;
      }
      const at = latest.current.cellAt(event.clientX - current.offsetX, event.clientY - current.offsetY - current.lift);
      if (at) latest.current.drop(current.index, at.row, at.col);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  // Where the dragged or selected piece would land, and whether it fits there.
  const preview = useMemo(() => {
    if (drag?.moved) {
      const at = cellAt(drag.x - drag.offsetX, drag.y - drag.offsetY - drag.lift);
      const piece = tray[drag.index];
      if (!at || !piece) return null;
      return { cells: piece.cells, row: at.row, col: at.col, ok: fits(board, piece.cells, at.row, at.col) };
    }
    if (selected !== null && tray[selected]) return { cells: tray[selected].cells, row: cursor.row, col: cursor.col, ok: fits(board, tray[selected].cells, cursor.row, cursor.col) };
    return null;
  }, [drag, selected, cursor, tray, board]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewCells = new Set(preview ? preview.cells.map(([r, c]) => `${preview.row + r}:${preview.col + c}`) : []);

  function onBoardKey(event) {
    if (selected === null) return;
    const piece = tray[selected];
    const { rows, cols } = bounds(piece.cells);
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dr, dc] = moves[event.key];
      setCursor(current => ({ row: Math.max(0, Math.min(SIZE - rows, current.row + dr)), col: Math.max(0, Math.min(SIZE - cols, current.col + dc)) }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      keyboard.current = drop(selected, cursor.row, cursor.col);
    } else if (event.key === 'Escape') setSelected(null);
  }

  function tapCell(row, col) {
    if (selected === null) return;
    const { rows, cols } = bounds(tray[selected].cells);
    const r = Math.max(0, Math.min(SIZE - rows, row));
    const c = Math.max(0, Math.min(SIZE - cols, col));
    if (!drop(selected, r, c)) setCursor({ row: r, col: c });
  }

  if (!cards.length) return <p className="c-meta">This guide needs flashcards to play Blocks.</p>;

  if (phase === 'over') {
    const total = known.length + missed.length;
    return (
      <SessionFinish guideId={guide.id} guideTitle={guide.title} cards={total} accuracy={total ? (known.length / total) * 100 : 0} minutes={played.current / 60} kind="blocks" onRestart={onDone ? () => onDone('again') : undefined} onDone={() => onDone?.('done')}>
        <p className="bg-final"><strong>{score}</strong> points · {lines} line{lines === 1 ? '' : 's'}{score >= best && score > 0 ? ' · New best' : best ? ` · Best ${best}` : ''}</p>
        <style jsx>{`
          .bg-final { margin: 0; font: 500 17px/1.4 var(--font-sans); color: var(--ink); }
          .bg-final strong { font-weight: 700; }
        `}</style>
      </SessionFinish>
    );
  }

  const card = question ? cards[question.index] : null;
  const traySize = 18;
  return (
    <div className="bg" ref={rootRef}>
      <div className="bg-stats" aria-live="polite">
        <span><strong>{score}</strong> points</span>
        <span>{lines} lines</span>
        <span className={streak >= 2 ? 'is-hot' : ''}>{streak} in a row</span>
        {best > 0 && <span className="c-meta">Best {best}</span>}
      </div>

      <div className="bg-stage">
        <div
          ref={boardRef}
          className={'bg-board' + (selected !== null ? ' is-placing' : '')}
          role="grid"
          aria-label={selected !== null ? 'Board. Arrow keys move the piece, Enter places it, Escape puts it back.' : 'Board'}
          tabIndex={selected !== null ? 0 : -1}
          onKeyDown={onBoardKey}
        >
          {board.map((line, row) => line.map((color, col) => {
            const key = `${row}:${col}`;
            const ghost = previewCells.has(key);
            return (
              <span
                key={key}
                role="gridcell"
                aria-label={color ? 'filled' : 'empty'}
                className={'bg-cell' + (color ? ` is-filled c${color}` : '') + (flash.includes(key) ? ' is-clearing' : '') + (ghost ? (preview.ok ? ' is-ghost' : ' is-blocked') : '')}
                onClick={() => tapCell(row, col)}
              />
            );
          }))}
          {combo && <span className="bg-combo" aria-live="polite">{combo}</span>}
        </div>

        {phase === 'ask' && question && card && (
          <div className="bg-ask" role="dialog" aria-modal="false" aria-labelledby="bg-question">
            <p className="c-meta bg-ask-label">Answer to earn your next pieces</p>
            {isCardImage(card.front_image) && <img className="bg-ask-img" src={card.front_image} alt="" />}
            <h2 id="bg-question" className="bg-question">{card.front}</h2>
            <div className="bg-options">
              {question.options.map(option => {
                const state = picked === null ? '' : option === question.answer ? ' is-right' : option === picked ? ' is-wrong' : ' is-dim';
                return (
                  <button key={option} type="button" className={'bg-option' + state} onClick={event => { keyboard.current = event.detail === 0; answer(option); }} disabled={picked !== null}>
                    {picked !== null && option === question.answer && <Check size={18} strokeWidth={2} aria-hidden="true" />}
                    {picked === option && option !== question.answer && <X size={18} strokeWidth={2} aria-hidden="true" />}
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
            {picked !== null && picked !== question.answer && (
              <div className="bg-miss">
                <p className="c-meta" role="status">Not quite. Tricky pieces this round.</p>
                <button ref={continueRef} type="button" className="c-btn c-btn--primary" onClick={() => pendingGo?.()}>Continue</button>
              </div>
            )}
            {picked !== null && picked === question.answer && <p className="bg-right" role="status">Right!{streak > 0 && streak % 3 === 0 ? ' Bonus piece earned.' : ''}</p>}
          </div>
        )}
      </div>

      <div className="bg-tray" aria-label="Your pieces">
        {tray.map((piece, index) => (
          <button
            key={piece.id}
            type="button"
            className={'bg-tray-piece' + (selected === index ? ' is-selected' : '') + (drag?.index === index && drag.moved ? ' is-lifted' : '') + (fitsAnywhere(board, piece.cells) ? '' : ' is-stuck')}
            onPointerDown={event => startDrag(event, index)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index); setCursor({ row: 0, col: 0 }); setTimeout(() => boardRef.current?.focus(), 0); } }}
            aria-pressed={selected === index}
            aria-label={`${piece.helper ? 'Bonus piece' : 'Piece'} of ${piece.cells.length} block${piece.cells.length === 1 ? '' : 's'}${fitsAnywhere(board, piece.cells) ? '' : ", doesn't fit"}`}
            disabled={phase !== 'play'}
          >
            <Piece cells={piece.cells} color={piece.color} size={traySize} />
          </button>
        ))}
        {phase === 'play' && <p className="c-meta bg-hint">Drag a piece onto the board, or tap it and then a square.</p>}
      </div>

      {/* In <body>: a transformed page wrapper would otherwise make "fixed" relative to itself. */}
      {drag?.moved && tray[drag.index] && (
        <BodyPortal>
          <div className="bg-drag" style={{ position: 'fixed', zIndex: 400, pointerEvents: 'none', left: drag.x - drag.offsetX, top: drag.y - drag.offsetY - drag.lift }} aria-hidden="true">
            <Piece cells={tray[drag.index].cells} color={tray[drag.index].color} size={drag.size - GAP} gap={GAP} />
          </div>
        </BodyPortal>
      )}

      <style jsx>{`
        .bg { display: grid; gap: 16px; justify-items: center; width: 100%; max-width: 520px; margin: 0 auto; user-select: none; -webkit-user-select: none; }
        .bg-stats { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 16px; font: 500 15px/1.4 var(--font-sans); color: var(--muted); }
        .bg-stats strong { color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; }
        .bg-stats .is-hot { color: var(--flame); font-weight: 600; }
        .bg-stage { position: relative; width: 100%; }
        .bg-board { position: relative; display: grid; grid-template-columns: repeat(${SIZE}, 1fr); gap: ${GAP}px; width: 100%; aspect-ratio: 1; padding: ${PAD}px; border-radius: var(--r-card); background: var(--surface-card); border: 1px solid var(--line); box-sizing: border-box; touch-action: none; }
        .bg-board.is-placing:focus-visible { outline: 2px solid var(--olive); outline-offset: 3px; }
        .bg-ask { position: absolute; inset: 0; display: grid; align-content: center; gap: 12px; padding: 20px; border-radius: var(--r-card); background: var(--surface-raised); border: 1px solid var(--line); box-shadow: var(--shadow-float); text-align: center; overflow: auto; }
        .bg-ask-label { margin: 0; }
        .bg-ask-img { max-height: 120px; max-width: 100%; justify-self: center; object-fit: contain; border-radius: 12px; }
        .bg-question { margin: 0; font: 600 20px/1.3 var(--font-sans); color: var(--ink); }
        .bg-options { display: grid; gap: 8px; }
        .bg-option { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--r-input); background: var(--card); color: var(--ink); font: 500 15px/1.35 var(--font-sans); text-align: center; cursor: pointer; }
        .bg-option:hover:not(:disabled) { border-color: var(--olive); }
        .bg-option:disabled { cursor: default; }
        .bg-option.is-right { border-color: var(--success); color: var(--success); font-weight: 600; }
        .bg-option.is-wrong { border-color: var(--error); color: var(--error); }
        .bg-option.is-dim { opacity: 0.55; }
        .bg-miss { display: grid; gap: 8px; justify-items: center; }
        .bg-miss p, .bg-right { margin: 0; }
        .bg-right { color: var(--success); font-weight: 600; }
        .bg-tray { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; min-height: 120px; width: 100%; }
        .bg-tray-piece { display: grid; place-items: center; min-width: 88px; min-height: 88px; padding: 10px; border: 1px solid transparent; border-radius: var(--r-input); background: transparent; cursor: grab; touch-action: none; }
        .bg-tray-piece:disabled { cursor: default; }
        .bg-tray-piece.is-selected { border-color: var(--olive); background: var(--olive-tint); }
        .bg-tray-piece.is-lifted { opacity: 0.25; }
        .bg-tray-piece.is-stuck { opacity: 0.45; }
        .bg-hint { width: 100%; margin: 0; text-align: center; }
        .bg-combo { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 8px 16px; border-radius: var(--r-pill); background: var(--surface-raised); box-shadow: var(--shadow-float); font: 700 20px/1 var(--font-sans); color: var(--ink); pointer-events: none; animation: bg-pop 900ms ease forwards; }
        @keyframes bg-pop { 0% { opacity: 0; } 15% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
        :global(.bg-piece) { display: grid; }
        :global(.bg-cell) { display: block; border-radius: 5px; background: var(--hairline); }
        .bg-board :global(.bg-cell) { width: 100%; height: 100%; cursor: ${selected !== null ? 'pointer' : 'default'}; }
        :global(.bg-cell.is-gap) { background: transparent; }
        :global(.bg-cell.is-filled) { box-shadow: inset 0 -3px 0 var(--block-shade), inset 0 2px 0 var(--block-shine); }
        :global(.bg-cell.c1) { background: var(--block-1); }
        :global(.bg-cell.c2) { background: var(--block-2); }
        :global(.bg-cell.c3) { background: var(--block-3); }
        :global(.bg-cell.c4) { background: var(--block-4); }
        :global(.bg-cell.c5) { background: var(--block-5); }
        .bg-board :global(.bg-cell.is-ghost) { background: var(--olive-tint); box-shadow: inset 0 0 0 2px var(--olive); }
        .bg-board :global(.bg-cell.is-blocked) { box-shadow: inset 0 0 0 2px var(--error); }
        .bg-board :global(.bg-cell.is-clearing) { animation: bg-clear 420ms ease forwards; }
        @keyframes bg-clear { 0% { background: var(--sheen); } 100% { background: var(--hairline); } }
        @media (prefers-reduced-motion: reduce) {
          .bg-combo { animation: none; }
          .bg-board :global(.bg-cell.is-clearing) { animation: none; }
        }
      `}</style>
    </div>
  );
}
