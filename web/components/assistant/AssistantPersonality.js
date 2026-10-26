import { useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import BodyPortal from '../BodyPortal';
import { assistantApi } from '../../lib/assistant';
import { SurveyStep } from './AssistantSetup';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u;
const MAX_INSTRUCTIONS = 1500;

const OPT_IN = {
  faith: {
    title: 'Turn on Chaplain?',
    text: 'Chaplain adds brief, non-denominational words of faith and hope. It never preaches, and you can switch back any time.',
    yes: 'Include faith-based encouragement',
    field: 'chaplain_opt_in',
  },
  mature: {
    title: 'This one swears',
    text: "It curses and gets wild, but it never insults you or puts you down, and it drops the act if you're having a rough time. 18+ only.",
    yes: "I'm 18+, turn it on",
    field: 'mature_opt_in',
  },
};

// Reads a shared personality file: Cordia's own export, or any plain-text description.
export function parsePersonaFile(fileName, text) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  try {
    const data = JSON.parse(text);
    const str = value => (typeof value === 'string' ? value : '');
    const instructions = str(data.instructions) || str(data.prompt) || str(data.personality) || str(data.system);
    if (instructions) return { name: (str(data.name) || base).slice(0, 30), description: str(data.description).slice(0, 140), instructions: instructions.slice(0, MAX_INSTRUCTIONS) };
  } catch {
    // Not JSON: the whole file is the personality.
  }
  return { name: base.slice(0, 30), description: '', instructions: text.trim().slice(0, MAX_INSTRUCTIONS) };
}

function download(persona) {
  const body = JSON.stringify({ cordia_persona: 1, name: persona.name, description: persona.description, instructions: persona.instructions }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${persona.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'personality'}.cordia.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Focuses the sheet's first control once, when it opens, and closes it on Escape. onClose is
// read through a ref: the parent passes a new function every render, and re-running this on
// each keystroke pulled the cursor back to the Name field while typing "How it talks".
function useSheetOpened(focusRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    focusRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function PersonaSheet({ draft, onChange, onSave, onDelete, onClose, busy, error }) {
  const firstRef = useRef(null);
  useSheetOpened(firstRef, onClose);
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <form className="c-sheet asst-sheet" role="dialog" aria-modal="true" aria-labelledby="persona-title" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); onSave(); }}>
          <h2 id="persona-title" className="c-title">{draft.id ? `Edit ${draft.name || 'personality'}` : 'New personality'}</h2>
          <label className="c-field"><span>Name</span><input ref={firstRef} className="c-input" maxLength={30} value={draft.name} placeholder="Hype gremlin" onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
          <label className="c-field"><span>Short description</span><input className="c-input" maxLength={140} value={draft.description} placeholder="Chaotic little goblin who believes in me" onChange={event => onChange({ ...draft, description: event.target.value })} /></label>
          <label className="c-field"><span>How it talks</span>
            <textarea className="c-input asst-textarea" rows={6} maxLength={MAX_INSTRUCTIONS} value={draft.instructions} placeholder="A retired rockstar on a comeback tour. Calls my tasks gigs and doesn't let me cancel a show." onChange={event => onChange({ ...draft, instructions: event.target.value })} />
          </label>
          <p className="c-meta">{draft.instructions.trim().length}/{MAX_INSTRUCTIONS} · Safety rules, crisis care and STOP always still apply.</p>
          {error && <p className="asst-error" role="alert">{error}</p>}
          <div className="asst-sheet-actions">
            {draft.id && <button type="button" className="c-btn c-btn--quiet asst-danger" onClick={onDelete} disabled={busy}><Trash2 {...ICON} />Delete</button>}
            <span className="c-grow" />
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save and use'}</button>
          </div>
        </form>
      </div>
    </BodyPortal>
  );
}

