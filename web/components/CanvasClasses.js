import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Download, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, Search, Settings2, Sparkles } from 'lucide-react';
import { apiErrorMessage, apiFetch, authorizedFetch } from '../lib/api';
import { openNewSheet } from '../lib/newSheet';
import { SectionLoader } from './CordiaLoader';
import CanvasCourseList from './CanvasCourseList';
import ClassCard from './ClassCard';
import ViewToggle from './ViewToggle';
import { useListView } from '../lib/listView';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function fileSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// What a file is, from its name or type: a label and an icon for its tile.
const KINDS = [
  [/\.pdf$|pdf/i, 'PDF', FileText],
  [/\.(pptx?|key|odp)$|presentation/i, 'Slides', Presentation],
  [/\.(docx?|odt|rtf|pages)$|wordprocessing|msword/i, 'Document', FileText],
  [/\.(xlsx?|csv|ods|numbers)$|spreadsheet|excel/i, 'Spreadsheet', FileSpreadsheet],
  [/\.(png|jpe?g|gif|webp|heic|svg)$|^image\//i, 'Image', FileImage],
  [/\.(mp4|mov|m4v|webm)$|^video\//i, 'Video', FileVideo],
];
function fileKind(file) {
  const found = KINDS.find(([pattern]) => pattern.test(file.name || '') || pattern.test(file.type || ''));
  return found ? { label: found[1], Icon: found[2] } : { label: 'File', Icon: FileText };
}
const shownName = name => String(name || 'Untitled file').replace(/\.(pdf|pptx?|docx?|xlsx?|csv|txt|key|odt|odp|ods|rtf|png|jpe?g|gif|webp|heic|svg|mp4|mov|m4v|webm)$/i, '');

// One Canvas file as a browser File, through Cordia (the token never reaches the page).
async function fetchFile(courseId, file) {
  const response = await authorizedFetch(`/canvas/courses/${courseId}/files/${file.id}`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data?.detail, 'Canvas could not send this file.'));
  }
  const blob = await response.blob();
  return new File([blob], file.name || 'canvas-file', { type: file.type || blob.type || 'application/octet-stream' });
}

