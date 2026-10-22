// Asking the Cordia Chrome extension to read a page the server can't (Quizlet and YouTube turn
// servers away). extension/asai-bridge.js relays the request to extension/background.js, which
// only accepts its own short list of actions and links.

export function extensionReady() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-asai-extension') === 'ready';
}

// Extensions before 2.1.3 announce themselves but can't import; they never answer a request.
export function extensionCan(kind) {
  if (typeof document === 'undefined') return false;
  return (document.documentElement.getAttribute('data-asai-imports') || '').split(' ').includes(kind);
}

export function askExtension(action, url, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('The extension took too long to answer.')); }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== 'CORDIA_EXT_RESULT' || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (event.data.success) resolve(event.data);
      else reject(new Error(event.data.error || 'The extension could not read that link.'));
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'CORDIA_EXT_REQUEST', id, action, url }, window.location.origin);
  });
}

// youtube.com/watch, youtu.be, /shorts/, /live/ and /embed/ video links.
export function isYoutubeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
    const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
      : host === 'youtube.com' || host === 'youtube-nocookie.com' ? url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/) || [])[1]
        : '';
    return url.protocol === 'https:' && /^[\w-]{11}$/.test(id || '');
  } catch {
    return false;
  }
}

// A transcript arrives as one long run of text (automatic captions have no punctuation); break it
// into paragraphs of about `size` characters, at sentence ends when there are any.
export function transcriptParagraphs(text, size = 700) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const paragraphs = [];
  let current = '';
  for (const word of words) {
    current = current ? `${current} ${word}` : word;
    if ((current.length >= size && /[.?!]["')\]]?$/.test(word)) || current.length >= size * 1.6) {
      paragraphs.push(current);
      current = '';
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}
