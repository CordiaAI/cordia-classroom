import { formatDate } from '../lib/formatters';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import CalendarDashboard from './CalendarDashboard';

function Stat({ value, label }) {
  return (
    <div className="overview-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function DashboardOverview({ folders, guides, stats, navigate }) {
  const overview = createDashboardOverview(folders, guides);
  const current = overview.continueGuide;
  const progress = Math.round(Number(current?.read_progress || 0) * 100);

  return (
    <div className="student-overview fade-in">
      <header className="overview-heading">
        <div>
          <span className="overview-eyebrow">Your dashboard</span>
          <h1>What will you learn next?</h1>
          <p>Continue where you left off, check what is due, or start something new.</p>
        </div>
        <button type="button" className="overview-primary" onClick={() => navigate('/create')}>New study guide</button>
      </header>

      <div className="overview-priority-grid">
        <section className="continue-card">
          {current ? (
            <>
              <span className="overview-eyebrow">{progress > 0 ? 'Continue studying' : 'Latest material'}</span>
              <h2>{current.title || 'Untitled study guide'}</h2>
              <p>{progress > 0 ? `${progress}% read · Open the guide when you are ready to continue.` : 'Your newest study guide is ready to open.'}</p>
              {progress > 0 && <div className="continue-progress" aria-label={`${progress}% read`}><span style={{ width: `${progress}%` }} /></div>}
              <div className="overview-actions">
                <button type="button" className="overview-primary" onClick={() => navigate(`/guide/${current.id}`)}>Open guide</button>
                {overview.reviewGuide && (
                  <button type="button" className="overview-secondary" onClick={() => navigate(`/flashcards/study?guideId=${overview.reviewGuide.id}`)}>Review cards</button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="overview-eyebrow">Start here</span>
              <h2>Turn course material into your first study guide.</h2>
              <p>Create one in Classroom or capture a page with the browser extension.</p>
              <div className="overview-actions">
                <button type="button" className="overview-primary" onClick={() => navigate('/create')}>Create a guide</button>
                <button type="button" className="overview-secondary" onClick={() => navigate('/install-extension')}>Capture a page</button>
              </div>
            </>
          )}
        </section>

        <CalendarDashboard compact onOpenCalendar={() => navigate('/dashboard?view=calendar')} />
      </div>

      <section className="recent-material">
        <header>
          <div>
            <span className="overview-eyebrow">Your library</span>
            <h2>Recent material</h2>
          </div>
          <button type="button" onClick={() => navigate('/dashboard?view=guides')}>View all</button>
        </header>
        {overview.recentGuides.length ? (
          <div className="recent-list">
            {overview.recentGuides.map(guide => (
              <button type="button" key={guide.id} onClick={() => navigate(`/guide/${guide.id}`)}>
                <span className="recent-guide-mark" aria-hidden="true">Guide</span>
                <span className="recent-guide-copy">
                  <strong>{guide.title || 'Untitled study guide'}</strong>
                  <small>{guide.className} · {formatDate(guide.created_at)}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="recent-empty">Your recent study guides will appear here.</p>
        )}
      </section>

      {stats && (
        <section className="overview-snapshot" aria-label="Study snapshot">
          <Stat value={stats.total_guides || 0} label="Guides" />
          <Stat value={stats.total_flashcards || 0} label="Flashcards" />
          <Stat value={`${stats.avg_quiz_score || 0}%`} label="Quiz average" />
          <Stat value={stats.minutes_today || 0} label="Minutes today" />
        </section>
      )}

      <style jsx global>{`
        .student-overview { display: grid; gap: 22px; min-width: 0; }
        .overview-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 4px 2px 0; }
        .overview-heading h1 { margin: 5px 0 6px; max-width: 720px; font-size: clamp(2.1rem, 4vw, 4.15rem); line-height: .94; letter-spacing: -.065em; }
        .overview-heading p, .continue-card p { margin: 0; color: var(--text-muted); line-height: 1.55; }
        .overview-eyebrow { color: var(--accent); font-size: .69rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
        .overview-primary, .overview-secondary { border: 1px solid var(--border-default); border-radius: 14px; padding: 12px 18px; font: inherit; font-weight: 750; cursor: pointer; transition: transform .16s ease, box-shadow .16s ease; }
        .overview-primary { color: white; background: var(--ink); border-color: var(--ink); box-shadow: 0 10px 22px rgba(23, 25, 21, .12); }
        .overview-secondary { color: var(--ink); background: var(--surface); }
        .overview-primary:hover, .overview-secondary:hover { transform: translateY(-1px); }
        .overview-priority-grid { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(300px, .82fr); gap: 18px; align-items: stretch; }
        .continue-card, .recent-material, .overview-snapshot { border: 1px solid var(--border-default); border-radius: 28px; background: var(--surface); box-shadow: var(--shadow-md); }
        .continue-card { display: flex; min-height: 255px; flex-direction: column; justify-content: center; padding: clamp(24px, 4vw, 42px); overflow: hidden; }
        .continue-card h2 { margin: 9px 0 10px; max-width: 680px; font-size: clamp(1.7rem, 3vw, 2.55rem); line-height: 1.03; letter-spacing: -.045em; overflow-wrap: anywhere; }
        .continue-progress { height: 6px; max-width: 420px; margin: 20px 0 0; overflow: hidden; border-radius: 999px; background: var(--bg-hover); }
        .continue-progress span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
        .overview-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
        .recent-material { padding: 24px; }
        .recent-material > header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
        .recent-material h2 { margin: 4px 0 0; font-size: 1.45rem; letter-spacing: -.035em; }
        .recent-material > header button { border: 0; color: var(--accent); background: transparent; font: inherit; font-size: .78rem; font-weight: 750; cursor: pointer; }
        .recent-list { display: grid; }
        .recent-list button { display: flex; align-items: center; gap: 13px; min-width: 0; padding: 14px 0; border: 0; border-top: 1px solid var(--border-default); color: var(--ink); background: transparent; text-align: left; cursor: pointer; }
        .recent-guide-mark { flex: 0 0 auto; padding: 6px 9px; border-radius: 999px; color: var(--accent); background: var(--bg-hover); font-size: .62rem; font-weight: 800; text-transform: uppercase; }
        .recent-guide-copy { display: grid; flex: 1; min-width: 0; gap: 3px; }
        .recent-guide-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recent-guide-copy small, .recent-empty { color: var(--text-muted); }
        .recent-empty { margin: 8px 0 0; }
        .overview-snapshot { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; }
        .overview-stat { display: grid; gap: 3px; padding: 18px 22px; border-left: 1px solid var(--border-default); }
        .overview-stat:first-child { border-left: 0; }
        .overview-stat strong { font-size: 1.25rem; }
        .overview-stat span { color: var(--text-muted); font-size: .7rem; font-weight: 650; }
        @media (max-width: 940px) {
          .overview-priority-grid { grid-template-columns: 1fr; }
          .overview-heading { align-items: flex-start; flex-direction: column; }
        }
        @media (max-width: 620px) {
          .student-overview { gap: 15px; }
          .overview-heading h1 { font-size: 2.35rem; }
          .continue-card, .recent-material { border-radius: 22px; }
          .overview-snapshot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .overview-stat:nth-child(3) { border-left: 0; border-top: 1px solid var(--border-default); }
          .overview-stat:nth-child(4) { border-top: 1px solid var(--border-default); }
        }
      `}</style>
    </div>
  );
}
