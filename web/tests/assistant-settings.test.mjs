// Settings → Assistant: every screen reads from and saves to Cordia Assistant (lib/assistant.js)
// with the student's Classroom token, and is built from the design system's own pieces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Assistant has its own page, the top bar opens it, and old Settings links land there', () => {
  const page = read('pages/assistant.js');
  assert.match(page, /<AssistantSettings onOpenPlan=/);
  const sidebar = read('components/Sidebar.js');
  assert.match(sidebar, /label: 'Assistant', href: '\/assistant'/);
  assert.match(sidebar, /pathname === '\/assistant'/);
  const settings = read('pages/settings.js');
  assert.doesNotMatch(settings, /key: 'assistant'/);
  assert.match(settings, /section === 'assistant'.*pathname: '\/assistant'/);
});

test('calls go to /assistant/api with the Classroom token, never a second login', () => {
  const lib = read('lib/assistant.js');
  assert.match(lib, /const BASE = '\/assistant\/api'/);
  assert.match(lib, /Authorization: `Bearer \$\{getToken\(\) \|\| ''\}`/);
  assert.doesNotMatch(lib, /localStorage\.setItem/);
});

test('consent wording comes from the Assistant, word for word', () => {
  const setup = read('components/assistant/AssistantSetup.js');
  assert.match(setup, /\{catalog\.consents\.sms\}/);
  assert.match(setup, /\{catalog\.consents\.personality\}/);
  assert.match(setup, /consents: \{ sms_informational: true, personality_data: true, terms: true \}/);
});

test('one icon set: apps use Lucide icons, not brand marks or emoji', () => {
  const apps = read('components/assistant/AssistantApps.js');
  assert.match(apps, /from 'lucide-react'/);
  assert.doesNotMatch(apps, /<img|\.svg|\p{Extended_Pictographic}/u);
  for (const file of ['AssistantSettings', 'AssistantSetup', 'AssistantPersonality', 'AssistantSchedule', 'AssistantData']) {
    assert.doesNotMatch(read(`components/assistant/${file}.js`), /\p{Extended_Pictographic}/u, file);
  }
});

test('styles use tokens only', () => {
  const css = read('styles/assistant.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
  assert.match(read('pages/_app.js'), /import '\.\.\/styles\/assistant\.css';/);
});
