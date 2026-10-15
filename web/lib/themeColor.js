// Resolved value of a theme token, for canvas drawing (CSS variables don't reach canvas).
export function themeColor(name) {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
