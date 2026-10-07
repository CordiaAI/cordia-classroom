import { useEffect, useState } from 'react';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { apiFetch } from '../lib/api';
import StudyDocument from './StudyDocument';
import AIChatWidget from './AIChatWidget';
import WorkspaceIcon from './WorkspaceIcon';

export default function DashboardOverview({ folders, guides, navigate }) {
  const overview = createDashboardOverview(folders, guides);
  const current = overview.continueGuide;
  const [material, setMaterial] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setMaterial(null);
    if (current?.id) apiFetch('/guides/' + current.id).then(data => { if (!cancelled && data?.guide) setMaterial(data.guide); });
    return () => { cancelled = true; };
  }, [current?.id]);
  const guide = current ? { ...current, ...material, className: folders.find(folder => folder.id === current.folder_id)?.name } : null;
  const open = () => navigate(current ? `/guide/${current.id}` : '/create');
  return (
    <div className="classroom-study-scene">
      <section className="study-scene-intro">
        <span className="scene-eyebrow">Cordia Classroom</span>
        <h1>Study<br />smarter<span>.</span></h1>
        <p>Turn any course material into notes, study guides, flashcards, and an AI tutor — built around the way you learn.</p>
        <button type="button" className="scene-continue" onClick={open}>{current ? 'Continue studying' : 'Start studying'}<WorkspaceIcon name="arrow" /></button>
        <nav className="scene-tools" aria-label="Study destinations">
          {[{ label: 'Study Guide', icon: 'study', href: '/dashboard?view=guides' }, { label: 'Practice', icon: 'practice', href: '/practice' }, { label: 'Flashcards', icon: 'flashcards', href: '/flashcards' }, { label: 'SmartNotes', icon: 'notes', href: '/smartnotes' }].map(item => <button type="button" key={item.label} onClick={() => navigate(item.href)}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
      </section>
      <div className="study-scene-reader"><StudyDocument key={guide?.id || 'empty'} guide={guide} onOpen={open} /></div>
      <aside className="study-scene-tutor" aria-label="Cordia Tutor"><AIChatWidget preferredGuideId={current?.id || ''} /></aside>
      {current && <footer className="study-scene-course"><WorkspaceIcon name="study" /><div><span>Current course</span><strong>{guide.className || current.title}</strong></div><div className="scene-course-progress"><span style={{ width: `${Math.round((current.read_progress || 0) * 100)}%` }} /></div><span>{Math.round((current.read_progress || 0) * 100)}%</span></footer>}
    </div>
  );
}
