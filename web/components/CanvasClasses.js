import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Download, FileText, Settings2, Sparkles } from 'lucide-react';
import { apiErrorMessage, apiFetch, authorizedFetch } from '../lib/api';
import { openNewSheet } from '../lib/newSheet';
import { SectionLoader } from './CordiaLoader';
import CanvasCourseList from './CanvasCourseList';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function fileSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
function CourseFiles({ course }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    apiFetch(`/canvas/courses/${course.id}/files`).then(data => {
      if (Array.isArray(data?.files)) setFiles(data.files);
      else { setFiles([]); setError(apiErrorMessage(data?.detail, 'Canvas could not list this class’s files.')); }
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
  return (
    <>
      {error && <p className="cc-error" role="alert">{error}</p>}
      {files.length > 0 ? (
        <ul className="cc-files">
          {files.map(file => (
            <li key={file.id} className="cc-file">
              <FileText {...ICON} />
              <span className="cc-file-name c-truncate">{file.name}</span>
              <span className="c-meta cc-file-size">{fileSize(file.size)}</span>
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => act(file, 'guide')} disabled={Boolean(busy)}>
                <Sparkles {...ICON} />{busy === `guide:${file.id}` ? 'Getting it…' : 'Make guide'}
              </button>
              <button type="button" className="c-icon-btn" onClick={() => act(file, 'download')} disabled={Boolean(busy)} aria-label={`Download ${file.name}`}><Download {...ICON} /></button>
            </li>
          ))}
        </ul>
      ) : !error && <p className="c-meta cc-none">No files shared in this class yet.</p>}
    </>
  );
}

// Canvas → Classes: every imported class with its course material and its Cordia class.
export default function CanvasClasses({ status, onStatus }) {
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(() => new Set());
  const [choosing, setChoosing] = useState(false);
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
      </div>
      {choosing && <div className="c-card cc-choose"><CanvasCourseList courses={status.courses || []} onChange={onStatus} /></div>}
      {!imported.length && !choosing && (
        <div className="c-empty">
          <span className="c-section-title">No classes brought in yet</span>
          <button type="button" className="c-btn c-btn--primary" onClick={() => setChoosing(true)}>Choose classes</button>
        </div>
      )}
      {imported.map(course => {
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
        .cc-class { padding: 8px; }
        .cc-head { display: flex; align-items: center; gap: 6px; min-height: 56px; }
        .cc-head .cc-closed { transform: rotate(-90deg); }
        .cc-head .lucide { transition: transform var(--dur) var(--ease); }
        .cc-name { flex: 1; min-width: 0; display: grid; gap: 2px; padding: 6px 4px; border: 0; background: none; color: var(--ink); text-align: left; cursor: pointer; }
        .cc-name strong { font: 600 20px/1.15 var(--font-sans); }
        .cc-files { list-style: none; margin: 0; padding: 0 8px 8px; display: grid; }
        .cc-file { display: flex; align-items: center; gap: 12px; min-height: 56px; border-top: 1px solid var(--line); }
        .cc-file > .lucide { color: var(--olive-ink); flex: 0 0 auto; }
        .cc-file-name { flex: 1; min-width: 0; font: 600 15px/1.3 var(--font-sans); }
        .cc-file-size { white-space: nowrap; }
        .cc-none, .cc-error { margin: 0; padding: 8px 16px 14px; }
        .cc-error { color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        @media (max-width: 600px) { .cc-file-size { display: none; } }
      `}</style>
    </div>
  );
}
