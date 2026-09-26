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

function runtime(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, response => {
    resolve(chrome.runtime.lastError ? { success: false, error: chrome.runtime.lastError.message } : response);
  }));
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
  connectLink.href = 'https://classroom.cordiacode.com';
  connectLink.textContent = 'Connect';
  connectLink.hidden = state.authenticated;
  announce(state.authenticated
    ? `Connected${auth.userEmail ? ` as ${auth.userEmail}` : ''}. Ready.`
    : (auth?.error || 'Connect CordiaClassroom to make and save a guide.'), state.authenticated ? 'ready' : 'warning');
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
  const response = await runtime({ action: 'createStudyGuide', content, images: state.images });
  if (!response?.success) throw new Error(response?.error || 'Study-guide creation failed.');
  if (!response.study_guide) throw new Error('The server returned no study guide.');
  state.generated = response;
  state.title = chooseGuideTitle();
  step('create', 'done');
}

async function makeStudyGuide() {
  if (!state.authenticated) return initAuth();
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
    } catch (_) {
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

function addTutorMessage(role, text) {
  tutorMessages.querySelector('.tutor-empty')?.remove();
  const message = document.createElement('p');
  message.className = `tutor-message ${role}`;
  // Diagrams render in Classroom; the side panel shows a pointer instead of raw diagram code.
  message.textContent = String(text || '').replace(/```mermaid[\s\S]*?```/g, '[Diagram: open this Tutor chat in Classroom to see it]');
  tutorMessages.appendChild(message);
  tutorMessages.scrollTop = tutorMessages.scrollHeight;
}

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
  addTutorMessage('user', question);
  tutorInput.value = '';
  tutorSend.disabled = true;
  announce('Cordia is reading the current material…', 'working');
  try {
    await ensureTutorContext();
    const response = await runtime({
      action: 'askTutor',
      question,
      content: studyContext(),
      contextTitle: state.source?.title || 'Current study material',
      contextUrl: state.source?.url || '',
    });
    if (!response?.success) throw new Error(response?.error || 'Cordia Tutor could not answer that question.');
    addTutorMessage('assistant', response.answer);
    announce('Tutor answer ready.', 'ready');
  } catch (error) {
    addTutorMessage('assistant', error.message || 'I could not answer that yet.');
    announce(error.message || 'Cordia Tutor could not answer that question.', 'error');
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
