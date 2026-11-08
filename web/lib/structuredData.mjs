// Schema.org JSON-LD for the public pages, built from lib/brand.mjs. Each page gets one @graph:
// the home page names the site, the organization and the app (with one Offer per plan); every
// other page is a WebPage inside the site, with a breadcrumb trail. No ratings or reviews.
import { BRAND_NAME, ENTITY_LINE, LOGO_URL, PARENT_ORG, PLANS, SAME_AS, SITE_URL, SUPPORT_EMAIL } from './brand.mjs';

export const ids = { website: `${SITE_URL}/#website`, org: `${SITE_URL}/#org`, app: `${SITE_URL}/#app` };
export const pageUrl = path => SITE_URL + (path === '/' ? '/' : path);

function offer(tier) {
  const base = { '@type': 'Offer', name: tier.name, price: tier.price, priceCurrency: PLANS.currency };
  if (tier.price === '0') return base;
  return {
    ...base,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: tier.price,
      priceCurrency: PLANS.currency,
      unitCode: 'MON',
      unitText: tier.interval,
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
    },
  };
}

export function homeGraph() {
  return [
    { '@type': 'WebSite', '@id': ids.website, name: BRAND_NAME, url: SITE_URL, publisher: { '@id': ids.org } },
    {
      '@type': 'Organization',
      '@id': ids.org,
      name: BRAND_NAME,
      url: SITE_URL,
      logo: LOGO_URL,
      email: SUPPORT_EMAIL,
      description: ENTITY_LINE,
      sameAs: SAME_AS,
      parentOrganization: { '@type': 'Organization', '@id': `${PARENT_ORG.url}/#org`, name: PARENT_ORG.name, url: PARENT_ORG.url },
    },
    {
      '@type': 'WebApplication',
      '@id': ids.app,
      name: BRAND_NAME,
      url: SITE_URL,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web browser; Chrome extension',
      publisher: { '@id': ids.org },
      offers: PLANS.tiers.map(offer),
    },
  ];
}

export function pageGraph({ path, name, crumb }) {
  const url = pageUrl(path);
  return [
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name, isPartOf: { '@id': ids.website }, about: { '@id': ids.app } },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: pageUrl('/') },
        { '@type': 'ListItem', position: 2, name: crumb, item: url },
      ],
    },
  ];
}

// The same {question, answer} array the visible FAQ renders (components/Faq.js).
export function faqPage(items, path) {
  return {
    '@type': 'FAQPage',
    '@id': `${pageUrl(path)}#faq`,
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

// The script body, with "<" escaped so no string can close the tag.
export const graphJson = nodes => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
