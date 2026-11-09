import Head from 'next/head';
import { BRAND_NAME, SITE_URL } from '../lib/brand.mjs';
import { pageTitle, publicPage } from '../lib/publicPages.mjs';
import { articleGraph, faqPage, graphJson, homeGraph, pageGraph, pageUrl } from '../lib/structuredData.mjs';

// The <head> of every signed-out page: title, description, canonical, Open Graph and Twitter
// tags, noindex where the page list says so, and the page's one JSON-LD @graph. Everything comes
// from lib/publicPages.mjs, so each page only names its path (and its FAQ, if it has one).
// Pages that aren't in that list (a shared guide, a classroom invite) pass their own title and
// description, set their own robots tag, and get no JSON-LD, except a draft guide, which passes
// `article` so its Article markup can be checked on a preview deployment.
export default function SeoHead({ path, faq = null, title: ownTitle = '', description: ownDescription = '', article = null }) {
  const page = publicPage(path);
  const url = pageUrl(path);
  if (!page) {
    return (
      <Head>
        <title key="title">{ownTitle}</title>
        <meta name="description" content={ownDescription} key="description" />
        <link rel="canonical" href={url} key="canonical" />
        <meta property="og:site_name" content={BRAND_NAME} key="og:site_name" />
        <meta property="og:url" content={url} key="og:url" />
        <meta property="og:title" content={ownTitle} key="og:title" />
        <meta property="og:description" content={ownDescription} key="og:description" />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} key="og:image" />
        {article && <script type="application/ld+json" key="ld-graph" dangerouslySetInnerHTML={{ __html: graphJson(articleGraph({ path, description: ownDescription, ...article })) }} />}
      </Head>
    );
  }
  const title = pageTitle(page);
  const graph = path === '/' ? homeGraph()
    : page.article ? articleGraph({ path, description: page.description, crumb: page.crumb, modified: page.modified, ...page.article })
      : pageGraph({ path, name: title, crumb: page.crumb, modified: page.modified });
  if (faq) graph.push(faqPage(faq, path));
  return (
    <Head>
      <title key="title">{title}</title>
      <meta name="description" content={page.description} key="description" />
      <link rel="canonical" href={url} key="canonical" />
      {!page.index && <meta name="robots" content="noindex" key="robots" />}
      <meta property="og:type" content={page.article ? 'article' : 'website'} key="og:type" />
      <meta property="og:site_name" content={BRAND_NAME} key="og:site_name" />
      <meta property="og:url" content={url} key="og:url" />
      <meta property="og:title" content={title} key="og:title" />
      <meta property="og:description" content={page.description} key="og:description" />
      <meta property="og:image" content={`${SITE_URL}/og-image.png`} key="og:image" />
      <meta name="twitter:title" content={title} key="twitter:title" />
      <meta name="twitter:description" content={page.description} key="twitter:description" />
      <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} key="twitter:image" />
      <script type="application/ld+json" key="ld-graph" dangerouslySetInnerHTML={{ __html: graphJson(graph) }} />
    </Head>
  );
}
