import { useEffect, useRef } from 'react';
import BodyPortal from './BodyPortal';

export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <BodyPortal>
    <div className="c-scrim" onClick={onCancel}>
      <div className="c-sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={event => event.stopPropagation()}>
        <h2 id="confirm-title" className="c-section-title">{title}</h2>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-row">
          <button ref={cancelRef} type="button" className="c-btn c-btn--secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="c-btn c-btn--primary confirm-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
      <style jsx>{`
        .confirm-sheet { width: min(400px, 100%); display: grid; gap: 16px; }
        .confirm-message { margin: 0; }
        .confirm-row { display: flex; justify-content: flex-end; gap: 8px; }
        .confirm-danger { background: var(--error-solid); border-color: var(--error-solid); }
        .confirm-danger:hover:not(:disabled) { background: var(--error-solid); filter: brightness(.9); }
      `}</style>
    </div>
    </BodyPortal>
  );
}
