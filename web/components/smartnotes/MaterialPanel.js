import { useEffect, useRef, useState } from 'react';
import { useFileDropZone } from '../../lib/fileDrop';
import { notesRequest } from '../../lib/smartnotes';
import FileViewer, { ACCEPTED_FILE_TYPES } from './FileViewer';

// Class material beside the notes: an opened or dropped file, or one of the student's study guides.
export default function MaterialPanel({ onError }) {
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

  // Study guides for the picker
  useEffect(() => {
    notesRequest('/guides?limit=50')
      .then(data => setGuideList(data.guides || []))
      .catch(caught => onError(caught.message));
  }, []);

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

  return (
    <div
      ref={viewerWrapRef}
      className={`sn-viewer-wrap${viewerDragOver ? ' sn-viewer-drag' : ''}`}
    >
      <div className="sn-viewer-toolbar">
        <span className="sn-panel-label">Class Material</span>
        <div className="sn-viewer-controls">
          <button className="btn sn-open-btn" onClick={() => fileInputRef.current?.click()}>
            Open File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {guideList.length > 0 && (
            <select className="sn-guide-select" onChange={handleGuideSelect} defaultValue="">
              <option value="" disabled>View a study guide…</option>
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
            <p>Open or drag &amp; drop a PDF, PowerPoint, document, or image — or select a study guide above.</p>
          </div>
        )}
        {viewerDragOver && (
          <div className="sn-viewer-drop-overlay">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Drop to open</p>
          </div>
        )}
        <FileViewer file={viewerFile} guideContent={guideContent} />
      </div>
    </div>
  );
}
