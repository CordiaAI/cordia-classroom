// The CordiaClassroom Chrome Web Store listing. The ID is permanent across versions
// (2.1.0 at the time of writing); a link without the ID only opens the store home page.
export const EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/cordiaclassroom/eddmfjcnfjfbaknmeccjbjdgpeipjbaf';

// The extension stamps data-asai-extension="ready" on <html> (extension/asai-bridge.js)
// and posts ASAI_EXTENSION_READY on Classroom pages.
const MARKER = 'data-asai-extension';

export function extensionInstalled() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute(MARKER) === 'ready';
}

// Calls onReady once the extension is detected. Returns a cleanup function.
export function watchExtension(onReady) {
  if (extensionInstalled()) { onReady(); return () => {}; }
  const observer = new MutationObserver(() => { if (extensionInstalled()) onReady(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [MARKER] });
  const onMessage = event => { if (event.source === window && event.data?.type === 'ASAI_EXTENSION_READY') onReady(); };
  window.addEventListener('message', onMessage);
  return () => { observer.disconnect(); window.removeEventListener('message', onMessage); };
}
