// Turns a Tutor answer into display blocks: bold main points, numbered steps with the
// work beneath, plain-language notes, bullets, and real math symbols. Same rules as the
// extension side panel (extension/tutor-chat.js). Model text is never treated as HTML.

const LATEX = [
  [/\\\(|\\\)|\\\[|\\\]|\$\$?/g, ''], [/\\equiv/g, '≡'], [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'],
  [/\\pmod\{([^}]*)\}/g, '(mod $1)'], [/\\(?:bmod|mod)\b/g, 'mod'], [/\\leq?\b/g, '≤'], [/\\geq?\b/g, '≥'],
  [/\\neq?\b/g, '≠'], [/\\approx/g, '≈'], [/\\pi/g, 'π'], [/\\infty/g, '∞'], [/\\(?:rightarrow|to)\b/g, '→'],
  [/\\Rightarrow/g, '⇒'], [/\\pm/g, '±'], [/\\sqrt\{([^}]*)\}/g, '√($1)'], [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],
  [/\^\{?-1\}?/g, '⁻¹'], [/\^\{?2\}?/g, '²'], [/\^\{?3\}?/g, '³'], [/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1'],
  [/\\([a-zA-Z]+)/g, '$1'],
];

// Any math the model still writes as LaTeX becomes real symbols.
export function readableMath(text) {
  return LATEX.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text || ''));
}

// "**bold** rest" -> [{ text: 'bold', bold: true }, { text: ' rest', bold: false }]
export function inlineParts(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    return bold ? { text: bold[1], bold: true } : { text: part.replace(/`/g, ''), bold: false };
  });
}

// Blocks: { type: 'paragraph' | 'bullet' | 'note', text } and
// { type: 'step', number, title, children: [{ type: 'work' | 'bullet' | 'note', text }] }.
export function parseTutorAnswer(text) {
  const blocks = [];
  let step = null;
  readableMath(text).split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) { step = null; return; }
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const target = step ? step.children : blocks;
    if (numbered) {
      step = { type: 'step', number: numbered[1], title: numbered[2], children: [] };
      blocks.push(step);
    } else if (line.startsWith('>')) {
      target.push({ type: 'note', text: line.replace(/^>\s?/, '') });
    } else if (bullet) {
      target.push({ type: 'bullet', text: bullet[1] });
    } else {
      target.push({ type: step ? 'work' : 'paragraph', text: line });
    }
  });
  return blocks;
}
