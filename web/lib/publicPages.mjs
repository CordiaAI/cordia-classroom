// Every page that works signed out: its title topic, meta description and source file. One list
// feeds the page heads (components/SeoHead.js), the crawl files (scripts/crawlFiles.mjs) and the
// SEO check (scripts/seoCheck.mjs). Titles render as "<topic> | Cordia Classroom" and must stay
// unique; descriptions are 120–160 characters. `index: false` pages get noindex and stay out of
// the sitemap.
import { BRAND_NAME, PLANS, planByKey } from './brand.mjs';
import { USE_CASES, useCasePath } from './useCases/index.mjs';
import { AUTHOR, PUBLISHED_GUIDES, guidePath } from './guides/index.mjs';

const { trial } = PLANS;
const price = key => `$${planByKey(key).price}`;

export const PUBLIC_PAGES = [
  {
    path: '/', file: 'pages/index.js', index: true, crumb: 'Home',
    topic: 'AI Study App for College Students',
    description: 'Turn your slides, PDFs, lectures and Canvas pages into study guides, flashcards and practice tests. Cordia Classroom is free to start for college students.',
  },
  {
    path: '/pricing', file: 'pages/pricing.js', index: true, crumb: 'Pricing',
    topic: 'Pricing: Free, Pro and Academic Weapon',
    description: `Cordia Classroom is free to start. Pro costs ${price('pro')} a month and Academic Weapon ${price('weapon')} a month, with a ${trial.days}-day ${trial.plan} trial and no card needed.`,
  },
  {
    path: '/mission', file: 'pages/mission.js', index: true, crumb: 'Features and mission',
    topic: 'Features and Mission',
    description: 'How Cordia Classroom captures your course material, writes study guides, NCLEX-style questions and flashcards from it, and why it never searches the web.',
  },
  // Use-case pages (lib/useCases/): one content file each, laid out by components/UseCasePage.js.
  ...USE_CASES.map(page => ({
    path: useCasePath(page), file: `pages/${page.slug}.js`, index: true, crumb: page.crumb,
    topic: page.topic, description: page.description, modified: page.updated,
  })),
  // Guides (lib/guides/): the index stays noindex until a guide is published, and only published
  // guides are listed here. Drafts aren't, so they get the app noindex rule and no sitemap entry.
  {
    path: '/guides', file: 'pages/guides/index.js', index: PUBLISHED_GUIDES.length > 0, crumb: 'Guides',
    topic: 'Study Guides and How-Tos',
    description: 'Guides from Cordia Classroom on studying for college exams: planning backward from the test, active recall, spaced review and using AI with your own notes.',
  },
  ...PUBLISHED_GUIDES.map(guide => ({
    path: guidePath(guide), file: 'pages/guides/[slug].js', index: true, crumb: guide.crumb,
    topic: guide.topic, description: guide.description, modified: guide.dateModified,
    article: { headline: guide.title, author: AUTHOR, published: guide.datePublished },
  })),
  {
    path: '/connect/claude', file: 'pages/connect/claude.js', index: true, crumb: 'Use with Claude',
    topic: 'Use with Claude',
    description: 'Connect Cordia Classroom to Claude to search your notes and lectures, get quizzed from your own flashcards and save new cards to your Library.',
  },
  {
    path: '/instructors', file: 'pages/instructors.js', index: true, crumb: 'For instructors',
    topic: 'Turn Off Class Sharing for Instructors',
    description: 'Instructors can turn off study set sharing for a course they teach: verify your school email, enter the course code, and shared sets become private.',
  },
  {
    path: '/honor-code', file: 'pages/honor-code.js', index: true, crumb: 'Honor Code',
    topic: 'Honor Code and Academic Integrity',
    description: 'How to use Cordia Classroom with academic integrity: it is a study aid, never for live exams or for handing in its output as your own original work.',
  },
  {
    path: '/copyright', file: 'pages/copyright.js', index: true, crumb: 'Copyright',
    topic: 'Copyright and Takedown Requests',
    description: 'Report a shared guide, set or profile that uses your work without permission. Staff review every notice before acting, and you can send a counter-notice.',
  },
  {
    path: '/privacy', file: 'pages/privacy.js', index: true, crumb: 'Privacy Policy',
    topic: 'Privacy Policy',
    description: 'How Cordia Classroom collects, uses, shares and protects your data, including the Chrome extension, Canvas, connected AI apps and your privacy rights.',
  },
  {
    path: '/terms', file: 'pages/terms.js', index: true, crumb: 'Terms of Service',
    topic: 'Terms of Service',
    description: 'The terms for using Cordia Classroom: eligibility, acceptable use, class sharing, lecture recording, Canvas, AI-generated content, plans and billing.',
  },
  {
    path: '/login', file: 'pages/login.js', index: false, crumb: 'Sign in',
    topic: 'Sign In',
    description: 'Sign in to Cordia Classroom to get back to your study guides, flashcards, lecture notes and Canvas deadlines, or send yourself a password reset link.',
  },
  {
    path: '/signup', file: 'pages/signup.js', index: false, crumb: 'Create an account',
    topic: 'Create a Free Account',
    description: 'Create a free Cordia Classroom account and start turning your slides, PDFs, lectures and Canvas pages into study guides, flashcards and practice tests.',
  },
  {
    path: '/reset-password', file: 'pages/reset-password.js', index: false, crumb: 'Reset password',
    topic: 'Reset Your Password',
    description: 'Choose a new password for your Cordia Classroom account. Reset links expire, so request a new one from the sign-in page if this link no longer works.',
  },
];

export const pageTitle = page => `${page.topic} | ${BRAND_NAME}`;
export const publicPage = path => PUBLIC_PAGES.find(page => page.path === path);
export const INDEXABLE_PAGES = PUBLIC_PAGES.filter(page => page.index);

// Everything outside PUBLIC_PAGES is the signed-in app and stays out of search: an
// X-Robots-Tag header (next.config.js) and a robots meta tag (pages/_app.js). These keep their
// own rules: shared guides and invites set noindex themselves, profiles and Discover are left as
// they are for now, and /assistant/* is the separate Assistant app.
const OWN_RULES = ['/sets/', '/join/', '/u/', '/assistant/'];
export const ROBOTS_NOINDEX = 'noindex, nofollow';

// For a Next.js route pattern ("/guide/[id]") or a path.
export const isAppRoute = pathname => !publicPage(pathname) && pathname !== '/explore' && !OWN_RULES.some(prefix => pathname.startsWith(prefix));

// The next.config.js `source` for the header: every path except the public pages, the routes
// with their own rules, Next's assets and files with an extension (robots.txt, images, fonts).
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function appRouteSource() {
  const skip = [
    '$',
    ...PUBLIC_PAGES.filter(page => page.path !== '/').map(page => `${escapeRegex(page.path.slice(1))}/?$`),
    'explore/?$',
    ...OWN_RULES.map(prefix => escapeRegex(prefix.slice(1))),
    '_next/',
    '.*\\.[A-Za-z0-9]+$',
  ];
  return `/((?!${skip.join('|')}).*)`;
}
