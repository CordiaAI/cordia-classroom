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

// Formats /extract-file-text can't read but the student can re-save as one it can.
const SAVE_AS = {
  doc: 'Older Word (.doc) files can\'t be read. Save it as .docx, then upload it.',
  ppt: 'Older PowerPoint (.ppt) files can\'t be read. Save it as .pptx, then upload it.',
  rtf: 'RTF files can\'t be read. Save it as .docx or PDF, then upload it.',
  heic: 'HEIC photos can\'t be read. Save it as JPG or PNG, then upload it.',
  heif: 'HEIC photos can\'t be read. Save it as JPG or PNG, then upload it.',
};

// Formats the server cannot read yet get a clear message before any upload starts.
export function unsupportedFileMessage(file) {
  const name = file?.name || '';
  const type = file?.type || '';
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const saveAs = SAVE_AS[extension] || (/^image\/hei[cf]$/i.test(type) ? SAVE_AS.heic : '');
  if (saveAs) return saveAs;
  if (!UNSUPPORTED.test(name) && !/^(video|audio)\//.test(type)) return '';
  const kind = /^video\//.test(type) || /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mpeg|mpg|3gp)$/i.test(name) ? 'Video'
    : /^audio\//.test(type) || /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff?)$/i.test(name) ? 'Audio'
      : 'This file type';
  return kind === 'This file type' ? 'That file type is not supported yet. Try a PDF, slides, Word, image or text.' : `${kind} files are not supported yet. Try a PDF, slides, Word, image or text.`;
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

// True while a dragged file is over the page and some upload box will take it, for the
// page-wide "Drop to upload" hint.
export function useFileDragging() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const notify = current => setDragging(current !== null);
    listeners.add(notify);
    return () => listeners.delete(notify);
  }, []);
  return dragging;
}
