// What's new: features released to students who joined before them. New students meet them in
// onboarding; everyone else hears about them here, once (Dashboard card, a pointer tip where the
// feature lives, the Help sheet's "What's new" list, and an item in Learn Cordia).
//
// Each entry:
//   id          short and stable (it's stored per student; never reuse one)
//   title       5 words at most
//   description one plain, student-facing line
//   releasedAt  'YYYY-MM-DD'; students who joined on or after it aren't announced to
//   where       { route, anchor }: route is a path, or 'guide' (the last guide opened); anchor is a
//               CSS selector for the pointer tip
//   usedOn      page routes (Next pathnames) that count as using it; defaults to where.route
//   showMeId    a Learn Cordia walkthrough id (lib/walkthrough.js MINI), or null
//   audience    'all' | 'canvas-connected' | 'nursing' | 'pro' | 'free'
//   flag        optional: a name in FLAGS (lib/whatsNew.js); the feature is skipped while it's off
//   icon        a lucide icon name (components map it)
//
// Pure: no imports, so the rules can be tested in Node (web/tests/whats-new.test.mjs).

export const AUDIENCES = ['all', 'canvas-connected', 'nursing', 'pro', 'free'];

// Seeded from git history (last 30 days). CONFIRM: each date, title and line, in the PR.
export const FEATURE_RELEASES = [
  {
    id: 'learn', title: 'Learn, idea by idea',
    description: 'Learn takes each idea from new to mastered, mixing cards, choices and typing.',
    releasedAt: '2026-10-28', where: { route: 'guide', anchor: '[data-spot="learn-pill"]' }, usedOn: ['/learn/[guideId]'],
    showMeId: null, audience: 'all', flag: null, icon: 'GraduationCap',
  },
  {
    id: 'how-sure', title: 'Say how sure you are',
    description: 'Tell Learn and Quiz how sure you are, so lucky guesses don\'t count as learned.',
    releasedAt: '2026-10-28', where: { route: 'guide', anchor: '[data-spot="learn-pill"]' }, usedOn: ['/learn/[guideId]', '/quiz/[guideId]'],
    showMeId: null, audience: 'all', flag: null, icon: 'Gauge',
  },
  {
    id: 'timed-test', title: 'Timed practice test',
    description: 'Before an exam, take a timed test in Learn; misses go back into practice.',
    releasedAt: '2026-10-29', where: { route: 'guide', anchor: '[data-spot="learn-pill"]' }, usedOn: ['/learn/[guideId]'],
    showMeId: null, audience: 'all', flag: null, icon: 'Timer',
  },
  {
    id: 'public-sets', title: 'Share sets publicly',
    description: 'Make a set public from its sharing chip, or study one someone shared.',
    releasedAt: '2026-11-05', where: { route: 'guide', anchor: '.vis' }, usedOn: ['/sets/[id]'],
    showMeId: null, audience: 'all', flag: null, icon: 'Globe',
  },
  {
    id: 'discover', title: 'Discover public sets',
    description: 'Search everyone\'s public sets, study groups and people in one place.',
    releasedAt: '2026-11-07', where: { route: '/explore', anchor: '#ex-q' }, usedOn: ['/explore'],
    showMeId: null, audience: 'all', flag: 'DISCOVER', icon: 'Compass',
  },
];

// Study screens run in focus mode (components/Layout.js): nothing is ever announced on them.
export const FOCUS_ROUTES = ['/session', '/flashcards/study', '/quiz/[guideId]', '/nclex/[guideId]', '/practice/[guideId]', '/learn/[guideId]'];

export const EMPTY_SEEN = { announced: [], opened: [], dismissed: [] };

const day = value => String(value || '').slice(0, 10);

// Joined before the release (new students get it through onboarding). Unknown join date: not announced.
export function joinedBefore(release, user) {
  const joined = day(user?.createdAt);
  return Boolean(joined) && joined < day(release.releasedAt);
}

export function matchesAudience(release, user) {
  switch (release.audience || 'all') {
    case 'all': return true;
    case 'canvas-connected': return Boolean(user?.canvas);
    case 'nursing': return Boolean(user?.nursing);
    case 'pro': return (user?.plan || 'free') !== 'free';
    case 'free': return (user?.plan || 'free') === 'free';
    default: return false;
  }
}

export function flagOn(release, flags = {}) {
  return !release.flag || Boolean(flags[release.flag]);
}

const has = (seen, kind, id) => Array.isArray(seen?.[kind]) && seen[kind].includes(id);

// Released to this student at all (Help's list, Learn Cordia): audience and flag, released by today.
export function available(release, user, flags, today = new Date().toISOString()) {
  return day(release.releasedAt) <= day(today) && matchesAudience(release, user) && flagOn(release, flags);
}

// Worth announcing: available, joined before it, and not yet dismissed or used.
export function eligible(release, user, seen, flags, today) {
  return available(release, user, flags, today) && joinedBefore(release, user)
    && !has(seen, 'dismissed', release.id) && !has(seen, 'opened', release.id);
}

// The Dashboard card's one feature: the oldest still eligible.
export function nextAnnouncement(releases, user, seen, flags, today) {
  return [...releases]
    .filter(release => eligible(release, user, seen, flags, today))
    .sort((a, b) => day(a.releasedAt).localeCompare(day(b.releasedAt)) || releases.indexOf(a) - releases.indexOf(b))[0] || null;
}

// Help's "What's new": everything available, newest first, each with a dot while it's unseen.
export function helpList(releases, user, seen, flags, today) {
  return releases
    .filter(release => available(release, user, flags, today))
    .sort((a, b) => day(b.releasedAt).localeCompare(day(a.releasedAt)) || releases.indexOf(a) - releases.indexOf(b))
    .map(release => ({ ...release, unseen: eligible(release, user, seen, flags, today) }));
}

export function unseenCount(releases, user, seen, flags, today) {
  return releases.filter(release => eligible(release, user, seen, flags, today)).length;
}

export function usedRoutes(release) {
  if (release.usedOn?.length) return release.usedOn;
  return release.where?.route && release.where.route !== 'guide' ? [release.where.route] : [];
}

// Releases a page counts as using (pathname is Next's pattern, e.g. '/learn/[guideId]').
export function usedOnPage(releases, pathname) {
  return releases.filter(release => usedRoutes(release).includes(pathname)).map(release => release.id);
}

// Where the pointer tip goes: the release whose `where` is this page and that's still eligible.
export function tipForPage(releases, pathname, user, seen, flags, today) {
  if (FOCUS_ROUTES.includes(pathname)) return null;
  return releases.find(release => {
    const route = release.where?.route;
    const here = route === 'guide' ? pathname === '/guide/[id]' : route === pathname;
    return here && release.where?.anchor && eligible(release, user, seen, flags, today);
  }) || null;
}

export function mergeSeen(...lists) {
  const out = { announced: [], opened: [], dismissed: [] };
  for (const list of lists) {
    for (const kind of Object.keys(out)) {
      for (const id of Array.isArray(list?.[kind]) ? list[kind] : []) if (!out[kind].includes(id)) out[kind].push(id);
    }
  }
  return out;
}
