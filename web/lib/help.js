export const HELP_EVENT = 'cordia:help';

// Opens the Help sheet (Learn Cordia, tour, feedback, shortcuts) from anywhere.
export function openHelp() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HELP_EVENT));
}
