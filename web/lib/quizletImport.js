// Importing a Quizlet set into the card editor. Quizlet blocks servers, so a link is read by the
// Chrome extension in the student's own browser (extension/background.js importQuizlet); without
// the extension, the student pastes Quizlet's Export text instead.

export function isQuizletUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && /(^|\.)quizlet\.com$/i.test(url.hostname) && /\d{3,}/.test(url.pathname);
  } catch {
    return false;
  }
}

export function extensionReady() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-asai-extension') === 'ready';
}

export function importWithExtension(url, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('The extension took too long to read the set.')); }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== 'CORDIA_QUIZLET_RESULT' || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (event.data.success && event.data.cards?.length) resolve({ title: event.data.title || '', cards: event.data.cards });
      else reject(new Error(event.data.error || 'No cards were found.'));
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'CORDIA_QUIZLET_IMPORT', id, url }, window.location.origin);
  });
}

// Quizlet's Export defaults to a tab between term and definition and a new line between cards.
// Pasted text also often uses " - " or ": " between them. Lines without a separator continue the
// previous definition.
export function parseQuizletText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const filled = lines.filter(line => line.trim());
  const separators = ['\t', ' - ', ' – ', ': '];
  const separator = separators.find(sep => filled.length && filled.filter(line => line.includes(sep)).length >= Math.ceil(filled.length / 2));
  if (!separator) return [];
  const cards = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const at = line.indexOf(separator);
    if (at > 0) cards.push({ term: line.slice(0, at).trim(), definition: line.slice(at + separator.length).trim() });
    else if (cards.length) cards[cards.length - 1].definition = `${cards[cards.length - 1].definition}\n${line.trim()}`.trim();
  }
  return cards.filter(card => card.term && card.definition);
}
