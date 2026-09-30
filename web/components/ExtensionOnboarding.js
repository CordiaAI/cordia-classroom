import { useState, useEffect, useRef, useCallback } from 'react';

const STORE_URL =
  'https://chromewebstore.google.com/detail/autostudyai/eddmfjcnfjfbaknmeccjbjdgpeipjbaf';

// The extension stamps this attribute on <html> once its content script runs on
// classroom.cordiaai.io. See extension/asai-bridge.js + manifest content_scripts.
const INSTALL_MARKER_ATTR = 'data-asai-extension';

const STEPS = [
  {
    id: 1,
    title: 'Open CordiaClassroom',
    body: 'On any lecture, slideshow, Canvas page, or PDF, click the pinned CordiaClassroom icon.',
    scene: 'toolbar',
  },
  {
    id: 2,
    title: 'Make a study guide',
    body: 'Click “Make study guide.” One button captures, reads, focuses, and creates the guide.',
    scene: 'capture',
  },
  {
    id: 3,
    title: 'Review and save',
    body: 'Review the result, then click “Save to Classroom” when the live save bubble appears.',
    scene: 'preview',
  },
  {
    id: 4,
    title: 'Continue in Classroom',
    body: 'After the save is confirmed, Cordia opens the exact study guide in Classroom automatically.',
    scene: 'platform',
  },
];

// True if the extension has already announced itself on this page.
function detectInstalled() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(INSTALL_MARKER_ATTR) === 'ready';
}

