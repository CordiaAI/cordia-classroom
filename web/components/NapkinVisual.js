import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Sparkles } from 'lucide-react';
import { authOnlyHeaders, openUpgrade } from '../lib/api';
import CordiaLoader from './CordiaLoader';
import { currentTheme } from './MermaidDiagram';

export const VISUAL_ERROR = "Couldn't make a visual. Try again.";
// New drawings a student can ask for after the first (the server holds the same cap).
const MAX_REDRAWS = 3;
// Why Napkin didn't draw, in words a student can act on.
const REASONS = {
  not_configured: "Visuals aren't set up yet.",
  rate_limited: 'Napkin is busy. Try again in a minute.',
  timeout: 'Napkin took too long. Try again.',
  napkin_error: 'Napkin turned this one down.',
  no_credits: "Visuals are paused for now. We're on it.",
  no_visuals: "Napkin couldn't find a picture in this text. Try a longer passage.",
  download_failed: "Napkin drew it, but it didn't come through. Try again.",
};

// Visuals left this month, shared by every NapkinVisual on the page.
let usageCache = null;
let usagePromise = null;
const usageListeners = new Set();
function setUsage(next) {
  usageCache = next;
  usageListeners.forEach(listener => listener(next));
}
function loadUsage() {
  if (!usagePromise) {
    usagePromise = fetch('/api/visual', { headers: authOnlyHeaders() })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null)
      .then(data => { setUsage(data); return data; });
  }
  return usagePromise;
}
export function useVisualUsage() {
  const [usage, setLocal] = useState(usageCache);
  useEffect(() => {
    usageListeners.add(setLocal);
    loadUsage();
    return () => usageListeners.delete(setLocal);
  }, []);
  return usage;
}

function useTheme() {
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    setTheme(currentTheme());
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function visualsLeftLabel(usage) {
  if (!usage || typeof usage.left !== 'number') return '';
  return `${usage.left} visual${usage.left === 1 ? '' : 's'} left`;
}

async function saveFile(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function download(visual, format, name) {
  const svg = await (await fetch(visual.url)).text();
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  if (format === 'svg') return saveFile(svgBlob, `${name}.svg`);
  const href = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = href;
    });
    const scale = 2;
    const width = (visual.width || image.naturalWidth || 1200) * scale;
    const height = (visual.height || image.naturalHeight || 800) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (png) await saveFile(png, `${name}.png`);
  } finally {
    URL.revokeObjectURL(href);
  }
}

