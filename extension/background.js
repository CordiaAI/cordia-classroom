const API = 'https://autostudy-ai.fly.dev';
const MAX_FILE_BYTES = 50 * 1024 * 1024;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

async function apiFetch(path, options = {}, retry = true) {
  const auth = await storageGet(['authToken']);
  if (!auth.authToken) throw new Error('Sign in to CordiaClassroom first.');
  const headers = { Authorization: `Bearer ${auth.authToken}`, ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response = await fetch(API + path, { ...options, headers });
  if (response.status === 401 && retry) {
    const sync = await syncClassroomAuth(true);
    const fresh = await storageGet(['authToken']);
    if (!sync?.authenticated || !fresh.authToken) {
      await chrome.storage.local.remove(['authToken', 'refreshToken', 'userEmail']);
      throw new Error('Your Classroom session expired. Sign in again to reconnect.');
    }
    response = await fetch(API + path, { ...options, headers: { ...headers, Authorization: `Bearer ${fresh.authToken}` } });
  }
  return response;
}

async function responseData(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const detail = data?.detail;
  const error = new Error((typeof detail === 'string' ? detail : detail?.message) || fallback);
  error.status = response.status;
  throw error;
}

async function activeWebTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Open an HTTP or HTTPS study page first.');
  return tab;
}

async function syncClassroomAuth(forceRefresh = false) {
  const tabs = await chrome.tabs.query({ url: 'https://classroom.cordiacode.com/*' });
  for (const tab of tabs) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { action: 'syncCordiaAuth', forceRefresh });
    } catch (_) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['asai-bridge.js'] });
        return await chrome.tabs.sendMessage(tab.id, { action: 'syncCordiaAuth', forceRefresh });
      } catch (_) { /* Try the next Classroom tab. */ }
    }
  }
  return { authenticated: false, error: 'Sign in to CordiaClassroom, then reopen this panel.' };
}

async function validateClassroomAuth() {
  await syncClassroomAuth(false);
  const auth = await storageGet(['authToken', 'userEmail']);
  if (!auth.authToken) return { authenticated: false, error: 'Connect CordiaClassroom to make and save a guide.' };
  try {
    const profile = await responseData(await apiFetch('/auth/me'), 'Classroom could not verify this session.');
    return { authenticated: true, userEmail: profile.email || auth.userEmail || '' };
  } catch (error) {
    await chrome.storage.local.remove(['authToken', 'refreshToken', 'userEmail']);
    return { authenticated: false, error: error.message };
  }
}

async function ensureScraper(tabId) {
  try {
    const ready = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (ready?.scraperVersion === 1) return;
  } catch (_) { /* Inject below. */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['vendor/Readability.js', 'content.js'] });
}

async function captureScreen() {
  const tab = await activeWebTab();
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 82 });
  if (!image) throw new Error('Chrome could not capture the visible page.');
  return { image, title: tab.title || 'Study material', url: tab.url, sourceType: 'screenshot', tabId: tab.id };
}

function safeDocumentUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The document URL is not supported.');
  return url.href;
}

function filenameFor(source, response) {
  const disposition = response.headers.get('content-disposition') || '';
  const headerName = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)?.[1];
  if (headerName) return decodeURIComponent(headerName.replace(/\"/g, '').trim());
  if (source.filename) return source.filename;
  return decodeURIComponent(new URL(response.url || source.url).pathname.split('/').pop() || 'study-material');
}

async function extractDocument(source) {
  const response = await fetch(safeDocumentUrl(source.url), { credentials: 'include', redirect: 'follow' });
  if (!response.ok) throw new Error(`Document download failed (${response.status}).`);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_FILE_BYTES) throw new Error('The document is larger than 50 MB.');
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_FILE_BYTES) throw new Error('The document is empty or larger than 50 MB.');
  const form = new FormData();
  form.append('file', new File([blob], filenameFor(source, response), {
    type: blob.type || response.headers.get('content-type') || 'application/octet-stream',
  }));
  return responseData(await apiFetch('/extract-file-text', { method: 'POST', body: form }), 'Document extraction failed.');
}

