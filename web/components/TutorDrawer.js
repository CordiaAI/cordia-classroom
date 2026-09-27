import { useEffect, useRef, useState } from 'react';
import AIChatWidget from './AIChatWidget';

const MIN_WIDTH = 300;
const MAX_WIDTH = 520;
const OPEN_KEY = 'cordiaTutorOpen';

export default function TutorDrawer({ preferredGuideId = '', preferredNoteId = '', docked = false }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(360);
  const toggleRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem('cordiaTutorWidth'));
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    setOpen(localStorage.getItem(OPEN_KEY) === 'true');
  }, []);

  useEffect(() => {
    const reveal = () => changeOpen(true);
    window.addEventListener('cordia:tutor-prompt', reveal);
    return () => window.removeEventListener('cordia:tutor-prompt', reveal);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      changeOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  // Open drawer pushes the page content over instead of covering it.
  useEffect(() => {
    if (docked) return;
    const body = document.body;
    body.classList.toggle('tutor-open', open);
    body.style.setProperty('--tutor-offset', `${width}px`);
    return () => body.classList.remove('tutor-open');
  }, [open, width, docked]);

  // Clicking empty space closes the Tutor; clicking anything you can use (buttons,
  // fields, the drawing board, links) keeps it open so you can work beside it.
  useEffect(() => {
    if (docked || !open) return;
    const closeOnEmptyClick = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (shellRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      if (target.closest('button, a, input, textarea, select, label, canvas, [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="dialog"], [role="separator"], .practice-token')) return;
      changeOpen(false);
    };
    document.addEventListener('pointerdown', closeOnEmptyClick);
    return () => document.removeEventListener('pointerdown', closeOnEmptyClick);
  }, [open, docked]);

  function changeOpen(next) {
    setOpen(next);
    localStorage.setItem(OPEN_KEY, String(next));
  }

  function changeWidth(next) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    setWidth(clamped);
    localStorage.setItem('cordiaTutorWidth', String(clamped));
  }

  function startResize(event) {
    event.preventDefault();
    const move = pointerEvent => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pointerEvent.clientX));
      setWidth(next);
    };
    const stop = pointerEvent => {
      changeWidth(pointerEvent.clientX);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function resizeWithKeyboard(event) {
    const step = event.shiftKey ? 40 : 10;
    const next = event.key === 'Home' ? MIN_WIDTH
      : event.key === 'End' ? MAX_WIDTH
        : event.key === 'ArrowLeft' ? width - step
          : event.key === 'ArrowRight' ? width + step : null;
    if (next === null) return;
    event.preventDefault();
    changeWidth(next);
  }

  if (docked) {
    return (
      <section className={`tutor-dock${open ? ' is-open' : ''}`} aria-label="Cordia Tutor">
        <button
          ref={toggleRef}
          type="button"
          className="tutor-dock-toggle"
          onClick={() => changeOpen(!open)}
          aria-controls="cordia-tutor-dock"
          aria-expanded={open}
        >
          <span>Tutor</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
        <div id="cordia-tutor-dock" className="tutor-dock-panel" aria-hidden={!open} inert={!open}>
          <AIChatWidget preferredGuideId={preferredGuideId} preferredNoteId={preferredNoteId} />
        </div>
      </section>
    );
  }

  return (
    <>
      <div ref={shellRef} className={`tutor-drawer-shell${open ? ' is-open' : ''}`} style={{ '--tutor-width': `${width}px` }}>
      <aside id="cordia-tutor-drawer" className="tutor-drawer" aria-label="Cordia Tutor" aria-hidden={!open} inert={!open}>
        <AIChatWidget preferredGuideId={preferredGuideId} preferredNoteId={preferredNoteId} />
        <div className="tutor-resize-handle" role="separator" aria-label="Resize Tutor" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex="0" onKeyDown={resizeWithKeyboard} onPointerDown={startResize} />
      </aside>
      </div>
      <button
        ref={toggleRef}
        type="button"
        className={`tutor-drawer-toggle${open ? ' is-hidden' : ''}`}
        onClick={() => changeOpen(true)}
        aria-controls="cordia-tutor-drawer"
        aria-expanded={open}
        aria-label="Open Cordia Tutor"
        tabIndex={open ? -1 : 0}
      >
        Tutor
      </button>
    </>
  );
}
