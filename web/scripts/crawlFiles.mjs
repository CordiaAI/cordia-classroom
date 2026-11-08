// robots.txt, sitemap.xml and llms.txt, written into public/ at build time (next.config.js runs
// this for `next build` and `next dev`) from lib/brand.mjs and the public page list. The files
// are build output, so they're in .gitignore; change the sources, not the files.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_NAME, ENTITY_LINE, FREE_PLAN_TEXT, PLANS, SITE_URL, SUPPORT_EMAIL, listText as list } from '../lib/brand.mjs';
import { INDEXABLE_PAGES, pageTitle } from '../lib/publicPages.mjs';
import { pageUrl } from '../lib/structuredData.mjs';
import { INTERVALS } from '../lib/spacedReview.mjs';
import { TYPE_LABELS } from '../lib/retainEngine.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

// Search and AI answer engines named explicitly, so their access never depends on the "*" rule.
export const ANSWER_ENGINES = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Applebot'];

export function robotsTxt() {
  return [
    '# Generated at build by web/scripts/crawlFiles.mjs from lib/brand.mjs and lib/publicPages.mjs.',
    '# Search and AI answer engines may read the public pages.',
    ...ANSWER_ENGINES.map(agent => `User-agent: ${agent}`),
    'Allow: /',
    '',
    '# Every other crawler: the same rules as before this file was generated (nothing disallowed).',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

// The date of the last commit that touched a page's source file; the build date without git.
export function lastModified(file, { git = true, today = new Date() } = {}) {
  if (git) {
    try {
      const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    } catch { /* no git here: fall back to the build date */ }
  }
  return today.toISOString().slice(0, 10);
}

export function sitemapXml(options) {
  const urls = INDEXABLE_PAGES.map(page => `  <url><loc>${pageUrl(page.path)}</loc><lastmod>${lastModified(page.file, options)}</lastmod></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

export function llmsTxt() {
  const { tiers, trial } = PLANS;
  const quizTypes = Object.values(TYPE_LABELS).map(label => label.toLowerCase());
  return [
    `# ${BRAND_NAME}`,
    '',
    `> ${ENTITY_LINE}`,
    '',
    '## Who it is for',
    '',
    'College students who want to study from their own course material. Instructors can turn off study set sharing for a course they teach.',
    '',
    '## What it does',
    '',
    '- Turns uploaded PDFs, PowerPoint and Word files, notes, photos, web pages, YouTube videos and recorded lectures into study guides, flashcards and practice tests.',
    '- Uses only the material you add; it does not search the web for answers.',
    `- Quizzes with ${list(quizTypes)} questions.`,
    `- Flashcard review spaced ${list(INTERVALS.map(String))} days apart.`,
    '- NCLEX-style practice questions from your own nursing material.',
    '- Records lectures and writes them up as outline notes.',
    '- Connects to Canvas with an access token (read-only) for classes, deadlines, grades and course files, or to a Canvas calendar feed for deadlines.',
    '- A Chrome extension captures the page you have open, including Canvas, Blackboard and Moodle pages and Google Docs and Slides.',
    '- Connects to Claude, so Claude can search your notes and quiz you from your flashcards.',
    '',
    '## Plans and prices (USD)',
    '',
    ...tiers.map(tier => `- ${tier.name}: $${tier.price} a ${tier.interval}`),
    `- The Free plan includes ${FREE_PLAN_TEXT}.`,
    `- Free trial: ${trial.days} days of ${trial.plan}, no card needed, one per account. It ends on its own and the account goes back to Free.`,
    '',
    '## Key pages',
    '',
    ...INDEXABLE_PAGES.map(page => `- [${pageTitle(page)}](${pageUrl(page.path)}): ${page.description}`),
    '',
    '## Contact',
    '',
    `- Support: ${SUPPORT_EMAIL}`,
    '',
  ].join('\n');
}

export function writeCrawlFiles(dir = join(WEB, 'public')) {
  writeFileSync(join(dir, 'robots.txt'), robotsTxt());
  writeFileSync(join(dir, 'sitemap.xml'), sitemapXml());
  writeFileSync(join(dir, 'llms.txt'), llmsTxt());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeCrawlFiles();
