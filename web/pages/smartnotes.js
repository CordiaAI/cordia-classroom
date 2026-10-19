import { useState, useEffect, useRef, useCallback } from 'react';
import CordiaLoader, { SectionLoader } from '../components/CordiaLoader';
import BodyPortal from '../components/BodyPortal';
import { mermaidConfig } from '../components/MermaidDiagram';
import { useRouter } from 'next/router';
import { authHeaders, authorizedFetch, responseJson } from '../lib/api';
import { Check, ChevronDown, FilePlus2, FileUp, NotebookPen, Sparkles, X as XIcon } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';
import PdfPages from '../components/PdfPages';
import { useFileDropZone } from '../lib/fileDrop';
import { sanitizeHtml } from '../lib/sanitizeHtml';
import NapkinVisual from '../components/NapkinVisual';
import { MIN_CHARS, htmlToText, isDefaultTitle, needsCover } from '../lib/noteMeta.mjs';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ─── Rule-based formatter ────────────────────────────────────────────────────
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
function cleanPastedHtml(html) {
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

function plainTextToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.trim() ? `<p>${escHtml(line)}</p>` : '')
    .join('');
}

function saveErrorMessage(status) {
  if (status === 401) return 'Your session expired. Sign in again to save this note.';
  if (status === 413 || status === 422) return 'This note is too large to save. Split it into two notes.';
  return 'Could not save this note. Check your connection and try again.';
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

// ─── Mermaid renderer (lazy-loaded) ─────────────────────────────────────────
function MermaidDiagram({ code }) {
  const ref = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code || !ref.current) return;
    setError(false);
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize(mermaidConfig());
      const id = 'mermaid-' + Date.now();
      mermaid.render(id, code).then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      }).catch(() => setError(true));
    });
  }, [code]);

  if (error) return <p className="sn-diagram-placeholder">Diagram could not be rendered.</p>;
  return <div ref={ref} className="sn-diagram-render" />;
}

// The built-in diagram for a highlight, drawn only when no Napkin visual is available.
function BuiltInDiagram({ text, code, loading, draw }) {
  useEffect(() => { if (!code) draw(text); }, [text]);
  if (loading) return <div className="sn-diagram-placeholder"><CordiaLoader size={20} label="Drawing" /></div>;
  return code ? <MermaidDiagram code={code} /> : null;
}

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

