import { useEffect, useRef, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { canvasStatus } from '../lib/canvas';
import ShareSheet from './ShareSheet';

const UNDO_MS = 6000;

// One class suggestion for a finished guide: "Add to MGT 300?". At high confidence with one
// plausible class the guide is filed automatically with an Undo toast.
export default function ClassChip({ guideId, onFiled }) {
  const [suggestion, setSuggestion] = useState(null);
  const [filed, setFiled] = useState(null);
  const [share, setShare] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let active = true;
    if (!guideId) return undefined;
    canvasStatus().then(available => {
      if (!available) return;
      apiFetch('/classes/suggest/' + guideId).then(data => {
        const item = data?.suggestion;
        if (!active || !item) return;
        if (item.auto) {
          afterFile(item, true);
        } else setSuggestion(item);
      });
    });
    return () => { active = false; clearTimeout(timer.current); };
  }, [guideId]);

  function showToast(next) {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), next.undo ? UNDO_MS : 2400);
  }

  function afterFile(result, auto) {
    setSuggestion(null);
    setFiled(result);
    onFiled?.(result);
    if (auto) showToast({ text: `Added to ${result.code}`, undo: true });
    if (result.ask_share) setShare(result);
    else if (result.held) showToast({ text: 'Held for review' });
  }

  async function accept() {
    const item = suggestion;
    setSuggestion(null);
    const data = await apiFetch('/classes/file', { method: 'POST', body: JSON.stringify({ guide_id: guideId, class_id: item.class_id }) });
    if (data?.class_id) afterFile({ ...item, ...data }, false);
  }

  async function undo() {
    clearTimeout(timer.current);
    setToast(null);
    setShare(null);
    await apiFetch('/classes/unfile', { method: 'POST', body: JSON.stringify({ guide_id: guideId, folder_id: filed?.previous_folder_id || null }) });
    onFiled?.(null);
    setFiled(null);
  }

  return (
    <>
      {suggestion && (
        <button type="button" className="c-chip class-chip" onClick={accept} data-spot="class-chip">
          <GraduationCap size={16} strokeWidth={1.75} aria-hidden="true" />Add to {suggestion.code}?
        </button>
      )}
      {share && (
        <ShareSheet classId={share.class_id} code={share.code} guideId={guideId} onDone={result => {
          setShare(null);
          if (result.status === 'held') showToast({ text: 'Held for review' });
          else if (result.share) showToast({ text: `Shared with ${share.code}` });
        }} />
      )}
      {toast && (
        <div className="c-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="c-btn c-btn--quiet" onClick={undo}>Undo</button>}
        </div>
      )}
      <style jsx>{`
        .class-chip { justify-self: start; align-self: start; }
      `}</style>
    </>
  );
}
