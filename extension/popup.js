const state = {
  screenshot: '', scraped: null, source: null, sections: [], images: [],
  generated: null, title: '', authenticated: false,
};

const makeButton = document.getElementById('make-guide');
const saveButton = document.getElementById('save-guide');
const saveBubble = document.getElementById('save-bubble');
const result = document.getElementById('result');
const resultTitle = document.getElementById('result-title');
const resultContent = document.getElementById('result-content');
const statusBox = document.getElementById('status');
const statusText = document.getElementById('status-text');
const connectLink = document.getElementById('connect');
const tutorForm = document.getElementById('tutor-form');
const tutorInput = document.getElementById('tutor-input');
const tutorSend = document.getElementById('tutor-send');
const tutorMessages = document.getElementById('tutor-messages');

const UPGRADE_URL = 'https://classroom.cordiaai.io/settings?section=subscription&upgrade=1';
const upgradeSheet = document.getElementById('upgrade-sheet');
const upgradeTitle = document.getElementById('upgrade-title');
const upgradeBody = document.getElementById('upgrade-body');
const LIMIT_TITLES = {
  guide: "You've used your 3 free study guides",
  tutor: "You've used your 10 free tutor prompts",
};

// Every 402 from Classroom opens the same upgrade sheet, wherever it came from.
function runtime(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, response => {
    const result = chrome.runtime.lastError ? { success: false, error: chrome.runtime.lastError.message } : response;
    if (result?.limit) showUpgrade(result.limit);
    resolve(result);
  }));
}

function showUpgrade(limit = {}) {
  upgradeTitle.textContent = LIMIT_TITLES[limit.feature] || limit.message || 'Upgrade to CordiaClassroom Pro';
  const resets = limit.resets_at ? new Date(limit.resets_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  upgradeBody.textContent = `Pro gives you unlimited guides from any page, unlimited Cordia Tutor, and guides that adapt to how you learn.${resets ? ` Your free plan resets ${resets}.` : ''}`;
  upgradeSheet.hidden = false;
}

async function refreshPlan() {
  const plan = await runtime({ action: 'billingStatus' });
  state.guidesLeft = plan?.success ? plan.features?.guide?.remaining : null;
  if (state.guidesLeft === 0) {
    makeButton.textContent = 'Get Pro to make more guides';
  } else {
    makeButton.textContent = 'Make study guide';
  }
}

function storage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function announce(message, tone = 'ready') {
  statusText.textContent = message;
  statusBox.dataset.tone = tone;
}

function step(name, status) {
  document.querySelector(`[data-step="${name}"]`).dataset.state = status;
}

function resetSteps() {
  document.querySelectorAll('.step').forEach(item => { item.dataset.state = ''; });
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\.(pdf|pptx?|docx?)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\w/g, letter => letter.toUpperCase());
}

function isGenericTitle(value) {
  return !value || /^(file\s*preview|document|study material|slides?|page|untitled)$/i.test(value.trim());
}

