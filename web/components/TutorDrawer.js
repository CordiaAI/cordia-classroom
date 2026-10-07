import { useEffect, useRef, useState } from 'react';
import AIChatWidget from './AIChatWidget';
import AcademicInfinityMark from './AcademicInfinityMark';

const MIN_WIDTH = 300;
const MAX_WIDTH = 520;
const OPEN_KEY = 'cordiaTutorOpen';

export default function TutorDrawer({ preferredGuideId = '', preferredNoteId = '' }) {
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

  // Reserve space beside the reading window on wide screens.
  useEffect(() => {
    const body = document.body;
    body.classList.toggle('tutor-open', open);
    body.style.setProperty('--tutor-offset', `${width}px`);
    return () => body.classList.remove('tutor-open');
  }, [open, width]);

  // Clicking empty space closes the Tutor; clicking anything you can use (buttons,
  // fields, the drawing board, links) keeps it open so you can work beside it.
  useEffect(() => {
    if (!open) return;
    const closeOnEmptyClick = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (shellRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      if (target.closest('button, a, input, textarea, select, label, canvas, [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="dialog"], [role="separator"], .practice-token')) return;
      changeOpen(false);
    };
    document.addEventListener('pointerdown', closeOnEmptyClick);
    return () => document.removeEventListener('pointerdown', closeOnEmptyClick);
  }, [open]);

  function changeOpen(next) {
    setOpen(next);
    localStorage.setItem(OPEN_KEY, String(next));
    window.dispatchEvent(new CustomEvent('cordia:tutor-visibility', { detail: { open: next } }));
  }

  function changeWidth(next) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    setWidth(clamped);
    localStorage.setItem('cordiaTutorWidth', String(clamped));
  }

  function startResize(event) {
    event.preventDefault();
    const move = pointerEvent => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - pointerEvent.clientX - 20));
      setWidth(next);
    };
    const stop = pointerEvent => {
      changeWidth(window.innerWidth - pointerEvent.clientX - 20);
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


  return (
    <>
      {open && <button type="button" className="tutor-backdrop" aria-label="Dismiss Tutor overlay" onClick={() => { changeOpen(false); toggleRef.current?.focus(); }} />}
      <div ref={shellRef} className={`tutor-drawer-shell${open ? ' is-open' : ''}`} style={{ '--tutor-width': `${width}px` }}>
      <aside id="cordia-tutor-drawer" className="tutor-drawer" aria-label="Cordia Tutor" aria-hidden={!open} inert={!open}>
        <button type="button" className="tutor-close" aria-label="Close Cordia Tutor" onClick={() => { changeOpen(false); toggleRef.current?.focus(); }}>×</button>
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
        <AcademicInfinityMark className="tutor-brand-mark" /> Tutor
      </button>
    </>
  );
}