// A Napkin visual for a piece of study text. `fallback()` renders the page's own themed
// diagram whenever there is no visual (not set up, timed out, rate limited, failed).
// auto: start at once (Notes' "Make diagram"); otherwise a "Make visual" button shows.
export default function NapkinVisual({ text, context = '', fallback, auto = false, onUse, useLabel = 'Use this', name = 'cordia-visual' }) {
  const usage = useVisualUsage();
  const theme = useTheme();
  const [state, setState] = useState({ phase: 'idle' }); // idle | loading | ready | fallback | limit
  const [index, setIndex] = useState(0);
  const [used, setUsed] = useState(false);
  const disabled = usage?.enabled === false;
  const autoStarted = useRef('');

  // redraw 0 is the first drawing; 1-3 ask Napkin for a new one, added beside the earlier ones.
  async function make(redraw = 0) {
    const earlier = redraw > 0 && state.phase === 'ready' ? state : null;
    // A failed redraw goes back to the versions already made, with the reason under them.
    const giveUp = fallbackState => (earlier ? setState({ ...earlier, note: fallbackState.reason || 'error', detail: fallbackState.detail }) : setState(fallbackState));
    setState({ phase: 'loading', redraw });
    if (!earlier) setIndex(0);
    setUsed(false);
    try {
      const ask = resume => fetch('/api/visual', {
        method: 'POST',
        headers: { ...authOnlyHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context, theme: drawnTheme, ...(redraw ? { redraw } : {}), ...(resume ? { resume } : {}) }),
      });
      const drawnTheme = currentTheme();
      let response = await ask();
      let data = await response.json().catch(() => ({}));
      // A slow drawing answers "pending"; keep asking with its ticket (the server stops at 3 minutes).
      for (let round = 0; data?.status === 'pending' && data.resume && round < 12; round += 1) {
        setState({ phase: 'loading', redraw, slow: true });
        response = await ask(data.resume);
        data = await response.json().catch(() => ({}));
      }
      if (response.status === 402) {
        const detail = data?.detail || {};
        setUsage({ ...(usageCache || {}), left: 0, limit: detail.limit });
        if (detail.plan === 'free') openUpgrade({ feature: 'visual' });
        if (earlier) giveUp({ reason: 'limit' });
        else setState({ phase: 'limit', pro: detail.plan !== 'free' });
        return;
      }
      if (data?.status === 'ok' && data.visuals?.length) {
        if (typeof data.left === 'number') setUsage({ ...(usageCache || {}), left: data.left, limit: data.limit });
        const visuals = [...(earlier?.visuals || []), ...data.visuals];
        setState({ phase: 'ready', visuals, alt: data.alt, rendered: data.theme, redraws: redraw });
        setIndex(visuals.length - data.visuals.length);
        return;
      }
      giveUp({ phase: 'fallback', reason: data?.reason, detail: typeof data?.detail === 'string' ? data.detail : '', quiet: data?.reason === 'not_configured' && Boolean(fallback) });
    } catch {
      giveUp({ phase: 'fallback' });
    }
  }

  useEffect(() => {
    if (!auto || !text) return;
    if (disabled) { setState({ phase: 'fallback', reason: 'not_configured', quiet: Boolean(fallback) }); return; }
    // Start drawing at once, once per text (each request is a paid Napkin drawing); the server
    // says if visuals aren't set up or none are left.
    if (autoStarted.current === text) return;
    autoStarted.current = text;
    make();
  }, [auto, text, disabled]);

  const left = visualsLeftLabel(usage);
  const visual = state.visuals?.[index];

  if (state.phase === 'loading') {
    return (
      <div className="nv">
        <div className="nv-frame nv-frame--loading">
          <div className="nv-wait"><CordiaLoader label="Making a visual" /><span className="c-meta">{state.slow ? 'Still drawing. Detailed visuals can take a minute.' : (state.redraw ? 'Drawing a new version…' : 'Drawing your visual…')}</span></div>
        </div>
        <VisualStyle />
      </div>
    );
  }

  if (state.phase === 'ready' && visual) {
    // Never a light visual on a dark page: if the theme changed since it was made, recolour it.
    const inverted = state.rendered && state.rendered !== theme;
    return (
      <div className="nv">
        <figure className="nv-frame">
          <img className={'nv-image' + (inverted ? ' is-inverted' : '')} src={visual.url} alt={state.alt || 'Diagram'} width={visual.width || undefined} height={visual.height || undefined} />
        </figure>
        <div className="nv-bar">
          {!used && (
            <button type="button" className={`c-btn c-btn--sm ${onUse ? 'c-btn--primary' : 'c-btn--secondary'}`} onClick={() => { setUsed(true); onUse?.({ ...visual, alt: state.alt, theme: state.rendered }); }}>{useLabel}</button>
          )}
          {state.visuals.length > 1 && !used && (
            <div className="nv-dots" role="group" aria-label="Versions">
              {state.visuals.map((item, dot) => (
                <button key={item.url} type="button" className={'nv-dot' + (dot === index ? ' is-on' : '')} aria-label={`Version ${dot + 1} of ${state.visuals.length}`} aria-pressed={dot === index} onClick={() => setIndex(dot)} />
              ))}
            </div>
          )}
          <div className="nv-actions">
            {!used && (state.redraws || 0) < MAX_REDRAWS && (
              <button type="button" className="c-btn c-btn--sm c-btn--quiet" onClick={() => make((state.redraws || 0) + 1)} title={`${MAX_REDRAWS - (state.redraws || 0)} redraw${MAX_REDRAWS - (state.redraws || 0) === 1 ? '' : 's'} left`}><RefreshCw aria-hidden="true" />Regenerate</button>
            )}
            <button type="button" className="c-icon-btn" aria-label="Download SVG" title="Download SVG" onClick={() => download(visual, 'svg', name)}><Download size={18} strokeWidth={1.75} aria-hidden="true" /></button>
            <button type="button" className="c-btn c-btn--sm c-btn--quiet" onClick={() => download(visual, 'png', name)}>PNG</button>
          </div>
        </div>
        {state.note && (
          <p className="nv-error" role="alert">
            {state.note === 'limit' ? "You've used this month's visuals." : REASONS[state.note] || VISUAL_ERROR}
            {state.note === 'napkin_error' && state.detail ? ` (${state.detail})` : ''}
          </p>
        )}
        <VisualStyle />
      </div>
    );
  }

  return (
    <div className="nv">
      {fallback?.()}
      {state.phase === 'fallback' && !state.quiet && (
        <p className="nv-error" role="alert">
          {REASONS[state.reason] || VISUAL_ERROR}
          {state.reason === 'not_configured' && usage?.missing?.length ? ` Missing on the server: ${usage.missing.join(', ')}.` : ''}
          {state.reason === 'napkin_error' && state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      {state.phase === 'limit' && state.pro && <p className="nv-error" role="alert">Limit reached</p>}
      {!disabled && state.phase !== 'limit' && !(auto && state.phase === 'idle') && (
        <div className="nv-bar">
          <button type="button" className="c-btn c-btn--sm c-btn--secondary" onClick={() => make()} disabled={!text}><Sparkles aria-hidden="true" />{state.phase === 'fallback' ? 'Try again' : 'Make visual'}</button>
          {left && <span className="c-meta">{left}</span>}
        </div>
      )}
      <VisualStyle />
    </div>
  );
}

function VisualStyle() {
  return (
    <style jsx global>{`
      .nv { display: grid; gap: 8px; min-width: 0; }
      .nv-frame { margin: 0; display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 10; max-height: 480px; padding: 16px; border: 1px solid var(--hairline); border-radius: var(--r-row); background: var(--surface-card); overflow: hidden; }
      .nv-wait { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .nv-image { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
      .nv-image.is-inverted { filter: invert(1) hue-rotate(180deg); }
      .nv-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
      .nv-dots { display: inline-flex; gap: 8px; }
      .nv-dot { width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--r-pill); background: transparent; cursor: pointer; display: grid; place-items: center; }
      .nv-dot::before { content: ''; width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--muted); opacity: .5; }
      .nv-dot.is-on::before { background: var(--olive); opacity: 1; }
      .nv-actions { display: inline-flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
      .nv-error { margin: 0; color: var(--muted); font: 500 var(--fs-13)/var(--lh-body) var(--font-sans); }
      img.nv-inline { display: block; max-width: 100%; height: auto; margin: 16px 0; border-radius: var(--r-row); }
      [data-theme='dark'] img.nv-inline.nv-light, :root:not([data-theme='dark']) img.nv-inline.nv-dark { filter: invert(1) hue-rotate(180deg); }
    `}</style>
  );
}
