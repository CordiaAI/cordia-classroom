(() => {
  if (globalThis.__cordiaScraperVersion === 2) return;
  globalThis.__cordiaScraperVersion = 2;

  const DOCUMENT_PATTERN = /\.(pdf|pptx|docx|txt|md|csv|png|jpe?g|webp)(?:$|[?#])/i;
  const LMS_MAIN = [
    '#content', '.ic-Layout-contentMain', '#region-main', '.course-content',
    '#contentPanel', '.vtbegenerated', '.d2l-page-main', '.d2l-content-wrapper',
    'main', 'article', '[role="main"]', '#main-content',
  ];
  const NOISE = [
    'script', 'style', 'noscript', 'nav', 'header', 'footer', 'form', 'button',
    '[role="navigation"]', '[aria-hidden="true"]', '.screenreader-only',
    '.ic-app-header', '.ic-app-nav-toggle-and-crumbs', '.module-sequence-footer',
  ].join(',');

  const DOCUMENT_NAME = /\.(pdf|pptx|docx|txt|md|csv|png|jpe?g|webp)$/i;
  const GOOGLE_DOC = /^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]{20,})/i;
  const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BR|SECTION|ARTICLE|BLOCKQUOTE|PRE|TABLE|UL|OL|DT|DD|FIGCAPTION)$/;
  const SUBSTANTIAL_TEXT = 400;

  function absoluteUrl(value) {
    if (!value || /^(javascript|data):/i.test(value)) return '';
    try { return new URL(value, location.href).href; } catch (_) { return ''; }
  }

  function normalizeCanvasDownload(url) {
    const parsed = new URL(url);
    if (!/\/files\/\d+(?:\/(?:preview|file_preview))?\/?$/i.test(parsed.pathname)) return url;
    parsed.pathname = parsed.pathname.replace(/\/(?:preview|file_preview)\/?$/i, '').replace(/\/$/, '') + '/download';
    if (!parsed.searchParams.has('download_frd')) parsed.searchParams.set('download_frd', '1');
    return parsed.href;
  }

  function filename(url, element) {
    const label = element?.getAttribute('download') || element?.getAttribute('title') || element?.textContent?.trim();
    if (label && DOCUMENT_PATTERN.test(label)) return label.split(/[/\\]/).pop();
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'study-material');
  }

  // Google Docs/Slides/Sheets links and embeds become a PDF export the signed-in student can download.
  function googleExport(url) {
    const match = url.match(GOOGLE_DOC);
    if (!match) return null;
    const [, kind, id] = match;
    const exportUrl = kind === 'presentation'
      ? `https://docs.google.com/presentation/d/${id}/export/pdf`
      : `https://docs.google.com/${kind}/d/${id}/export?format=pdf`;
    return { url: exportUrl, filename: `${document.title || 'Google document'}.pdf` };
  }

  function documentCandidate(element) {
    const attribute = element.tagName === 'OBJECT' ? 'data' : element.tagName === 'A' ? 'href' : 'src';
    const url = absoluteUrl(element.getAttribute(attribute));
    if (!url) return null;
    const embedded = ['IFRAME', 'EMBED', 'OBJECT'].includes(element.tagName);
    const google = googleExport(url);
    if (google) return { kind: 'file', ...google, embedded };
    const canvasFile = /\/files\/\d+(?:\/(?:preview|file_preview|download))?(?:[/?#]|$)/i.test(url);
    const named = [element.getAttribute('download'), element.getAttribute('title'), element.textContent?.trim()]
      .some(label => label && DOCUMENT_NAME.test(label.trim()));
    const typed = /application\/(pdf|vnd\.openxmlformats)/i.test(element.getAttribute('type') || '');
    if (!canvasFile && !named && !typed && !DOCUMENT_PATTERN.test(url)) return null;
    return {
      kind: 'file',
      url: canvasFile ? normalizeCanvasDownload(url) : url,
      filename: filename(url, element),
      embedded,
    };
  }

  function documentSources() {
    const found = [];
    document.querySelectorAll('iframe[src], embed[src], object[data], a[href]').forEach(element => {
      if (element.tagName === 'A' && element.closest(NOISE)) return; // skip nav/header/footer links
      const candidate = documentCandidate(element);
      if (candidate) found.push(candidate);
    });
    const self = DOCUMENT_PATTERN.test(location.href)
      ? { kind: 'file', url: location.href, filename: filename(location.href), embedded: true }
      : null;
    return {
      embedded: self || found.find(item => item.embedded) || null,
      linked: found.find(item => !item.embedded) || null,
    };
  }

  // Visible text including open shadow roots (web components) and same-origin frames.
  function deepText(root) {
    const out = [];
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue.trim()) out.push(node.nodeValue.replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches(NOISE) || node.checkVisibility?.() === false) return;
        if (node.shadowRoot) walk(node.shadowRoot);
        if (node.tagName === 'IFRAME') {
          try { if (node.contentDocument?.body) walk(node.contentDocument.body); } catch (_) { /* cross-origin */ }
        }
      } else if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }
      node.childNodes.forEach(walk);
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK.test(node.tagName)) out.push('\n');
    };
    walk(root);
    return out.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function selectedText() {
    const selected = window.getSelection()?.toString().trim();
    return selected ? { kind: 'text', text: selected, selected: true, title: document.title } : null;
  }

  function pageText() {
    const copy = document.cloneNode(true);
    copy.querySelectorAll(NOISE).forEach(node => node.remove());
    const article = typeof Readability === 'function'
      ? new Readability(copy, { charThreshold: 80, maxElemsToParse: 0 }).parse()
      : null;
    const readable = article?.textContent?.trim() || '';
    if (readable.length >= SUBSTANTIAL_TEXT) {
      return { kind: 'text', text: readable, selected: false, title: article.title || document.title };
    }
    const root = LMS_MAIN.map(selector => document.querySelector(selector)).find(Boolean) || document.body;
    const deep = deepText(root);
    const text = deep.length > readable.length ? deep : readable;
    return { kind: 'text', text, selected: false, title: (text === readable && article?.title) || document.title };
  }

  // Preference: the student's selection, an embedded document, the page's own text when it has
  // real content, then a linked document (e.g. a file page that is only a download link).
  function capture() {
    const selection = selectedText();
    if (selection) return selection;
    const { embedded, linked } = documentSources();
    if (embedded) return embedded;
    const text = pageText();
    if (text.text.length >= SUBSTANTIAL_TEXT || !linked) return text;
    return linked;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ scraperVersion: 2 });
      return false;
    }
    if (message.action === 'scrapePage') {
      sendResponse(capture());
      return false;
    }
    return false;
  });
})();
