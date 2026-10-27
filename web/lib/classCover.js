import { apiFetch } from './api';
import { classLabel } from './classLabel';
import { requestVisual } from '../components/NapkinVisual';
import { currentTheme } from '../components/MermaidDiagram';

// A class's cover in Library's card view: a Napkin visual of what the class covers, drawn from
// its name and the titles of its guides, lectures and notes (never made-up topics).
export const COVER_CONTEXT = 'A cover picture for a class: show how its main topics connect, as one simple diagram.';
const MAX_TOPICS = 10;

export function coverText(name, titles = []) {
  const { title, code } = classLabel(name);
  const topics = [...new Set(titles.map(item => String(item || '').trim()).filter(Boolean))].slice(0, MAX_TOPICS);
  return [`${title}${code && code !== title ? ` (${code})` : ''}`, ...(topics.length ? ['Topics in this class:', ...topics.map(topic => `- ${topic}`)] : [])].join('\n');
}

export async function saveCover(folderId, visual) {
  const data = await apiFetch(`/folders/${folderId}/cover`, { method: 'PUT', body: JSON.stringify(visual) });
  return data?.folder ? { folder: data.folder } : { error: data?.detail || 'Cover not saved' };
}

export async function removeCover(folderId) {
  const data = await apiFetch(`/folders/${folderId}/cover`, { method: 'DELETE' });
  return data?.folder ? { folder: data.folder } : { error: data?.detail || 'Cover not removed' };
}

// Draw a first cover and keep it. { cover } on success; { stop } when visuals are off or used up,
// so Library stops drawing more this visit.
export async function drawCover(folder, titles) {
  const text = coverText(folder.name, titles);
  const theme = currentTheme();
  const { status, data } = await requestVisual({ text, context: COVER_CONTEXT, theme });
  if (status === 402) return { stop: 'limit' };
  const visual = data?.status === 'ok' ? data.visuals?.[0] : null;
  if (!visual) return { stop: data?.reason === 'not_configured' ? 'off' : '' };
  const cover = { url: visual.url, alt: data.alt || '', text, redraw: 0, theme: data.theme || theme };
  // Shown even if saving fails (before the covers migration runs); the cache makes the next
  // visit's drawing free.
  await saveCover(folder.id, cover);
  return { cover };
}
