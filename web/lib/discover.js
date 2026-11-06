// Discover (Stage 7): public guides, classrooms and people. All visibility, block, opt-out and
// minors rules are applied by the backend (services/discover.py); this only asks.
import { apiFetch } from './api';
import { FILTERS } from './discover.mjs';

export { explorePath, publicSetRows, studiedBy, FILTERS } from './discover.mjs';

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? '?' + text : '';
}

export const discoverGuides = ({ q = '', offset = 0, limit, ...filters } = {}) => {
  const picked = Object.fromEntries(FILTERS.map(key => [key, filters[key]]));
  return apiFetch('/discover/guides' + query({ q, offset: offset || '', limit, ...picked }));
};
export const discoverClassrooms = ({ q = '', school, course } = {}) => apiFetch('/discover/classrooms' + query({ q, school, course }));
export const discoverPeople = q => apiFetch('/discover/people' + query({ q }));