function chooseGuideTitle() {
  const sourceTitle = cleanTitle(state.source?.title);
  const headings = state.sections.map(section => cleanTitle(section.heading)).filter(title => !isGenericTitle(title));
  const content = state.sections.map(section => `${section.heading || ''} ${section.text || ''}`).join(' ');
  const assessment = cleanTitle(content.match(/\b(?:exam|test|quiz)\s*(?:review\s*)?#?\s*\d+\b/i)?.[0]);
  const topic = headings.find(title => !assessment || !title.toLowerCase().includes(assessment.toLowerCase()));
  if (assessment) return (topic ? `${assessment} — ${topic}` : assessment).slice(0, 100);
  if (!isGenericTitle(sourceTitle)) return sourceTitle.slice(0, 100);
  return (topic || 'Study Guide').slice(0, 100);
}

async function initAuth() {
  const auth = await runtime({ action: 'validateClassroomAuth' });
  state.authenticated = Boolean(auth?.authenticated);
  makeButton.disabled = !state.authenticated;
  tutorInput.disabled = !state.authenticated;
  tutorSend.disabled = !state.authenticated;
  connectLink.href = 'https://classroom.cordiaai.io';
  connectLink.textContent = 'Connect';
  connectLink.hidden = state.authenticated;
  announce(state.authenticated
    ? `Connected${auth.userEmail ? ` as ${auth.userEmail}` : ''}. Ready.`
    : (auth?.error || 'Connect CordiaClassroom to make and save a guide.'), state.authenticated ? 'ready' : 'warning');
  if (state.authenticated) await refreshPlan();
}

async function capture() {
  step('capture', 'active');
  announce('Capturing the visible study material…', 'working');
  const response = await runtime({ action: 'captureScreen' });
  if (!response?.success) {
    state.screenshot = '';
    step('capture', 'skipped');
    announce('Screen capture was unavailable. Reading the page directly…', 'working');
    return false;
  }
  state.screenshot = response.image;
  state.source = response;
  step('capture', 'done');
  return true;
}

async function scrape() {
  step('scrape', 'active');
  announce('Reading the page and attached document…', 'working');
  const response = await runtime({ action: 'scrapePage' });
  if (!response?.success) throw new Error(response?.error || 'Page reading failed.');
  state.scraped = response;
  state.source = response;
  step('scrape', 'done');
}

async function extract() {
  step('extract', 'active');
  announce('Finding the material worth studying…', 'working');
  const images = state.screenshot ? [{ data: state.screenshot, context: 'Visible study material' }] : [];
  const content = state.scraped?.text || (state.screenshot ? '[Screenshot fallback]' : '');
  if (!content) throw new Error('Chrome could not read or capture this page. Reload the extension, then try again.');
  const response = await runtime({
    action: 'extractEducationalContent',
    content,
    images,
  });
  if (!response?.success) throw new Error(response?.error || 'Educational extraction failed.');
  state.sections = response.sections || [];
  state.images = response.use_images ? images : [];
  if (!state.sections.length) throw new Error('No educational content was found on this page.');
  step('extract', 'done');
}

async function generate() {
  step('create', 'active');
  announce('Writing the study guide…', 'working');
  const content = state.sections.map(section => `${section.heading}\n${section.text}`).join('\n\n');
  if (state.requestSource !== content) {
    state.requestSource = content;
    state.requestId = crypto.randomUUID();
  }
  const response = await runtime({ action: 'createStudyGuide', content, images: state.images, requestId: state.requestId });
  if (!response?.success) throw new Error(response?.error || 'Study-guide creation failed.');
  if (!response.study_guide) throw new Error('The server returned no study guide.');
  state.generated = response;
  state.title = chooseGuideTitle();
  step('create', 'done');
}

async function makeStudyGuide() {
  if (!state.authenticated) return initAuth();
  // Out of free guides: show the upgrade before spending the student's time on capture.
  if (state.guidesLeft === 0) return showUpgrade({ feature: 'guide' });
  makeButton.disabled = true;
  saveBubble.hidden = true;
  saveBubble.classList.remove('saved');
  saveButton.disabled = false;
  saveButton.textContent = 'Save to Classroom';
  result.hidden = true;
  resetSteps();
  state.scraped = null;
  state.sections = [];
  state.generated = null;
  try {
    await capture();
    try {
      await scrape();
    } catch (scrapeError) {
      // A document we found but couldn't use (too large, unreadable) must not silently
      // become a screenshot of one visible page; only protected pages fall back.
      if (/^(The document|Document)/.test(scrapeError?.message || '')) throw scrapeError;
      step('scrape', 'skipped');
      announce('The page is protected. Using the visible capture instead…', 'working');
    }
    await extract();
    await generate();
    resultTitle.textContent = state.title;
    resultContent.textContent = state.generated.study_guide;
    result.hidden = false;
    document.getElementById('guide-title').textContent = state.title;
    saveBubble.hidden = false;
    announce('Guide ready. Review it, then save it to Classroom.', 'ready');
  } catch (error) {
    announce(error.message || 'The guide could not be created.', 'error');
  } finally {
    makeButton.disabled = false;
  }
}

function studyContext() {
  return state.sections.map(section => `${section.heading || ''}\n${section.text || ''}`).join('\n\n').trim();
}

const tutorChat = window.CordiaTutorChat.createChat({
  messages: tutorMessages,
  card: document.querySelector('.tutor-card'),
  sizeButton: document.getElementById('tutor-size'),
  newChatButton: document.getElementById('tutor-new'),
});

async function ensureTutorContext() {
  if (studyContext()) return;
  resetSteps();
  await capture();
  try {
    await scrape();
  } catch (_) {
    step('scrape', 'skipped');
  }
  await extract();
}

async function askTutor(event) {
  event.preventDefault();
  const question = tutorInput.value.trim();
  if (!question || tutorSend.disabled) return;
  if (!state.authenticated) return initAuth();
  const history = tutorChat.history();
  tutorChat.add('user', question);
  tutorInput.value = '';
  tutorSend.disabled = true;
  announce('Cordia is reading the current material…', 'working');
  const stopThinking = tutorChat.thinking();
  try {
    await ensureTutorContext();
    const response = await runtime({
      action: 'askTutor',
      question,
      history,
      content: studyContext(),
      contextTitle: state.source?.title || 'Current study material',
      contextUrl: state.source?.url || '',
    });
    if (!response?.success) throw new Error(response?.error || 'Cordia Tutor could not answer that question.');
    stopThinking();
    tutorChat.add('assistant', response.answer);
    announce('Tutor answer ready.', 'ready');
  } catch (error) {
    stopThinking();
    if (error.message === 'context_window_full') tutorChat.contextFull();
    else tutorChat.add('assistant', error.message || 'I could not answer that yet.', { remember: false });
    announce(error.message === 'context_window_full' ? 'Start a new chat to keep going.' : error.message || 'Cordia Tutor could not answer that question.', 'error');
  } finally {
    tutorSend.disabled = false;
    tutorInput.focus();
  }
}

async function saveStudyGuide() {
  if (!state.generated || saveButton.disabled) return;
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  announce('Saving your guide to CordiaClassroom…', 'working');
  const source = state.source || {};
  const response = await runtime({
    action: 'saveStudyGuide',
    title: state.title,
    notes: state.generated.notes,
    studyGuide: state.generated.study_guide,
    flashcards: state.generated.flashcards,
    url: source.url || '',
    sourceType: source.sourceType || 'webpage',
    tabId: source.tabId,
  });
  if (!response?.success || !response.savedGuide?.id) {
    saveButton.disabled = false;
    saveButton.textContent = 'Save to Classroom';
    announce(response?.error || 'The guide could not be saved. Try again.', 'error');
    return;
  }
  saveBubble.classList.add('saved');
  saveButton.textContent = 'Saved';
  state.requestSource = null;
  refreshPlan();
  if (response.redirected) {
    announce('Saved. Opening your guide in CordiaClassroom…', 'ready');
  } else {
    connectLink.href = response.guideUrl;
    connectLink.textContent = 'Open guide';
    connectLink.hidden = false;
    announce('Saved to Classroom. Open the guide here.', 'ready');
  }
}

makeButton.addEventListener('click', makeStudyGuide);
saveButton.addEventListener('click', saveStudyGuide);
tutorForm.addEventListener('submit', askTutor);
connectLink.addEventListener('click', () => announce('Sign in to Classroom. This panel will connect automatically.', 'working'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['authToken', 'userEmail'].some(key => changes[key])) initAuth();
});
window.addEventListener('focus', initAuth);
document.addEventListener('visibilitychange', () => { if (!document.hidden) initAuth(); });
initAuth();

document.getElementById('upgrade-open').addEventListener('click', () => {
  chrome.tabs.create({ url: UPGRADE_URL });
});
document.getElementById('upgrade-close').addEventListener('click', () => {
  upgradeSheet.hidden = true;
});
