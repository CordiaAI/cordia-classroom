import { useEffect, useState } from 'react';
import { Brain, CalendarDays, Check, Layers, MessageCircle, NotebookPen, Upload, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { readUserValue, writeUserValue } from '../lib/userStore';
import { openNewSheet } from '../lib/newSheet';

// Six first things, each ticked from real use. Dismissible, and gone once all are done.
export default function GettingStarted({ guides, stats, insights, notesCount, calendarConnected, navigate }) {
  const [tutorUsed, setTutorUsed] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(Boolean(readUserValue('cordiaGetStartedDismissed', false)));
    apiFetch('/tutor/session').then(session => {
      setTutorUsed(Boolean(session?.messages?.some(message => message.role === 'user')));
    });
  }, []);

  const latest = guides?.[0]?.id;
  const items = [
    { key: 'material', label: 'Add material', icon: Upload, done: guides.length > 0, go: () => openNewSheet() },
    { key: 'quiz', label: 'Take a quiz', icon: Brain, done: (insights?.answered || 0) > 0 || (stats?.avg_quiz_score || 0) > 0, go: () => navigate(latest ? `/quiz/${latest}` : '/library') },
    { key: 'tutor', label: 'Ask the Tutor', icon: MessageCircle, done: tutorUsed, go: () => navigate('/tutor') },
    { key: 'cards', label: 'Study cards', icon: Layers, done: (stats?.cards_studied || 0) > 0, go: () => navigate(latest ? `/flashcards/study?guideId=${latest}` : '/library?tab=cards') },
    { key: 'calendar', label: 'Connect Calendar', icon: CalendarDays, done: calendarConnected, go: () => navigate('/calendar') },
    { key: 'note', label: 'Write a note', icon: NotebookPen, done: notesCount > 0, go: () => navigate('/smartnotes') },
  ];
  const done = items.filter(item => item.done).length;
  if (dismissed || done === items.length) return null;

  function dismiss() {
    writeUserValue('cordiaGetStartedDismissed', true);
    setDismissed(true);
  }

  return (
    <section className="c-card started" aria-labelledby="started-title">
      <header className="c-row">
        <h2 id="started-title" className="c-section-title">Get started</h2>
        <span className="c-meta">{done} of {items.length}</span>
        <span className="c-spacer" />
        <button type="button" className="c-icon-btn" onClick={dismiss} aria-label="Hide Get started"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      </header>
      <ul className="started-grid">
        {items.map(item => (
          <li key={item.key}>
            <button type="button" className={'started-item' + (item.done ? ' is-done' : '')} onClick={item.go} aria-label={`${item.label}${item.done ? ', done' : ''}`}>
              <span className="started-check" aria-hidden="true">{item.done ? <Check size={18} strokeWidth={2} /> : <item.icon size={20} strokeWidth={1.75} />}</span>
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <style jsx>{`
        .started { display: grid; gap: 12px; padding: 20px; }
        .started-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .started-item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--r-input); background: var(--card); color: var(--ink); font: 600 15px/1.2 var(--font-sans); text-align: left; cursor: pointer; }
        .started-item:hover { border-color: var(--olive); }
        .started-check { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .is-done .started-check { background: var(--olive); color: var(--on-olive); }
        @media (max-width: 767px) { .started-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
    </section>
  );
}
