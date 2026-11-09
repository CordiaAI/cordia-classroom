// Comparison pages: long-form pages at the site root, written in web/content/<slug>.md with their
// JSON-LD in web/content/<slug>.jsonld.json (both read on the server by the page's getStaticProps).
// Unlike the other public pages, each one has its own exact <title> and Open Graph text, given in
// its brief, instead of "<topic> | Cordia Classroom".
export const COMPARISONS = [
  {
    slug: 'best-ai-study-platforms-canvas-integration',
    title: 'Best AI Study Platforms With Canvas Integration (2026)',
    ogTitle: 'Best AI Study Platforms With Canvas Integration',
    topic: 'Best AI Study Platforms With Canvas Integration',
    crumb: 'Best AI study platforms with Canvas integration',
    description: 'Compare AI study platforms that work with Canvas: how each one connects, what it makes from your class materials, free tiers and prices.',
    published: '2026-11-09',
    modified: '2026-11-09',
    footerLabel: 'AI study platforms with Canvas integration',
    // It quotes other companies' plans ("Unlimited text chats"), so the site's "no open-ended
    // limits" copy rule (scripts/seoCheck.mjs BANNED) doesn't apply to that word on this page.
    allowWords: ['unlimited'],
    // The walkthrough screenshots (public/images/canvas-comparison/), for width and height.
    images: {
      '/images/canvas-comparison/01-canvas-module-slides.png': [1368, 694],
      '/images/canvas-comparison/02-cordia-side-panel.png': [1368, 694],
      '/images/canvas-comparison/03-build-steps.png': [1368, 694],
      '/images/canvas-comparison/04-guide-outline-and-tabs.png': [1368, 845],
      '/images/canvas-comparison/05-learn-confidence.png': [1100, 838],
      '/images/canvas-comparison/06-quiz-setup.png': [1368, 694],
    },
  },
];

export const comparisonPath = page => `/${page.slug}`;
export const comparisonByPath = path => COMPARISONS.find(page => comparisonPath(page) === path) || null;