// ─── Study guide Q&A parser ──────────────────────────────────────────────────
function parseGuideQA(html) {
  // Strip HTML tags, decode entities
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

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

// ─── Study guide preview modal (shared by editor + index) ────────────────────
function StudyGuidePreviewModal({ preview, title, setTitle, error, saving, onClose, onApprove, onEdit }) {
  if (!preview) return null;
  const hasPairs = preview.pairs && preview.pairs.length > 0;
  return (
    <BodyPortal>
    <div className="c-scrim" onClick={onClose}>
      <div className="c-sheet sn-modal" role="dialog" aria-modal="true" aria-label="Guide preview" onClick={e => e.stopPropagation()}>
        <div className="sn-modal-header">
          <input
            className="c-input sn-modal-title-input"
            aria-label="Guide title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            disabled={saving}
          />
        </div>
        <div className="sn-modal-body">
          {error && <div className="sn-modal-error">{error}</div>}
          {hasPairs ? (
            <div className="sn-modal-pairs">
              {preview.pairs.map((p, i) => (
                <div key={i} className="sn-modal-pair">
                  <div className="sn-modal-q"><strong>Q{i + 1}.</strong> {p.question}</div>
                  <div className="sn-modal-a">{p.answer}</div>
                </div>
              ))}
            </div>
          ) : (
            !error && <div className="sn-modal-empty">0 questions</div>
          )}
        </div>
        <div className="sn-modal-footer">
          <button className="c-btn c-btn--quiet sn-modal-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="c-btn c-btn--secondary sn-modal-edit" onClick={onEdit} disabled={saving || !hasPairs}>Edit</button>
          <button
            className="c-btn c-btn--primary sn-modal-approve"
            onClick={onApprove}
            disabled={saving || !hasPairs || !title.trim()}
          >
            {saving ? 'Saving…' : 'Save guide'}
          </button>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
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
function FileViewer({ file, guideContent }) {
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

          const renderError = await responseJson(renderResponse).catch(() => ({}));
          if (renderError.detail) fallbackReason = `${renderError.detail} Showing extracted slide text instead.`;
        } catch {
          fallbackReason = 'Could not reach the visual renderer. Showing extracted slide text instead.';
        }

        if (cancelled) return;
        setFallbackNotice(fallbackReason);

        const extractData = new FormData();
        extractData.append('file', file);
        const extractResponse = await authorizedFetch('/extract-file-text', { method: 'POST', body: extractData });
        const data = await responseJson(extractResponse).catch(() => ({}));
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
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      setExtracting(true);
      const fd = new FormData();
      fd.append('file', file);
      authorizedFetch('/extract-file-text', { method: 'POST', body: fd })
        .then(async r => {
          const data = await responseJson(r).catch(() => ({}));
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
      return () => { cancelled = true; URL.revokeObjectURL(url); };
    }

    if (TEXT_EXTS.has(ext)) {
      const reader = new FileReader();
      reader.onload = () => { if (!cancelled) setExtractedText(reader.result || ''); };
      reader.onerror = () => { if (!cancelled) setExtractError('Could not read this file.'); };
      reader.readAsText(file);
      return () => { cancelled = true; };
    }

    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [file]);

  if (guideContent) return <GuideViewer html={guideContent} />;
  if (!file) return null;

  const ext = file.name.split('.').pop().toLowerCase();

  if (extracting) return <div className="sn-viewer-empty"><CordiaLoader size={20} label={SLIDE_EXTS.has(ext) ? 'Preparing slides' : 'Reading the file'} /></div>;

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

  if (!objectUrl) return null;

  if (ext === 'pdf' || SLIDE_EXTS.has(ext)) return <PdfPages url={objectUrl} title={file.name} />;
  if (IMAGE_EXTS.has(ext)) return <img src={objectUrl} className="sn-viewer-img" alt={file.name} />;
  if (VIDEO_EXTS.has(ext)) return <video src={objectUrl} controls className="sn-viewer-video" />;
  if (AUDIO_EXTS.has(ext)) return <audio src={objectUrl} controls style={{ width: '100%', padding: 16 }} />;

  return <iframe src={objectUrl} className="sn-iframe" title={file.name} />;
}

// ─── Notes Index — grid of saved notes with stacked-paper preview ────────────
function NotesIndex({ router, timerState, setTimerState }) {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);

  // Select-mode for "Turn into Study Guide" → click a note to convert
  const [selectMode, setSelectMode] = useState(false);
  const [convertingNoteId, setConvertingNoteId] = useState(null);
  const [guidePreview, setGuidePreview] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [savingGuide, setSavingGuide] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  // Napkin covers and AI titles, made in the background a few notes at a time.
  const [covers, setCovers] = useState({});
  const [coversEnabled, setCoversEnabled] = useState(false);
  const [labelling, setLabelling] = useState({});
  const labelled = useRef(new Set());

  useEffect(() => {
    fetch('/api/notes/covers', { headers: authHeaders() })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!data) return;
        setCoversEnabled(Boolean(data.enabled));
        setCovers(Object.fromEntries((data.covers || []).map(cover => [cover.note_id, cover])));
      })
      .catch(() => {});
  }, []);

  // Untitled notes get an AI title; notes without a current cover get one (2 at a time, 6 per visit).
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const due = notes.map(note => {
      const length = htmlToText(note.content).length;
      return { note, title: length >= MIN_CHARS && isDefaultTitle(note.title), cover: coversEnabled && needsCover(covers[note.id], length) };
    }).filter(item => (item.title || item.cover) && !labelled.current.has(item.note.id)).slice(0, 6);
    if (!due.length) return undefined;
    due.forEach(item => labelled.current.add(item.note.id));
    let next = 0;
    const work = async () => {
      while (!cancelled && next < due.length) {
        const item = due[next++];
        if (item.cover) setLabelling(current => ({ ...current, [item.note.id]: true }));
        const data = await fetch('/api/notes/meta', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ note_id: item.note.id, title: item.title, cover: item.cover }),
        }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        if (data?.title) setNotes(current => current.map(note => (note.id === item.note.id ? { ...note, title: data.title } : note)));
        if (data?.cover?.url) setCovers(current => ({ ...current, [item.note.id]: { ...data.cover, content_length: htmlToText(item.note.content).length } }));
        setLabelling(current => { const { [item.note.id]: _, ...rest } = current; return rest; });
      }
    };
    work(); work();
    return () => { cancelled = true; };
  }, [loading, notes.length, coversEnabled, Object.keys(covers).length]);

  useEffect(() => {
    Promise.all([
      fetch(API + '/smart_notes', { headers: authHeaders() }).then(responseJson).catch(() => ({ notes: [] })),
      fetch(API + '/folders', { headers: authHeaders() }).then(responseJson).catch(() => ({ folders: [] })),
      fetch(API + '/guides', { headers: authHeaders() }).then(responseJson).catch(() => ({ guides: [] })),
    ]).then(([notesData, foldersData, guidesData]) => {
      setNotes(notesData.notes || []);
      setFolders(foldersData.folders || []);
      setGuides(guidesData.guides || []);
      setLoading(false);
    });
  }, []);

  const folderById = Object.fromEntries(folders.map(f => [f.id, f]));
  useEffect(() => { walkthroughEvent('notes-opened'); }, []);

  // A new note is only saved once it has text or a title (see doSave), so empty notes never pile up.
  function handleNew() {
    walkthroughEvent('note-created');
    router.push('/smartnotes?id=new');
  }

  async function handleSelectNoteForGuide(note) {
    if (convertingNoteId) return; // ignore extra clicks while one is processing
    setConvertingNoteId(note.id);
    setPreviewError('');
    setSelectedFolderId(note.folder_id || null);
    try {
      const resp = await fetch(API + '/smart_notes/' + note.id + '/study_guide', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await responseJson(resp);
      if (!resp.ok) {
        setGuidePreview({ title: '', study_guide: '', pairs: [] });
        setPreviewError(data?.detail || 'Failed to generate study guide');
        setPreviewTitle('');
      } else {
        setGuidePreview(data);
        setPreviewTitle(data.title || 'Untitled — Study Guide');
      }
    } catch {
      setGuidePreview({ title: '', study_guide: '', pairs: [] });
      setPreviewError('Network error — please try again');
    } finally {
      setConvertingNoteId(null);
      setSelectMode(false);
    }
  }

  function handleClosePreview() {
    setGuidePreview(null);
    setPreviewTitle('');
    setPreviewError('');
  }

  async function handleApprovePreview() {
    if (!guidePreview || !guidePreview.study_guide) return;
    setSavingGuide(true);
    try {
      const flashcards = (guidePreview.pairs || []).map(p => ({ front: p.question, back: p.answer }));
      const resp = await fetch(API + '/guides', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (previewTitle || 'Untitled — Study Guide').trim(),
          study_guide: guidePreview.study_guide,
          notes: guidePreview.notes_html || '',
          flashcards: flashcards.length ? flashcards : undefined,
          folder_id: selectedFolderId || null,
          source_type: guidePreview.source?.type,
          source_title: guidePreview.source?.title,
          source_id: guidePreview.source?.id,
        }),
      });
      const data = await responseJson(resp);
      if (resp.ok && data.guide?.id) {
        router.push('/guide/' + data.guide.id);
      } else {
        setPreviewError(data?.detail || 'Failed to save study guide');
      }
    } catch {
      setPreviewError('Network error while saving');
    } finally {
      setSavingGuide(false);
    }
  }

  function handleEditPreview() {
    if (!guidePreview) return;
    const pairs = guidePreview.pairs.map(p => ({ term: p.question, definition: p.answer }));
    try {
      localStorage.setItem('autostudy_manual_draft', JSON.stringify({
        title: (previewTitle || 'Untitled — Study Guide').trim(),
        pairs,
        inputMode: 'manual',
      }));
    } catch {}
    handleClosePreview();
    router.push('/create');
  }

  function previewText(html) {
    if (!html) return '';
    // Parsed in an inert document so saved HTML can never run code while building a preview.
    const doc = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html');
    return (doc.body.textContent || '').trim().slice(0, 200);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  return (
    <div className="sn-index c-page">
      <div className="c-page-head">
        <h1 className="c-title">Notes</h1>
        {notes.length > 0 && (
          <div className="c-row">
            {selectMode ? (
              <button className="c-btn c-btn--secondary" onClick={() => setSelectMode(false)} disabled={!!convertingNoteId}>Cancel</button>
            ) : (
              <>
                {notes.some(n => previewText(n.content)) && (
                  <button className="c-btn c-btn--quiet sn-convert-header-btn" onClick={() => setSelectMode(true)}><Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Turn into guide</button>
                )}
                <button className="c-btn c-btn--primary" onClick={handleNew} data-spot="note-new"><FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" />New note</button>
              </>
            )}
          </div>
        )}
      </div>
      {selectMode && <p className="c-section-title" role="status">Pick a note</p>}

      {loading && <SectionLoader height={180} label="Loading notes" />}

      {!loading && notes.length === 0 && (
        <div className="c-empty">
          <button className="c-btn c-btn--primary c-btn--lg" onClick={handleNew} data-spot="note-new"><FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" />New note</button>
        </div>
      )}

      {!loading && notes.length > 0 && (
        <div className={'sn-grid' + (selectMode ? ' sn-grid--select' : '')}>
          {notes.map(n => {
            const folder = n.folder_id ? folderById[n.folder_id] : null;
            const isConverting = convertingNoteId === n.id;
            const cardClasses = [
              'sn-card',
              selectMode ? 'sn-card--selectable' : '',
              isConverting ? 'sn-card--converting' : '',
            ].filter(Boolean).join(' ');
            const onCardClick = selectMode
              ? () => handleSelectNoteForGuide(n)
              : () => router.push('/smartnotes?id=' + n.id);
            return (
              <div
                key={n.id}
                className={cardClasses}
                onClick={onCardClick}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') onCardClick(); }}
              >
                <div className="sn-card-stack">
                  <div className="sn-card-paper sn-card-paper-3" />
                  <div className="sn-card-paper sn-card-paper-2" />
                  <div className="sn-card-paper sn-card-paper-1">
                    {covers[n.id]?.url
                      ? <img className="sn-card-cover" src={covers[n.id].url} alt={covers[n.id].alt || ''} loading="lazy" />
                      : <div className="sn-card-preview">{previewText(n.content) || 'Empty note'}</div>}
                    {labelling[n.id] && <span className="sn-card-making"><CordiaLoader size={20} label="Making a cover" /></span>}
                  </div>
                </div>
                <div className="sn-card-meta">
                  <div className="sn-card-title">{n.title || 'Untitled Notes'}</div>
                  <div className="sn-card-sub">
                    <span className="sn-card-date">{fmtDate(n.updated_at || n.created_at)}</span>
                    {folder && <span className="sn-card-class">{folder.name}</span>}
                  </div>
                </div>
                {isConverting && <div className="sn-card-converting-overlay">Generating…</div>}
              </div>
            );
          })}
        </div>
      )}

      <StudyGuidePreviewModal
        preview={guidePreview}
        title={previewTitle}
        setTitle={setPreviewTitle}
        error={previewError}
        saving={savingGuide}
        onClose={handleClosePreview}
        onApprove={handleApprovePreview}
        onEdit={handleEditPreview}
      />
    </div>
  );
}

