import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { isCardImage, uploadCardImage } from '../lib/cardImages';

// A photo for one side of a flashcard: a small button until one is added, then the photo with a
// remove button. Phones offer the camera from the same picker.
export default function CardPhoto({ value, onChange, label = 'Add photo', onError }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadCardImage(file));
    } catch (error) {
      onError?.(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {value && isCardImage(value) ? (
        <span className="card-photo">
          <img src={value} alt="" />
          <button type="button" className="card-photo-remove" onClick={() => onChange('')} aria-label={`Remove photo (${label.replace(/^Add photo/i, '').trim() || 'card'})`}><X size={14} strokeWidth={2} aria-hidden="true" /></button>
        </span>
      ) : (
        <button type="button" className="card-photo-add" onClick={() => inputRef.current?.click()} disabled={busy} aria-label={label} title={label}>
          {busy ? <Loader2 className="card-photo-spin" size={18} strokeWidth={1.75} aria-hidden="true" /> : <ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={event => { pick(event.target.files?.[0]); event.target.value = ''; }} />
      <style jsx>{`
        .card-photo-add { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); cursor: pointer; }
        .card-photo-add:hover:not(:disabled) { background: var(--lift-pane); box-shadow: var(--lift-shadow); transform: var(--lift); }
        .card-photo-add:disabled { cursor: progress; }
        .card-photo { position: relative; flex: none; display: inline-block; width: 64px; height: 48px; }
        .card-photo img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
        .card-photo-remove { position: absolute; top: -8px; right: -8px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--card); color: var(--ink); cursor: pointer; }
        .card-photo-remove:hover { color: var(--error); }
        :global(.card-photo-spin) { animation: card-photo-spin 900ms linear infinite; }
        @keyframes card-photo-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { :global(.card-photo-spin) { animation: none; } }
      `}</style>
    </>
  );
}
