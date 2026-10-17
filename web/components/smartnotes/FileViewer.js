import { useEffect, useState } from 'react';
import PdfPages from '../PdfPages';
import { authorizedFetch, responseJson } from '../../lib/api';
import { sanitizeHtml } from '../../lib/sanitizeHtml';

// Office docs that need backend extraction (browser cannot render natively)
const EXTRACT_EXTS = new Set(['docx', 'doc', 'odt', 'ods']);
// Presentations render to a scrollable PDF of the real slides (server-side LibreOffice).
const SLIDE_EXTS = new Set(['pptx', 'ppt', 'odp']);
// Plain-text formats readable client-side via FileReader
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log',
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
  'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'ps1',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogv', 'mov']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
// What the file picker offers: every type this viewer can show.
export const ACCEPTED_FILE_TYPES = ['pdf', ...SLIDE_EXTS, ...EXTRACT_EXTS, ...TEXT_EXTS, ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]
  .map(ext => '.' + ext).join(',');
// Shown straight from the file through an object URL (slides get a rendered PDF instead).
const isEmbeddable = ext => ext === 'pdf' || IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);

// ─── Study guide Q&A parser ──────────────────────────────────────────────────
function parseGuideQA(html) {
  // Strip HTML tags, decode entities
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays the text "&lt;"
    .replace(/\s+/g, ' ').trim();

  const pairs = [];
  // Match Q\d+[:.] ... A\d+[:.] ... with the same number
  const re = /Q(\d+)\s*[:.]\s*([\s\S]*?)A\1\s*[:.]\s*([\s\S]*?)(?=Q\d+\s*[:.]\s*|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const q = m[2].trim();
    const a = m[3].trim();
    if (q || a) pairs.push({ num: m[1], question: q, answer: a });
  }
  return pairs;
}

