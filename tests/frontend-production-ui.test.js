const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const layout = read('web', 'components', 'Layout.js');
const navigation = read('web', 'components', 'Sidebar.js');
const dashboard = read('web', 'pages', 'dashboard.js');
const login = read('web', 'pages', 'index.js');
const api = read('web', 'lib', 'api.js');
const styles = read('web', 'styles', 'globals.css');
const calendarDashboard = read('web', 'components', 'CalendarDashboard.js');
const tutor = read('web', 'components', 'AIChatWidget.js');
const tutorDrawer = read('web', 'components', 'TutorDrawer.js');
const retain = read('web', 'components', 'RetainCards.js');
const flashcards = read('web', 'components', 'FlashcardViewer.js');
const createPage = read('web', 'pages', 'create.js');
const nclex = read('web', 'components', 'NCLEXQuizMode.js');
const extensionPopup = read('extension', 'popup.js');
const missionPage = read('web', 'pages', 'mission.js');
const provenanceMigration = read('supabase', 'migrations', '20260916000000_guide_provenance.sql');
const rlsMigration = read('supabase', 'migrations', '20260915035012_harden_classroom_rls.sql');
const flashcardLibrary = read('web', 'pages', 'flashcards.js');
const library = read('web', 'pages', 'library.js');
const calendarPage = read('web', 'pages', 'canvas.js');
const system = read('web', 'styles', 'system.css');
const authCard = read('web', 'components', 'AuthCard.js');
const publicPage = read('web', 'components', 'PublicPage.js');
const guideCreate = read('web', 'lib', 'guideCreate.js');
const guidePage = read('web', 'pages', 'guide', '[id].js');
const folderPage = read('web', 'pages', 'folder', '[id].js');
const nextConfig = read('web', 'next.config.js');
const retainPage = read('web', 'pages', 'quiz', '[guideId].js');
const practicePage = read('web', 'components', 'PracticeWorkspace.js');
const oauthCallback = read('web', 'pages', 'auth', 'callback.js');

