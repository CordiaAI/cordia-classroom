import { useEffect, useRef, useState } from 'react';

let renderCount = 0;

export function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Light keeps Mermaid's neutral look; dark uses the page's own ink, card and olive colors.
export function mermaidConfig(theme = currentTheme()) {
  if (theme !== 'dark') return { startOnLoad: false, theme: 'neutral', securityLevel: 'strict' };
  const ink = '#FFFFFF';
  const box = '#2F3238';
  const line = '#C3CFB6';
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      darkMode: true,
      background: 'transparent',
      primaryColor: box,
      primaryTextColor: ink,
      primaryBorderColor: line,
      secondaryColor: box,
      tertiaryColor: box,
      lineColor: line,
      textColor: ink,
      mainBkg: box,
      nodeBorder: line,
      clusterBkg: 'transparent',
      clusterBorder: line,
      edgeLabelBackground: box,
      titleColor: ink,
      noteBkgColor: box,
      noteTextColor: ink,
      actorBkg: box,
      actorTextColor: ink,
      actorBorder: line,
      signalColor: line,
      signalTextColor: ink,
      labelTextColor: ink,
    },
  };
}

// Renders Mermaid source with strict security; AI-written diagrams never get script or HTML labels.
export default function MermaidDiagram({ code, label = 'Diagram' }) {
  const ref = useRef(null);
  const [error, setError] = useState(false);
  const [theme, setTheme] = useState(currentTheme);

  // Redraw when the theme changes.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!code || !ref.current) return;
    let active = true;
    setError(false);
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize(mermaidConfig(theme));
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
