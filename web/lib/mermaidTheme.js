import { themeColor } from './themeColor';

// Mermaid styled in Cordia's palette for the current theme (formal, monochrome, olive lines).
export function mermaidConfig() {
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const ink = themeColor('--ink');
  const field = themeColor('--field');
  const line = themeColor('--olive-ink');
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      darkMode: dark,
      fontFamily: 'Manrope, Arial, sans-serif',
      fontSize: '15px',
      background: 'transparent',
      primaryColor: field,
      primaryTextColor: ink,
      primaryBorderColor: line,
      secondaryColor: field,
      tertiaryColor: field,
      lineColor: line,
      textColor: ink,
      mainBkg: field,
      nodeBorder: line,
      clusterBkg: 'transparent',
      clusterBorder: line,
      edgeLabelBackground: field,
      titleColor: ink,
    },
  };
}