assert.match(navigation, /className="c-topbar"/);
assert.match(navigation, /<AccountMenu open=\{menuOpen\}/);
assert.match(navigation, /className="c-tabbar"/);
assert.doesNotMatch(layout, /className="app-layout"/);
// Today loads every source together (cached, revalidated) and reveals once.
assert.match(dashboard, /useCachedPage\('today'/);
assert.match(dashboard, /await Promise\.all\(/);
assert.match(dashboard, /<LoadGate ready=\{loaded\}/);
assert.match(api, /AbortController/);
assert.match(api, /REQUEST_TIMEOUT_MS/);
assert.match(api, /export function apiErrorMessage/);
assert.match(api, /localStorage\.getItem\('userEmail'\) \|\| tokenIdentity\(\)\.email/);
assert.match(api, /localStorage\.getItem\('userName'\) \|\| tokenIdentity\(\)\.name/);
assert.match(api, /metadata\.given_name/);
assert.match(api, /localStorage\.removeItem\('userName'\)/);
assert.match(api, /response\.headers\.get\('X-Request-ID'\)/);
assert.doesNotMatch(api, /Reference: \$\{/);
assert.doesNotMatch(authCard, /\/auth\/(signup|login|oauth|forgot-password)/);
assert.match(authCard, /supabaseAuth\(\)\.signInWithOAuth/);
assert.match(authCard, /var\(--google-blue\)/);
assert.match(publicPage, /classroom-clouds\.webp/);
assert.match(authCard, /Continue with Google/);
assert.match(login, /<h1 className="landing-title">CordiaClassroom<\/h1>/);
assert.match(login, /Tutor reminds you through phone messages/);
// Raw provider errors never reach the student.
assert.match(authCard, /export function authMessage/);
assert.doesNotMatch(authCard, /setError\(authError\?\.message/);
assert.match(oauthCallback, /setToken\(accessToken/);
assert.match(calendarDashboard, /apiFetch\('\/calendar\/connection'/);
assert.match(calendarDashboard, /cordiaCanvasCalendarFeed/);
assert.match(calendarDashboard, /accountKey\(FEED_KEY, accountId\)/);
assert.match(calendarDashboard, /localStorage\.removeItem\(FEED_KEY\)/);
assert.match(calendarDashboard, /method: 'DELETE'/);
assert.doesNotMatch(calendarDashboard, /localStorage\.setItem\(feedKey, url\)/);
assert.match(navigation, /apiFetch\('\/auth\/me'\)/);
assert.match(navigation, /displayName/);
assert.match(calendarDashboard, /Due today/);
assert.match(calendarPage, /<CalendarDashboard \/>/);
assert.match(navigation, /label: 'Canvas', href: '\/canvas'/);
assert.match(dashboard, /calendar: '\/canvas\?tab=calendar'/);
assert.match(dashboard, /Some Classroom data could not be refreshed/);
assert.match(dashboard, /guides: guideList/);
assert.match(dashboard, /role="alert"/);
assert.match(calendarDashboard, /apiErrorMessage\(data\?\.detail/);
// Cards have no resize handles; one soft shadow; three radii.
assert.doesNotMatch(styles, /resize: (horizontal|vertical|both)/);
assert.match(read('web', 'styles', 'tokens.css'), /--shadow-card: 0 1px 2px rgba\(16, 24, 16, 0\.04\), 0 8px 24px rgba\(16, 24, 16, 0\.06\)/);
assert.match(system, /\.workspace-rail[^{]*\{ display: none !important; \}/);
assert.match(calendarDashboard, /Notification\.requestPermission/);
assert.match(calendarDashboard, /\{loading \? 'Checking…' : 'Connect'\}/);
for (const step of ['Open Canvas', 'Copy link', 'Paste here']) assert.ok(calendarDashboard.includes(step), `calendar step ${step}`);
assert.doesNotMatch(calendarDashboard, /CanvasConnectionWizard|canvas-token-wizard|\/profile\/settings|Pipedream/);
assert.doesNotMatch(styles, /\.canvas-wizard-overlay|\.canvas-token-wizard/);
assert.match(tutor, /<strong>Tutor<\/strong>/);
// The context chip follows the material on screen after every navigation.
assert.match(tutor, /appliedPreferred\.current = ''; \}, \[router\.asPath, preferredGuideId, preferredNoteId\]/);
// Send shows only when there is text.
assert.match(tutor, /\{input\.trim\(\) && \(\n\s*<button type="button" className="cordia-tutor-send"/);
// Web Tutor: readable answers, the student's message stays visible, and a live loader bubble.
assert.match(tutor, /rich_text: true/);
assert.match(tutor, /parseTutorAnswer\(text\)/);
assert.match(tutor, /next\?\.id && !sendingRef\.current/);
assert.match(tutor, /tutor-thinking/);
assert.match(tutor, /<CordiaLoader size=\{20\} label="Thinking" \/>/);
assert.match(tutor, /apiFetch\('\/smart_notes'\)/);
assert.match(tutor, /guide_id: material\.id/);
assert.match(tutor, /note_id: material\.id/);
assert.match(tutor, /context_title: material\.title/);
assert.match(tutor, /\/extract-file-text/);
assert.match(tutor, /find_material: 'Finding related material…'/);
assert.match(tutor, /Browser unavailable\. Open the Chrome side panel/);
assert.match(tutor, /choose an existing guide or SmartNote, or attach a file/);
assert.match(tutor, /Based on \{message\.source\.title\}/);
assert.match(tutor, /retain_context: retainContext/);
assert.doesNotMatch(createPage, /externalSourceId\.startsWith\('canvas:'\)/);
assert.match(nclex, /source_type: 'study_guide'/);
assert.match(extensionPopup, /action: 'createStudyGuide'/);
assert.match(extensionPopup, /sourceType: source\.sourceType/);
assert.match(missionPage, /One Cordia Tutor/);
assert.match(guidePage, /\{sourceHref\n\s*\? <a href=\{sourceHref\}/);
for (const column of ['source_type', 'source_title', 'source_id']) assert.ok(provenanceMigration.includes(column));
for (const policy of [
  'Allow insert for authenticated users',
  'Users can insert own guides',
  'Users can update own guides',
  'Users can delete own guides',
  'Users can insert own usage',
  'Users can update own usage',
]) assert.ok(rlsMigration.includes(`drop policy if exists "${policy}"`));
assert.doesNotMatch(rlsMigration, /drop policy[^;]*(?:select|view)/i);
assert.match(rlsMigration, /alter function public\.handle_new_user\(\) set search_path = ''/);
assert.match(rlsMigration, /revoke execute on function public\.handle_new_user\(\) from public, anon, authenticated/);
assert.match(tutorDrawer, /role="separator"/);
assert.match(tutorDrawer, /aria-valuenow=\{width\}/);
assert.match(tutorDrawer, /onKeyDown=\{resizeWithKeyboard\}/);
assert.match(tutorDrawer, /cordiaTutorOpen/);
assert.match(tutorDrawer, /event\.key !== 'Escape'/);
assert.match(tutorDrawer, /cordia:tutor-prompt/);
assert.match(retain, /retainContext/);
assert.match(retain, /selected_answer: selectedAnswer/);
assert.match(retain, /correct_answer: conceptAnswer\(question\)/);
assert.match(retainPage, /'Regenerating…' : 'Regenerate'/);
assert.match(retainPage, /\/quiz\/.*\/regenerate/);
assert.match(retainPage, /method: 'POST'/);
assert.match(guidePage, /\{ key: 'practice', label: 'Practice', icon: PencilRuler, href: '\/practice\/' \+ id, needsCards: true \}/);
assert.match(practicePage, /'Regenerate' : 'Generate'/);
assert.match(practicePage, /Drawing workspace/);
assert.match(practicePage, /Source material/);
assert.match(practicePage, /Check answer/);
assert.match(flashcards, /Explain this question:/);
assert.match(flashcards, /Again <kbd>1<\/kbd>/);
assert.match(flashcards, /Got it <kbd>2<\/kbd>/);
assert.doesNotMatch(retain, /Chatbot being created|requestExplanation/);
assert.doesNotMatch([dashboard, calendarDashboard, createPage, flashcardLibrary, library].join('\n'), /editorial-kicker|dashboard-rail-kicker/);
assert.match(guidePage, /Study guide unavailable/);
assert.match(folderPage, /Class unavailable/);
assert.match(guidePage, /role="alert"/);
assert.match(folderPage, /role="alert"/);
assert.doesNotMatch(folderPage, /Unknown Folder/);
assert.match(layout, /!pageOwnsTutor && <TutorDrawer preferredGuideId=\{activeGuideId\} preferredNoteId=\{activeNoteId\} \/>/);
assert.match(layout, /<Walkthrough \/>/);
assert.match(tutorDrawer, /tutor-drawer-shell/);
assert.doesNotMatch(tutor, /requestAnimationFrame|MAX_BUBBLES|stepPhysics/);
assert.match(nextConfig, /Strict-Transport-Security/);
assert.match(nextConfig, /X-Content-Type-Options/);
assert.match(nextConfig, /X-Frame-Options/);
assert.match(nextConfig, /Referrer-Policy/);
assert.match(nextConfig, /Permissions-Policy/);

console.log('Production frontend contract passed');
