// The public connector docs (/connect/claude) and the privacy section stay in step with the server:
// every tool and prompt listed, the real server URL and support contact, the privacy anchor present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READ_TOOLS } from '../lib/mcp/readTools.mjs';
import { WRITE_TOOLS } from '../lib/mcp/writeTools.mjs';
import { PROMPTS } from '../lib/mcp/prompts.mjs';
import { SUPPORT_EMAIL } from '../lib/mcp/config.mjs';
import { SITE_URL } from '../lib/brand.mjs';

const page = readFileSync(new URL('../pages/connect/claude.js', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../pages/privacy.js', import.meta.url), 'utf8');

test('the connect page lists exactly the server\'s tools and prompts', () => {
  const listed = [...page.matchAll(/^\s+\['([a-z_]+)', '/gm)].map(match => match[1]);
  assert.deepEqual(listed, [...READ_TOOLS, ...WRITE_TOOLS].map(tool => tool.name));
  for (const prompt of PROMPTS) assert.ok(page.includes(`['${prompt.title}',`), prompt.title);
});

test('the connect page gives the real server URL, the support contact and the privacy link', () => {
  // The canonical host. Tokens keep their audience (MCP_TOKEN_AUDIENCE, still the legacy host), and
  // the endpoint checks that audience whichever host the request arrives on.
  assert.ok(page.includes(`const SERVER_URL = '${SITE_URL}/mcp'`));
  assert.ok(page.includes('SUPPORT_EMAIL'));
  assert.equal(SUPPORT_EMAIL, 'support@cordiaai.io');
  assert.ok(page.includes('/privacy#connected-ai-apps'));
  assert.ok(privacy.includes('id="connected-ai-apps"'));
});

test('the privacy section covers sharing, conversations, the audit log and its retention, and revoking', () => {
  const section = privacy.slice(privacy.indexOf('id="connected-ai-apps"'), privacy.indexOf('7. Cookies'));
  for (const phrase of ['What a connected app can access', 'does not store your conversations', 'deleted after 90 days', 'never record what you asked', 'Disconnect']) {
    assert.ok(section.includes(phrase), phrase);
  }
});
