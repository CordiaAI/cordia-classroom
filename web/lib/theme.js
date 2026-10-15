// Theme: 'system' (default) follows the device; 'light' or 'dark' is the student's pick.
export function themePreference() {
  if (typeof window === 'undefined') return 'system';
  const saved = localStorage.getItem('theme');
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

export function resolvedTheme(preference = themePreference()) {
  if (preference !== 'system') return preference;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference = themePreference(), forceLight = false) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', forceLight ? 'light' : resolvedTheme(preference));
}

export function setThemePreference(preference) {
  if (preference === 'system') localStorage.removeItem('theme');
  else localStorage.setItem('theme', preference);
  applyTheme(preference);
}
