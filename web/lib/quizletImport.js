// Importing a Quizlet set into the card editor. Quizlet blocks servers, so a link is read by the
// Chrome extension in the student's own browser (extension/background.js importQuizlet); without
// the extension, the student pastes Quizlet's Export text instead.
import { askExtension } from './extensionBridge.js';

export function isQuizletUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && /(^|\.)quizlet\.com$/i.test(url.hostname) && /\d{3,}/.test(url.pathname);
  } catch {
    return false;
  }
}

export { extensionCan, extensionReady } from './extensionBridge.js';

export async function importWithExtension(url) {
  const set = await askExtension('importQuizlet', url);
  if (!set.cards?.length) throw new Error('No cards were found.');
  return { title: set.title || '', cards: set.cards };
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
