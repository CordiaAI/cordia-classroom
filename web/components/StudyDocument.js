import { useRef, useState } from 'react';
import { parseQAPairs, parseNotes } from '../lib/formatters';
import WorkspaceIcon from './WorkspaceIcon';

export default function StudyDocument({ guide, onOpen, onRead, onLearn, readSections }) {
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState(100);
  const windowRef = useRef(null);
  const pairs = parseQAPairs(guide?.study_guide);
  const notes = parseNotes(guide?.notes);
  const pages = Math.max(1, Math.ceil(pairs.length / 3));
  const visible = pairs.slice(page * 3, page * 3 + 3);
  function changePage(next) {
    setPage(Math.max(0, Math.min(pages - 1, next)));
    windowRef.current?.querySelector('.document-paper')?.scrollTo({ top: 0 });
  }
  return (
    <section ref={windowRef} className="study-document-window" aria-label="Study document">
      <header className="document-toolbar">
        <span className="document-course"><WorkspaceIcon name="study" />{guide?.className || 'Your study space'}</span>
        <div className="document-toolbar-actions">
          {onOpen && <button type="button" onClick={onOpen} aria-label="Open study guide"><WorkspaceIcon name="study" /></button>}
          <button type="button" onClick={() => { if (document.fullscreenElement) document.exitFullscreen?.(); else windowRef.current?.requestFullscreen?.(); }} aria-label="Expand document">⛶</button>
        </div>
      </header>
      <div className="document-body">
        <nav className="document-thumbnails" aria-label="Document pages">
          {Array.from({ length: pages }, (_, index) => (
            <button key={index} type="button" className={page === index ? 'active' : ''} onClick={() => changePage(index)} aria-label={`Page ${index + 1}`} aria-current={page === index ? 'page' : undefined}>
              <span className="thumbnail-number">{index + 1}</span>
              <span className="thumbnail-paper"><strong>{guide?.title || 'Your first guide'}</strong>{pairs.slice(index * 3, index * 3 + 3).map(pair => <span key={pair.index}><b>{pair.question}</b>{pair.answer}</span>)}</span>
            </button>
          ))}
        </nav>
        <article className="document-paper" style={{ '--document-scale': scale / 100 }}>
          <div className="document-paper-label">Study guide <span>Page {page + 1} of {pages}</span></div>
          <h2>{guide?.title || 'A little focus. A deeper understanding.'}</h2>
          <div className="document-rule" />
          {visible.length ? visible.map((pair, index) => (
            <section className="document-section" key={pair.index}>
              <h3><span>{page * 3 + index + 1}.</span>{pair.question}</h3>
              <p>{pair.answer}</p>
              {pair.image && <img src={pair.image} alt={`Illustration for ${pair.question}`} />}
              {onRead && <button className="document-read" type="button" aria-pressed={readSections?.has(page * 3 + index) || false} onClick={() => onRead(page * 3 + index)}>{readSections?.has(page * 3 + index) ? 'Read' : 'Mark as read'} <span>✓</span></button>}
              {onLearn && <button className="document-read" type="button" onClick={() => onLearn(page * 3 + index)}>Learn it your way <span>→</span></button>}
            </section>
          )) : guide?.study_guide ? <p className="document-prose">{guide.study_guide}</p> : notes.length ? notes.map((note, index) => <p key={index}>{note}</p>) : <div className="document-empty"><WorkspaceIcon name="upload" /><h3>Your next discovery starts here.</h3><p>Bring in your course material. Cordia will help you turn it into understanding.</p>{onOpen && <button type="button" className="btn" onClick={onOpen}>Add study material <WorkspaceIcon name="arrow" /></button>}</div>}
        </article>
      </div>
      <footer className="document-footer">
        <div><button type="button" aria-label="Previous page" disabled={!page} onClick={() => changePage(page - 1)}>‹</button><span>{page + 1} / {pages}</span><button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => changePage(page + 1)}>›</button></div>
        <div><button type="button" aria-label="Zoom out" disabled={scale <= 80} onClick={() => setScale(value => value - 10)}>−</button><span>{scale}%</span><button type="button" aria-label="Zoom in" disabled={scale >= 140} onClick={() => setScale(value => value + 10)}>+</button></div>
      </footer>
    </section>
  );
}
