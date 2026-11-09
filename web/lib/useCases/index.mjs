// Every use-case page, in the order the footer and sibling links list them. Each entry is one
// content file; components/UseCasePage.js lays it out and lib/publicPages.mjs registers it.
import aiStudyGuideGenerator from './aiStudyGuideGenerator.mjs';
import canvasStudyTool from './canvasStudyTool.mjs';
import aiQuizGenerator from './aiQuizGenerator.mjs';
import aiFlashcardMaker from './aiFlashcardMaker.mjs';
import installExtension from './installExtension.mjs';

export const USE_CASES = [aiStudyGuideGenerator, canvasStudyTool, aiQuizGenerator, aiFlashcardMaker, installExtension];

export const useCasePath = page => `/${page.slug}`;
export const useCaseBySlug = slug => USE_CASES.find(page => page.slug === slug);
