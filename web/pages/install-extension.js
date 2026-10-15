import { useEffect, useState } from 'react';
import { Check, Download, MousePointerClick, Pin } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { EXTENSION_STORE_URL, watchExtension } from '../lib/extension';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

const STEPS = [
  { title: 'Add to Chrome', icon: Download, text: 'Open the Chrome Web Store listing and choose Add to Chrome.' },
  { title: 'Pin it', icon: Pin, text: 'Open the puzzle-piece menu in the toolbar and pin CordiaClassroom.' },
  { title: 'Capture a page', icon: MousePointerClick, text: 'On any course page, open the extension and make a guide.' },
];

export default function InstallExtensionPage() {
  const { ready } = useRequireAuth();
  const [installed, setInstalled] = useState(false);

  useEffect(() => watchExtension(() => setInstalled(true)), []);

  if (!ready) return null;

  return (
    <div className="c-page ext">
      <header className="c-page-head">
        <h1 className="c-title">Chrome extension</h1>
        {installed ? (
          <span className="ext-installed" role="status"><Check {...ICON} />Installed</span>
        ) : (
          <a className="c-btn c-btn--primary" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">Add to Chrome</a>
        )}
      </header>

      <ol className="ext-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="c-card ext-step">
            <span className="ext-num" aria-hidden="true">{index + 1}</span>
            <h2><step.icon {...ICON} />{step.title}</h2>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>

      <style jsx>{`
        .ext-installed { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 999px; background: var(--success-bg); color: var(--success); font: 600 15px/1 var(--font-sans); }
        .ext-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .ext-step { display: grid; align-content: start; gap: 12px; padding: 24px; }
        .ext-num { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--olive); color: #fff; font: 600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        h2 { display: flex; align-items: center; gap: 8px; margin: 0; font: 600 17px/1.3 var(--font-sans); }
        p { margin: 0; font: 500 15px/1.5 var(--font-sans); }
        @media (max-width: 767px) { .ext-steps { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </div>
  );
}
