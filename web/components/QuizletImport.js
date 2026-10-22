import { useEffect, useRef, useState } from 'react';
import { Download, Link as LinkIcon } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { extensionCan, extensionReady, importWithExtension, isQuizletUrl, parseQuizletText } from '../lib/quizletImport';

// "Import from Quizlet": a set link read through the extension, or Quizlet's Export text pasted in.
// The cards land in the editor so the student can check them before saving.
export default function QuizletImport({ initialUrl = '', onImport, onCancel }) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasExtension, setHasExtension] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const firstRef = useRef(null);

  const typedRef = useRef(false);
  typedRef.current = Boolean(text.trim());

  // The extension marks the page once it has loaded, which can be after this sheet opens.
  useEffect(() => {
    const check = () => {
      const ready = extensionCan('quizlet');
      setHasExtension(ready);
      setOutdated(!ready && extensionReady());
      return ready;
    };
    setPasteMode(!check());
    const onMessage = event => {
      if (event.source !== window || event.data?.type !== 'ASAI_EXTENSION_READY') return;
      if (check() && !typedRef.current) setPasteMode(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy, pasteMode]);

  const pasted = pasteMode ? parseQuizletText(text) : [];

  async function importLink(event) {
    event.preventDefault();
    if (!isQuizletUrl(url)) {
      setError('Paste the link to a Quizlet set, like quizlet.com/123456789/biology-flash-cards.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const set = await importWithExtension(url.trim());
      onImport(set);
    } catch (caught) {
      setError(`${caught.message} You can also paste the set's Export text instead.`);
      setBusy(false);
    }
  }

  function importText(event) {
    event.preventDefault();
    if (!pasted.length) {
      setError("No cards found. Paste the text from Quizlet's Export, with a tab between each term and definition.");
      return;
    }
    onImport({ title: '', cards: pasted });
  }

  return (
    <BodyPortal>
    <div className="c-scrim" onClick={() => { if (!busy) onCancel(); }}>
      <div className="c-sheet quizlet-sheet" role="dialog" aria-modal="true" aria-labelledby="quizlet-title" onClick={event => event.stopPropagation()}>
        <h2 id="quizlet-title" className="c-section-title">Import from Quizlet</h2>
        {!pasteMode ? (
          <form className="quizlet-form" onSubmit={importLink}>
            <label className="quizlet-label" htmlFor="quizlet-url">Quizlet set link</label>
            <div className="quizlet-url">
              <LinkIcon size={18} strokeWidth={1.75} aria-hidden="true" />
              <input ref={firstRef} id="quizlet-url" className="c-input" type="url" inputMode="url" value={url} onChange={event => { setUrl(event.target.value); setError(''); }} placeholder="https://quizlet.com/123456789/set-name-flash-cards/" disabled={busy} />
            </div>
            <p className="c-meta quizlet-note">Public sets, and sets you can open while signed in to Quizlet. Use the set's own link, not a Learn, Match or Test link.</p>
            {error && <p className="quizlet-error" role="alert">{error}</p>}
            <div className="quizlet-actions">
              <button type="button" className="c-btn c-btn--quiet quizlet-switch" onClick={() => { setPasteMode(true); setError(''); }} disabled={busy}>Paste text instead</button>
              <button type="button" className="c-btn c-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
              <button type="submit" className="c-btn c-btn--primary" disabled={busy || !url.trim()}>
                <Download size={18} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Reading the set…' : 'Import set'}
              </button>
            </div>
          </form>
        ) : (
          <form className="quizlet-form" onSubmit={importText}>
            <ol className="c-meta quizlet-steps">
              <li>Open the set on Quizlet.</li>
              <li>Choose <strong>⋯</strong>, then <strong>Export</strong>, then <strong>Copy text</strong>.</li>
              <li>Paste it here.</li>
            </ol>
            <textarea ref={firstRef} className="c-input quizlet-text" value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder={'Term\tDefinition\nTerm\tDefinition'} aria-label="Quizlet export text" />
            {text.trim() && <p className="c-meta" role="status">{pasted.length} card{pasted.length === 1 ? '' : 's'} found</p>}
            {!hasExtension && <p className="c-meta quizlet-note">{outdated
              ? <>Update the <a href="/install-extension">Cordia extension</a> to import straight from a set link.</>
              : <>With the <a href="/install-extension">Cordia extension</a>, you can import straight from a set link.</>}</p>}
            {error && <p className="quizlet-error" role="alert">{error}</p>}
            <div className="quizlet-actions">
              {hasExtension && <button type="button" className="c-btn c-btn--quiet quizlet-switch" onClick={() => { setPasteMode(false); setError(''); }}>Use a link</button>}
              <button type="button" className="c-btn c-btn--secondary" onClick={onCancel}>Cancel</button>
              <button type="submit" className="c-btn c-btn--primary" disabled={!pasted.length}>
                <Download size={18} strokeWidth={1.75} aria-hidden="true" />{pasted.length ? `Import ${pasted.length} cards` : 'Import'}
              </button>
            </div>
          </form>
        )}
      </div>
      <style jsx>{`
        .quizlet-sheet { width: min(560px, 100%); display: grid; gap: 14px; }
        .quizlet-form { display: grid; gap: 10px; }
        .quizlet-label { font: 600 14px/1.3 var(--font-sans); color: var(--ink); }
        .quizlet-url { position: relative; display: flex; align-items: center; }
        .quizlet-url :global(svg) { position: absolute; left: 14px; color: var(--muted); pointer-events: none; }
        .quizlet-url :global(input) { width: 100%; padding-left: 42px; }
        .quizlet-note, .quizlet-steps { margin: 0; }
        .quizlet-steps { padding-left: 20px; display: grid; gap: 2px; }
        .quizlet-text { min-height: 180px; font-family: var(--font-mono, monospace); font-size: 13px; tab-size: 4; }
        .quizlet-error { margin: 0; color: var(--error); font-weight: 600; }
        .quizlet-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
        .quizlet-switch { margin-right: auto; }
      `}</style>
    </div>
    </BodyPortal>
  );
}
