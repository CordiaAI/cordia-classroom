import { useEffect, useRef, useState } from 'react';

// Renders every page of a PDF (including server-rendered slide decks) as a scrollable
// column of canvases. Browsers' built-in PDF frames show only the first page on iPhone
// and nothing on Android, so the file viewer draws pages itself. Pages render lazily
// as they scroll near view.
export default function PdfPages({ url, title }) {
  const listRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    let observer = null;
    setPages([]);
    setError('');

    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
      doc = await pdfjs.getDocument({ url }).promise;
      if (cancelled) return;
      const first = await doc.getPage(1);
      const base = first.getViewport({ scale: 1 });
      setPages(Array.from({ length: doc.numPages }, (_, index) => ({ number: index + 1, ratio: base.height / base.width })));

      const rendered = new Set();
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const number = Number(entry.target.dataset.page);
          if (!entry.isIntersecting || rendered.has(number)) return;
          rendered.add(number);
          renderPage(doc, number, entry.target).catch(() => rendered.delete(number));
        });
      }, { root: listRef.current, rootMargin: '600px 0px' });
      requestAnimationFrame(() => {
        listRef.current?.querySelectorAll('canvas[data-page]').forEach(canvas => observer.observe(canvas));
      });
    })().catch(() => { if (!cancelled) setError('Could not display this file.'); });

    return () => {
      cancelled = true;
      observer?.disconnect();
      doc?.destroy();
    };
  }, [url]);

  if (error) return <div className="sn-viewer-empty"><p>{error}</p></div>;
  if (!pages.length) return <div className="sn-viewer-empty"><p>Loading {title}…</p></div>;

  return (
    <div className="sn-pdf-pages" ref={listRef} role="document" aria-label={title}>
      {pages.map(page => (
        <canvas
          key={page.number}
          data-page={page.number}
          className="sn-pdf-page"
          style={{ aspectRatio: `1 / ${page.ratio}` }}
          aria-label={`Page ${page.number} of ${pages.length}`}
        />
      ))}
    </div>
  );
}

async function renderPage(doc, number, canvas) {
  const page = await doc.getPage(number);
  const width = canvas.clientWidth || 600;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (width * pixelRatio) / page.getViewport({ scale: 1 }).width });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
}
