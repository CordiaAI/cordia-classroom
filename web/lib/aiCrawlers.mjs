// AI and search crawlers whose visits to public pages are logged (web/proxy.js), one structured line
// each: {"type":"ai_crawler","bot":"GPTBot","path":"/pricing","status":200}. Nothing about the
// visitor (no IP, no full user agent, no query string) is written.

// The name each bot puts in its user agent. Google-Extended is a robots.txt token that Google does
// not send as a user agent, so it is listed for completeness but won't normally appear.
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Bingbot', 'Applebot',
];

// Every regex special character escaped (backslash included), so a name is always matched literally.
const escapeRegex = text => text.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&');
const PATTERN = new RegExp(`(?:^|[^A-Za-z0-9-])(${AI_CRAWLERS.map(escapeRegex).join('|')})(?![A-Za-z0-9-])`, 'i');

// The bot's canonical name for a user agent, or null. Case doesn't matter (Bing sends "bingbot").
export function crawlerFrom(userAgent = '') {
  const match = PATTERN.exec(String(userAgent));
  if (!match) return null;
  return AI_CRAWLERS.find(name => name.toLowerCase() === match[1].toLowerCase()) || null;
}

// A path that is a page rather than a file: no extension, not Next's own assets or the API.
export const isPagePath = path => !/^\/(_next|api)\//.test(path) && !/\.[A-Za-z0-9]+$/.test(path);

export const crawlerLogLine = ({ bot, path, status }) => JSON.stringify({ type: 'ai_crawler', bot, path, status });
