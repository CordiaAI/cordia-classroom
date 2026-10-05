import { useEffect, useRef, useState } from 'react';

// Page-wide file drag and drop. A file dropped anywhere on the page goes to one
// upload box: the box under the pointer if there is one, otherwise the box with
// the highest priority (the page's own upload box before the Tutor).
const zones = new Map();
const listeners = new Set();
let activeId = null;
let endTimer = null;
let nextId = 1;

const UNSUPPORTED = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|iso|exe|msi|app|apk|mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpeg|mpg|3gp|mp3|wav|m4a|aac|ogg|flac|wma|aiff?)$/i;

// Formats the server cannot read yet get a clear message before any upload starts.
export function unsupportedFileMessage(file) {
  const name = file?.name || '';
  const type = file?.type || '';
  if (!UNSUPPORTED.test(name) && !/^(video|audio)\//.test(type)) return '';
  const kind = /^video\//.test(type) || /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpeg|mpg|3gp)$/i.test(name) ? 'Video'
    : /^audio\//.test(type) || /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff?)$/i.test(name) ? 'Audio'
      : 'This file type';
  return `${kind} files are not supported yet (${name}). Try a PDF, PowerPoint, Word, image, or text file.`;
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  listeners.forEach(notify => notify(id));
}

function pickZone(target) {
  let best = null;
  zones.forEach((zone, id) => {
    const element = zone.getElement();
    if (!element) return;
    const contains = target instanceof Node && element.contains(target);
    const rank = (contains ? 1000 : 0) + zone.priority;
    if (!best || rank > best.rank) best = { id, rank, contains };
  });
  return best;
}

function onDragOver(event) {
  if (!hasFiles(event) || !zones.size) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  setActive(pickZone(event.target)?.id ?? null);
  // dragover repeats while a file is over the page; when it stops, the drag left.
  window.clearTimeout(endTimer);
  endTimer = window.setTimeout(() => setActive(null), 160);
}

function onDrop(event) {
  if (!hasFiles(event) || !zones.size) return;
  event.preventDefault();
  window.clearTimeout(endTimer);
  const picked = pickZone(event.target);
  setActive(null);
  const files = Array.from(event.dataTransfer.files || []);
  const zone = picked && zones.get(picked.id);
  if (zone && files.length) zone.onFiles(files, { direct: picked.contains });
}

function install() {
  window.addEventListener('dragenter', onDragOver);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
}

function uninstall() {
  window.removeEventListener('dragenter', onDragOver);
  window.removeEventListener('dragover', onDragOver);
  window.removeEventListener('drop', onDrop);
  window.clearTimeout(endTimer);
  setActive(null);
}

// Registers an upload box. Returns true while a dragged file would land in it,
// so the box can show its drop outline.
export function useFileDropZone({ getElement, onFiles, priority = 0, enabled = true }) {
  const [active, setIsActive] = useState(false);
  const latest = useRef({ getElement, onFiles });
  latest.current = { getElement, onFiles };

  useEffect(() => {
    if (!enabled) return undefined;
    const id = nextId++;
    if (!zones.size) install();
    zones.set(id, {
      priority,
      getElement: () => latest.current.getElement(),
      onFiles: (files, info) => latest.current.onFiles(files, info),
    });
    const notify = current => setIsActive(current === id);
    listeners.add(notify);
    return () => {
      zones.delete(id);
      listeners.delete(notify);
      if (activeId === id) setActive(null);
      if (!zones.size) uninstall();
    };
  }, [enabled, priority]);

  return enabled && active;
}
