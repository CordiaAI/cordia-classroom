import ComparisonArticle from '../components/ComparisonArticle';
import { COMPARISONS, comparisonPath } from '../lib/comparisons/index.mjs';

const SLUG = 'best-ai-study-platforms-canvas-integration';

// The page text (web/content/<slug>.md) and JSON-LD (web/content/<slug>.jsonld.json) are read and
// parsed at build time, so all of it is in the server-rendered HTML.
export async function getStaticProps() {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { parseComparison } = await import('../lib/comparisons/markdown.mjs');
  const dir = join(process.cwd(), 'content');
  const [text, jsonLd] = await Promise.all([
    readFile(join(dir, `${SLUG}.md`), 'utf8'),
    readFile(join(dir, `${SLUG}.jsonld.json`), 'utf8').then(JSON.parse),
  ]);
  return { props: { parts: parseComparison(text), jsonLd } };
}

export default function BestAiStudyPlatformsCanvasIntegration({ parts, jsonLd }) {
  const page = COMPARISONS.find(item => item.slug === SLUG);
  return <ComparisonArticle page={page} path={comparisonPath(page)} parts={parts} jsonLd={jsonLd} />;
}
