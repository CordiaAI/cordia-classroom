import { useCallback, useEffect, useRef, useState } from 'react';
import { Pipette, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import SegmentedControl from './SegmentedControl';
import { defaultLook, lookSettings, saveLook } from '../lib/theme';
import { cssVar } from '../lib/cssVar';
import { ACCENTS, BACKGROUNDS, FONTS, SIZES, applyPreset, validateSettings, withCustomAccent } from '../lib/themeSettings.mjs';
import {
  ACCENT_NAMES, APPEARANCE_NAMES, BACKGROUND_NAMES, FONT_NAMES, GLASS_CHOICES, GLASS_NAMES, MAKE_IT_YOURS_EVENT, SIZE_NAMES, UNDO_MS,
  customAccentAdjusted, pickGlass, sameSettings, shownGlass, themeTiles,
} from '../lib/makeItYours.mjs';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function matches(query) {
  try { return typeof window !== 'undefined' && Boolean(window.matchMedia) && window.matchMedia(query).matches; } catch { return false; }
}

// The host: mounted once in the signed-in Layout (both shells, every width), so the sheet opens from the
// account menus, Settings and Search alike (lib/makeItYours.mjs openMakeItYours). It owns the Undo toast so the
// toast outlives the sheet when the student closes it straight after Reset.
export default function MakeItYoursHost() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('closed'); // opening | open | closing | closed
  const returnTo = useRef(null);
  const timer = useRef(null);
  const [undo, setUndo] = useState(null); // { previous, key } while the Undo toast shows
  const undoTimer = useRef(null);
  const toastRef = useRef(null);

  useEffect(() => {
    function onOpen(event) {
      const target = event.detail?.returnTo;
      returnTo.current = target instanceof HTMLElement ? target : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      clearTimeout(timer.current);
      setOpen(true);
      setPhase('opening');
      timer.current = setTimeout(() => setPhase('open'), OPEN_MS);
    }
    window.addEventListener(MAKE_IT_YOURS_EVENT, onOpen);
    return () => { window.removeEventListener(MAKE_IT_YOURS_EVENT, onOpen); clearTimeout(timer.current); };
  }, []);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    setPhase('closing');
    timer.current = setTimeout(() => { setOpen(false); setPhase('closed'); }, matches('(prefers-reduced-motion: reduce)') ? 0 : CLOSE_MS);
    // Focus goes back to whatever opened it: the account row, the Settings row, or what Search was opened from.
    const back = returnTo.current;
    requestAnimationFrame(() => {
      if (back && back.isConnected) back.focus({ preventScroll: true });
      else document.querySelector('.c-side-account, .c-avatar')?.focus({ preventScroll: true });
    });
  }, []);

  const showUndo = useCallback(previous => {
    clearTimeout(undoTimer.current);
    setUndo({ previous, key: Date.now() });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }, []);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  function onUndo() {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    saveLook(undo.previous);
    window.dispatchEvent(new CustomEvent('cordia:make-it-yours-restored'));
    setUndo(null);
  }

  return (
    <>
      {open && <MakeItYoursSheet phase={phase} onClose={close} onReset={showUndo} toastRef={toastRef} />}
      {undo && (
        <BodyPortal>
          <div key={undo.key} ref={toastRef} className="c-toast miy-toast" role="status">
            <span>Back to Cordia</span>
            <button type="button" className="c-btn c-btn--quiet" onClick={onUndo}>Undo</button>
          </div>
        </BodyPortal>
      )}
      <style jsx global>{`
        /* Reset happens in the sheet, so its Undo toast is born over it: it sits at the top, centred on the window
           like the sheet, and the sheet makes room under it, so it never covers the footer (Reset, Done) or the
           title. It keeps that place for its six seconds, even if the sheet closes first. */
        .c-toast.miy-toast { top: calc(16px + env(safe-area-inset-top)); bottom: auto !important; left: 50% !important; width: max-content; }
        :root:has(.miy-toast) .miy-scrim { --miy-toast-room: calc(78px + env(safe-area-inset-top)); }
      `}</style>
    </>
  );
}

