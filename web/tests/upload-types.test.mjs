// Every file picker that sends course material to the server's reader (/extract-file-text) offers
// exactly the server's types (lib/uploadTypes.mjs). tests/test_upload_types.py checks that list
// against backend/services/file_extraction.py; this file checks the pickers use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { UPLOAD_ACCEPT, UPLOAD_TYPES, extensionOf, uploadTypeProblem } from '../lib/uploadTypes.mjs';
import { unsupportedFileMessage } from '../lib/fileDrop.js';

const web = new URL('../', import.meta.url);

// Pickers that don't go to the material reader, and where their files go instead.
const OTHER_PICKERS = {
  'components/CardPhoto.js': 'image/*', // flashcard photos, shrunk in the browser (lib/cardImages.js)
  'components/FeedbackModal.js': 'image/*', // screenshots attached to feedback
  'components/LectureRecorder.js': '{AUDIO_ACCEPT}', // lecture audio for transcription (lib/lectureFile.js)
  'components/assistant/AssistantPersonality.js': '.json,.txt,.md,application/json,text/plain,text/markdown', // personality import
};

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(new URL(dir, web), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) found.push(...await sourceFiles(`${path}/`));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test('every material file picker offers exactly the server types', async () => {
  const pickers = [];
  for (const path of [...await sourceFiles('components/'), ...await sourceFiles('pages/')]) {
    const source = await readFile(new URL(path, web), 'utf8');
    for (const [input] of source.matchAll(/<input\b[^>]*type="file"[^>]*>/g)) {
      const accept = /accept=(\{[^}]+\}|"[^"]*")/.exec(input)?.[1] || '(none)';
      pickers.push({ path, accept: accept.replace(/^"|"$/g, '') });
    }
  }
  const material = pickers.filter(picker => !(picker.path in OTHER_PICKERS));
  assert.deepEqual(material.map(picker => picker.path).sort(), ['components/AIChatWidget.js', 'components/NewSheet.js', 'components/PracticeWorkspace.js', 'pages/library.js']);
  for (const picker of material) assert.equal(picker.accept, '{UPLOAD_ACCEPT}', `${picker.path} must use UPLOAD_ACCEPT`);
  for (const picker of pickers.filter(item => item.path in OTHER_PICKERS)) assert.equal(picker.accept, OTHER_PICKERS[picker.path], picker.path);
});

test('the accept attribute is the type list', () => {
  assert.equal(UPLOAD_ACCEPT.split(',').length, UPLOAD_TYPES.length);
  assert.ok(UPLOAD_ACCEPT.split(',').every(item => /^\.[a-z0-9]+$/.test(item)));
  for (const removed of ['doc', 'rtf']) assert.ok(!UPLOAD_TYPES.includes(removed));
  for (const added of ['ppt', 'heic', 'heif']) assert.ok(UPLOAD_TYPES.includes(added));
});

test('dropped files the server cannot read get a message before upload', () => {
  assert.equal(extensionOf('Lecture 3.final.PDF'), 'pdf');
  assert.equal(uploadTypeProblem('IMG_0042.HEIC'), '');
  assert.equal(uploadTypeProblem('Week 2.ppt'), '');
  assert.equal(uploadTypeProblem('essay.doc'), 'Save this as .docx first, then upload it.');
  assert.equal(uploadTypeProblem('notes.rtf'), 'Save this as .docx first, then upload it.');
  assert.equal(uploadTypeProblem('slides.key'), 'Export this as a PDF first, then upload it.');
  assert.equal(unsupportedFileMessage({ name: 'lecture.mp4', type: 'video/mp4' }), 'Video files are not supported yet. Try a PDF, slides, Word, image or text.');
  assert.equal(unsupportedFileMessage({ name: 'lecture.mp3', type: 'audio/mpeg' }), 'Audio files are not supported yet. Try a PDF, slides, Word, image or text.');
  assert.equal(unsupportedFileMessage({ name: 'backup.zip', type: 'application/zip' }), 'That file type is not supported yet. Try a PDF, slides, Word, image or text.');
  // Systems often label TypeScript files as MPEG video; the name decides.
  assert.equal(unsupportedFileMessage({ name: 'app.ts', type: 'video/mp2t' }), '');
  assert.equal(unsupportedFileMessage({ name: 'photo.heic', type: 'image/heic' }), '');
});
