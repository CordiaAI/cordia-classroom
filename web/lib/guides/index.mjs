// Every guide (/guides/<slug>), one content file each. A guide with `draft: true` is built only for
// local dev and Vercel preview deployments, so it 404s on production; it stays out of the public
// pages list (lib/publicPages.mjs), so the app noindex rule (PR 238) covers it, and out of the sitemap, llms.txt
// and the /guides index. Publishing a guide is flipping its draft flag to false.
//
// Each content file's default export is its metadata; its body is a separate `body` export that
// only lib/guides/bodies.mjs imports, from getStaticProps on the server. This file is reachable
// from browser code (lib/publicPages.mjs), so it must never import a body: a draft's text would
// ship in production JavaScript. scripts/seoCheck.mjs fails the build if one does.
import howToStudyForFinals from './howToStudyForFinals.mjs';
import aiStudyHelpCollege from './aiStudyHelpCollege.mjs';
import sourceGroundedAiTutoring from './sourceGroundedAiTutoring.mjs';
import areAiTutorsSafe from './areAiTutorsSafe.mjs';

export const GUIDES = [aiStudyHelpCollege, howToStudyForFinals, sourceGroundedAiTutoring, areAiTutorsSafe];
export const PUBLISHED_GUIDES = GUIDES.filter(guide => !guide.draft);

export const guidePath = guide => `/guides/${guide.slug}`;
export const guideBySlug = slug => GUIDES.find(guide => guide.slug === slug);

// Drafts show in `next dev` and on Vercel preview builds (VERCEL_ENV=preview), never on production
// or in a plain `next build` (CI, the SEO check).
export const draftsVisible = (env = process.env) => env.NODE_ENV === 'development' || env.VERCEL_ENV === 'preview';
export const visibleGuides = (env = process.env) => GUIDES.filter(guide => !guide.draft || draftsVisible(env));

export { AUTHOR } from './author.mjs';
