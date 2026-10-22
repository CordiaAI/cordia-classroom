// Links the extension reads for the web app: which YouTube links count, and how a transcript is laid out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isYoutubeUrl, transcriptParagraphs } from '../lib/extensionBridge.js';

test('YouTube video links in their usual shapes', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=aircAruvnKk',
    'https://youtube.com/watch?v=aircAruvnKk&t=42s',
    'https://m.youtube.com/watch?v=aircAruvnKk',
    'https://youtu.be/aircAruvnKk?si=abc',
    'https://www.youtube.com/shorts/aircAruvnKk',
    'https://www.youtube.com/live/aircAruvnKk',
  ]) assert.ok(isYoutubeUrl(link), link);
  for (const link of [
    'http://www.youtube.com/watch?v=aircAruvnKk',
    'https://www.youtube.com/@3blue1brown',
    'https://www.youtube.com/watch?v=short',
    'https://youtube.com.evil.example/watch?v=aircAruvnKk',
    'https://quizlet.com/583427227/x/',
  ]) assert.equal(isYoutubeUrl(link), false, link);
});

test('a transcript is broken into paragraphs, at sentence ends when it has them', () => {
  const sentence = 'Supply rises when prices rise. ';
  const text = transcriptParagraphs(sentence.repeat(60), 300);
  const paragraphs = text.split('\n\n');
  assert.ok(paragraphs.length > 3);
  assert.ok(paragraphs.slice(0, -1).every(p => p.endsWith('.') && p.length >= 300));
  // Automatic captions have no punctuation: split by length anyway.
  const plain = transcriptParagraphs('word '.repeat(400), 300).split('\n\n');
  assert.ok(plain.length > 3 && plain.every(p => p.length <= 480 + 5));
  assert.equal(transcriptParagraphs(''), '');
});