async function scrapePage() {
  const tab = await activeWebTab();
  await ensureScraper(tab.id);
  const source = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePage' });
  if (!source) throw new Error('The page scraper returned no content.');
  if (source.kind === 'file') {
    const extracted = await extractDocument(source).catch(error => {
      throw new Error(/^The document/.test(error?.message) ? error.message : `The document could not be read: ${error?.message}`);
    });
    return { text: extracted.text, title: source.filename || tab.title || 'Study document', url: source.url, sourceType: 'file', tabId: tab.id };
  }
  if (!source.text?.trim()) throw new Error('No readable page content was found.');
  return {
    text: source.text.trim(),
    title: source.title || tab.title || 'Study page',
    url: tab.url,
    sourceType: source.selected ? 'selected_text' : 'webpage',
    tabId: tab.id,
  };
}

async function extractEducationalContent(message) {
  return responseData(await apiFetch('/ingest', {
    method: 'POST',
    body: JSON.stringify({ content: message.content, images: message.images || [] }),
  }), 'Educational-content extraction failed.');
}

async function createStudyGuide(message) {
  const generated = await responseData(await apiFetch('/generate', {
    method: 'POST',
    body: JSON.stringify({ content: message.content, images: message.images || [], notes: true, study_guide: true, flashcards: true }),
  }), 'Study-guide generation failed.');
  if (!generated.study_guide) throw new Error('The server returned no study guide.');
  return generated;
}

async function askTutor(message) {
  const answer = await responseData(await apiFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({
      question: message.question,
      content: message.content,
      mode: 'short',
      context_title: message.contextTitle || 'Current study material',
      context_url: /^https?:/i.test(message.contextUrl || '') ? message.contextUrl : null,
    }),
  }), 'Cordia Tutor could not answer that question.');
  if (!answer?.answer) throw new Error('Cordia Tutor returned no answer.');
  return answer;
}

async function saveStudyGuide(message) {
  if (!message.studyGuide?.trim()) throw new Error('Create a study guide before saving.');
  const saved = await responseData(await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title: message.title || 'Study Guide',
      notes: message.notes || null,
      study_guide: message.studyGuide,
      flashcards: message.flashcards || null,
      source_url: /^https?:/i.test(message.url || '') ? message.url : null,
      source_type: message.sourceType || 'webpage',
      source_title: message.title || 'Captured study material',
    }),
  }), 'The guide was generated but could not be saved.');
  if (!saved?.guide?.id) throw new Error('CordiaClassroom did not confirm the saved guide.');
  const guideUrl = `https://classroom.cordiacode.com/guide/${encodeURIComponent(saved.guide.id)}`;
  let redirected = false;
  try {
    if (message.tabId) {
      await chrome.tabs.update(message.tabId, { url: guideUrl });
      redirected = true;
    }
  } catch (_) { /* The source tab may have closed after generation. */ }
  if (!redirected) {
    try {
      await chrome.tabs.create({ url: guideUrl });
      redirected = true;
    } catch (_) { /* The confirmed save still succeeds even if Chrome blocks navigation. */ }
  }
  return { savedGuide: saved.guide, guideUrl, redirected };
}

const ACTIONS = { captureScreen, scrapePage, extractEducationalContent, createStudyGuide, saveStudyGuide, askTutor };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'syncClassroomAuth') {
    syncClassroomAuth().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message.action === 'validateClassroomAuth') {
    validateClassroomAuth().then(sendResponse).catch(error => sendResponse({ authenticated: false, error: error.message }));
    return true;
  }
  const action = ACTIONS[message.action];
  if (!action) return false;
  action(message)
    .then(data => sendResponse({ success: true, ...data }))
    .catch(error => sendResponse({ success: false, error: error.message, status: error.status || 0 }));
  return true;
});
