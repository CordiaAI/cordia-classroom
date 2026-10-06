import { useEffect, useState } from 'react';

const STORE_URL = 'https://chromewebstore.google.com/detail/cordiaclassroom';
const MARKER = 'data-asai-extension';

// The extension stamps data-asai-extension="ready" on <html> (extension/asai-bridge.js)
// and posts ASAI_EXTENSION_READY, so the button hides once it is installed.
function extensionReady() {
  return document.documentElement.getAttribute(MARKER) === 'ready';
}

export default function InstallSidebarButton() {
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(extensionReady());
    const observer = new MutationObserver(() => { if (extensionReady()) setInstalled(true); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [MARKER] });
    const onMessage = event => { if (event.data?.type === 'ASAI_EXTENSION_READY') setInstalled(true); };
    window.addEventListener('message', onMessage);
    return () => { observer.disconnect(); window.removeEventListener('message', onMessage); };
  }, []);

  if (installed) return null;

  return (
    <div className="install-sidebar">
      <a className="install-sidebar-button" href={STORE_URL} target="_blank" rel="noopener noreferrer">
        <span className="install-sidebar-wave install-sidebar-wave-ink" aria-hidden="true" />
        <span className="install-sidebar-wave install-sidebar-wave-olive" aria-hidden="true" />
        <span className="install-sidebar-label">Install Classroom SideBar</span>
      </a>
      <small className="install-sidebar-caption">Install Chrome extension to make a study guide just by viewing notes in a webpage!</small>
      <style jsx>{`
        .install-sidebar { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 236px; }
        .install-sidebar-button {
          position: relative;
          display: inline-flex;
          padding: 2px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--ink) 14%, var(--surface));
          box-shadow: 0 8px 20px rgba(17, 18, 15, 0.1);
          overflow: hidden;
          isolation: isolate;
          text-decoration: none;
        }
        /* Two soft wave layers travel around the outline at different speeds. */
        .install-sidebar-wave {
          position: absolute;
          inset: -150%;
          z-index: -1;
          animation: install-sidebar-orbit 4.2s linear infinite;
        }
        .install-sidebar-wave-ink {
          background: conic-gradient(from 0deg, transparent 0 8%, var(--ink) 16%, transparent 24% 46%, #9a9e95 56%, transparent 66% 100%);
        }
        .install-sidebar-wave-olive {
          background: conic-gradient(from 120deg, transparent 0 20%, var(--olive-hover) 30%, transparent 40% 72%, var(--olive) 82%, transparent 92% 100%);
          animation-duration: 6.4s;
          animation-direction: reverse;
          mix-blend-mode: multiply;
        }
        :global([data-theme='dark']) .install-sidebar-wave-olive { mix-blend-mode: screen; }
        .install-sidebar-label {
          display: inline-flex;
          align-items: center;
          min-height: 36px;
          padding: 0 15px;
          border-radius: 10px;
          background: var(--surface);
          color: var(--ink);
          font-size: 0.76rem;
          font-weight: 750;
          white-space: nowrap;
          transition: background 0.15s ease;
        }
        .install-sidebar-button:hover .install-sidebar-label { background: var(--bg-hover); }
        .install-sidebar-button:focus-visible { outline: 3px solid color-mix(in srgb, var(--olive) 30%, transparent); outline-offset: 2px; }
        .install-sidebar-caption { color: var(--ink); font-size: 0.56rem; font-weight: 560; line-height: 1.25; text-align: center; }
        @keyframes install-sidebar-orbit { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .install-sidebar-wave { animation: none; } }
        @media (max-width: 1180px) { .install-sidebar-caption { display: none; } }
        /* Chrome extensions don't run on phones. */
        @media (max-width: 720px) { .install-sidebar { display: none; } }
      `}</style>
    </div>
  );
}
