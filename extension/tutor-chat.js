// Cordia Tutor chat in the side panel: readable answers, the live Cordia loader,
// maximize/minimize, and the conversation sent with each question so Cordia remembers it.
(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const LOGO = 'cordia-classroom-logo.png';
  // Centerline of the Cordia infinity stroke (same trace as the Classroom loader).
  const TRACE = [[95, 240], [50, 175], [22, 119], [50, 74], [80, 66], [110, 79], [170, 117], [230, 160], [275, 190],
    [320, 221], [380, 248], [410, 250], [440, 226], [470, 149], [445, 96], [410, 98], [350, 132], [320, 153],
    [275, 190], [230, 223], [170, 275], [135, 297]];
  const DURATION = 4.2;
  let loaderId = 0;

  function smoothPath(points) {
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const [p0, p1, p2, p3] = [points[i - 1] || points[i], points[i], points[i + 1], points[i + 2] || points[i + 1]];
      d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} `
        + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }
  const PATH = smoothPath(TRACE);

  function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    children.forEach(child => node.appendChild(child));
    return node;
  }

  // Liquid bubbles ride the infinity mark and merge back in while a light wave travels through it.
  function loader() {
    const id = `cordia-loader-${loaderId += 1}`;
    const matrix = values => svg('feColorMatrix', { values });
    const bubbles = [0, 0.17, 0.34, 0.51, 0.68, 0.85].map((offset, index) => svg('circle', { r: '0', fill: '#11120f' }, [
      svg('animateMotion', { dur: `${DURATION}s`, repeatCount: 'indefinite', begin: `-${(offset * DURATION).toFixed(2)}s` }, [svg('mpath', { href: `#${id}-trace` })]),
      svg('animate', { attributeName: 'r', dur: `${DURATION}s`, begin: `-${(offset * DURATION).toFixed(2)}s`, repeatCount: 'indefinite', values: index % 2 ? '0;30;18;34;20;28;0' : '0;24;36;20;32;22;0' }),
    ]));
    return svg('svg', { viewBox: '-30 -30 572 383', class: 'tutor-loader', 'aria-hidden': 'true' }, [
      svg('defs', {}, [
        svg('path', { id: `${id}-trace`, d: PATH, pathLength: '1000' }),
        svg('filter', { id: `${id}-ink`, 'color-interpolation-filters': 'sRGB' }, [matrix('0 0 0 0 0.067  0 0 0 0 0.07  0 0 0 0 0.059  0 0 0 1 0')]),
        svg('filter', { id: `${id}-white`, 'color-interpolation-filters': 'sRGB' }, [matrix('0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0')]),
        svg('filter', { id: `${id}-goo`, x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB' }, [
          svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '9', result: 'blur' }),
          svg('feColorMatrix', { in: 'blur', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11' }),
        ]),
        svg('mask', { id: `${id}-inside`, maskUnits: 'userSpaceOnUse', x: '-30', y: '-30', width: '572', height: '383' }, [
          svg('image', { href: LOGO, width: '512', height: '323', filter: `url(#${id}-white)` }),
        ]),
        svg('linearGradient', { id: `${id}-glow`, x1: '0', x2: '1' }, [
          svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }),
          svg('stop', { offset: '0.5', 'stop-color': '#fff', 'stop-opacity': '0.9' }),
          svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }),
        ]),
      ]),
      svg('g', { filter: `url(#${id}-goo)` }, [svg('image', { href: LOGO, width: '512', height: '323', filter: `url(#${id}-ink)` }), ...bubbles]),
      svg('image', { href: LOGO, width: '512', height: '323', filter: `url(#${id}-ink)` }),
      svg('g', { mask: `url(#${id}-inside)` }, [
        svg('use', { href: `#${id}-trace`, class: 'tutor-loader-wave', stroke: `url(#${id}-glow)` }, [
          svg('animate', { attributeName: 'stroke-dashoffset', from: '110', to: '-890', dur: `${DURATION}s`, repeatCount: 'indefinite' }),
        ]),
      ]),
    ]);
  }

  const LATEX = [
    [/\\\(|\\\)|\\\[|\\\]|\$\$?/g, ''], [/\\equiv/g, '≡'], [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'],
    [/\\pmod\{([^}]*)\}/g, '(mod $1)'], [/\\(?:bmod|mod)\b/g, 'mod'], [/\\leq?\b/g, '≤'], [/\\geq?\b/g, '≥'],
    [/\\neq?\b/g, '≠'], [/\\approx/g, '≈'], [/\\pi/g, 'π'], [/\\infty/g, '∞'], [/\\(?:rightarrow|to)\b/g, '→'],
    [/\\Rightarrow/g, '⇒'], [/\\pm/g, '±'], [/\\sqrt\{([^}]*)\}/g, '√($1)'], [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],
    [/\^\{?-1\}?/g, '⁻¹'], [/\^\{?2\}?/g, '²'], [/\^\{?3\}?/g, '³'], [/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1'],
    [/\\([a-zA-Z]+)/g, '$1'],
  ];

  // Any math the model still writes as LaTeX becomes real symbols.
  function readableMath(text) {
    return LATEX.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
  }

  // **bold** inside a line, built as DOM nodes (model text is never inserted as HTML).
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).forEach(part => {
      const bold = part.match(/^\*\*([^*]+)\*\*$/);
      if (bold) {
        const strong = document.createElement('strong');
        strong.textContent = bold[1];
        parent.appendChild(strong);
      } else {
        parent.appendChild(document.createTextNode(part.replace(/`/g, '')));
      }
    });
    return parent;
  }

  function block(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return inline(node, text);
  }

  // Bold main points, numbered steps with the work beneath, and grey plain-language notes.
  function renderAnswer(container, text) {
    const source = readableMath(String(text || '').replace(/```mermaid[\s\S]*?```/g, '\n> Open this chat in Classroom to see the diagram.\n'));
    let list = null;
    source.split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) { list = null; return; }
      const stepMatch = line.match(/^(\d+)[.)]\s+(.*)$/);
      const bullet = line.match(/^[-•*]\s+(.*)$/);
      if (stepMatch) {
        const step = document.createElement('div');
        step.className = 'tutor-step';
        const number = document.createElement('span');
        number.className = 'tutor-step-number';
        number.textContent = stepMatch[1];
        const body = document.createElement('div');
        body.appendChild(block('p', 'tutor-step-title', stepMatch[2]));
        step.append(number, body);
        container.appendChild(step);
        list = body;
      } else if (line.startsWith('>')) {
        (list || container).appendChild(block('p', 'tutor-note', line.replace(/^>\s?/, '')));
      } else if (bullet) {
        (list || container).appendChild(block('p', 'tutor-bullet', bullet[1]));
      } else if (list) {
        list.appendChild(block('p', 'tutor-work', line));
      } else {
        container.appendChild(block('p', '', line));
      }
    });
  }

  function createChat({ messages, card, sizeButton, newChatButton }) {
    const history = [];

    function scroll() { messages.scrollTop = messages.scrollHeight; }

    function add(role, text, { remember = true } = {}) {
      messages.querySelector('.tutor-empty')?.remove();
      const bubble = document.createElement('div');
      bubble.className = `tutor-message ${role}`;
      if (role === 'assistant') renderAnswer(bubble, text);
      else bubble.textContent = text;
      messages.appendChild(bubble);
      if (remember) history.push({ role, text: String(text || '') });
      scroll();
    }

    function thinking() {
      const bubble = document.createElement('div');
      bubble.className = 'tutor-message assistant tutor-thinking';
      bubble.setAttribute('role', 'status');
      bubble.setAttribute('aria-label', 'Cordia is thinking');
      bubble.appendChild(loader());
      messages.appendChild(bubble);
      scroll();
      return () => bubble.remove();
    }

    function reset() {
      history.length = 0;
      messages.replaceChildren(Object.assign(document.createElement('p'), { className: 'tutor-empty', textContent: 'Ask for an explanation, example, or quick check.' }));
    }

    // The model can no longer hold the whole chat: say so plainly and offer a fresh one.
    function contextFull() {
      if (document.querySelector('.tutor-full')) return;
      const overlay = document.createElement('div');
      overlay.className = 'tutor-full';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-labelledby', 'tutor-full-title');
      const box = document.createElement('div');
      const title = Object.assign(document.createElement('strong'), { id: 'tutor-full-title', textContent: 'Context window filled - please start a new chat.' });
      const body = Object.assign(document.createElement('p'), { textContent: 'In other words, I can’t remember this whole chat anymore. Sorry, my memory is shorter\u00a0:\u2060(' });
      const start = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Start new chat' });
      start.addEventListener('click', () => { overlay.remove(); reset(); });
      box.append(title, body, start);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      start.focus();
    }

    sizeButton.addEventListener('click', () => {
      const maximized = document.body.classList.toggle('tutor-maximized');
      sizeButton.textContent = maximized ? 'Minimize chat' : 'Maximize chat';
      sizeButton.setAttribute('aria-pressed', String(maximized));
      card.scrollIntoView({ block: 'start' });
      scroll();
    });
    newChatButton.addEventListener('click', reset);

    return { add, thinking, contextFull, history: () => history.slice() };
  }

  window.CordiaTutorChat = { createChat, renderAnswer, readableMath };
})();
