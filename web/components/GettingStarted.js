import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const DISMISS_KEY = 'cordia-getting-started-dismissed';

// Persistent dashboard checklist: each item checks itself off from real usage, so students
// who rushed through setup still find the extension, Learn it your way, Practice and SmartNotes.
export default function GettingStarted({ guides, navigate }) {
  const [used, setUsed] = useState(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { setDismissed(false); }
    let active = true;
    apiFetch('/onboarding/checklist').then(data => { if (active && data && !data.detail) setUsed(data); });
    return () => { active = false; };
  }, []);

  if (!used || dismissed) return null;
  const latest = guides?.[0]?.id;
  const items = [
    { key: 'extension_guide', label: 'Make a guide with the Chrome extension', hint: 'One click from any Canvas page', href: '/install-extension' },
    { key: 'learn_your_way', label: 'Open “Learn it your way” on a question', hint: 'Re-teaches it in your style', href: latest ? `/guide/${latest}?learn=1` : '/create' },
    { key: 'practice', label: 'Do a Practice set', hint: 'Problems written from your material', href: latest ? `/practice/${latest}?tour=1` : '/practice?tour=1' },
    { key: 'smartnote', label: 'Turn notes into a guide with SmartNotes', hint: 'Type in lecture, study later', href: '/smartnotes' },
  ];
  const done = items.filter(item => used[item.key]).length;
  if (done === items.length) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* remembering is optional */ }
    setDismissed(true);
  }

  return (
    <section className="getting-started" aria-label="Get the most out of Cordia">
      <header>
        <div><strong>Get the most out of Cordia</strong><span>{done} of {items.length} done</span></div>
        <button type="button" className="getting-started-close" onClick={dismiss} aria-label="Hide checklist">×</button>
      </header>
      <div className="getting-started-bar"><span style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <ul>
        {items.map(item => (
          <li key={item.key} className={used[item.key] ? 'done' : ''}>
            <button type="button" onClick={() => navigate(item.href)} disabled={used[item.key]}>
              <span className="getting-started-check">{used[item.key] ? '✓' : ''}</span>
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              {!used[item.key] && <span aria-hidden="true">→</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