function GuideViewer({ html }) {
  const pairs = parseGuideQA(html);
  if (pairs.length === 0) {
    return <div className="sn-guide-viewer" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
  }
  return (
    <div className="sn-guide-qa-viewer">
      {pairs.map((pair) => (
        <div key={pair.num} className="sn-qa-pair">
          <p className="sn-qa-q"><strong>Q{pair.num}. {pair.question}</strong></p>
          <p className="sn-qa-a">{pair.answer}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Slide card viewer (PPTX) ────────────────────────────────────────────────
function SlideCardViewer({ slides }) {
  return (
    <div className="sn-slide-list">
      {slides.map(slide => (
        <div key={slide.number} className="sn-slide-card">
          <div className="sn-slide-num">Slide {slide.number}</div>
          {slide.texts.length === 0
            ? <p className="sn-slide-no-text">(image only)</p>
            : slide.texts.map((t, i) => <p key={i} className="sn-slide-text">{t}</p>)
          }
        </div>
      ))}
    </div>
  );
}

// ─── File viewer ─────────────────────────────────────────────────────────────
export default function FileViewer({ file, guideContent }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [extractedText, setExtractedText] = useState(null);
  const [slidesData, setSlidesData] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState(null);

  useEffect(() => {
    setObjectUrl(null);
    setExtractedText(null);
    setSlidesData(null);
    setExtracting(false);
    setExtractError(null);
    setFallbackNotice(null);
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    let cancelled = false;
    let renderedUrl = null;

    if (SLIDE_EXTS.has(ext)) {
      setExtracting(true);

      async function loadPptx() {
        let fallbackReason = 'Visual preview was unavailable, so the slide text is shown instead.';
        try {
          const renderData = new FormData();
          renderData.append('file', file);
          const renderResponse = await authorizedFetch('/render-pptx', { method: 'POST', body: renderData });

          if (renderResponse.ok) {
            const pdfBlob = await renderResponse.blob();
            renderedUrl = URL.createObjectURL(pdfBlob);
            if (cancelled) {
              URL.revokeObjectURL(renderedUrl);
              renderedUrl = null;
              return;
            }
            setObjectUrl(renderedUrl);
            return;
          }

          const renderError = await responseJson(renderResponse);
          if (renderError.detail) fallbackReason = `${renderError.detail} Showing extracted slide text instead.`;
        } catch {
          fallbackReason = 'Could not reach the visual renderer. Showing extracted slide text instead.';
        }

        if (cancelled) return;
        setFallbackNotice(fallbackReason);

        const extractData = new FormData();
        extractData.append('file', file);
        const extractResponse = await authorizedFetch('/extract-file-text', { method: 'POST', body: extractData });
        const data = await responseJson(extractResponse);
        if (cancelled) return;
        if (!extractResponse.ok) throw new Error(data.detail || 'Could not read this presentation.');
        setExtractedText(data.text || '');
        setSlidesData(data.slides || []);
      }

      loadPptx()
        .catch(error => { if (!cancelled) setExtractError(error.message || 'Could not read this presentation.'); })
        .finally(() => { if (!cancelled) setExtracting(false); });

      return () => {
        cancelled = true;
        if (renderedUrl) URL.revokeObjectURL(renderedUrl);
      };
    }

    if (EXTRACT_EXTS.has(ext)) {
      setExtracting(true);
      const fd = new FormData();
      fd.append('file', file);
      authorizedFetch('/extract-file-text', { method: 'POST', body: fd })
        .then(async r => {
          const data = await responseJson(r);
          if (cancelled) return;
          if (!r.ok) {
            setExtractError(data.detail || 'Could not extract text from this file.');
          } else {
            setExtractedText(data.text || '');
            if (data.slides) setSlidesData(data.slides);
          }
          setExtracting(false);
        })
        .catch(() => {
          if (!cancelled) { setExtractError('Could not reach the server.'); setExtracting(false); }
        });
      return () => { cancelled = true; };
    }

    if (TEXT_EXTS.has(ext)) {
      const reader = new FileReader();
      reader.onload = () => { if (!cancelled) setExtractedText(reader.result || ''); };
      reader.onerror = () => { if (!cancelled) setExtractError('Could not read this file.'); };
      reader.readAsText(file);
      return () => { cancelled = true; };
    }

    if (!isEmbeddable(ext)) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [file]);

  if (guideContent) return <GuideViewer html={guideContent} />;
  if (!file) return null;

  const ext = file.name.split('.').pop().toLowerCase();

  if (extracting) return <div className="sn-viewer-empty"><p>{SLIDE_EXTS.has(ext) ? 'Preparing slides' : 'Reading'} {file.name}…</p></div>;

  if (slidesData !== null) return (
    <div className="sn-slide-fallback">
      {fallbackNotice && <div className="sn-slide-fallback-notice">{fallbackNotice}</div>}
      <SlideCardViewer slides={slidesData} />
    </div>
  );

  if (extractedText !== null) {
    return (
      <div className="sn-extracted-viewer">
        <div className="sn-extracted-filename">{file.name}</div>
        {extractedText.trim() === ''
          ? <p className="sn-extracted-empty">(No readable text found.)</p>
          : <pre className="sn-extracted-content">{extractedText}</pre>}
      </div>
    );
  }

  if (extractError) {
    return <div className="sn-viewer-empty"><p>{extractError}</p></div>;
  }

  // No iframe fallback: a blob: URL shares this page's origin, so an HTML-like file could run as Classroom.
  if (!isEmbeddable(ext) && !SLIDE_EXTS.has(ext)) {
    return <div className="sn-viewer-empty"><p>Classroom can't preview .{ext} files. Open a PDF, slides, document, image, video, audio, or text file.</p></div>;
  }
  if (!objectUrl) return null;

  if (ext === 'pdf' || SLIDE_EXTS.has(ext)) return <PdfPages url={objectUrl} title={file.name} />;
  if (IMAGE_EXTS.has(ext)) return <img src={objectUrl} className="sn-viewer-img" alt={file.name} />;
  if (VIDEO_EXTS.has(ext)) return <video src={objectUrl} controls className="sn-viewer-video" />;
  return <audio src={objectUrl} controls style={{ width: '100%', padding: 16 }} />;
}