function OptInSheet({ kind, onConfirm, onClose, busy }) {
  const copy = OPT_IN[kind];
  const cancelRef = useRef(null);
  useSheetOpened(cancelRef, onClose);
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <div className="c-sheet asst-sheet" role="alertdialog" aria-modal="true" aria-labelledby="optin-title" onClick={event => event.stopPropagation()}>
          <h2 id="optin-title" className="c-title">{copy.title}</h2>
          <p>{copy.text}</p>
          <div className="asst-sheet-actions">
            <span className="c-grow" />
            <button ref={cancelRef} type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="c-btn c-btn--primary" onClick={onConfirm} disabled={busy}>{copy.yes}</button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

export default function AssistantPersonality({ view, catalog, save, reload, toast }) {
  const identity = view.identity;
  const [name, setName] = useState(identity.assistant_name);
  const [nameError, setNameError] = useState('');
  const [instructions, setInstructions] = useState(identity.custom_instructions);
  const [sliders, setSliders] = useState(view.style.sliders);
  const [preview, setPreview] = useState({ text: '', busy: true });
  const [pending, setPending] = useState(null); // a preset waiting on its opt-in
  const [draft, setDraft] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const fileRef = useRef(null);
  const saveTimers = useRef({});
  const previewTimer = useRef(null);
  const previewSeq = useRef(0);

  useEffect(() => { setSliders(view.style.sliders); }, [view.style.sliders]);

  function requestPreview(extra = {}, delay = 700) {
    clearTimeout(previewTimer.current);
    setPreview(current => ({ ...current, busy: true }));
    previewTimer.current = setTimeout(async () => {
      const seq = ++previewSeq.current;
      const out = await assistantApi('/preview', { method: 'POST', json: extra });
      if (seq !== previewSeq.current) return;
      setPreview(current => ({ text: out.ok && out.data.text ? out.data.text : current.text, busy: false }));
    }, delay);
  }
  useEffect(() => { requestPreview({}, 0); }, []);

  function moveSlider(key, value) {
    const next = { ...sliders, [key]: value };
    setSliders(next);
    requestPreview({ overrides: { [key]: value } });
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => save({ section: 'personality', overrides: { [key]: value } }), 500);
  }

  async function resetSlider(key) {
    clearTimeout(saveTimers.current[key]);
    if (await save({ section: 'personality', overrides: { [key]: null } })) requestPreview({}, 0);
  }

  async function commitName() {
    const trimmed = name.trim();
    if (trimmed === identity.assistant_name) { setNameError(''); return; }
    if (!trimmed) { setNameError('Give your assistant a name.'); return; }
    if (trimmed.length > 20) { setNameError('Keep the name to 20 characters.'); return; }
    if (!NAME_RE.test(trimmed)) { setNameError("Use letters, numbers, spaces, . ' or -"); return; }
    setNameError('');
    if (await save({ section: 'identity', assistant_name: trimmed })) { toast('Renamed'); requestPreview({}, 0); }
  }

  async function commitInstructions() {
    const text = instructions.trim();
    if (text === identity.custom_instructions || text.length > 500) return;
    if (await save({ section: 'identity', custom_instructions: text })) { toast('Saved'); requestPreview({}, 0); }
  }

  async function choosePreset(voice) {
    if (voice.id === identity.voice_preset && !identity.persona_id) return;
    if (voice.opt_in) { setPending(voice); return; }
    if (await save({ section: 'identity', voice_preset: voice.id })) requestPreview({}, 0);
  }

  async function confirmPreset() {
    setBusy(true);
    const ok = await save({ section: 'identity', voice_preset: pending.id, [OPT_IN[pending.opt_in].field]: true });
    setBusy(false);
    if (ok) { setPending(null); requestPreview({}, 0); }
  }

  async function choosePersona(id) {
    if (id === identity.persona_id) return;
    if (await save({ section: 'identity', persona_id: id })) requestPreview({}, 0);
  }

  async function saveDraft() {
    const trimmed = draft.name.trim();
    if (!trimmed) { setDraftError('Give the personality a name.'); return; }
    if (draft.instructions.trim().length < 10) { setDraftError('Describe how it talks in a sentence or two.'); return; }
    setBusy(true); setDraftError('');
    const ok = await save({ section: 'personas', save: { ...draft, name: trimmed }, use: true }, setDraftError);
    setBusy(false);
    if (ok) { setDraft(null); toast('Saved'); requestPreview({}, 0); }
  }

  async function deleteDraft() {
    setBusy(true);
    const ok = await save({ section: 'personas', delete: draft.id });
    setBusy(false);
    if (ok) { setDraft(null); toast('Personality deleted'); requestPreview({}, 0); }
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 64000) { toast('That file is too big. Personalities are a few paragraphs at most.'); return; }
    setDraftError('');
    setDraft(parsePersonaFile(file.name, await file.text()));
  }

  const active = identity.personas.find(persona => persona.id === identity.persona_id);
  const isChecked = voice => !identity.persona_id && identity.voice_preset === voice.id;

  return (
    <div className="c-stack">
      <div className="asst-split">
        <div className="c-stack">
          <div className="c-card asst-card">
            <h2 className="c-section-title">Name</h2>
            <label className="c-field">
              <span>Name</span>
              <input className="c-input asst-name" maxLength={20} value={name} onChange={event => setName(event.target.value)} onBlur={commitName} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitName(); } }} aria-invalid={nameError ? true : undefined} />
            </label>
            {nameError ? <p className="asst-error" role="alert">{nameError}</p> : <p className="c-meta">{name.trim().length}/20 · What it calls itself.</p>}
          </div>

          <div className="c-card asst-card">
            <h2 className="c-section-title">Style</h2>
            <p className="c-meta">Move a slider and the sample text updates. Your survey sets where each starts.</p>
            {catalog.sliders.map(slider => {
              const overridden = view.style.overridden.includes(slider.key);
              return (
                <div key={slider.key} className="asst-slider">
                  <div className="asst-slider-head">
                    <label htmlFor={`slider-${slider.key}`} className="asst-slider-label">{slider.label}</label>
                    {overridden && <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => resetSlider(slider.key)}>Reset</button>}
                  </div>
                  <input id={`slider-${slider.key}`} type="range" min={slider.min} max={slider.max} step={1} value={sliders[slider.key]} onChange={event => moveSlider(slider.key, Number(event.target.value))} aria-valuetext={`${sliders[slider.key]} of ${slider.max}`} />
                  <div className="asst-slider-ends c-meta" aria-hidden="true"><span>{slider.low}</span><span>{slider.high}</span></div>
                </div>
              );
            })}
            <button type="button" className="c-btn c-btn--quiet asst-start" onClick={() => setRetaking(true)}>Retake the survey</button>
          </div>
        </div>

        <div className="c-card asst-card asst-preview" aria-live="polite" aria-busy={preview.busy}>
          <span className="c-meta">Sample text</span>
          <p className="asst-bubble is-me">ugh I skipped my run again</p>
          {preview.text ? <p className="asst-bubble">{preview.text}</p> : <p className="c-meta">Writing a sample…</p>}
        </div>
      </div>

      {retaking && (
        <SurveyStep items={catalog.survey} retake onCancel={() => setRetaking(false)} onDone={() => { setRetaking(false); toast('Answers saved'); reload(); requestPreview({}, 0); }} />
      )}

      <div className="c-card asst-card">
        <h2 className="c-section-title">Personality</h2>
        <p className="c-meta">How it sounds. Pick one, or make your own.</p>
        {catalog.voice_groups.map(group => (
          <div key={group.id} className="asst-group" role="radiogroup" aria-label={group.title}>
            <h3 className="asst-group-title">{group.title}</h3>
            <div className="asst-options">
              {catalog.voices.filter(voice => voice.group === group.id).map(voice => (
                <button key={voice.id} type="button" role="radio" aria-checked={isChecked(voice)} className="asst-option" onClick={() => choosePreset(voice)}>
                  <strong>{voice.name}</strong>
                  <span className="c-meta">{voice.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="asst-group" role="radiogroup" aria-label="Your personalities">
          <h3 className="asst-group-title">Yours</h3>
          {identity.personas.length ? (
            <div className="asst-options">
              {identity.personas.map(persona => (
                <button key={persona.id} type="button" role="radio" aria-checked={identity.persona_id === persona.id} className="asst-option" onClick={() => choosePersona(persona.id)}>
                  <strong>{persona.name}</strong>
                  <span className="c-meta">{persona.description || persona.instructions.slice(0, 80)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="c-meta">Write your own, or import one someone shared with you.</p>
          )}
          <div className="asst-actions">
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => { setDraftError(''); setDraft({ name: '', description: '', instructions: '' }); }}><Plus {...ICON} />Create</button>
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => fileRef.current?.click()}><Upload {...ICON} />Import</button>
            {active && <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => { setDraftError(''); setDraft({ ...active }); }}><Pencil {...ICON} />Edit {active.name}</button>}
            {active && <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => download(active)}><Download {...ICON} />Export</button>}
            <input ref={fileRef} type="file" accept=".json,.txt,.md,application/json,text/plain,text/markdown" hidden onChange={event => { importFile(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
        </div>
      </div>

      <div className="c-card asst-card">
        <h2 className="c-section-title">How it talks to you</h2>
        <label className="c-field">
          <span className="sr-only">In your own words</span>
          <textarea className="c-input asst-textarea" rows={4} maxLength={500} value={instructions} placeholder="Talk to me like a coach, not a robot. Keep it to one or two sentences. Push me on workouts, go easy on school." onChange={event => setInstructions(event.target.value)} onBlur={commitInstructions} />
        </label>
        <div className="asst-actions asst-spread">
          <span className="c-meta">{instructions.trim().length}/500 · In your own words. Safety rules and STOP always still apply.</span>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" disabled={instructions.trim() === identity.custom_instructions} onClick={commitInstructions}>Save</button>
        </div>
      </div>

      {pending && <OptInSheet kind={pending.opt_in} busy={busy} onConfirm={confirmPreset} onClose={() => setPending(null)} />}
      {draft && <PersonaSheet draft={draft} onChange={setDraft} onSave={saveDraft} onDelete={deleteDraft} onClose={() => setDraft(null)} busy={busy} error={draftError} />}
    </div>
  );
}
