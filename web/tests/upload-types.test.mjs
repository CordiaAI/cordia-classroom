import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the upload picker offers only file types /extract-file-text reads', async () => {
  const sheet = await source('components/NewSheet.js');
  const extraction = await source('../backend/services/file_extraction.py');
  const materials = await source('../backend/routers/materials.py');
  const accept = sheet.match(/const ACCEPT = '([^']+)'/)[1].split(',');
  assert.ok(accept.every(entry => entry.startsWith('.')), 'no MIME wildcards (image/* lets a Mac pick HEIC)');

  const images = [...extraction.match(/IMAGE_TYPES = \{([^}]+)\}/)[1].matchAll(/"(\w+)":/g)].map(match => match[1]);
  const plain = [...extraction.match(/PLAIN_TEXT_TYPES = \{([^}]+)\}/)[1].matchAll(/"(\w+)"/g)].map(match => match[1]);
  const documents = ['pdf', 'docx', 'pptx'].filter(type => materials.includes(`extension == "${type}"`));
  const readable = new Set([...documents, ...images, ...plain]);
  for (const entry of accept) assert.ok(readable.has(entry.slice(1)), `${entry} is offered but the server can't read it`);
});

test('old Office, RTF and HEIC files get a save-as message before upload', async () => {
  const drop = await source('lib/fileDrop.js');
  for (const type of ['doc', 'ppt', 'rtf', 'heic', 'heif']) assert.match(drop, new RegExp(`\\n  ${type}: '`), type);
  assert.match(drop, /Save it as \.docx, then upload it/);
  assert.match(drop, /Save it as \.pptx, then upload it/);
  assert.match(drop, /image\\\/hei\[cf\]/, 'HEIC is caught by MIME type too');
});
