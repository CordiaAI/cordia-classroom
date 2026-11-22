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
// "See all in Discover".
export function publicSetRows(guides, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const rows = (Array.isArray(guides) ? guides : []).slice(0, 3).map(guide => ({
    key: 'p' + guide.id,
    kind: 'public',
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

// Is the student narrowing the list (a search or any filter)? Discover's own default view has neither.
export function narrowing(q, filters) {
  return Boolean(String(q || '').trim()) || FILTERS.some(key => {
    const value = (filters || {})[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
  });
}

// The empty Sets list, in one short sentence and the one thing to do about it. "clear" resets the
// search and filters; "library" opens the student's own sets, where sharing one publicly starts.
export function emptySetsCopy(q, filters) {
  const term = String(q || '').trim();
  if (term) return { message: `No public sets match “${term}”.`, action: 'clear', label: 'Clear search' };
  if (narrowing('', filters)) return { message: 'No public sets match these filters.', action: 'clear', label: 'Clear filters' };
  return { message: 'Sets that students share publicly show up here.', action: 'library', label: 'Open your library' };
}

// What fills an empty search: the popular public sets first, then sets from the student's
// classmates, each at most `limit` long. A set in both lists shows once, under Popular. A group
// with nothing in it is left out.
export const SUGGESTION_LIMIT = 4;
export function suggestionGroups({ popular, classmates } = {}, limit = SUGGESTION_LIMIT) {
  const usable = list => (Array.isArray(list) ? list : []).filter(guide => guide && guide.id);
  const first = usable(popular).slice(0, limit);
  const seen = new Set(first.map(guide => guide.id));
  const second = usable(classmates).filter(guide => !seen.has(guide.id)).slice(0, limit);
  return [
    { key: 'popular', title: 'Popular public sets', sets: first },
    { key: 'classmates', title: 'From your classmates', sets: second },
  ].filter(group => group.sets.length);
}

// A result that is not a list of sets (a dropped connection, a server error) is a failure, never "no sets".
export const isSetList = result => Boolean(result) && Array.isArray(result.guides);
