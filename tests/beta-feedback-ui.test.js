const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const navigation = read('web', 'components', 'Sidebar.js');
const help = read('web', 'components', 'HelpSheet.js');
const modal = read('web', 'components', 'FeedbackModal.js');
const review = read('web', 'pages', 'feedback-review.js');

// Feedback lives under avatar > Help.
assert.match(navigation, /role="menuitem" onClick=\{\(\) => \{ setMenuOpen\(false\); setShowHelp\(true\); \}\}/);
assert.match(navigation, /onFeedback=\{\(\) => \{ setShowHelp\(false\); setShowFeedback\(true\); \}\}/);
assert.match(help, /onClick=\{onFeedback\}>.*Feedback<\/button>/);
assert.match(navigation, /\/feedback\/reviewer-status/);
assert.match(help, /canReviewFeedback &&/);

for (const category of ['bug', 'suggestion', 'incorrect_content', 'account_payment', 'other']) {
  assert.ok(modal.includes(`['${category}'`));
}
assert.match(modal, /role="dialog"/);
assert.match(modal, /aria-modal="true"/);
assert.match(modal, /event\.key === 'Escape'/);
assert.match(modal, /event\.key !== 'Tab'/);
assert.match(modal, /maxLength=\{2000\}/);
assert.match(modal, /requestIdRef/);
assert.match(modal, /submittingRef/);
assert.match(modal, /page_path: \(router\.asPath/);
assert.match(modal, /split\('\?', 1\)/);
assert.match(modal, /Your draft is still here/);
assert.doesNotMatch(modal, /setMessage\(''\)/);

assert.match(review, /\/feedback\/review/);
assert.match(review, /Feedback review/);
assert.match(review, /category/);
assert.match(review, /status/);
assert.doesNotMatch(review, /dangerouslySetInnerHTML/);

console.log('Beta feedback UI contract passed');
