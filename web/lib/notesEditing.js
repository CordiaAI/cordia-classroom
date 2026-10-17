// Editing rules for the SmartNotes paper: paste cleanup and as-you-type formatting.
const SPELL_MAP = {
  // Common typos
  teh: 'the', hte: 'the', adn: 'and', nad: 'and', hwich: 'which',
  recieve: 'receive', definately: 'definitely', occured: 'occurred',
  seperate: 'separate', untill: 'until', occurance: 'occurrence', waht: 'what',
  biuld: 'build', existance: 'existence', neccessary: 'necessary', accomodate: 'accommodate',
  comittee: 'committee', concious: 'conscious', liason: 'liaison',
  alot: 'a lot', becuase: 'because', wierd: 'weird', freind: 'friend',
  thier: 'their', beleive: 'believe', enviroment: 'environment',
  goverment: 'government', reccomend: 'recommend', grammer: 'grammar',
  // Contractions (no apostrophe → with apostrophe)
  dont: "don't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't",
  wasnt: "wasn't", werent: "weren't", hasnt: "hasn't", havent: "haven't",
  doesnt: "doesn't", didnt: "didn't", wouldnt: "wouldn't",
  shouldnt: "shouldn't", couldnt: "couldn't",
  im: "I'm", ive: "I've", youre: "you're", theyre: "they're",
  // Abbreviations
  eg: 'e.g.', ie: 'i.e.',
};

const FORCE_UPPER = new Set([
  // Biology / chemistry
  'atp', 'adp', 'nadh', 'fadh2', 'dna', 'rna', 'mrna', 'trna', 'rrna', 'pcr', 'ph', 'ite', 'cs', 'mgt',
  // Medical / clinical
  'ecg', 'ekg', 'cpr', 'iv', 'bp', 'hr', 'gi', 'cns', 'pns', 'icu', 'er',
  'abg', 'cbc', 'wbc', 'rbc', 'bmp', 'cmp', 'inr', 'ptt', 'bun', 'gfr',
  'ldl', 'hdl', 'bmi', 'bpm', 'hiv', 'aids', 'adhd', 'ocd', 'ptsd', 'cvd',
  // Imaging / physics
  'mri', 'ct', 'pet', 'uv', 'ir', 'nmr',
  // Computer science
  'cpu', 'gpu', 'ram', 'rom', 'sql', 'api', 'url', 'html', 'css',
  'os', 'ip', 'tcp', 'udp', 'http', 'https',
  // Academic / standardised tests
  'gpa', 'sat', 'act', 'iq', 'gre', 'lsat', 'mcat',
  // Business
  'ceo', 'cfo', 'cto', 'coo', 'roi', 'gdp', 'gnp',
  // Geopolitical
  'usa', 'uk', 'eu', 'un',
]);

function applyWordRules(word) {
  const lower = word.toLowerCase();
  if (FORCE_UPPER.has(lower)) return word.toUpperCase();
  if (SPELL_MAP[lower]) return SPELL_MAP[lower];
  return word;
}

function escHtml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PASTE_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI']);
const PASTE_BLOCKS = new Set(['DIV', 'SECTION', 'ARTICLE', 'TR', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

// Pasted pages and transcripts carry heavy inline styling (often several times the text
// size). Keep only the structure the notes and study-guide prompt use, with no attributes.
export function cleanPastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return escHtml(node.textContent.replace(/\s+/g, ' '));
    if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE'].includes(node.tagName)) return '';
    const inner = Array.from(node.childNodes).map(walk).join('');
    if (node.tagName === 'BR') return '<br>';
    if (PASTE_TAGS.has(node.tagName)) {
      const tag = node.tagName.toLowerCase();
      return inner.trim() ? `<${tag}>${inner}</${tag}>` : '';
    }
    return PASTE_BLOCKS.has(node.tagName) && inner.trim() ? `<p>${inner}</p>` : inner;
  }
  return walk(doc.body);
}

export function plainTextToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.trim() ? `<p>${escHtml(line)}</p>` : '')
    .join('');
}