// ─── Page entry — routes between index and editor based on ?id ───────────────
export default function SmartNotesPage({ timerState, setTimerState }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !router.isReady) return null;
  if (router.isReady && !router.query.id) return <NotesIndex router={router} timerState={timerState} setTimerState={setTimerState} />;
  return <SmartNotesEditor />;
}

// ─── Editor (single note) ────────────────────────────────────────────────────
function SmartNotesEditor() {
  const router = useRouter();
  const [noteId, setNoteId] = useState(null);
  const [title, setTitle] = useState('Untitled Notes');
  const [hasText, setHasText] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState('');
  const [notes, setNotes] = useState([]); // session list
  const [showNotesList, setShowNotesList] = useState(false);
  const notesPickerRef = useRef(null);
  const notesTriggerRef = useRef(null);
  // The notes dropdown closes on Escape (focus returns to its button) and on any outside click.
  useEffect(() => {
    if (!showNotesList) return undefined;
    function onKey(event) {
      if (event.key !== 'Escape') return;
      setShowNotesList(false);
      notesTriggerRef.current?.focus();
    }
    function onPointer(event) {
      if (!notesPickerRef.current?.contains(event.target)) setShowNotesList(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [showNotesList]);

  // Diagram / visualize
  const [mermaidCode, setMermaidCode] = useState(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [visualizeMode, setVisualizeMode] = useState(false);
  const [visualSource, setVisualSource] = useState(null); // { text, context, key }
  const visualAnchor = useRef(null);

  // "Turn into Study Guide" preview modal
  const [convertingGuide, setConvertingGuide] = useState(false);
  const [guidePreview, setGuidePreview] = useState(null); // { title, study_guide, pairs }
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [savingGuide, setSavingGuide] = useState(false);

  // Resize state
  const [colWidth, setColWidth] = useState(320);
  const [topPx, setTopPx] = useState(null); // null = CSS default 1fr
  const layoutRef = useRef(null);

  // File viewer
  const [viewerFile, setViewerFile] = useState(null);
  const [guideList, setGuideList] = useState([]);
  const [guideContent, setGuideContent] = useState(null);
  const fileInputRef = useRef(null);
  const viewerWrapRef = useRef(null);
  // A file dropped anywhere on the page opens in the material viewer.
  const viewerDragOver = useFileDropZone({
    priority: 2,
    getElement: () => viewerWrapRef.current,
    onFiles: files => {
      setGuideContent(null);
      setViewerFile(files[0]);
    },
  });

  // Class/folder assignment
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState('');
  const folderIdRef = useRef('');

  // Paper (contenteditable)
  const paperRef = useRef(null);
  const saveTimer = useRef(null);
  const pollTimer = useRef(null);
  // Refs mirror state so timeout callbacks always read the latest values
  const noteIdRef = useRef(null);
  const titleRef  = useRef('Untitled Notes');
  const lastSavedRef = useRef('');       // last saved content snapshot
  const lastSavedTitleRef = useRef('Untitled Notes'); // last saved title snapshot
  const titleRequested = useRef(false); // AI title asked for once per opened note

  // Multi-page illusion: how many "filled pages" are behind the front paper (0–2)
  const [pageCount, setPageCount] = useState(0);

  // ── Init: load existing note (parent only renders editor when ?id is present)
  useEffect(() => {
    const { id } = router.query;
    if (id === 'new') {
      if (noteIdRef.current || !paperRef.current?.innerHTML) startBlankNote();
    } else if (id && String(id) !== String(noteIdRef.current)) {
      loadNote(id);
    }
  }, [router.isReady, router.query.id]);

  // Load existing guides for picker
  useEffect(() => {
    fetch(API + '/guides?limit=50', { headers: authHeaders() })
      .then(responseJson)
      .then(data => setGuideList(data.guides || []))
      .catch(() => {});
  }, []);

  // Load classes/folders for assignment
  useEffect(() => {
    fetch(API + '/folders', { headers: authHeaders() })
      .then(responseJson)
      .then(data => setFolders(data.folders || []))
      .catch(() => {});
  }, []);

  // Load notes list (also callable after save to refresh titles)
  const fetchNotes = useCallback(() => {
    fetch(API + '/smart_notes', { headers: authHeaders() })
      .then(responseJson)
      .then(data => setNotes(data.notes || []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchNotes(); }, [noteId, fetchNotes]);

  // A blank editor with no saved note behind it yet.
  function startBlankNote() {
    noteIdRef.current = null;
    titleRequested.current = false;
    titleRef.current = 'Untitled Notes';
    folderIdRef.current = '';
    setNoteId(null);
    setTitle('Untitled Notes');
    setFolderId('');
    if (paperRef.current) {
      paperRef.current.innerHTML = '<p><br></p>';
      lastSavedRef.current = paperRef.current.innerHTML;
      setHasText(false);
    }
    lastSavedTitleRef.current = 'Untitled Notes';
  }

  // The note is created on the server the first time it has something in it.
  const creatingRef = useRef(null);
  function noteIsEmpty() {
    const text = paperRef.current?.innerText?.trim() || '';
    const title = (titleRef.current || '').trim();
    return !text && (!title || title === 'Untitled Notes');
  }
  async function ensureNote() {
    if (noteIdRef.current) return noteIdRef.current;
    if (noteIsEmpty()) return null;
    if (!creatingRef.current) {
      creatingRef.current = (async () => {
        try {
          const resp = await fetch(API + '/smart_notes', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: titleRef.current || 'Untitled Notes' }),
          });
          const data = await responseJson(resp);
          if (!data?.note) return null;
          noteIdRef.current = data.note.id;
          setNoteId(data.note.id);
          walkthroughEvent('note-written');
          if (folderIdRef.current) {
            await fetch(API + '/smart_notes/' + data.note.id, {
              method: 'PUT',
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder_id: folderIdRef.current }),
            }).catch(() => {});
          }
          window.history.replaceState(window.history.state, '', '/smartnotes?id=' + data.note.id);
          return data.note.id;
        } catch {
          return null;
        } finally {
          creatingRef.current = null;
        }
      })();
    }
    return creatingRef.current;
  }

  async function loadNote(id) {
    try {
      const resp = await fetch(API + '/smart_notes/' + id, { headers: authHeaders() });
      if (!resp.ok) { startBlankNote(); return; }
      const data = await responseJson(resp);
      noteIdRef.current = data.note.id;
      titleRequested.current = false;
      titleRef.current  = data.note.title || 'Untitled Notes';
      folderIdRef.current = data.note.folder_id || '';
      setNoteId(data.note.id);
      setTitle(data.note.title || 'Untitled Notes');
      setFolderId(data.note.folder_id || '');
      if (paperRef.current) {
        paperRef.current.innerHTML = data.note.content && data.note.content.trim()
          ? sanitizeHtml(data.note.content)
          : '<p><br></p>';
        lastSavedRef.current = paperRef.current.innerHTML;
        lastSavedTitleRef.current = data.note.title || 'Untitled Notes';
        setHasText(Boolean(paperRef.current.innerText.trim()));
      }
    } catch {}
  }

  // ── Save helper — sends content to backend, updates lastSavedRef ────────
  // Resolves to '' when the note is saved (or unchanged), otherwise to a readable error.
  // A failed save leaves lastSavedRef untouched so the next autosave retries it.
  const doSave = useCallback(async (opts = {}) => {
    if (!paperRef.current) return '';
    if (!noteIdRef.current && !(await ensureNote())) return '';
    const content = paperRef.current.innerHTML;
    const title = titleRef.current;
    if (content === lastSavedRef.current && title === lastSavedTitleRef.current && !opts.force) return '';
    setSaveStatus('saving');
    let message = '';
    try {
      const response = await authorizedFetch('/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) message = saveErrorMessage(response.status);
    } catch {
      message = saveErrorMessage(0);
    }
    if (message) {
      setSaveStatus('error');
      setSaveError(message);
      return message;
    }
    lastSavedRef.current = content;
    lastSavedTitleRef.current = title;
    setSaveError('');
    setSaveStatus('saved');
    // Still "Untitled Notes" with real text: ask once for an AI title (saved to the note by the server).
    if (!titleRequested.current && isDefaultTitle(title) && (paperRef.current?.innerText || '').trim().length >= MIN_CHARS) {
      titleRequested.current = true;
      const noteId = noteIdRef.current;
      fetch('/api/notes/meta', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ note_id: noteId, title: true, cover: false }) })
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
          if (!data?.title || noteIdRef.current !== noteId || !isDefaultTitle(titleRef.current)) return;
          titleRef.current = data.title;
          lastSavedTitleRef.current = data.title;
          setTitle(data.title);
          fetchNotes();
        })
        .catch(() => {});
    }
    setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1500);
    fetchNotes(); // refresh sidebar list so title changes appear immediately
    return '';
  }, [fetchNotes]);

  // ── Autosave (debounced 1s after a keypress) ────────────────────────────
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(), 1000);
  }, [doSave]);

  // ── Live polling: every 3s, save if content changed (catches mouse-only edits)
  useEffect(() => {
    pollTimer.current = setInterval(() => { doSave(); }, 3000);
    return () => clearInterval(pollTimer.current);
  }, [doSave]);

  // ── Multi-page illusion — track scrollHeight, add ghost pages as content grows
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    function update() {
      const visible = paper.clientHeight || 1;
      // Each "filled page" = one extra visible-height of content beyond the first
      const filled = Math.max(0, Math.floor((paper.scrollHeight - 16) / visible) - 1);
      setPageCount(Math.min(filled, 2)); // cap at 2 ghost pages
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(paper);
    const mo = new MutationObserver(update);
    mo.observe(paper, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  // ── Flush save on unmount (SPA navigation) and beforeunload (tab close) ──
  useEffect(() => {
    function flushSave() {
      clearTimeout(saveTimer.current);
      if (!paperRef.current) return;
      // A note that was never saved and has text: create it now (SPA navigation keeps this running).
      if (!noteIdRef.current) { if (!noteIsEmpty()) doSave(); return; }
      const content = paperRef.current.innerHTML;
      const title = titleRef.current;
      const contentChanged = content !== lastSavedRef.current;
      const titleChanged = title !== lastSavedTitleRef.current;
      if (!contentChanged && !titleChanged) return;
      fetch(API + '/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
        keepalive: true,
      }).catch(() => {});
      lastSavedRef.current = content;
      lastSavedTitleRef.current = title;
    }
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('beforeunload', flushSave);
      flushSave(); // fires on SPA navigation (component unmount)
    };
  }, []);

  // ── Class/folder assignment — save immediately on change ────────────────
  async function handleFolderChange(e) {
    const newId = e.target.value;
    folderIdRef.current = newId;
    setFolderId(newId);
    if (!noteIdRef.current) return; // saved with the note when it is first created
    try {
      await fetch(API + '/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: newId || '' }),
      });
      fetchNotes();
    } catch {}
  }

  // ── Visualize: send highlighted text to diagram API ─────────────────────
  function handleVisualize() {
    setVisualizeMode(v => !v);
  }

  // "Make diagram": a Napkin visual of the highlight (the rest of the note is context).
  // If no visual can be made, the built-in diagram is drawn instead.
  function handleCheckmark() {
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    if (!selectedText || selectedText.length < 5) return;
    const paperText = paperRef.current?.innerText || '';
    const at = paperText.indexOf(selectedText);
    const context = at >= 0
      ? `${paperText.slice(Math.max(0, at - 700), at)}\n${paperText.slice(at + selectedText.length, at + selectedText.length + 700)}`.trim()
      : '';
    let block = selection.rangeCount ? selection.getRangeAt(0).endContainer : null;
    while (block && block.parentNode !== paperRef.current) block = block.parentNode;
    visualAnchor.current = block || null;
    setVisualizeMode(false);
    setMermaidCode(null);
    setVisualSource({ text: selectedText, context, key: Date.now() });
  }

  async function drawBuiltInDiagram(text) {
    setDiagramLoading(true);
    try {
      const resp = await fetch(API + '/smart_notes/diagram', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await responseJson(resp);
      setMermaidCode(data.mermaid || null);
    } catch {}
    setDiagramLoading(false);
  }

  // "Use this" puts the visual into the note, after the highlighted paragraph.
  function insertVisual(visual) {
    const paper = paperRef.current;
    if (!paper) return;
    const img = document.createElement('img');
    img.src = visual.url;
    img.alt = visual.alt || 'Diagram';
    img.className = `nv-inline nv-${visual.theme === 'dark' ? 'dark' : 'light'}`;
    const anchor = visualAnchor.current && paper.contains(visualAnchor.current) ? visualAnchor.current : paper.lastChild;
    if (anchor) anchor.parentNode.insertBefore(img, anchor.nextSibling);
    else paper.appendChild(img);
    setHasText(true);
    scheduleSave();
  }

  // ── Resize handlers ──────────────────────────────────────────────────────
  function onVDragStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidth;
    const onMove = (me) => {
      if (!layoutRef.current) return;
      const dx = startX - me.clientX;
      const maxW = layoutRef.current.offsetWidth - 340;
      setColWidth(Math.max(200, Math.min(startWidth + dx, maxW)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onHDragStart(e) {
    e.preventDefault();
    const onMove = (me) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const newTop = Math.max(100, Math.min(me.clientY - rect.top, rect.height - 8 - 100));
      setTopPx(newTop);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onPaperPaste(event) {
    const data = event.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (!html && !text) return; // images and files keep the browser default
    event.preventDefault();
    const cleaned = (html && cleanPastedHtml(html)) || plainTextToHtml(text || '');
    if (cleaned) document.execCommand('insertHTML', false, cleaned);
    setHasText(Boolean(paperRef.current?.innerText.trim()));
    scheduleSave();
  }

  // ── Paper keyboard handler ───────────────────────────────────────────────
  function onPaperKeyUp(e) {
    if (!paperRef.current) return;
    setHasText(Boolean(paperRef.current.innerText.trim()));
    scheduleSave();
  }

  function onPaperKeyDown(e) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const root = paperRef.current;

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
        // After sentence-ending punctuation \u2014 capitalize start of new sentence
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

    // \u2500\u2500 Tab: indent / outdent list items \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
        block.innerHTML = '<mark class="sn-callout">' + escHtml(calloutMatch[1]) + '</mark>';
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
        block.innerHTML = '<strong>' + letter + sep + '</strong>' + (content ? ' ' + escHtml(content) : '');
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
          + defMatch[2] + ' ' + escHtml(defMatch[3]);
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

  // ── File upload ──────────────────────────────────────────────────────────
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setGuideContent(null);
    setViewerFile(file);
    e.target.value = '';
  }

  function handleGuideSelect(e) {
    const guide = guideList.find(g => g.id === e.target.value);
    if (!guide) return;
    setViewerFile(null);
    setGuideContent(guide.study_guide || guide.notes || '<p>No content available.</p>');
  }

  // ── New session — flush current, then create+navigate to fresh note ──────
  async function handleNewNote() {
    setShowNotesList(false);
    await doSave();
    startBlankNote();
    router.push('/smartnotes?id=new');
  }

  async function handleDeleteNote(id, e) {
    e?.stopPropagation();
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      await fetch(API + '/smart_notes/' + id, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setNotes(prev => prev.filter(n => n.id !== id));
      if (id === noteIdRef.current) {
        await handleNewNote();
      }
    } catch {}
  }

  async function handleSwitchNote(id) {
    setShowNotesList(false);
    await doSave(); // persist current note before switching
    router.push('/smartnotes?id=' + id);
  }

  async function handleConvertToGuide() {
    setShowNotesList(false);
    await ensureNote();
    if (!noteIdRef.current) return;
    setPreviewError('');
    setConvertingGuide(true);
    try {
      // The backend reads the saved note, so a failed save must stop here with its reason.
      const saveProblem = await doSave();
      if (saveProblem) {
        setPreviewError(saveProblem);
        setGuidePreview({ title: '', study_guide: '', pairs: [] });
        return;
      }
      const resp = await fetch(API + '/smart_notes/' + noteIdRef.current + '/study_guide', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await responseJson(resp);
      if (!resp.ok) {
        setPreviewError(data?.detail || 'Failed to generate study guide');
        setGuidePreview({ title: '', study_guide: '', pairs: [] });
      } else {
        setGuidePreview(data);
        setPreviewTitle(data.title || 'Untitled — Study Guide');
      }
    } catch (e) {
      setPreviewError('Network error — please try again');
      setGuidePreview({ title: '', study_guide: '', pairs: [] });
    } finally {
      setConvertingGuide(false);
    }
  }

  function handleClosePreview() {
    setGuidePreview(null);
    setPreviewError('');
    setPreviewTitle('');
  }

  async function handleApprovePreview() {
    if (!guidePreview || !guidePreview.study_guide) return;
    setSavingGuide(true);
    try {
      const flashcards = (guidePreview.pairs || []).map(p => ({ front: p.question, back: p.answer }));
      const resp = await fetch(API + '/guides', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (previewTitle || 'Untitled — Study Guide').trim(),
          study_guide: guidePreview.study_guide,
          notes: guidePreview.notes_html || '',
          flashcards: flashcards.length ? flashcards : undefined,
          folder_id: folderIdRef.current || null,
          source_type: guidePreview.source?.type,
          source_title: guidePreview.source?.title,
          source_id: guidePreview.source?.id,
        }),
      });
      const data = await responseJson(resp);
      if (resp.ok && data.guide?.id) {
        router.push('/guide/' + data.guide.id);
      } else {
        setPreviewError(data?.detail || 'Failed to save study guide');
      }
    } catch {
      setPreviewError('Network error while saving');
    } finally {
      setSavingGuide(false);
    }
  }

  function handleEditPreview() {
    if (!guidePreview) return;
    const pairs = guidePreview.pairs.map(p => ({ term: p.question, definition: p.answer }));
    try {
      localStorage.setItem('autostudy_manual_draft', JSON.stringify({
        title: (previewTitle || 'Untitled — Study Guide').trim(),
        pairs,
        inputMode: 'manual',
      }));
    } catch {}
    handleClosePreview();
    router.push('/create');
  }

  return (
    <div className="sn-page">
      {/* Header bar */}
      <div className="sn-header">
        <div className="sn-header-left">
          <input
            className="sn-title-input"
            value={title}
            onChange={e => { titleRef.current = e.target.value; setTitle(e.target.value); scheduleSave(); }}
            placeholder="Title"
            aria-label="Note title"
            spellCheck={false}
          />
          <span className={`sn-status ${saveStatus}`}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? saveError : ''}
          </span>
        </div>
        <div className="sn-header-right">
          <select
            aria-label="Class"
            className="c-select sn-class-select"
            value={folderId}
            onChange={handleFolderChange}
          >
            <option value="">No class</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {hasText && (
            <button className="c-btn c-btn--secondary sn-convert-header-btn" onClick={handleConvertToGuide} disabled={convertingGuide}>
              <Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />{convertingGuide ? 'Building…' : 'Turn into guide'}
            </button>
          )}
          <button
            className={`c-btn c-btn--primary sn-save-btn${saveStatus === 'saving' ? ' saving' : saveStatus === 'saved' ? ' saved' : saveStatus === 'error' ? ' error' : ''}`}
            onClick={() => doSave({ force: true })}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
          <div className="sn-notes-picker" ref={notesPickerRef}>
            <button
              ref={notesTriggerRef}
              className={`c-btn c-btn--secondary sn-notes-dropdown-trigger${showNotesList ? ' open' : ''}`}
              onClick={() => setShowNotesList(v => !v)}
              aria-expanded={showNotesList}
            >
              <NotebookPen size={20} strokeWidth={1.75} aria-hidden="true" />Notes<ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {showNotesList && (
              <div className="sn-notes-dropdown">
                <div className="sn-notes-dropdown-header">
                  <span className="sn-panel-label">Notes</span>
                  <button className="c-btn c-btn--quiet sn-new-btn" onClick={handleNewNote}>New note</button>
                </div>
                <div
                  className={'sn-notes-item sn-notes-item--back'}
                  onClick={async () => { setShowNotesList(false); await doSave(); router.push('/smartnotes'); }}
                >
                  All notes
                </div>
                {notes.map(n => (
                  <div
                    key={n.id}
                    className={'sn-notes-item' + (n.id === noteId ? ' active' : '')}
                    onClick={() => handleSwitchNote(n.id)}
                  >
                    {n.title || 'Untitled Notes'}
                  </div>
                ))}
                {notes.length === 0 && <div className="sn-notes-item muted">0 notes</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3-panel resizable grid */}
      <div
        className="sn-layout"
        ref={layoutRef}
        style={{
          gridTemplateColumns: `1fr 8px ${colWidth}px`,
          gridTemplateRows: topPx !== null ? `${topPx}px 8px 1fr` : '1fr 8px 1fr',
        }}
      >
        {/* Left: notes paper — spans all 3 rows */}
        <div className="sn-paper-wrap">
          <div className="sn-paper-label-row">
            <span className="sn-panel-label">Notes</span>
            {visualizeMode && (
              <button
                className="sn-visualize-confirm"
                onClick={handleCheckmark}
                title="Generate diagram from highlighted text"
                aria-label="Make diagram"
              >
                <Check aria-hidden="true" />
              </button>
            )}
          </div>
          <div className={`sn-paper-stage sn-paper-stage--p${pageCount}`}>
            {/* Ghost pages behind — appear as content fills */}
            <div className="sn-ghost-page sn-ghost-page-3" aria-hidden="true" />
            <div className="sn-ghost-page sn-ghost-page-2" aria-hidden="true" />
          <div
            ref={paperRef}
            className={`sn-paper${visualizeMode ? ' sn-paper--visualize' : ''}`}
            contentEditable
            suppressContentEditableWarning
            onKeyDown={onPaperKeyDown}
            onKeyUp={onPaperKeyUp}
            onPaste={onPaperPaste}
            data-placeholder="Start typing"
            spellCheck={false}
          />
          </div>
        </div>

        {/* Vertical drag divider */}
        <div className="sn-v-divider" onMouseDown={onVDragStart} />

        {/* Top-right: class material viewer */}
        <div
          ref={viewerWrapRef}
          className={`sn-viewer-wrap${viewerDragOver ? ' sn-viewer-drag' : ''}`}
        >
          <div className="sn-viewer-toolbar">
            <span className="sn-panel-label">Material</span>
            <div className="sn-viewer-controls">
              <button className="c-btn c-btn--secondary sn-open-btn" onClick={() => fileInputRef.current?.click()}>
                <FileUp size={20} strokeWidth={1.75} aria-hidden="true" />Open
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="*/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {guideList.length > 0 && (
                <select className="c-select sn-guide-select" onChange={handleGuideSelect} defaultValue="" aria-label="Show a guide">
                  <option value="" disabled>Guide</option>
                  {guideList.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="sn-viewer-body">
            {!viewerFile && !guideContent && (
              <div className="sn-viewer-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.35">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <p>Drop a file</p>
              </div>
            )}
            {viewerDragOver && (
              <div className="sn-viewer-drop-overlay">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>Drop</p>
              </div>
            )}
            <FileViewer file={viewerFile} guideContent={guideContent} />
          </div>
        </div>

        {/* Horizontal drag divider */}
        <div className="sn-h-divider" onMouseDown={onHDragStart} />

        {/* Bottom-right: diagram */}
        <div className="sn-diagram-wrap">
          <div className="sn-diagram-toolbar">
            <span className="sn-panel-label">Diagram</span>
            <button
              className={`c-btn c-btn--secondary sn-visualize-btn${visualizeMode ? ' active' : ''}`}
              onClick={handleVisualize}
            >
              {visualizeMode ? 'Cancel' : 'Visualize'}
            </button>
          </div>
          <div className="sn-diagram-body">
            {visualSource && (
              <NapkinVisual
                key={visualSource.key}
                auto
                text={visualSource.text}
                context={visualSource.context}
                useLabel="Use this"
                onUse={insertVisual}
                fallback={() => <BuiltInDiagram text={visualSource.text} code={mermaidCode} loading={diagramLoading} draw={drawBuiltInDiagram} />}
              />
            )}
            {!visualSource && (
              <div className="sn-diagram-placeholder">
                <p>Visualize → highlight → confirm</p>
              </div>
            )}
          </div>
        </div>

      </div>

      <StudyGuidePreviewModal
        preview={guidePreview}
        title={previewTitle}
        setTitle={setPreviewTitle}
        error={previewError}
        saving={savingGuide}
        onClose={handleClosePreview}
        onApprove={handleApprovePreview}
        onEdit={handleEditPreview}
      />
    </div>
  );
}
