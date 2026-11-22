// Discover (Stage 7), the parts with no network: addresses and the search panel's "Public sets"
// rows. lib/discover.js adds the API calls.
const TABS = ['guides', 'classrooms', 'people'];
export const FILTERS = ['school', 'course', 'term', 'creator_type', 'size', 'updated_within', 'from_my_classrooms'];

// /explore with the query (and, optionally, a tab and filters) filled in.
export function explorePath(q = '', { tab = '', ...filters } = {}) {
  const params = new URLSearchParams();
  if (String(q).trim()) params.set('q', String(q).trim());
  if (TABS.includes(tab) && tab !== 'guides') params.set('tab', tab);
  for (const key of FILTERS) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '' && value !== false) params.set(key, String(value));
  }
  const text = params.toString();
  return '/explore' + (text ? '?' + text : '');
}

// The search panel's group under the student's own results: up to three public sets, then
// "See all in Discover". owned: guide ids the student already has (lib/searchResults.mjs
// ownedGuideIds); those sets are left out before the three are picked, so they never show twice.
export function publicSetRows(guides, query, owned = new Set()) {
  const q = String(query || '').trim();
  if (!q) return [];
  const seen = new Set();
  const fresh = (Array.isArray(guides) ? guides : []).filter(guide => {
    const id = String(guide?.id || '');
    if (!id || owned.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const rows = fresh.slice(0, 3).map(guide => ({
    key: 'p' + guide.id,
    kind: 'public',
    id: guide.id,
    title: guide.title || 'Untitled',
    meta: guide.studied_by ? `Studied by ${guide.studied_by}` : (guide.author?.display_name || ''),
    href: '/sets/' + guide.id,
    verified: Boolean(guide.verified),
  }));
  return [...rows, { key: 'explore', kind: 'explore', title: 'See all in Discover', href: explorePath(q) }];
}

// "Studied by 3", "Studied by 1", or nothing for none.
export function studiedBy(count) {
  const n = Number(count) || 0;
  return n > 0 ? `Studied by ${n}` : '';
}