// Arrow keys move along a row of tiles or swatches and pick as they go, like native radio buttons (and show
// on the next frame: the sheet drops its transitions while the keyboard drives it). The custom colour is the
// Accent row's ninth choice: arrows only move to it, since picking it opens the colour picker (Enter or Space).
function onRadioKeys(event, setKeyed) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step && event.key !== 'Home' && event.key !== 'End') return;
  const radios = [...event.currentTarget.querySelectorAll('[role="radio"]:not([disabled])')];
  const at = radios.indexOf(document.activeElement);
  if (at < 0) return;
  event.preventDefault();
  const next = step ? radios[(at + step + radios.length) % radios.length] : radios[event.key === 'Home' ? 0 : radios.length - 1];
  setKeyed(true);
  next.focus();
  if (!next.hasAttribute('data-opens-picker')) next.click();
}

function MakeItYoursSheet({ phase, onClose, onReset, toastRef }) {
  const [settings, setSettings] = useState(() => lookSettings());
  const [reduceGlass] = useState(() => matches(REDUCED_TRANSPARENCY));
  const [keyed, setKeyed] = useState(false);
  const sheetRef = useRef(null);
  const resetRef = useRef(null);
  const pending = useRef(null);
  const frame = useRef(0);
  const pickerRef = useRef(null);

  // Every pick applies to the whole app at once and saves (the device at once, the account quietly).
  const commit = useCallback(next => {
    const saved = saveLook(next);
    setSettings(saved);
    return saved;
  }, []);

  // Undo puts back exactly what was there; the sheet shows it too.
  useEffect(() => {
    const onRestored = () => setSettings(lookSettings());
    window.addEventListener('cordia:make-it-yours-restored', onRestored);
    return () => window.removeEventListener('cordia:make-it-yours-restored', onRestored);
  }, []);

  // Focus moves to the dialog's heading on open (so the title is read first); Escape closes; Tab stays inside the
  // sheet (and the Undo toast while it shows).
  useEffect(() => {
    const first = requestAnimationFrame(() => sheetRef.current?.querySelector('#miy-title')?.focus({ preventScroll: true }));
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const nodes = [...sheetRef.current.querySelectorAll(FOCUSABLE), ...(toastRef.current ? toastRef.current.querySelectorAll(FOCUSABLE) : [])]
        .filter(node => node.offsetParent !== null || node === document.activeElement);
      if (!nodes.length) return;
      const at = nodes.indexOf(document.activeElement);
      const inside = at >= 0 || sheetRef.current.contains(document.activeElement);
      if (event.shiftKey && (at <= 0 || !inside)) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && (at === nodes.length - 1 || !inside)) { event.preventDefault(); nodes[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(first); document.removeEventListener('keydown', onKey); };
  }, [onClose, toastRef]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const look = settings.look !== 'none';
  const atDefault = sameSettings(settings, defaultLook());
  const adjusted = customAccentAdjusted(settings);
  const glass = shownGlass(settings, reduceGlass);
  const swatchAccent = accent => (accent === 'custom' ? settings.customAccent : `var(--swatch-accent-${accent})`);

  // The colour picker fires on every move; apply once per frame.
  function onCustom(event) {
    pending.current = event.target.value;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const { settings: next } = withCustomAccent(settings, pending.current);
      commit(next);
    });
  }
  const pickerValue = (settings.accent === 'custom' && settings.customAccent) || cssVar(`--swatch-accent-${ACCENTS.includes(settings.accent) ? settings.accent : 'olive'}`, '') || undefined;
  // The ninth Accent choice opens the browser's colour picker (it is a radio for arrows and screen readers; the
  // colour input itself is out of the tab order and hidden from them).
  function openPicker() {
    const input = pickerRef.current;
    if (!input) return;
    try { if (typeof input.showPicker === 'function') { input.showPicker(); return; } } catch { /* not allowed here: fall back */ }
    input.click();
  }
  const customChosen = settings.accent === 'custom';

  function reset() {
    if (atDefault) return;
    const previous = validateSettings(settings);
    commit(defaultLook());
    onReset(previous);
  }

  const radioProps = (chosen, onPick) => ({
    type: 'button', role: 'radio', 'aria-checked': chosen, tabIndex: chosen ? 0 : -1, onClick: onPick,
  });
  // A row whose current value is none of its tiles (a font after Paper & Clay) still needs one tab stop.
  const firstTabStop = (ids, current) => (ids.includes(current) ? null : ids[0]);
  const fontStop = firstTabStop(FONTS, settings.font);
  const accentStop = customChosen ? null : firstTabStop(ACCENTS, settings.accent);

  return (
    <BodyPortal>
      <div className={`miy-scrim is-${phase}`} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={sheetRef} className={'miy-sheet' + (keyed ? ' is-keyed' : '')} role="dialog" aria-modal="true" aria-labelledby="miy-title" aria-describedby="miy-sub"
          onPointerDown={() => keyed && setKeyed(false)}>
          <header className="miy-head">
            <div className="miy-head-text">
              <h2 id="miy-title" tabIndex={-1}>Make it yours</h2>
              <p id="miy-sub">Changes show up everywhere as you pick them, on every device you sign in to.</p>
            </div>
            <button type="button" className="c-icon-btn miy-close" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </header>

          <div className="miy-body">
            <div className="miy-row" role="group" aria-labelledby="miy-l-theme">
              <div className="miy-label"><span id="miy-l-theme">Theme</span><span className="miy-hint">A starting point. Change anything below.</span></div>
              <div className="miy-themes" role="radiogroup" aria-labelledby="miy-l-theme" onKeyDown={event => onRadioKeys(event, setKeyed)}>
                {themeTiles(settings).map(tile => (
                  <button key={tile.id} className="miy-tile miy-theme" {...radioProps(tile.chosen, () => { if (tile.id !== 'custom') commit(applyPreset(settings, tile.id)); })}>
                    {tile.id === 'paper-clay' ? (
                      <span className="miy-art miy-art-look" aria-hidden="true"><span className="miy-look-aa">Aa</span><span className="miy-look-dot" /></span>
                    ) : (
                      <span className="miy-art" aria-hidden="true" style={{ background: `var(--swatch-bg-${tile.id === 'custom' ? settings.bg : tile.bg})` }}>
                        <span className="miy-art-side" />
                        <span className="miy-art-dot" style={{ background: tile.id === 'custom' ? (settings.accent === 'paperclay' ? 'var(--swatch-accent-paperclay)' : swatchAccent(settings.accent)) : `var(--swatch-accent-${tile.accent})` }} />
                        <span className="miy-art-line" />
                      </span>
                    )}
                    <span className="miy-name">{tile.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-accent">
              <div className="miy-label"><span id="miy-l-accent">Accent</span><span className="miy-hint">Custom colours are adjusted so text stays readable.</span></div>
              <div className="miy-controls">
                <div className="miy-accents">
                  <div className="miy-dots" role="radiogroup" aria-labelledby="miy-l-accent" onKeyDown={event => onRadioKeys(event, setKeyed)}>
                    {ACCENTS.map(accent => (
                      <button key={accent} className="miy-dot" aria-label={ACCENT_NAMES[accent]} {...radioProps(settings.accent === accent, () => commit({ ...settings, accent, customAccent: null }))}
                        tabIndex={settings.accent === accent || accentStop === accent ? 0 : -1}>
                        <span className="miy-dot-fill" style={{ background: `var(--swatch-accent-${accent})` }} aria-hidden="true" />
                      </button>
                    ))}
                    <span className="miy-custom-slot">
                      <button className={'miy-dot miy-custom' + (customChosen ? ' is-chosen' : '')} data-opens-picker="" title="Custom colour"
                        aria-label={customChosen ? `Custom colour, ${settings.customAccent}` : 'Custom colour'} {...radioProps(customChosen, openPicker)}>
                        <span className="miy-dot-fill" style={customChosen ? { background: settings.customAccent } : undefined} aria-hidden="true">
                          {!customChosen && <Pipette size={16} strokeWidth={2} />}
                        </span>
                      </button>
                      <input ref={pickerRef} type="color" className="miy-picker" tabIndex={-1} aria-hidden="true"
                        value={(pickerValue || '').toLowerCase()} onChange={onCustom} />
                    </span>
                  </div>
                </div>
                <p className="miy-note" role="status" aria-live="polite">{adjusted ? 'Adjusted so text stays readable' : ''}</p>
              </div>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-bg">
              <div className="miy-label"><span id="miy-l-bg">Background</span></div>
              <div className="miy-tiles" role="radiogroup" aria-labelledby="miy-l-bg" onKeyDown={event => onRadioKeys(event, setKeyed)}>
                {BACKGROUNDS.map(bg => (
                  <button key={bg} className="miy-tile miy-small" {...radioProps(settings.bg === bg, () => commit({ ...settings, bg }))}>
                    <span className="miy-art miy-art-bg" style={{ background: `var(--swatch-bg-${bg})` }} aria-hidden="true" />
                    <span className="miy-name">{BACKGROUND_NAMES[bg]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-font">
              <div className="miy-label"><span id="miy-l-font">Font</span><span className="miy-hint" id="miy-readable">Readable is built for dyslexia and low vision.</span></div>
              <div className="miy-tiles" role="radiogroup" aria-labelledby="miy-l-font" onKeyDown={event => onRadioKeys(event, setKeyed)}>
                {FONTS.map(font => (
                  <button key={font} className="miy-tile miy-small miy-font" {...radioProps(settings.font === font, () => commit({ ...settings, font }))}
                    tabIndex={settings.font === font || fontStop === font ? 0 : -1} aria-describedby={font === 'readable' ? 'miy-readable' : undefined}>
                    <span className="miy-font-aa" style={{ fontFamily: `var(--font-${font}-display)` }} aria-hidden="true">Aa</span>
                    <span className="miy-font-name" style={{ fontFamily: `var(--font-${font}-ui)` }}>{FONT_NAMES[font]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-size">
              <div className="miy-label"><span id="miy-l-size">Text size</span></div>
              <SegmentedControl kind="radio" labelledBy="miy-l-size" className="miy-seg">
                {SIZES.map(size => (
                  <button key={size} type="button" role="radio" aria-checked={settings.size === size} onClick={() => commit({ ...settings, size })}>{SIZE_NAMES[size]}</button>
                ))}
              </SegmentedControl>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-appearance">
              <div className="miy-label"><span id="miy-l-appearance">Appearance</span></div>
              <SegmentedControl kind="radio" labelledBy="miy-l-appearance" className="miy-seg">
                {['light', 'dark', 'system'].map(appearance => (
                  <button key={appearance} type="button" role="radio" aria-checked={settings.appearance === appearance} onClick={() => commit({ ...settings, appearance })}>{APPEARANCE_NAMES[appearance]}</button>
                ))}
              </SegmentedControl>
            </div>

            <div className="miy-row" role="group" aria-labelledby="miy-l-glass">
              <div className="miy-label"><span id="miy-l-glass">Glass</span><span className="miy-hint" id="miy-glass-hint">{look ? 'Paper & Clay is always solid.' : 'Solid is easier to read on busy backgrounds.'}</span></div>
              <SegmentedControl kind="radio" labelledBy="miy-l-glass" className={'miy-seg' + (look ? ' is-locked' : '')} aria-describedby={look ? 'miy-glass-hint' : undefined}>
                {GLASS_CHOICES.map(choice => (
                  <button key={choice} type="button" role="radio" aria-checked={glass === choice} disabled={look} onClick={() => commit(pickGlass(settings, choice, reduceGlass))}>{GLASS_NAMES[choice]}</button>
                ))}
              </SegmentedControl>
            </div>
          </div>

          <footer className="miy-foot">
            <button ref={resetRef} type="button" className="c-btn c-btn--quiet miy-reset" onClick={reset} aria-disabled={atDefault || undefined}>Reset to Cordia</button>
            <button type="button" className="c-btn c-btn--primary miy-done" onClick={onClose}>Done</button>
          </footer>
        </section>
      </div>
      <style jsx global>{`
        /* DESIGN-SPEC 3.5 and 4.6: an 880px sheet of solid menu glass, 28px corners, over a 22% ink scrim with a
           3px blur; a full-height sheet on phones. Every value is a token. */
        .miy-scrim {
          --miy-toast-room: 0px;
          position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: calc(16px + var(--miy-toast-room)) 16px 16px;
          background: var(--scrim-sheet); -webkit-backdrop-filter: var(--scrim-sheet-blur); backdrop-filter: var(--scrim-sheet-blur);
          animation: miy-fade ${OPEN_MS}ms var(--ease) both;
        }
        .miy-scrim.is-closing { animation: miy-fade-out ${CLOSE_MS}ms var(--ease-exit) both; pointer-events: none; }
        .miy-sheet {
          position: relative; display: flex; flex-direction: column; width: min(880px, 100%); max-height: calc(100dvh - 32px - var(--miy-toast-room));
          border-radius: var(--r-panel); border: 1px solid; border-color: var(--glass-rim-border);
          background: var(--lg-menu); color: var(--ink);
          box-shadow: var(--glass-shadow-edge), var(--lg-depth-float);
          animation: miy-rise ${OPEN_MS}ms var(--ease) both;
        }
        .miy-scrim.is-closing .miy-sheet { animation: miy-sink ${CLOSE_MS}ms var(--ease-exit) both; }
        @keyframes miy-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes miy-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes miy-rise { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
        @keyframes miy-sink { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(8px) scale(.98); } }

        .miy-head { display: flex; align-items: flex-start; gap: 12px; padding: 24px 28px 8px; }
        .miy-head-text { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
        .miy-head h2 { margin: 0; font: 600 1.875rem/1.15 var(--font-display); letter-spacing: var(--track-title); color: var(--ink); outline: none; }
        /* Focus lands on the title so it is read first; it is not a control, so it shows no ring. */
        .miy-sheet .miy-head h2:focus-visible { outline: none !important; }
        .miy-head p { margin: 0; font: 500 0.9375rem/1.4 var(--font-sans); color: var(--muted); }
        .miy-close.miy-close { width: 40px; height: 40px; flex: none; color: var(--muted); }

        .miy-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 28px 0; overscroll-behavior: contain; }
        .miy-row { display: grid; grid-template-columns: 184px minmax(0, 1fr); gap: 20px; align-items: start; padding: 12px 0; border-top: 1px solid var(--hairline); }
        .miy-row:first-child { border-top: 0; }
        .miy-label { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; }
        .miy-label > span:first-child { font: 700 0.9375rem/1.3 var(--font-sans); color: var(--ink); }
        .miy-hint { font: 500 0.8125rem/1.4 var(--font-sans); color: var(--muted); }

        /* Tiles: theme windows, backgrounds and fonts. Chosen: the 2px accent ring with its 5px halo. Hover lifts an
           unchosen tile 1px (pointer only); nothing changes colour. */
        /* Every theme tile on one row (seven, or eight with Custom), so none sits alone on a second row. */
        .miy-themes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; }
        .miy-tiles { display: flex; flex-wrap: wrap; gap: 10px; }
        .miy-tile {
          display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 5px 5px 6px; margin: 0;
          border: 0; border-radius: var(--r-row); background: var(--glass-inner); color: var(--ink);
          box-shadow: var(--glass-inner-shadow); cursor: pointer; text-align: center;
          transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .miy-tile[aria-checked='true'] { box-shadow: var(--tile-ring); cursor: default; }
        .miy-small { width: 92px; }
        .miy-art { position: relative; display: block; height: 44px; border-radius: var(--r-input); overflow: hidden; box-shadow: var(--swatch-dot-edge); }
        .miy-art-bg { height: 52px; }
        .miy-art-side { position: absolute; left: 6px; top: 5px; bottom: 5px; width: 16px; border-radius: 5px; background: var(--swatch-tile-side); }
        .miy-art-dot { position: absolute; left: 28px; top: 8px; width: 22px; height: 8px; border-radius: var(--r-pill); }
        .miy-art-line { position: absolute; left: 28px; right: 8px; bottom: 8px; height: 10px; border-radius: 6px; background: var(--swatch-tile-line); }
        .miy-art-look { display: grid; place-items: center; background: var(--swatch-look-paper-clay); box-shadow: inset 0 0 0 1px var(--swatch-look-paper-clay-edge); }
        .miy-look-aa { font: 600 1.375rem/1 var(--swatch-look-paper-clay-font); color: var(--swatch-look-paper-clay-ink); }
        .miy-look-dot { position: absolute; right: 8px; bottom: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--swatch-look-paper-clay-dot); }
        .miy-name { font: 600 0.8125rem/1.25 var(--font-sans); color: var(--ink); text-wrap: balance; }
        .miy-font { height: 70px; align-items: center; justify-content: center; gap: 4px; }
        .miy-font-aa { font-size: 1.625rem; font-weight: 600; line-height: 1; color: var(--ink); }
        .miy-font-name { font-size: 0.8125rem; font-weight: 600; line-height: 1.25; color: var(--muted); }

        /* Accent dots: 32px, inside a 44px target. The current one has a 2px gap ring. */
        .miy-controls { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .miy-accents, .miy-dots { display: flex; flex-wrap: wrap; align-items: center; gap: 0; }
        .miy-dot { position: relative; display: grid; place-items: center; width: 44px; height: 44px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
        .miy-dot-fill {
          display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; box-shadow: var(--swatch-dot-edge);
          transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .miy-dot[aria-checked='true'] .miy-dot-fill, .miy-custom.is-chosen .miy-dot-fill { box-shadow: var(--dot-ring); }
        .miy-custom-slot { position: relative; display: inline-grid; }
        .miy-custom .miy-dot-fill { background: var(--swatch-custom-wheel); color: var(--swatch-custom-icon); }
        .miy-custom .miy-dot-fill svg { filter: var(--swatch-custom-icon-shadow); }
        .miy-custom.is-chosen .miy-dot-fill { color: transparent; }
        /* The colour input sits under its radio, so the browser opens the picker there; the radio takes every click. */
        .miy-picker { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
        .miy-note { margin: 0; min-height: 1.25rem; font: 600 0.8125rem/1.4 var(--font-sans); color: var(--muted); }

        @media (hover: hover) {
          .miy-tile:not([aria-checked='true']):hover { transform: translateY(-1px); }
          .miy-dot:not([aria-checked='true']):hover .miy-dot-fill { transform: translateY(-1px); }
        }
        .miy-tile:not([aria-checked='true']):active { transform: var(--press); }
        .miy-dot:active .miy-dot-fill { transform: var(--press); }
        .miy-tile:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 7px; }
        .miy-dot:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 0; }
        .miy-sheet.is-keyed :is(.miy-tile, .miy-dot-fill) { transition: none; }

        .miy-row > .miy-seg { justify-self: start; max-width: 100%; }
        .miy-seg.is-locked { opacity: .6; }
        .miy-seg.is-locked > button { cursor: not-allowed; }

        .miy-foot { display: flex; align-items: center; gap: 12px; padding: 16px 28px 22px; margin-top: 6px; border-top: 1px solid var(--hairline); }
        .miy-reset.miy-reset { color: var(--ink); }
        .miy-reset[aria-disabled='true'] { color: var(--muted); cursor: default; }
        @media (hover: hover) { .miy-reset[aria-disabled='true']:hover { background: transparent !important; } }
        .miy-done { margin-left: auto; min-width: 96px; }

        /* Phones: a full-height sheet; labels above their controls; every target at least 44px. */
        @media (max-width: 767px) {
          .miy-scrim { padding: 0; place-items: stretch; }
          .miy-sheet { position: fixed; inset: var(--miy-toast-room) 0 0; width: auto; height: auto; max-height: none; border-radius: 0; border-width: 0; }
          @keyframes miy-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
          @keyframes miy-sink { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(24px); } }
          .miy-head { padding: calc(16px + env(safe-area-inset-top)) 16px 8px; }
          .miy-head h2 { font-size: 1.75rem; }
          .miy-close.miy-close { width: 44px; height: 44px; }
          .miy-body { padding: 4px 16px 0; }
          .miy-row { grid-template-columns: minmax(0, 1fr); gap: 10px; }
          .miy-label { padding-top: 0; }
          .miy-themes { grid-auto-flow: row; grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .miy-small { width: calc((100% - 20px) / 3); min-width: 92px; }
          /* Nine 44px choices are wider than a phone: five and four, not eight and a lone custom colour. */
          .miy-dots { display: grid; grid-template-columns: repeat(5, 44px); }
          .miy-seg { max-width: 100%; }
          .miy-seg > button { min-height: 44px; }
          .miy-foot { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
        }
        /* Less motion: the sheet and its scrim appear and go with no movement and no fade. */
        @media (prefers-reduced-motion: reduce) {
          .miy-scrim, .miy-sheet, .miy-scrim.is-closing, .miy-scrim.is-closing .miy-sheet { animation: none; }
          .miy-tile, .miy-dot-fill { transition: none; }
          .miy-tile:hover, .miy-tile:active, .miy-dot .miy-dot-fill { transform: none !important; }
        }
      `}</style>
    </BodyPortal>
  );
}
