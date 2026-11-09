import GuideArticle from '../../components/GuideArticle';
import { AUTHOR, guideBySlug, guidePath, visibleGuides } from '../../lib/guides/index.mjs';
import { BODIES } from '../../lib/guides/bodies.mjs';
import { parseGuide } from '../../lib/guides/markdown.mjs';
import { relatedLinks } from '../../lib/guides/related.mjs';

// One guide. Everything arrives as props from getStaticProps, so the page's browser code holds
// no guide text: a draft is built only where drafts are visible (lib/guides/index.mjs) and 404s
// everywhere else.
export default function GuidePage({ guide, blocks, author, related }) {
  return <GuideArticle guide={guide} blocks={blocks} author={author} path={guidePath(guide)} related={related} />;
}

export function getStaticPaths() {
  return { paths: visibleGuides().map(guide => ({ params: { slug: guide.slug } })), fallback: false };
}

export function getStaticProps({ params }) {
  const guide = guideBySlug(params.slug);
  // Parsed here, so the editor notes (HTML comments) never reach the page or its JSON data.
  return { props: { guide, blocks: parseGuide(BODIES[guide.slug]), author: AUTHOR, related: relatedLinks(guide.related) } };
}
