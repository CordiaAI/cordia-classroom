import { useEffect, useRef, useState } from 'react';

import { mermaidConfig } from '../lib/mermaidTheme';

let renderCount = 0;

// Renders Mermaid source with strict security; AI-written diagrams never get script or HTML labels.
export default function MermaidDiagram({ code, label = 'Diagram' }) {
  const ref = useRef(null);
  const [error, setError] = useState(false);
  const [theme, setTheme] = useState('');

  // Re-render in the other palette when the theme changes.
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') || '');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!code || !ref.current) return;
    let active = true;
    setError(false);
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize(mermaidConfig());
      renderCount += 1;
      return mermaid.render(`cordia-diagram-${renderCount}`, code);
    }).then(({ svg }) => {
      if (active && ref.current) ref.current.innerHTML = svg;
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [code, theme]);

  if (error) return <pre className="study-aid-diagram-fallback">{code}</pre>;
  return <div ref={ref} className="study-aid-diagram" role="img" aria-label={label} />;
}
