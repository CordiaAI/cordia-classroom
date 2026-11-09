// A guide's related links: use-case pages by their footer label, guides by title, and never a
// guide the current build doesn't show (a published guide doesn't link to a draft).
import { guidePath, visibleGuides } from './index.mjs';
import { USE_CASES, useCasePath } from '../useCases/index.mjs';

export function relatedLinks(hrefs, guides = visibleGuides()) {
  const labels = new Map([
    ...USE_CASES.map(page => [useCasePath(page), page.footerLabel]),
    ...guides.map(guide => [guidePath(guide), guide.title]),
  ]);
  return hrefs.filter(href => labels.has(href)).map(href => ({ href, label: labels.get(href) }));
}
