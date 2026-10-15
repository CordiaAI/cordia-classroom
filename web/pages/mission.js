import { useEffect, useState } from 'react';
import { BookOpen, MessageCircle, MousePointerClick, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import PublicPage from '../components/PublicPage';
import { getToken } from '../lib/api';
import { PRICES } from '../lib/plans';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

const SECTIONS = [
  { icon: BookOpen, title: 'Only your material', text: 'Guides, cards and quizzes come from what you add. Cordia never searches the web for answers, so everything matches your class.' },
  { icon: MousePointerClick, title: 'Capture in a click', text: 'Open a course page, click the Chrome extension and make a guide. The source stays attached.' },
  { icon: MessageCircle, title: 'One Tutor', text: 'The Tutor in Cordia and in the Chrome side panel share one conversation, one class and one set of sources.' },
  { icon: Stethoscope, title: 'NCLEX for nursing', text: 'Nursing material gets NCLEX-style questions written from your own notes.' },
  { icon: ShieldCheck, title: 'Fair pricing', text: `Free covers 3 guides, 10 Tutor questions and 5 Explain views a month. Pro is ${PRICES.monthly.price} a month or ${PRICES.semester.price} a semester. The 7-day trial needs no card and never turns into a charge.` },
  { icon: Users, title: 'Built with students', text: 'A college student started Cordia for college students. Send feedback from Help; it shapes what comes next.' },
];

function Content() {
  return (
    <article className="mission">
      <h1 className="c-title">Approach</h1>
      <div className="mission-grid">
        {SECTIONS.map(section => (
          <section key={section.title} className="c-card mission-card">
            <h2><section.icon {...ICON} />{section.title}</h2>
            <p>{section.text}</p>
          </section>
        ))}
      </div>
      <p className="mission-sign">Jackson Laughlin, founder</p>
      <style jsx global>{`
        .mission { display: grid; gap: 24px; }
        .mission .c-title { margin: 0; }
        .mission-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
        .mission-card { display: grid; align-content: start; gap: 8px; padding: 24px; color: var(--ink); }
        .mission-card h2 { display: flex; align-items: center; gap: 10px; margin: 0; font: 600 17px/1.3 var(--font-sans); color: var(--ink); }
        .mission-card p { margin: 0; font: 500 15px/1.6 var(--font-sans); color: var(--ink); }
        .mission-sign { margin: 0; font: 500 17px/1.4 var(--font-display); color: var(--ink); }
      `}</style>
    </article>
  );
}

export default function MissionPage() {
  const [signedIn, setSignedIn] = useState(null);
  useEffect(() => setSignedIn(Boolean(getToken())), []);
  if (signedIn === null) return null;
  if (signedIn) return <div className="c-page"><Content /></div>;
  return <PublicPage title="Approach — CordiaClassroom" description="How Cordia Classroom works and what it promises." path="/mission"><Content /></PublicPage>;
}