function getBlock(node, root) {
  while (node && node !== root) {
    if (['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'DIV'].includes(node.nodeName)) return node;
    node = node.parentNode;
  }
  return null;
}

function placeCursorAt(el, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  const tn = el.firstChild;
  if (tn && tn.nodeType === Node.TEXT_NODE) {
    range.setStart(tn, Math.min(offset, tn.length));
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function toTitleCase(text) {
  return text.split(/\s+/).map(word => {
    if (!word) return word;
    if (/^[A-Z]{2,}(\d*)$/.test(word)) return word; // keep ALL-CAPS acronyms (ITE, UDP, 484)
    if (/^\d+$/.test(word)) return word; // keep bare numbers
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Count consecutive empty blocks immediately above a given block
function countEmptyBefore(block) {
  let count = 0;
  let prev = block.previousElementSibling;
  while (prev) {
    const t = (prev.innerText || prev.textContent || '').replace(/[\u200B\n\r]/g, '').trim();
    if (t === '') { count++; prev = prev.previousElementSibling; }
    else break;
  }
  return count;
}

// Formats the notes paper as the student types: headings, lists, callouts, inline markdown,
// spelling and acronym fixes. `root` is the contenteditable element.
export function formatOnKeyDown(e, root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  function insertAfter(newEl, ref) { ref.parentNode.insertBefore(newEl, ref.nextSibling); }
  function newParaAfter(ref) {
    const p = document.createElement('p'); p.innerHTML = '<br>';
    insertAfter(p, ref);
    const nr = document.createRange(); nr.setStart(p, 0); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
  }

  // ── Auto-capitalize: first letter typed into an empty block ──────────────
  if (/^[a-z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const range0 = sel.getRangeAt(0);
    const block0 = getBlock(range0.startContainer, root);
    const checkNode = block0 || (range0.startContainer !== root ? null : root);
    if (checkNode) {
      const raw = (checkNode.innerText || checkNode.textContent || '')
        .replace(/[\u200B\n\r]/g, '').trim();
      if (raw === '') {
        e.preventDefault();
        const tn = document.createTextNode(e.key.toUpperCase());
        range0.deleteContents();
        range0.insertNode(tn);
        const nr = document.createRange(); nr.setStartAfter(tn); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
        return;
      }
      // After sentence-ending punctuation, capitalize start of new sentence
      if (range0.startContainer.nodeType === Node.TEXT_NODE) {
        const beforeText = range0.startContainer.textContent.slice(0, range0.startOffset);
        if (/[.!?]\s+$/.test(beforeText)) {
          e.preventDefault();
          const tn = document.createTextNode(e.key.toUpperCase());
          range0.insertNode(tn);
          const nr = document.createRange(); nr.setStartAfter(tn); nr.collapse(true);
          sel.removeAllRanges(); sel.addRange(nr);
          return;
        }
      }
    }
  }

  // ── Tab: indent / outdent list items ──
  if (e.key === 'Tab') {
    e.preventDefault();
    const block = getBlock(sel.getRangeAt(0).startContainer, root);
    if (!block) return;
    const indentStep = '\u00A0\u00A0\u00A0\u00A0';
    if (e.shiftKey) {
      if (block.firstChild && block.firstChild.nodeType === Node.TEXT_NODE) {
        const t = block.firstChild.textContent;
        if (t.startsWith(indentStep)) {
          block.firstChild.textContent = t.slice(indentStep.length);
        }
      }
    } else {
      const raw = (block.innerText || block.textContent || '');
      const bulletMatch = raw.match(/^([-*\u2022])\s+(.*)/);
      if (bulletMatch) {
        block.innerHTML = indentStep + '\u25E6 ' + escHtml(bulletMatch[2]);
      } else if (block.firstChild && block.firstChild.nodeType === Node.TEXT_NODE) {
        block.firstChild.textContent = indentStep + block.firstChild.textContent;
      } else {
        block.insertBefore(document.createTextNode(indentStep), block.firstChild);
      }
      const nr = document.createRange();
      nr.selectNodeContents(block); nr.collapse(false);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    return;
  }

  // ── Space: inline markdown + spell/acronym correction ────────────────────
  if (e.key === ' ') {
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const before = node.textContent.slice(0, range.startOffset);
    const wordMatch = before.match(/(\S+)$/);
    if (!wordMatch) return;
    const word = wordMatch[1];

    function replaceWord(tag, inner) {
      e.preventDefault();
      const el = document.createElement(tag); el.textContent = inner;
      const cr = document.createRange();
      cr.setStart(node, range.startOffset - word.length);
      cr.setEnd(node, range.startOffset);
      cr.deleteContents(); cr.insertNode(el);
      const sp = document.createTextNode(' '); el.after(sp);
      const nr = document.createRange(); nr.setStartAfter(sp); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }

    // Inline markdown — check most specific patterns first
    const tripleBold = word.match(/^\*{3}([^*]+)\*{3}$/);
    if (tripleBold) { replaceWord('strong', tripleBold[1]); return; } // ***bold***

    const dblBold   = word.match(/^\*\*([^*]+)\*\*$/);
    const snglBold  = !dblBold && word.match(/^\*([^*]+)\*$/);
    const italic    = word.match(/^_([^_]+)_$/);
    const code      = word.match(/^`([^`]+)`$/);
    const strike    = word.match(/^~~([^~]+)~~$/);

    if (dblBold || snglBold) { replaceWord('strong', (dblBold || snglBold)[1]); return; }
    if (italic)  { replaceWord('em',     italic[1]);  return; }
    if (code)    { replaceWord('code',   code[1]);    return; }
    if (strike)  { replaceWord('del',    strike[1]);  return; }

    // Spell / acronym correction
    const corrected = applyWordRules(word);
    if (corrected !== word) {
      e.preventDefault();
      const cr = document.createRange();
      cr.setStart(node, range.startOffset - word.length);
      cr.setEnd(node, range.startOffset);
      cr.deleteContents();
      const tn = document.createTextNode(corrected + ' ');
      cr.insertNode(tn);
      const nr = document.createRange(); nr.setStartAfter(tn); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
      return;
    }
    return;
  }

  // ── Backspace: escape auto-inserted list prefix when line is only prefix ──
  if (e.key === 'Backspace') {
    const block = getBlock(sel.getRangeAt(0).startContainer, root);
    if (!block) return;
    const raw = (block.innerText || block.textContent || '').replace(/\u200B/g, '');
    if (
      /^[-*•]\s?$/.test(raw) ||
      /^\d+[.)]\s?$/.test(raw) ||
      /^>>\s?$/.test(raw) ||
      /^[A-Z][.)]\s?$/.test(raw)
    ) {
      e.preventDefault();
      const newP = document.createElement('p'); newP.innerHTML = '<br>';
      block.parentNode.replaceChild(newP, block);
      const nr = document.createRange(); nr.setStart(newP, 0); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    return;
  }

  // ── Enter: format current line + continue list patterns ──────────────────
  if (e.key === 'Enter') {
    const range = sel.getRangeAt(0);
    let block = getBlock(range.startContainer, root);
    // Chrome may put first-line text directly in root without a block wrapper
    if (!block && range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentNode === root) {
      const p = document.createElement('p');
      range.startContainer.parentNode.replaceChild(p, range.startContainer);
      p.appendChild(range.startContainer);
      block = p;
    }
    if (!block) return;

    // 0. Heading cascade — Enter inside any heading always makes plain <p>
    if (['H1', 'H2', 'H3', 'H4'].includes(block.nodeName)) {
      e.preventDefault(); newParaAfter(block); return;
    }

    const lineText = (block.innerText || block.textContent || '').replace(/\u200B/g, '').trim();
    if (!lineText) return;
    const words = lineText.split(/\s+/).filter(Boolean);

    // 1. Horizontal rule — line of ---, ***, ===, ___
    if (/^[-*=_]{3,}$/.test(lineText)) {
      e.preventDefault();
      const hr = document.createElement('hr');
      block.parentNode.replaceChild(hr, block);
      const newP = document.createElement('p'); newP.innerHTML = '<br>';
      hr.after(newP);
      const nr = document.createRange(); nr.setStart(newP, 0); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
      return;
    }

    // 2. Markdown headings — #→h1, ##→h2, ###→h3
    const mdH = lineText.match(/^(#{1,4})\s+(.+)$/);
    if (mdH) {
      e.preventDefault();
      const tagMap = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h3' };
      const heading = document.createElement(tagMap[mdH[1].length]);
      heading.textContent = mdH[2];
      block.parentNode.replaceChild(heading, block);
      newParaAfter(heading);
      return;
    }

    // 3. ALL CAPS line (≥4 chars) → <h2> section header
    if (/^[A-Z][A-Z0-9\s\-:&/()]+$/.test(lineText) && lineText.length >= 4) {
      e.preventDefault();
      const h2 = document.createElement('h2'); h2.textContent = lineText;
      block.parentNode.replaceChild(h2, block);
      newParaAfter(h2);
      return;
    }

    // 4. Date line — "April 24", "Mon, April 24 2026", "4/24/26", "2026-04-24"
    const MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December';
    const WDAY  = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
    const isDate = new RegExp(
      `^(?:(?:${WDAY}),?\\s+)?(?:${MONTH})\\s+\\d{1,2}(?:,?\\s*\\d{4})?$`, 'i'
    ).test(lineText)
      || /^\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/.test(lineText)
      || /^\d{4}-\d{2}-\d{2}$/.test(lineText);
    if (isDate) {
      e.preventDefault();
      block.classList.add('sn-date-line');
      newParaAfter(block);
      return;
    }

    // 5. Callout — "!! text" or "!!! text"
    const calloutMatch = lineText.match(/^!{2,3}\s+(.+)$/);
    if (calloutMatch) {
      e.preventDefault();
      block.innerHTML = '<mark class="sn-callout">⚠ ' + escHtml(calloutMatch[1]) + '</mark>';
      newParaAfter(block);
      return;
    }

    // 6. Blockquote — "> text"
    const quoteMatch = lineText.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      e.preventDefault();
      const bq = document.createElement('blockquote'); bq.textContent = quoteMatch[1];
      block.parentNode.replaceChild(bq, block);
      newParaAfter(bq);
      return;
    }

    // 7. Sub-bullet — ">> text"
    const subMatch = lineText.match(/^>>\s*(.*)/);
    if (subMatch) {
      e.preventDefault();
      block.innerHTML = '\u00a0\u00a0\u00a0\u00a0\u25e6 ' + escHtml(subMatch[1]);
      const newLine = document.createElement('p'); newLine.textContent = '>> ';
      insertAfter(newLine, block); placeCursorAt(newLine, 3);
      return;
    }

    // 8. Lettered list — "A. text" or "A) text" (uppercase only)
    const letteredMatch = lineText.match(/^([A-Z])([.)]\s*)(.*)/);
    if (letteredMatch) {
      e.preventDefault();
      const letter = letteredMatch[1];
      const sep = letteredMatch[2].trimEnd();
      const content = letteredMatch[3].trim();
      block.innerHTML = '<strong>' + escHtml(letter + sep) + '</strong>' + (content ? ' ' + escHtml(content) : '');
      const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
      const newLine = document.createElement('p');
      newLine.textContent = nextLetter + sep + ' ';
      insertAfter(newLine, block); placeCursorAt(newLine, newLine.textContent.length);
      return;
    }

    // 9. Bullet continuation — "- text", "* text", "• text"
    const bulletMatch = lineText.match(/^([-*•])\s+(.*)/);
    if (bulletMatch) {
      e.preventDefault();
      block.innerHTML = '• ' + escHtml(bulletMatch[2]);
      const newLine = document.createElement('p'); newLine.textContent = '- ';
      insertAfter(newLine, block); placeCursorAt(newLine, 2);
      return;
    }

    // 10. Numbered list — "1. text" or "1) text"
    const numMatch = lineText.match(/^(\d+)([.)]\s*)(.*)/);
    if (numMatch) {
      e.preventDefault();
      const num = parseInt(numMatch[1]);
      const sep = numMatch[2].trimEnd();
      const content = numMatch[3].trim();
      block.innerHTML = '<strong>' + escHtml(num + sep) + '</strong>' + (content ? ' ' + escHtml(content) : '');
      const newLine = document.createElement('p');
      newLine.textContent = (num + 1) + sep + ' ';
      insertAfter(newLine, block); placeCursorAt(newLine, newLine.textContent.length);
      return;
    }

    // 11. Definition — "term = value" or "term ≡ value" (≤5 words before =)
    const defMatch = lineText.match(/^([A-Za-z][A-Za-z\s\-']{0,40})\s*([=≡≈])\s*(.+)$/);
    if (defMatch && defMatch[1].trim().split(/\s+/).length <= 5) {
      e.preventDefault();
      block.innerHTML = '<strong>' + escHtml(defMatch[1].trim()) + '</strong> '
        + escHtml(defMatch[2]) + ' ' + escHtml(defMatch[3]);
      newParaAfter(block);
      return;
    }

    // 12. Bold term — "word(s): rest" or "word(s); rest" (≤6 words before separator)
    const termMatch = lineText.match(/^([A-Za-z][A-Za-z\s\-']{0,50}?)(\s*[:;—–]\s*)(.*)$/);
    if (termMatch && termMatch[1].trim().split(/\s+/).length <= 6) {
      e.preventDefault();
      const term = termMatch[1].trim();
      const sep  = termMatch[2];
      const rest = termMatch[3];
      block.innerHTML = '<strong>' + escHtml(term + sep) + '</strong>' + escHtml(rest);
      newParaAfter(block);
      return;
    }

    // 13–14. Context-based headings — blank lines above determine level
    //   Very first block OR 2+ blank lines above → Title <h1>
    //   1 blank line above → Section <h2>
    //   No blank lines, short line (2–6 words) → Sub-heading <h3>
    if (words.length >= 1 && words.length <= 10 && !/[.!?,;:]$/.test(lineText)) {
      const emptyAbove = countEmptyBefore(block);
      const isFirst = block.parentNode === root && !block.previousElementSibling;

      if (isFirst || emptyAbove >= 2) {
        e.preventDefault();
        const h1 = document.createElement('h1'); h1.textContent = toTitleCase(lineText);
        block.parentNode.replaceChild(h1, block);
        newParaAfter(h1);
        return;
      }
      if (emptyAbove === 1) {
        e.preventDefault();
        const h2 = document.createElement('h2'); h2.textContent = lineText;
        block.parentNode.replaceChild(h2, block);
        newParaAfter(h2);
        return;
      }
      if (words.length >= 2 && words.length <= 6) {
        e.preventDefault();
        const h3 = document.createElement('h3'); h3.textContent = lineText;
        block.parentNode.replaceChild(h3, block);
        newParaAfter(h3);
        return;
      }
    }

    // No rule matched — browser handles Enter normally
  }
}
