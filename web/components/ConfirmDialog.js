import { Sheet } from './Overlay';

// Confirmation for actions with consequences. Cancel is focused first.
export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <Sheet onClose={onCancel} labelledBy="confirm-title" className="confirm-sheet">
      <h2 id="confirm-title" className="c-section-title">{title}</h2>
      {message && <p className="confirm-message">{message}</p>}
      <div className="confirm-row">
        <button type="button" className="c-btn c-btn--secondary" onClick={onCancel} data-autofocus>Cancel</button>
        <button type="button" className="c-btn c-btn--primary confirm-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
      <style jsx global>{`
        .confirm-sheet { width: min(400px, 100%); display: grid; gap: 16px; }
        .confirm-message { margin: 0; }
        .confirm-row { display: flex; justify-content: flex-end; gap: 8px; }
        .confirm-danger { background: var(--error); border-color: var(--error); color: var(--canvas); }
        .confirm-danger:hover:not(:disabled) { background: var(--error); filter: brightness(.92); }
      `}</style>
    </Sheet>
  );
}
