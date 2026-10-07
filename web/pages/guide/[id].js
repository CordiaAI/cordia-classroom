import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { parseQAPairs, parseNotes, formatDate } from '../../lib/formatters';
import useSessionTracker from '../../lib/useSessionTracker';
import AILoadingSphere from '../../components/AILoadingSphere';
import StudyAidPanel from '../../components/StudyAidPanel';
import StudyDocument from '../../components/StudyDocument';
import { useLearningStyle } from '../../lib/learningStyle';

export default function GuidePage() {
  const router = useRouter();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  useSessionTracker('read', id || null);
  const [guide, setGuide] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('guide');
  const [revealedQs, setRevealedQs] = useState(new Set());
  const [quizHistory, setQuizHistory] = useState([]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const prevRevealed = useRef(0);
  const { learningStyle } = useLearningStyle();
  const [openAid, setOpenAid] = useState(null);

  useEffect(() => {
    if (ready && id) {
      loadGuide();
      loadQuizHistory();
    }
  }, [ready, id]);

  // Save read progress when revealed count changes
  useEffect(() => {
    if (!guide || !id) return;
    const qaPairs = parseQAPairs(guide.study_guide);
    if (qaPairs.length === 0) return;
    const progress = revealedQs.size / qaPairs.length;
    if (revealedQs.size > prevRevealed.current) {
      prevRevealed.current = revealedQs.size;
      apiFetch('/guides/' + id + '/read-progress', {
        method: 'PATCH',
        body: JSON.stringify({ read_progress: progress })
      });
    }
  }, [revealedQs]);

  async function loadGuide() {
    setLoadError('');
    const data = await apiFetch('/guides/' + id);
    if (data?.guide) {
      setGuide(data.guide);
    } else {
      setLoadError(apiErrorMessage(data?.detail, 'This study guide could not be loaded.'));
    }
  }

  async function loadQuizHistory() {
    const data = await apiFetch('/quiz/' + id + '/history');
    if (data?.attempts) setQuizHistory(data.attempts);
  }

  async function toggleBookmark() {
    const data = await apiFetch('/guides/' + id + '/bookmark', { method: 'PATCH' });
    if (data) setGuide(prev => ({ ...prev, is_bookmarked: data.is_bookmarked }));
  }

  if (loadError && !guide) return (
    <div className="empty-state" role="alert">
      <h2>Study guide unavailable</h2>
      <p>{loadError}</p>
      <div className="resource-load-actions">
        <button type="button" className="btn" onClick={loadGuide}>Try again</button>
        <button type="button" className="btn-outline" onClick={() => router.push('/dashboard?view=guides')}>Back to Study Guides</button>
      </div>
    </div>
  );

  if (!guide) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
      <AILoadingSphere />
    </div>
  );

  const qaPairs = parseQAPairs(guide.study_guide);
  const notes = parseNotes(guide.notes);
  const flashcards = guide.flashcards || [];
  const sourceTitle = guide.source_title || (guide.source_url ? 'Original source' : '');
  const externalSourceUrl = /^https?:\/\//i.test(guide.source_url || '') ? guide.source_url : '';
  const sourceHref = externalSourceUrl
    || (guide.source_type === 'smartnote' && guide.source_id ? `/smartnotes?id=${guide.source_id}` : '')
    || (guide.source_type === 'study_guide' && guide.source_id ? `/guide/${guide.source_id}` : '');
  const fcProgress = guide.flashcard_progress || {};
  const tabs = [
    { key: 'guide', label: 'Study Guide' },
    { key: 'notes', label: 'Notes' },
    { key: 'flashcards', label: `Flashcards (${flashcards.length})` },
    { key: 'quiz', label: 'Retain' },
    { key: 'practice', label: 'Practice' },
  ];

  return (
    <article className="guide-reader-window">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <a href="#" onClick={e => { e.preventDefault(); router.back(); }} style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
            &larr; Back
          </a>
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  const data = await apiFetch('/guides/' + id + '/rename', {
                    method: 'PATCH',
                    body: JSON.stringify({ title: renameValue.trim() })
                  });
                  if (data?.title) setGuide(prev => ({ ...prev, title: data.title }));
                  setIsRenaming(false);
                } else if (e.key === 'Escape') {
                  setIsRenaming(false);
                }
              }}
              onBlur={() => setIsRenaming(false)}
              style={{ fontSize: '1.5em', fontWeight: 700, background: 'var(--bg-tertiary)', border: '1px solid var(--border-active)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-primary)', width: '100%', marginTop: 8 }}
            />
          ) : (
            <h2 style={{ marginTop: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => { setRenameValue(guide.title); setIsRenaming(true); }}
            >
              {guide.title}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </h2>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginTop: 4 }}>
            {sourceTitle && <span className="guide-source">Based on {sourceHref
              ? <a href={sourceHref} target={externalSourceUrl ? '_blank' : undefined} rel={externalSourceUrl ? 'noopener noreferrer' : undefined}>{sourceTitle}</a>
              : sourceTitle} · </span>}
            <span className="timestamp">{formatDate(guide.created_at)}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button
            className="btn"
            onClick={() => router.push('/create?editGuideId=' + id)}
            style={{ padding: '6px 14px', fontSize: '0.8em' }}
          >
            Edit Guide
          </button>
          <button className={'bookmark-btn' + (guide.is_bookmarked ? ' active' : '')} onClick={toggleBookmark} style={{ fontSize: '1.6em' }}>
            {guide.is_bookmarked ? '\u2605' : '\u2606'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ alignItems: 'flex-end' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={'tab-btn' + (activeTab === tab.key ? ' active' : '')}
            aria-pressed={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <details className="reader-more-tools">
          <summary>More</summary>
          <button type="button" className="tab-btn" onClick={() => setActiveTab('nclex')}>NCLEX Mode</button>
        </details>
      </div>

      <div key={activeTab} className="study-tab-content">
      {/* Tab content */}
      {activeTab === 'guide' && (
        <>
          <StudyDocument key={guide.id} guide={guide} readSections={revealedQs} onLearn={learningStyle?.enabled ? index => setOpenAid(qaPairs[index].index) : undefined} onRead={index => {
            setRevealedQs(previous => new Set([...previous, index]));
          }} />
          {learningStyle?.enabled && qaPairs.length > 0 && <div className="reader-learning-aids">
            {openAid && <StudyAidPanel guideId={id} number={openAid} style={learningStyle.style} onClose={() => setOpenAid(null)} />}
          </div>}
        </>
      )}

      {activeTab === 'notes' && (
        <div className="guide-content">
          {notes.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>No notes available.</span>
          ) : (
            <ul className="notes-list">
              {notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'flashcards' && (
        <div>
          {flashcards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">&#127183;</div>
              No flashcards for this guide.
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                {flashcards.length} flashcards available.
                {fcProgress.known && <span> {fcProgress.known.length} mastered.</span>}
              </p>
              <button className="btn" onClick={() => router.push('/flashcards/study?guideId=' + id)}>
                Start Study Session
              </button>
              <div style={{ marginTop: 20 }}>
                {flashcards.slice(0, 5).map((fc, i) => (
                  <div key={i} className="fc-hub-card">
                    <span style={{ color: 'var(--text-primary)' }}>{fc.front}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>Card {i + 1}</span>
                  </div>
                ))}
                {flashcards.length > 5 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginTop: 8 }}>
                    +{flashcards.length - 5} more cards
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'quiz' && (
        <div>
          {qaPairs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">&#128221;</div>
              No Q&A pairs to generate a Retain session from.
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                Retain session generated from {qaPairs.length} questions in your study guide.
              </p>
              <button className="btn" onClick={() => router.push('/quiz/' + id)}>
                Start Quiz
              </button>
              {quizHistory.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h3 style={{ fontSize: '1em', marginBottom: 10, color: 'var(--text-secondary)' }}>Past Attempts</h3>
                  {quizHistory.map((a, i) => (
                    <div key={i} className="fc-hub-card">
                      <span style={{ color: 'var(--text-primary)' }}>Score: {a.score}%</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>
                        {a.correct_answers}/{a.total_questions} correct | {formatDate(a.completed_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'practice' && (
        <div className="practice-tab-intro">
          <h3>Work the problem, not just the flashcard.</h3>
          <p>
            Generate 10 source-grounded problems or scenarios, keep this guide visible,
            and use a touch-ready workspace to draw, type, and arrange symbols.
          </p>
          <button className="btn" onClick={() => router.push('/practice/' + id)}>
            Open practice workspace
          </button>
        </div>
      )}

      {activeTab === 'nclex' && (
        <div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
            Practice with AI-generated NCLEX-style clinical scenario questions based on your study material.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginBottom: 20 }}>
            Includes Multiple Choice and Select All That Apply (SATA) with rationales for each question.
          </p>
          <button className="btn" onClick={() => router.push('/nclex/' + id)}>
            Start NCLEX Practice
          </button>
        </div>
      )}
      </div>
    </article>
  );
}
