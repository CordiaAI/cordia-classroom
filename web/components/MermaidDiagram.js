import { useEffect, useRef, useState } from 'react';

let renderCount = 0;

// Renders Mermaid source with strict security; AI-written diagrams never get script or HTML labels.
export default function MermaidDiagram({ code, label = 'Diagram' }) {
  const ref = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code || !ref.current) return;
    let active = true;
    setError(false);
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
      renderCount += 1;
      return mermaid.render(`cordia-diagram-${renderCount}`, code);
    }).then(({ svg }) => {
      if (active && ref.current) ref.current.innerHTML = svg;
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [code]);

  if (error) return <pre className="study-aid-diagram-fallback">{code}</pre>;
  return <div ref={ref} className="study-aid-diagram" role="img" aria-label={label} />;
}
