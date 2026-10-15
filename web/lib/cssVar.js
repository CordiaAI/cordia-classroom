// Reads a design token's current value (for canvas drawing, exported images and Mermaid,
// which need concrete colors). Tokens live only in styles/tokens.css.
export function cssVar(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
