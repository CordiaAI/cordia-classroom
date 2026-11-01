// The guide-text parsers live in guideText.mjs, which the MCP server shares.
export { KEY_POINTS, guideNotes, hasStudyNotes, isStudyGuideNotes, parseNotes, parseQAPairs, parseStudyNotes } from './guideText.mjs';

// Canvas calendar feeds end every title with the section code ("Essay 2 [ENG-101-004]"). The class
// is shown on its own line, so the title drops it; the code is kept as the class when none is known.
const SECTION_CODE = /\s*\[([^\]]{2,80})\]\s*$/;
export function deadlineTitle(item) {
  return String(item?.title || '').replace(SECTION_CODE, '') || item?.title || '';
}
export function deadlineCourse(item) {
  return item?.course || String(item?.title || '').match(SECTION_CODE)?.[1] || '';
}

// Only https links and the app's own pages become hrefs; anything else (javascript:, data:, http:)
// falls back. The href is rebuilt behind a fixed scheme or "/", so no stored value can choose it.
export function safeHref(url, fallback) {
  const value = String(url || '');
  const web = /^https:\/\/(\S+)$/i.exec(value);
  if (web) return 'https://' + web[1];
  const page = /^\/(?!\/)(\S*)$/.exec(value);
  return page ? '/' + page[1] : fallback;
}
