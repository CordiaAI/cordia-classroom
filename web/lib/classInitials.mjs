// The two letters a class shows in the folded sidebar (VISUAL-POLISH V1.1): the course code's first two
// letters ("EH 102" -> "EH", "MUL 101" -> "MU"). A class whose name is its code ("MA 125", "EH-102-136")
// counts that as its code (lib/homeText.mjs classShort reads it, terms and section numbers aside). A
// class with no course code takes the first letters of the first two words of its name ("Adult Health
// I" -> "AH"); one word gives its first two letters ("Biology 101" -> "BI"). Small joining words and
// bare numbers don't count ("Introduction to Music" -> "IM"). Pure, so it can be tested in Node
// (web/tests/class-initials.test.mjs); components/Sidebar.js uses it.
import { classShort } from './homeText.mjs';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const COURSE_CODE = /^\p{L}{2,5}(?: \p{L}{2,5})? \d{3,4}\p{L}?$/u; // classShort's "DEPT 123" / "ART HIST 210"

const plain = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
const firstTwoLetters = text => (text.match(/\p{L}/gu) || []).slice(0, 2).join('').toUpperCase();

function wordInitials(text) {
  const words = plain(text).split(/[\s/_:,.&–—-]+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(word => /^\p{L}/u.test(word));
  const meaningful = words.filter(word => !SMALL_WORDS.has(word.toLowerCase()));
  const picked = meaningful.length ? meaningful : words;
  if (!picked.length) return '';
  if (picked.length === 1) return picked[0].slice(0, 2).toUpperCase();
  return (picked[0][0] + picked[1][0]).toUpperCase();
}

// code: the course code ('' when the class has none); name: the class's name.
export function classInitials(code, name) {
  const ownCode = plain(code);
  if (/^\p{L}{2}/u.test(ownCode)) return firstTwoLetters(ownCode);
  const short = plain(classShort(name));
  if (COURSE_CODE.test(short)) return firstTwoLetters(short);
  return wordInitials(short) || wordInitials(name);
}
