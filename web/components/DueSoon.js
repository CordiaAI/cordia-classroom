import { useRouter } from 'next/router';
import { BookOpen } from 'lucide-react';
import { dueLabel, folderForCode, splitTitle } from '../lib/calendarItems';
import { openNewSheet } from '../lib/newSheet';

// Today: the next deadlines from the Canvas calendar, each with Study.
export default function DueSoon({ items = [], folders = [] }) {
  const router = useRouter();
  const upcoming = items.filter(item => new Date(item.due_at) >= new Date(new Date().setHours(0, 0, 0, 0))).slice(0, 5);
  if (!upcoming.length) return null;
  return (
    <section className="c-card due" aria-labelledby="due-title">
      <h2 id="due-title" className="c-section-title">Due soon</h2>
      <ul className="due-list">
        {upcoming.map(item => {
          const { title, code } = splitTitle(item);
          const folder = folderForCode(folders, code);
          return (
            <li key={item.id} className="due-row">
              <span className="due-main">
                <span className="due-title c-truncate">{title}</span>
                <span className="due-meta">
                  <span className="c-meta due-when">{dueLabel(item)}</span>
                  {code && <span className="class-chip">{code}</span>}
                </span>
              </span>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => (folder ? router.push('/folder/' + folder.id) : openNewSheet())}>
                <BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />Study
              </button>
            </li>
          );
        })}
      </ul>
      <style jsx global>{`
        .due { display: grid; gap: 8px; padding: 20px 24px; }
        .due h2 { margin: 0; }
        .due-list { list-style: none; margin: 0; padding: 0; display: grid; }
        .due-row { display: flex; align-items: center; gap: 12px; min-height: 64px; border-top: 1px solid var(--line); }
        .due-row:first-child { border-top: 0; }
        .due-main { flex: 1; display: grid; gap: 4px; min-width: 0; }
        .due-title { font: 600 15px/1.3 var(--font-sans); color: var(--ink); }
        .due-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .due-when { font-variant-numeric: tabular-nums; }
        .class-chip { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 999px; background: var(--hover); border: 1px solid var(--line); color: var(--ink); font: 600 13px/1 var(--font-sans); white-space: nowrap; }
      `}</style>
    </section>
  );
}