export default function ExtensionOnboarding({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [storeOpened, setStoreOpened] = useState(false);
  const pollRef = useRef(null);

  // Lock body scroll while the overlay owns the screen.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset state each time the overlay opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setInstalled(detectInstalled());
      setStoreOpened(false);
    }
  }, [open]);

  // Poll + listen for the extension install signal while open.
  useEffect(() => {
    if (!open) return;

    function check() {
      if (detectInstalled()) {
        setInstalled(true);
        return true;
      }
      return false;
    }

    // The extension can also actively notify us via postMessage.
    function onMessage(e) {
      if (e.source === window && e.data && e.data.type === 'ASAI_EXTENSION_READY') {
        setInstalled(true);
      }
    }
    window.addEventListener('message', onMessage);

    if (!check()) {
      pollRef.current = setInterval(() => {
        if (check() && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 1000);
    }

    return () => {
      window.removeEventListener('message', onMessage);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [open]);

  const openStore = useCallback(() => {
    window.open(STORE_URL, '_blank', 'noopener,noreferrer');
    setStoreOpened(true);
  }, []);

  const next = useCallback(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), []);
  const prev = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="asai-onb-backdrop" role="dialog" aria-modal="true" aria-label="Install the CordiaClassroom extension">
      <div className="asai-onb-card">
        <button className="asai-onb-close" onClick={onClose} aria-label="Close">&times;</button>

        {/* Install status pill */}
        <div className={'asai-onb-status' + (installed ? ' is-installed' : '')}>
          <span className="asai-onb-dot" />
          {installed ? 'Extension detected — you’re all set!' : 'Waiting for extension…'}
        </div>

        <h2 className="asai-onb-title">Get the CordiaClassroom extension</h2>

        {!storeOpened && !installed && (
          <p className="asai-onb-lead">
            Chrome requires one click to add it. We’ll open the Web Store for you — click
            <strong> “Add to Chrome,”</strong> then follow along here.
          </p>
        )}

        {/* Animated scene */}
        <Scene scene={current.scene} key={current.scene} />

        {/* Step copy */}
        <div className="asai-onb-stepinfo">
          <div className="asai-onb-stepnum">Step {current.id} of {STEPS.length}</div>
          <h3>{current.title}</h3>
          <p>{current.body}</p>
        </div>

        {/* Progress dots */}
        <div className="asai-onb-dots">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              className={'asai-onb-pdot' + (i === step ? ' active' : '') + (i < step ? ' done' : '')}
              onClick={() => setStep(i)}
              aria-label={'Go to step ' + s.id}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="asai-onb-controls">
          {!storeOpened && !installed ? (
            <button className="asai-onb-btn asai-onb-btn-primary asai-onb-btn-wide" onClick={openStore}>
              🧩 Add to Chrome (opens Web Store)
            </button>
          ) : (
            <>
              <button className="asai-onb-btn asai-onb-btn-ghost" onClick={prev} disabled={step === 0}>
                ← Back
              </button>
              {!isLast ? (
                <button className="asai-onb-btn asai-onb-btn-primary" onClick={next}>Next →</button>
              ) : installed ? (
                <button className="asai-onb-btn asai-onb-btn-primary" onClick={onClose}>Done — start studying</button>
              ) : (
                <button className="asai-onb-btn asai-onb-btn-primary" onClick={openStore}>
                  Re-open Web Store
                </button>
              )}
            </>
          )}
        </div>

        {storeOpened && !installed && (
          <p className="asai-onb-hint">
            Finished installing? This screen unlocks automatically once we detect the extension.
          </p>
        )}
      </div>

      <style jsx>{`
        .asai-onb-backdrop {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(10, 14, 22, 0.78);
          backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: asai-fade 0.25s ease;
        }
        @keyframes asai-fade { from { opacity: 0; } to { opacity: 1; } }
        .asai-onb-card {
          position: relative;
          width: 100%; max-width: 520px;
          background: var(--card-bg, #fff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 18px;
          padding: 26px 26px 22px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
          animation: asai-rise 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes asai-rise { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .asai-onb-close {
          position: absolute; top: 12px; right: 14px;
          background: none; border: none; font-size: 1.6em; line-height: 1;
          color: var(--text-muted, #9ca3af); cursor: pointer;
        }
        .asai-onb-close:hover { color: var(--text-primary, #111); }
        .asai-onb-status {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 0.72em; font-weight: 600;
          color: var(--text-muted, #6b7280);
          background: rgba(120,120,120,0.1);
          padding: 5px 11px; border-radius: 999px; margin-bottom: 14px;
        }
        .asai-onb-status.is-installed { color: #15803d; background: rgba(34,197,94,0.14); }
        .asai-onb-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--text-muted, #9ca3af);
          animation: asai-pulse 1.4s ease-in-out infinite;
        }
        .asai-onb-status.is-installed .asai-onb-dot { background: #22c55e; animation: none; }
        @keyframes asai-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        .asai-onb-title {
          font-size: 1.3em; font-weight: 800; letter-spacing: -0.02em;
          margin: 0 0 6px; color: var(--text-primary, #111);
        }
        .asai-onb-lead {
          font-size: 0.85em; line-height: 1.5; color: var(--text-muted, #6b7280);
          margin: 0 0 16px;
        }
        .asai-onb-lead strong { color: var(--accent, #2563eb); }
        .asai-onb-stepinfo { text-align: center; margin: 16px 0 4px; }
        .asai-onb-stepnum {
          font-size: 0.68em; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--accent, #2563eb); margin-bottom: 4px;
        }
        .asai-onb-stepinfo h3 { margin: 0 0 5px; font-size: 1.02em; font-weight: 700; color: var(--text-primary, #111); }
        .asai-onb-stepinfo p { margin: 0; font-size: 0.84em; line-height: 1.5; color: var(--text-muted, #6b7280); }
        .asai-onb-dots { display: flex; gap: 8px; justify-content: center; margin: 16px 0 18px; }
        .asai-onb-pdot {
          width: 9px; height: 9px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
          background: var(--border, #d1d5db); transition: all 0.2s;
        }
        .asai-onb-pdot.done { background: var(--accent, #2563eb); opacity: 0.55; }
        .asai-onb-pdot.active { background: var(--accent, #2563eb); transform: scale(1.35); }
        .asai-onb-controls { display: flex; gap: 10px; justify-content: space-between; }
        .asai-onb-btn {
          font-size: 0.85em; font-weight: 600; padding: 10px 18px; border-radius: 10px;
          cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
        }
        .asai-onb-btn-wide { flex: 1; }
        .asai-onb-btn-primary { background: var(--accent, #2563eb); color: #fff; }
        .asai-onb-btn-primary:hover { filter: brightness(1.08); }
        .asai-onb-btn-ghost { background: transparent; border-color: var(--border, #d1d5db); color: var(--text-primary, #111); }
        .asai-onb-btn-ghost:disabled { opacity: 0.4; cursor: default; }
        .asai-onb-hint { text-align: center; font-size: 0.74em; color: var(--text-muted, #9ca3af); margin: 12px 0 0; }
      `}</style>
    </div>
  );
}

/* ---------- Animated scenes: a mock browser the cursor interacts with ---------- */
function Scene({ scene }) {
  return (
    <div className="asai-scene">
      {/* Mock browser chrome */}
      <div className="asai-browser">
        <div className="asai-browser-bar">
          <span className="asai-tl asai-tl-r" /><span className="asai-tl asai-tl-y" /><span className="asai-tl asai-tl-g" />
          <div className="asai-url">
            {scene === 'platform' ? 'classroom.cordiaai.io' : 'canvas.university.edu/lecture'}
          </div>
          {/* Extension icon in toolbar */}
          <div className={'asai-ext-icon' + (scene === 'toolbar' ? ' highlight' : '')}>🧩</div>
        </div>

        <div className="asai-browser-body">
          {scene === 'toolbar' && (
            <>
              <div className="asai-slide">
                <div className="asai-slide-title" />
                <div className="asai-slide-line" /><div className="asai-slide-line short" /><div className="asai-slide-line" />
              </div>
              <span className="asai-cursor cursor-to-icon">▲</span>
            </>
          )}

          {scene === 'capture' && (
            <>
              <div className="asai-sidepanel">
                <div className="asai-sidepanel-title">Cordia Tutor</div>
                <div className="asai-sidepanel-skill">Capture</div>
                <button className="asai-capture-btn">Read this study material</button>
                <div className="asai-sidepanel-status">Reading current page…</div>
              </div>
              <span className="asai-cursor cursor-to-capture">▲</span>
            </>
          )}

          {scene === 'preview' && (
            <>
              <div className="asai-preview">
                <div className="asai-preview-head">Study Guide Preview</div>
                <div className="asai-qa"><span className="asai-q" /><span className="asai-a" /></div>
                <div className="asai-qa"><span className="asai-q" /><span className="asai-a short" /></div>
                <button className="asai-save-btn">Save to platform</button>
              </div>
              <span className="asai-cursor cursor-to-save">▲</span>
            </>
          )}

          {scene === 'platform' && (
            <>
              <div className="asai-guidelist">
                <div className="asai-guide-row target">📖 Lecture 4 — Study Guide</div>
                <div className="asai-guide-row">📖 Lecture 3 — Study Guide</div>
              </div>
              <span className="asai-cursor cursor-to-guide">▲</span>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .asai-scene { display: flex; justify-content: center; }
        .asai-browser {
          width: 100%; max-width: 420px; height: 178px;
          background: #f3f4f6; border: 1px solid var(--border, #e5e7eb);
          border-radius: 12px; overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.12);
        }
        .asai-browser-bar {
          display: flex; align-items: center; gap: 6px;
          background: #e5e7eb; padding: 7px 10px; position: relative;
        }
        .asai-tl { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
        .asai-tl-r { background: #ff5f57; } .asai-tl-y { background: #febc2e; } .asai-tl-g { background: #28c840; }
        .asai-url {
          flex: 1; margin-left: 8px; background: #fff; border-radius: 6px;
          font-size: 0.62em; color: #6b7280; padding: 4px 9px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .asai-ext-icon {
          font-size: 0.95em; padding: 2px 5px; border-radius: 6px; transition: all 0.3s;
        }
        .asai-ext-icon.highlight {
          background: rgba(37,99,235,0.18);
          box-shadow: 0 0 0 2px rgba(37,99,235,0.5);
          animation: asai-bounce 1.2s ease-in-out infinite;
        }
        @keyframes asai-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        .asai-browser-body { position: relative; height: calc(100% - 30px); padding: 12px; }

        /* Slide mock */
        .asai-slide { background: #fff; border-radius: 8px; padding: 12px; height: 100%; }
        .asai-slide-title { width: 55%; height: 11px; border-radius: 4px; background: #c7d2fe; margin-bottom: 12px; }
        .asai-slide-line { width: 100%; height: 7px; border-radius: 4px; background: #e5e7eb; margin-bottom: 7px; }
        .asai-slide-line.short { width: 60%; }

        /* Chrome side-panel mock */
        .asai-sidepanel {
          position: absolute; inset: 0 0 0 auto; width: 185px;
          background: #fff; border-left: 1px solid #e5e7eb;
          padding: 12px; box-shadow: -8px 0 20px rgba(0,0,0,0.12); text-align: left;
        }
        .asai-sidepanel-title { font-size: 0.72em; font-weight: 800; color: #111; margin-bottom: 4px; }
        .asai-sidepanel-skill { font-size: 0.58em; color: #5b684e; margin-bottom: 10px; }
        .asai-capture-btn {
          width: 100%; background: #2563eb; color: #fff; border: none;
          border-radius: 7px; padding: 7px; font-size: 0.66em; font-weight: 700;
          animation: asai-glow 1.6s ease-in-out infinite;
        }
        @keyframes asai-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.4); } 50% { box-shadow: 0 0 0 6px rgba(37,99,235,0); } }
        .asai-sidepanel-status { font-size: 0.58em; color: #6b7280; margin-top: 8px; }

        /* Preview mock */
        .asai-preview { background: #fff; border-radius: 8px; padding: 11px; height: 100%; }
        .asai-preview-head { font-size: 0.66em; font-weight: 800; color: #111; margin-bottom: 9px; }
        .asai-qa { margin-bottom: 8px; }
        .asai-q { display: block; width: 70%; height: 7px; border-radius: 4px; background: #c7d2fe; margin-bottom: 4px; }
        .asai-a { display: block; width: 100%; height: 6px; border-radius: 4px; background: #e5e7eb; }
        .asai-a.short { width: 50%; }
        .asai-save-btn {
          margin-top: 4px; background: #16a34a; color: #fff; border: none;
          border-radius: 7px; padding: 6px 12px; font-size: 0.64em; font-weight: 700; float: right;
          animation: asai-glow 1.6s ease-in-out infinite;
        }

        /* Platform list mock */
        .asai-guidelist { display: flex; flex-direction: column; gap: 8px; }
        .asai-guide-row {
          background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 10px 12px; font-size: 0.66em; color: #374151;
        }
        .asai-guide-row.target {
          border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.25);
          animation: asai-glow 1.6s ease-in-out infinite;
        }

        /* Cursor + per-scene travel paths */
        .asai-cursor {
          position: absolute; font-size: 1.1em; color: #111;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
          pointer-events: none; transform: rotate(-20deg);
        }
        .cursor-to-icon  { animation: toIcon 2.4s ease-in-out infinite; }
        .cursor-to-capture { animation: toCapture 2.4s ease-in-out infinite; }
        .cursor-to-save  { animation: toSave 2.4s ease-in-out infinite; }
        .cursor-to-guide { animation: toGuide 2.4s ease-in-out infinite; }

        @keyframes toIcon {
          0%   { top: 90px; left: 60px; opacity: 0; }
          25%  { opacity: 1; }
          70%  { top: -26px; left: 360px; }
          82%  { top: -22px; left: 360px; }
          100% { top: -26px; left: 360px; opacity: 1; }
        }
        @keyframes toCapture {
          0%   { top: 110px; left: 60px; opacity: 0; }
          25%  { opacity: 1; }
          70%  { top: 56px; left: 320px; }
          82%  { top: 60px; left: 320px; }
          100% { top: 56px; left: 320px; opacity: 1; }
        }
        @keyframes toSave {
          0%   { top: 30px; left: 60px; opacity: 0; }
          25%  { opacity: 1; }
          70%  { top: 104px; left: 300px; }
          82%  { top: 108px; left: 300px; }
          100% { top: 104px; left: 300px; opacity: 1; }
        }
        @keyframes toGuide {
          0%   { top: 100px; left: 60px; opacity: 0; }
          25%  { opacity: 1; }
          70%  { top: 18px; left: 180px; }
          82%  { top: 22px; left: 180px; }
          100% { top: 18px; left: 180px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
