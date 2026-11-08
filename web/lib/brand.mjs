// Who Cordia Classroom is, said the same way everywhere: page heads, JSON-LD, the footer and the
// crawl files (scripts/crawlFiles.mjs). Plans come from lib/plans.js, never retyped here.
import { EXTENSION_STORE_URL } from './extension.js';
import { FEATURE_COPY, FREE_LIMITS, TIERS, TRIAL } from './plans.js';

export const BRAND_NAME = 'Cordia Classroom';
export const SITE_URL = 'https://classroom.cordiaai.io';
export const SUPPORT_EMAIL = 'support@cordiaai.io';
export const ENTITY_LINE = 'Cordia Classroom is an AI study app for college students that turns course material (slides, PDFs, lectures and Canvas pages) into study guides, flashcards and practice tests.';
export const SAME_AS = [EXTENSION_STORE_URL];
export const PARENT_ORG = { name: 'CordiaAI', url: 'https://cordiaai.io' };
export const LOGO_URL = `${SITE_URL}/cordia-classroom-icon.png`;

const amount = price => price.replace(/^\$/, '');

// Every plan with its monthly price in USD, the trial, and the Free plan's monthly allowances.
export const PLANS = {
  currency: 'USD',
  tiers: [
    { key: 'free', name: 'Free', price: '0', interval: 'month' },
    ...Object.entries(TIERS).map(([key, tier]) => ({ key, name: tier.name, price: amount(tier.price), interval: tier.per })),
  ],
  trial: { ...TRIAL, plan: TIERS[TRIAL.tier].name },
  freeAllowances: Object.entries(FREE_LIMITS).map(([feature, limit]) => ({ feature, limit, label: FEATURE_COPY[feature].label })),
};

export const planByKey = key => PLANS.tiers.find(tier => tier.key === key);

// "a, b and c"
export const listText = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]);

// "3 study guides, … each month, plus one try each of practice sets, …"
export const FREE_PLAN_TEXT = (() => {
  const monthly = PLANS.freeAllowances.filter(item => item.limit > 1).map(item => `${item.limit} ${item.label}`);
  const oneTry = PLANS.freeAllowances.filter(item => item.limit === 1).map(item => item.label);
  return `${listText(monthly)} each month, plus one try each of ${listText(oneTry)}`;
})();
