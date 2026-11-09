import { NextResponse } from 'next/server';
import { crawlerFrom, crawlerLogLine, isPagePath } from './lib/aiCrawlers.mjs';
import { publicPage } from './lib/publicPages.mjs';

// AI crawler log: one structured line per crawler request to a public page, e.g.
//   {"type":"ai_crawler","bot":"GPTBot","path":"/pricing","status":200}
// Vercel shows it in the deployment's logs (search "ai_crawler"). No IP, full user agent or query.
//
// The matcher only lets requests whose user agent names one of these crawlers reach this function,
// so visitors' requests never run it and pay no latency. It changes nothing about the response:
// next.config.js headers (including the app routes' noindex) are applied before it and kept.
// Public pages are prerendered, so a request that reaches one is served 200; a proxy runs before
// the page and can't read the final status, which is why the line records 200 for them.
export function proxy(request) {
  const path = request.nextUrl.pathname;
  const bot = crawlerFrom(request.headers.get('user-agent') || '');
  if (bot && isPagePath(path) && publicPage(path)) console.log(crawlerLogLine({ bot, path, status: 200 }));
  return NextResponse.next();
}

// Literal values only: Next reads this at build time. Keep the bot list in step with
// lib/aiCrawlers.mjs (web/tests/ai-crawlers.test.mjs checks it). Static files are skipped.
export const config = {
  matcher: [
    {
      source: '/((?!_next/|api/|.*\\.[A-Za-z0-9]+$).*)',
      has: [{ type: 'header', key: 'user-agent', value: '.*(GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|Google-Extended|[Bb]ingbot|Applebot).*' }],
    },
  ],
};
