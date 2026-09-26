import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AILoadingSphere from '../../components/AILoadingSphere';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { formatDate } from '../../lib/formatters';

const practiceModes = [
  {
    key: 'work',
    step: '01',
    label: 'Work it out',
    description: 'Generate open-ended problems, then write, draw, or solve before checking the answer.',
    action: 'Open workspace',
  },
  {
    key: 'cards',
    step: '02',
    label: 'Recall with cards',
    description: 'Answer from memory before revealing each card. Keep the difficult ideas in rotation.',
    action: 'Study cards',
  },
  {
    key: 'quiz',
    step: '03',
    label: 'Test yourself',
    description: 'Take a focused quiz, get immediate feedback, and find what needs another pass.',
    action: 'Start quiz',
  },
];

const practiceLoop = [
  ['Recall', 'Try before reopening notes.'],
  ['Work', 'Write, draw, explain, or solve.'],
  ['Check', 'Compare and correct the gap.'],
  ['Return', 'Practice it again after a break.'],
];

export default function PracticeHub() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [guides, setGuides] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedGuideId, setSelectedGuideId] = useState('');
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready) loadLibrary();
  }, [ready]);

  async function loadLibrary() {
    setLoading(true);
    setError('');
    try {
      const [guideData, folderData] = await Promise.all([
        apiFetch('/guides'),
        apiFetch('/folders'),
      ]);
      const nextGuides = [...(guideData?.guides || [])]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setGuides(nextGuides);
      setFolders(folderData?.folders || []);
      setSelectedGuideId(current => current || String(nextGuides[0]?.id || ''));
    } catch (err) {
      setError(apiErrorMessage(err?.message || err, 'We could not load your study material.'));
    } finally {
      setLoading(false);
    }
  }

  const folderNames = useMemo(
    () => new Map(folders.map(folder => [String(folder.id), folder.name])),
    [folders]
  );

  const filteredGuides = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return guides.filter(guide => {
      const className = folderNames.get(String(guide.folder_id)) || 'No class';
      const matchesQuery = !normalizedQuery
        || guide.title?.toLowerCase().includes(normalizedQuery)
        || className.toLowerCase().includes(normalizedQuery);
      const matchesFolder = folderFilter === 'all'
        || (folderFilter === 'unassigned' ? !guide.folder_id : String(guide.folder_id) === folderFilter);
      return matchesQuery && matchesFolder;
    });
  }, [folderFilter, folderNames, guides, query]);

  const selectedGuide = filteredGuides.find(guide => String(guide.id) === selectedGuideId)
    || filteredGuides[0]
    || null;

  function openMode(mode) {
    if (!selectedGuide) return;
    if (mode === 'work') router.push(`/practice/${selectedGuide.id}`);
    if (mode === 'cards') router.push(`/flashcards/study?guideId=${selectedGuide.id}`);
    if (mode === 'quiz') router.push(`/quiz/${selectedGuide.id}`);
  }

  if (!ready || loading) {
    return (
      <div className="practice-loading">
        <AILoadingSphere size={92} />
        <p>Opening your practice library...</p>
        <style jsx>{`
          .practice-loading { min-height: 65vh; display: grid; place-content: center; justify-items: center; gap: 14px; color: var(--text-muted); }
          .practice-loading p { margin: 0; font-weight: 650; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="practice-hub fade-in">
      <section className="practice-hero">
        <div className="practice-hero-copy">
          <span className="practice-eyebrow">Practice</span>
          <h1>Turn studying into doing.</h1>
          <p>Choose material, retrieve what you know, check the gap, and return later.</p>
        </div>
        {selectedGuide && (
          <button className="practice-primary" type="button" onClick={() => openMode('work')}>
            Start open-ended practice
            <span aria-hidden="true">&#8599;</span>
          </button>
        )}
      </section>

      <section className="practice-loop" aria-label="Effective practice loop">
        {practiceLoop.map(([title, detail], index) => (
          <div className="practice-loop-step" key={title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{title}</strong><p>{detail}</p></div>
          </div>
        ))}
      </section>

      {error ? (
        <section className="practice-message" role="alert">
          <strong>Practice is temporarily unavailable.</strong>
          <p>{error}</p>
          <button type="button" onClick={loadLibrary}>Try again</button>
        </section>
      ) : guides.length === 0 ? (
        <section className="practice-empty">
          <span className="practice-eyebrow">Your first round</span>
          <h2>Add material before you practice.</h2>
          <p>Create a guide from notes or a file, then return here to recall, work, and test the ideas.</p>
          <button className="practice-primary" type="button" onClick={() => router.push('/create')}>Create a study guide</button>
        </section>
      ) : (
        <section className="practice-layout">
          <div className="practice-library-panel">
            <div className="practice-section-heading">
              <div>
                <span className="practice-eyebrow">Your material</span>
                <h2>Choose what to practice</h2>
              </div>
              <span className="practice-count">{filteredGuides.length}</span>
            </div>

            <div className="practice-filters">
              <label>
                <span className="sr-only">Search study guides</span>
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guides or classes" />
              </label>
              <label>
                <span className="sr-only">Filter by class</span>
                <select value={folderFilter} onChange={event => setFolderFilter(event.target.value)}>
                  <option value="all">All classes</option>
                  {folders.map(folder => <option key={folder.id} value={String(folder.id)}>{folder.name}</option>)}
                  <option value="unassigned">No class</option>
                </select>
              </label>
            </div>

            <div className="practice-guide-list">
              {filteredGuides.map(guide => {
                const active = selectedGuide && String(guide.id) === String(selectedGuide.id);
                const progress = Math.round((guide.read_progress || 0) * 100);
                return (
                  <button
                    type="button"
                    className={`practice-guide${active ? ' active' : ''}`}
                    aria-pressed={active}
                    key={guide.id}
                    onClick={() => setSelectedGuideId(String(guide.id))}
                  >
                    <span className="practice-guide-index" aria-hidden="true">{active ? '\u2713' : ' '}</span>
                    <span className="practice-guide-copy">
                      <strong>{guide.title || 'Untitled study guide'}</strong>
                      <small>{folderNames.get(String(guide.folder_id)) || 'No class'} · {formatDate(guide.created_at)}</small>
                    </span>
                    <span className="practice-guide-progress">{progress}% read</span>
                  </button>
                );
              })}
              {filteredGuides.length === 0 && (
                <div className="practice-no-results">No material matches that search.</div>
              )}
            </div>
          </div>

          <aside className="practice-action-panel" aria-live="polite">
            <div className="practice-selected">
              <span className="practice-eyebrow">Selected material</span>
              <h2>{selectedGuide?.title || 'Choose a study guide'}</h2>
              {selectedGuide && <p>{folderNames.get(String(selectedGuide.folder_id)) || 'No class'}</p>}
            </div>

            <div className="practice-mode-list">
              {practiceModes.map(mode => (
                <button type="button" key={mode.key} disabled={!selectedGuide} onClick={() => openMode(mode.key)}>
                  <span className="practice-mode-number">{mode.step}</span>
                  <span className="practice-mode-copy"><strong>{mode.label}</strong><small>{mode.description}</small></span>
                  <span className="practice-mode-action">{mode.action} &#8594;</span>
                </button>
              ))}
            </div>

            <p className="practice-note">Try first without notes. Use the source only after you have made an honest attempt.</p>
          </aside>
        </section>
      )}

      <style jsx>{`
        .practice-hub { width: min(1420px, calc(100% - 48px)); margin: 0 auto; padding: 34px 0 72px; color: var(--text-primary); }
        .practice-hero, .practice-loop, .practice-library-panel, .practice-action-panel, .practice-empty, .practice-message { background: #fff; border: 1px solid rgba(42, 45, 38, 0.13); box-shadow: 0 18px 48px rgba(24, 28, 20, 0.08); }
        .practice-hero { min-height: 236px; border-radius: 30px; padding: clamp(30px, 4vw, 58px); display: flex; align-items: flex-end; justify-content: space-between; gap: 36px; }
        .practice-hero-copy { max-width: 790px; }
        .practice-eyebrow { display: block; color: var(--olive); font-size: 0.76rem; font-weight: 850; letter-spacing: 0.15em; text-transform: uppercase; }
        h1 { margin: 12px 0 12px; max-width: 780px; font-size: clamp(2.55rem, 5vw, 5.35rem); line-height: 0.94; letter-spacing: -0.055em; }
        .practice-hero p { margin: 0; color: var(--text-secondary); font-size: clamp(1rem, 1.7vw, 1.25rem); line-height: 1.55; }
        .practice-primary { min-height: 54px; display: inline-flex; align-items: center; justify-content: center; gap: 28px; padding: 0 22px; border: 1px solid #11120f; border-radius: 15px; background: #11120f; color: #fff; box-shadow: 0 12px 25px rgba(17, 18, 15, 0.17); font: inherit; font-weight: 800; white-space: nowrap; cursor: pointer; transition: transform 150ms ease, box-shadow 150ms ease; }
        .practice-primary:hover { transform: translateY(-2px); box-shadow: 0 16px 32px rgba(17, 18, 15, 0.22); }
        .practice-primary:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid color-mix(in srgb, var(--olive) 32%, transparent); outline-offset: 2px; }

        .practice-loop { margin-top: 18px; border-radius: 22px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; }
        .practice-loop-step { min-height: 108px; display: flex; align-items: flex-start; gap: 16px; padding: 24px; border-right: 1px solid rgba(42, 45, 38, 0.11); }
        .practice-loop-step:last-child { border-right: 0; }
        .practice-loop-step > span { color: var(--olive); font-size: 0.75rem; font-weight: 850; letter-spacing: 0.08em; }
        .practice-loop-step strong { display: block; font-size: 1rem; }
        .practice-loop-step p { margin: 7px 0 0; color: var(--text-secondary); font-size: 0.84rem; line-height: 1.4; }

        .practice-layout { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.8fr); gap: 22px; align-items: start; }
        .practice-library-panel, .practice-action-panel { border-radius: 26px; padding: 28px; }
        .practice-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
        .practice-section-heading h2, .practice-selected h2, .practice-empty h2 { margin: 8px 0 0; font-size: clamp(1.55rem, 2.4vw, 2.25rem); line-height: 1.05; letter-spacing: -0.035em; }
        .practice-count { min-width: 42px; min-height: 42px; display: grid; place-items: center; border-radius: 50%; background: #f2f3ef; color: #11120f; font-weight: 850; }
        .practice-filters { margin: 24px 0 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 0.34fr); gap: 10px; }
        .practice-filters input, .practice-filters select { width: 100%; height: 48px; border: 1px solid rgba(42, 45, 38, 0.18); border-radius: 13px; background: #fff; color: #11120f; padding: 0 14px; font: inherit; font-weight: 650; }
        .practice-guide-list { display: grid; gap: 9px; max-height: 508px; overflow-y: auto; overscroll-behavior: contain; padding-right: 3px; }
        .practice-guide { width: 100%; min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 13px; padding: 16px; border: 1px solid rgba(42, 45, 38, 0.12); border-radius: 15px; background: #fff; color: #11120f; text-align: left; cursor: pointer; transition: border-color 150ms ease, background 150ms ease, transform 150ms ease; }
        .practice-guide:hover { border-color: rgba(42, 45, 38, 0.33); transform: translateY(-1px); }
        .practice-guide.active { border-color: var(--olive); background: #f7f8f4; }
        .practice-guide-index { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid rgba(42, 45, 38, 0.18); border-radius: 50%; color: #fff; font-size: 0.72rem; }
        .practice-guide.active .practice-guide-index { border-color: var(--olive); background: var(--olive); }
        .practice-guide-copy { min-width: 0; }
        .practice-guide-copy strong, .practice-guide-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .practice-guide-copy strong { font-size: 0.95rem; }
        .practice-guide-copy small { margin-top: 5px; color: var(--text-secondary); font-size: 0.75rem; }
        .practice-guide-progress { color: var(--text-secondary); font-size: 0.73rem; font-weight: 750; }
        .practice-no-results { min-height: 120px; display: grid; place-items: center; color: var(--text-secondary); text-align: center; }

        .practice-action-panel { position: sticky; top: 108px; }
        .practice-selected { padding: 2px 2px 22px; border-bottom: 1px solid rgba(42, 45, 38, 0.12); }
        .practice-selected p { margin: 9px 0 0; color: var(--text-secondary); }
        .practice-mode-list { margin-top: 18px; display: grid; gap: 10px; }
        .practice-mode-list button { width: 100%; min-width: 0; display: grid; grid-template-columns: 37px minmax(0, 1fr); gap: 14px; padding: 18px; border: 1px solid rgba(42, 45, 38, 0.14); border-radius: 16px; background: #fff; color: #11120f; text-align: left; cursor: pointer; transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
        .practice-mode-list button:hover { transform: translateY(-2px); border-color: var(--olive); box-shadow: 0 11px 26px rgba(24, 28, 20, 0.09); }
        .practice-mode-number { padding-top: 2px; color: var(--olive); font-size: 0.72rem; font-weight: 850; letter-spacing: 0.08em; }
        .practice-mode-copy strong, .practice-mode-copy small { display: block; }
        .practice-mode-copy strong { font-size: 1rem; }
        .practice-mode-copy small { margin-top: 6px; color: var(--text-secondary); font-size: 0.79rem; line-height: 1.45; }
        .practice-mode-action { grid-column: 2; margin-top: 2px; color: var(--olive); font-size: 0.78rem; font-weight: 850; }
        .practice-note { margin: 18px 2px 2px; color: var(--text-secondary); font-size: 0.78rem; line-height: 1.5; }

        .practice-empty, .practice-message { margin-top: 22px; border-radius: 26px; padding: 44px; }
        .practice-empty p, .practice-message p { max-width: 660px; color: var(--text-secondary); line-height: 1.55; }
        .practice-empty .practice-primary { margin-top: 10px; }
        .practice-message strong { font-size: 1.25rem; }
        .practice-message button { min-height: 44px; padding: 0 18px; border: 1px solid #11120f; border-radius: 12px; background: #11120f; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

        :global([data-theme='dark']) .practice-hero,
        :global([data-theme='dark']) .practice-loop,
        :global([data-theme='dark']) .practice-library-panel,
        :global([data-theme='dark']) .practice-action-panel,
        :global([data-theme='dark']) .practice-empty,
        :global([data-theme='dark']) .practice-message,
        :global([data-theme='dark']) .practice-guide,
        :global([data-theme='dark']) .practice-mode-list button,
        :global([data-theme='dark']) .practice-filters input,
        :global([data-theme='dark']) .practice-filters select { background: var(--surface); color: var(--text-primary); }
        :global([data-theme='dark']) .practice-guide.active { background: color-mix(in srgb, var(--olive) 18%, var(--surface)); }

        @media (max-width: 1000px) {
          .practice-hub { width: min(100% - 30px, 900px); }
          .practice-hero { align-items: flex-start; flex-direction: column; }
          .practice-loop { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .practice-loop-step:nth-child(2) { border-right: 0; }
          .practice-loop-step:nth-child(-n + 2) { border-bottom: 1px solid rgba(42, 45, 38, 0.11); }
          .practice-layout { grid-template-columns: 1fr; }
          .practice-action-panel { position: static; }
        }
        @media (max-width: 620px) {
          .practice-hub { width: min(100% - 20px, 580px); padding-top: 18px; }
          .practice-hero, .practice-library-panel, .practice-action-panel, .practice-empty, .practice-message { border-radius: 21px; padding: 22px; }
          .practice-hero { min-height: 0; }
          .practice-primary { width: 100%; justify-content: space-between; }
          .practice-loop { grid-template-columns: 1fr; }
          .practice-loop-step { min-height: 0; border-right: 0; border-bottom: 1px solid rgba(42, 45, 38, 0.11); }
          .practice-loop-step:last-child { border-bottom: 0; }
          .practice-filters { grid-template-columns: 1fr; }
          .practice-guide { grid-template-columns: 28px minmax(0, 1fr); }
          .practice-guide-progress { display: none; }
        }
      `}</style>
    </div>
  );
}
