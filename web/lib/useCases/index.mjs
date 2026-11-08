// Every use-case page, in the order the footer and sibling links list them. Each entry is one
// content file; components/UseCasePage.js lays it out and lib/publicPages.mjs registers it.
import aiStudyGuideGenerator from './aiStudyGuideGenerator.mjs';

export const USE_CASES = [aiStudyGuideGenerator];

export const useCasePath = page => `/${page.slug}`;
export const useCaseBySlug = slug => USE_CASES.find(page => page.slug === slug);