// A class's course material: open a file, or make a study guide from it.
export function CourseFiles({ course }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    // A class that hides its Files page is read link by link, which can take a while.
    apiFetch(`/canvas/courses/${course.id}/files`, { timeoutMs: 60000, reportFailure: true }).then(data => {
      if (Array.isArray(data?.files)) setFiles(data.files);
      else {
        setFiles([]);
        setError(data?.failed === 'timeout' ? 'Canvas took too long to list this class’s files. Try again in a moment.'
          : apiErrorMessage(data?.detail, 'Canvas could not list this class’s files.'));
      }
    });
  }, [course.id]);

  async function act(file, kind) {
    setBusy(`${kind}:${file.id}`);
    setError('');
    try {
      const picked = await fetchFile(course.id, file);
      if (kind === 'guide') openNewSheet('upload', { files: [picked] });
      else {
        const url = URL.createObjectURL(picked);
        const link = document.createElement('a');
        link.href = url;
        link.download = picked.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) {
      setError(failure.message);
    }
    setBusy('');
  }

  if (!files) return <SectionLoader height={120} label="Loading course material" />;
  const needle = query.trim().toLowerCase();
  const shown = needle ? files.filter(file => String(file.name || '').toLowerCase().includes(needle)) : files;
  return (
    <div className="cc-files-wrap">
      {files.length > 0 && (
        <div className="cc-files-head">
          <span className="c-meta">{files.length === 1 ? '1 file' : `${files.length} files`} from Canvas</span>
          {files.length > 8 && (
            <label className="cc-files-search">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <input className="c-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a file" aria-label="Find a file" />
            </label>
          )}
        </div>
      )}
      {error && <p className="cc-error" role="alert">{error}</p>}
      {shown.length > 0 ? (
        <ul className="cc-files">
          {shown.map(file => {
            const { label, Icon } = fileKind(file);
            return (
              <li key={file.id} className="cc-file">
                <span className="cc-file-tile"><Icon {...ICON} /></span>
                <span className="cc-file-text">
                  <span className="cc-file-name" title={file.name}>{shownName(file.name)}</span>
                  <span className="c-meta">{[label, fileSize(file.size)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="cc-file-actions">
                  {label !== 'Video' && <button type="button" className="c-btn c-btn--secondary c-btn--sm cc-file-guide" onClick={() => act(file, 'guide')} disabled={Boolean(busy)} aria-label={`Make a guide from ${file.name}`}>
                    <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" /><span className="cc-file-guide-label">{busy === `guide:${file.id}` ? 'Getting it…' : 'Make guide'}</span>
                  </button>}
                  <button type="button" className="c-icon-btn" onClick={() => act(file, 'download')} disabled={Boolean(busy)} aria-label={`Download ${file.name}`}><Download {...ICON} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : !error && <p className="c-meta cc-none">{needle ? 'No file matches that.' : 'No files shared in this class yet.'}</p>}
      <style jsx global>{`
        .cc-files-wrap { display: grid; gap: 4px; min-width: 0; }
        .cc-files-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 12px 4px; }
        .cc-files-search { position: relative; display: flex; align-items: center; flex: 0 1 260px; min-width: 0; }
        .cc-files-search .lucide { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
        .cc-files-search .c-input { width: 100%; height: 40px; margin: 0; padding: 0 12px 0 36px; line-height: 40px; }
        .cc-files { list-style: none; margin: 0; padding: 0 4px 4px; display: grid; grid-template-columns: minmax(0, 1fr); }
        .cc-file { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 10px 8px; border-radius: var(--r-row); }
        .cc-file + .cc-file { border-top: 1px solid var(--line); }
        .cc-file-tile { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--olive-tint); color: var(--olive-ink); }
        .cc-file-text { display: grid; gap: 2px; min-width: 0; }
        .cc-file-name { font: 600 15px/1.35 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .cc-file-actions { display: flex; align-items: center; gap: 6px; }
        .cc-file-guide { white-space: nowrap; }
        .cc-none, .cc-error { margin: 0; padding: 8px 16px 14px; }
        .cc-error { color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        @media (max-width: 600px) {
          .cc-file { grid-template-columns: 36px minmax(0, 1fr) auto; gap: 10px; padding: 10px 4px; }
          .cc-file-tile { width: 36px; height: 36px; }
          .cc-file-guide { width: 40px; padding: 0; justify-content: center; }
          .cc-file-guide-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        }
      `}</style>
    </div>
  );
}

// Canvas → Classes: every imported class with its course material and its Cordia class.
export default function CanvasClasses({ status, onStatus }) {
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(() => new Set());
  const [choosing, setChoosing] = useState(false);
  const [view, chooseView] = useListView();
  useEffect(() => { apiFetch('/folders').then(data => setFolders(data?.folders || [])); }, [status?.courses?.length]);

  const imported = (status?.courses || []).filter(course => course.imported);
  const folderFor = course => folders.find(folder => course.class_id && folder.class_id === course.class_id);
  const toggle = id => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="c-stack cc">
      <div className="c-row">
        <span className="c-meta">{imported.length} class{imported.length === 1 ? '' : 'es'} from {status.domain}</span>
        <span className="c-spacer" />
        <button type="button" className="c-btn c-btn--quiet" onClick={() => setChoosing(value => !value)} aria-expanded={choosing}><Settings2 {...ICON} />Choose classes</button>
        {imported.length > 0 && <ViewToggle view={view} onChange={chooseView} />}
      </div>
      {choosing && <div className="c-card cc-choose"><CanvasCourseList courses={status.courses || []} onChange={onStatus} /></div>}
      {!imported.length && !choosing && (
        <div className="c-empty">
          <span className="c-section-title">No classes brought in yet</span>
          <button type="button" className="c-btn c-btn--primary" onClick={() => setChoosing(true)}>Choose classes</button>
        </div>
      )}
      {view === 'cards' && imported.length > 0 && (
        <div className="cc-grid">
          {imported.map(course => {
            const folder = folderFor(course);
            return <ClassCard key={course.id} folder={folder} name={folder?.name || (course.code && !String(course.name || '').includes(course.code) ? `${course.code}: ${course.name || ''}` : course.name || course.code)} href={folder ? '/folder/' + folder.id : undefined} meta={course.term || 'Canvas'} />;
          })}
        </div>
      )}
      {view === 'rows' && imported.map(course => {
        const folder = folderFor(course);
        const expanded = open.has(course.id);
        return (
          <section key={course.id} className="c-card cc-class" aria-label={course.code || course.name}>
            <div className="cc-head">
              <button type="button" className="c-icon-btn" onClick={() => toggle(course.id)} aria-expanded={expanded} aria-label={expanded ? 'Hide course material' : 'Show course material'}>
                <ChevronDown {...ICON} className={expanded ? '' : 'cc-closed'} />
              </button>
              <button type="button" className="cc-name" onClick={() => toggle(course.id)}>
                <strong className="c-truncate">{course.code || course.name}</strong>
                <span className="c-meta c-truncate">{[course.code ? course.name : '', course.term].filter(Boolean).join(' · ')}</span>
              </button>
              {folder && <Link href={'/folder/' + folder.id} className="c-btn c-btn--quiet"><ArrowUpRight {...ICON} />Open class</Link>}
            </div>
            {expanded && <CourseFiles course={course} />}
          </section>
        );
      })}
      <style jsx global>{`
        .cc-choose { padding: 8px 20px; }
        .cc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
        @media (max-width: 767px) { .cc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
        .cc-class { padding: 8px; }
        .cc-head { display: flex; align-items: center; gap: 6px; min-height: 56px; }
        .cc-head .cc-closed { transform: rotate(-90deg); }
        .cc-head .lucide { transition: transform var(--dur) var(--ease); }
        .cc-name { flex: 1; min-width: 0; display: grid; gap: 2px; padding: 6px 4px; border: 0; background: none; color: var(--ink); text-align: left; cursor: pointer; }
        .cc-name strong { font: 600 20px/1.15 var(--font-sans); }
      `}</style>
    </div>
  );
}
