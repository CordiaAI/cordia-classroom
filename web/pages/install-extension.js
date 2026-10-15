import { useEffect, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { EXTENSION_STORE_URL, extensionInstalled } from '../lib/extension';
import StepGuide from '../components/StepGuide';
import { ChromeAddToChrome, ChromeCapture, ChromePin } from '../components/Illustrations';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Show, then tell: three steps with the real screens and the exact button circled.
export default function InstallExtensionPage() {
  const { ready } = useRequireAuth();
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const check = () => setInstalled(extensionInstalled());
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-asai-extension'] });
    const onMessage = event => { if (event.source === window && event.data?.type === 'ASAI_EXTENSION_READY') setInstalled(true); };
    window.addEventListener('message', onMessage);
    return () => { observer.disconnect(); window.removeEventListener('message', onMessage); };
  }, []);

  if (!ready) return null;
  return (
    <div className="c-page ext">
      <header className="c-page-head">
        <h1 className="c-title">Chrome extension</h1>
        {installed && <span className="ext-installed" role="status"><Check {...ICON} />Installed</span>}
      </header>
      <StepGuide label="Install the Chrome extension" steps={[
        {
          visual: <ChromeAddToChrome />,
          text: 'Click Add to Chrome in the Chrome Web Store.',
          action: !installed && <a className="c-btn c-btn--primary" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer"><Download {...ICON} />Add to Chrome</a>,
        },
        { visual: <ChromePin />, text: 'Open the puzzle piece, then pin CordiaClassroom.' },
        { visual: <ChromeCapture />, text: 'On a course page, click Make study guide.' },
      ]} />
      <style jsx>{`
        .ext-installed { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 999px; background: var(--success-bg); color: var(--ink); font: 600 15px/1 var(--font-sans); }
        .ext-installed :global(.lucide) { color: var(--success); }
      `}</style>
    </div>
  );
}
