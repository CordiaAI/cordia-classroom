// The windows the chat's tools open beside the conversation (pages/chat.js). One component per
// kind; `ask` sends a message back into the chat ("Quiz me on this").
import { useMemo, useState } from 'react';

function Section({ title, children }) {
  return (
    <section className="cw-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function GuideWindow({ data, ask }) {
  const sections = data.sections || {};
  return (
    <div className="cw-body">
      {data.course?.name && <p className="cw-eyebrow">{data.course.name}</p>}
      <div className="cw-actions">
        <button type="button" onClick={() => ask(`Quiz me on “${data.title}”.`)}>Quiz me</button>
        <button type="button" onClick={() => ask(`Show flashcards for “${data.title}”.`)}>Flashcards</button>
        <button type="button" onClick={() => ask(`What's the hardest idea in “${data.title}”? Teach it to me.`)}>Teach me</button>
      </div>
      {sections.outline?.length > 0 && (
        <Section title="Outline">
          {sections.outline.map((part, index) => (
            <div className="cw-outline" key={index}>
              <h4>{part.heading}</h4>
              <ul>{part.points.map((point, at) => <li key={at}>{point}</li>)}</ul>
            </div>
          ))}
        </Section>
      )}
      {sections.key_terms?.length > 0 && (
        <Section title="Key terms">
          <dl className="cw-terms">
            {sections.key_terms.map((term, index) => (
              <div key={index}><dt>{term.term}</dt><dd>{term.context}</dd></div>
            ))}
          </dl>
        </Section>
      )}
      {sections.notes?.length > 0 && !sections.outline?.length && (
        <Section title="Notes">{sections.notes.map((note, index) => <p key={index}>{note.text}</p>)}</Section>
      )}
      {sections.flashcards?.length > 0 && <Section title="Flashcards"><Cards cards={sections.flashcards} /></Section>}
      {data.url && <a className="cw-link" href={data.url} target="_blank" rel="noreferrer">Open in Classroom ↗</a>}
    </div>
  );
}

function QuizWindow({ data, ask }) {
  const questions = data.questions || [];
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [right, setRight] = useState(0);
  const [missed, setMissed] = useState([]);
  if (at >= questions.length) {
    return (
      <div className="cw-body cw-center">
        <p className="cw-score">{right}/{questions.length}</p>
        <p className="cw-muted">{right === questions.length ? 'Perfect round.' : `${questions.length - right} to go back over.`}</p>
        <div className="cw-actions">
          {missed.length > 0 && <button type="button" onClick={() => ask(`I missed these on the quiz: ${missed.join(' | ')}. Walk me through them.`)}>Go over my misses</button>}
          <button type="button" onClick={() => { setAt(0); setPicked(null); setRight(0); setMissed([]); }}>Try again</button>
        </div>
      </div>
    );
  }
  const item = questions[at];
  const answered = picked !== null;
  const choose = index => {
    if (answered) return;
    setPicked(index);
    if (index === item.answer_index) setRight(value => value + 1);
    else setMissed(list => [...list, item.question]);
  };
  return (
    <div className="cw-body">
      <p className="cw-eyebrow">Question {at + 1} of {questions.length}</p>
      <p className="cw-question">{item.question}</p>
      <div className="cw-options">
        {item.options.map((option, index) => {
          const state = !answered ? '' : index === item.answer_index ? 'is-right' : index === picked ? 'is-wrong' : 'is-dim';
          return <button type="button" key={index} className={`cw-option ${state}`} onClick={() => choose(index)}>{option}</button>;
        })}
      </div>
      {answered && (
        <>
          <p className="cw-explain">{item.explanation}</p>
          <div className="cw-actions">
            <button type="button" className="is-primary" onClick={() => { setAt(at + 1); setPicked(null); }}>{at + 1 === questions.length ? 'See score' : 'Next'}</button>
            <button type="button" onClick={() => ask(`Explain why the answer to “${item.question}” is “${item.options[item.answer_index]}”.`)}>Why?</button>
          </div>
        </>
      )}
    </div>
  );
}

function Cards({ cards }) {
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  if (!cards.length) return <p className="cw-muted">No cards here yet.</p>;
  if (at >= cards.length) {
    return (
      <div className="cw-center">
        <p className="cw-score">{known}/{cards.length}</p>
        <p className="cw-muted">known on the first try</p>
        <div className="cw-actions"><button type="button" onClick={() => { setAt(0); setKnown(0); setFlipped(false); }}>Go again</button></div>
      </div>
    );
  }
  const card = cards[at];
  const next = knewIt => { if (knewIt) setKnown(value => value + 1); setFlipped(false); setAt(at + 1); };
  return (
    <div>
      <button type="button" className={`cw-card ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
        <span className="cw-card-side">{flipped ? 'Answer' : 'Term'}</span>
        <span className="cw-card-text">{flipped ? card.back : card.front}</span>
      </button>
      <div className="cw-card-bar">
        <span className="cw-muted">{at + 1} / {cards.length}</span>
        {flipped
          ? <div className="cw-actions"><button type="button" onClick={() => next(false)}>Again</button><button type="button" className="is-primary" onClick={() => next(true)}>Got it</button></div>
          : <button type="button" onClick={() => setFlipped(true)}>Flip</button>}
      </div>
    </div>
  );
}

function FlashcardWindow({ data }) {
  return <div className="cw-body"><Cards cards={data.cards || []} /></div>;
}

function ReviewWindow({ data }) {
  const cards = data.cards || [];
  return (
    <div className="cw-body">
      <p className="cw-eyebrow">{data.total_due} due today</p>
      {cards.length ? <Cards cards={cards} /> : <p className="cw-muted">Nothing is due. You're caught up.</p>}
    </div>
  );
}

function LectureWindow({ data, ask }) {
  const clock = seconds => (Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '');
  return (
    <div className="cw-body">
      {data.course?.name && <p className="cw-eyebrow">{data.course.name}</p>}
      <div className="cw-actions"><button type="button" onClick={() => ask(`Quiz me on the lecture “${data.title}”.`)}>Quiz me</button></div>
      {data.summary?.length > 0 && <Section title="Summary"><ul>{data.summary.map((line, index) => <li key={index}>{line}</li>)}</ul></Section>}
      {data.watch_for?.length > 0 && (
        <Section title="Watch for">
          {data.watch_for.map((item, index) => <blockquote key={index}><span className="cw-time">{clock(item.timestamp_seconds)}</span>“{item.quote}” <em>{item.note}</em></blockquote>)}
        </Section>
      )}
      {data.todos?.length > 0 && <Section title="To-dos"><ul>{data.todos.map((todo, index) => <li key={index}>{todo.text}{todo.due_date ? ` · ${todo.due_date}` : ''}</li>)}</ul></Section>}
      {data.key_terms?.length > 0 && (
        <Section title="Key terms"><dl className="cw-terms">{data.key_terms.map((term, index) => <div key={index}><dt>{term.term}</dt><dd>{term.definition}</dd></div>)}</dl></Section>
      )}
    </div>
  );
}

function ListWindow({ data, ask }) {
  const rows = data.study_sets || data.results || [];
  return (
    <div className="cw-body">
      {!rows.length && <p className="cw-muted">Nothing matched.</p>}
      <ul className="cw-rows">
        {rows.map(row => (
          <li key={`${row.kind || 'set'}-${row.id}-${row.card_index ?? ''}`}>
            <button type="button" onClick={() => ask(row.kind === 'lecture' ? `Open the lecture “${row.title}”.` : `Open “${row.title}”.`)}>
              <span className="cw-row-title">{row.title}</span>
              <span className="cw-muted">{row.course?.name || row.kind?.replace('_', ' ') || ''}{row.snippet ? ` · ${row.snippet}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RENDER = { guide: GuideWindow, quiz: QuizWindow, flashcards: FlashcardWindow, review: ReviewWindow, lecture: LectureWindow, library: ListWindow, search: ListWindow };
const LABEL = { guide: 'Study guide', quiz: 'Quiz', flashcards: 'Flashcards', review: 'Review', lecture: 'Lecture', library: 'Library', search: 'Search' };

export function windowTitle(win) {
  if (win.kind === 'library') return 'Your study guides';
  if (win.kind === 'search') return `Search: ${win.data?.query || ''}`;
  return win.data?.title || LABEL[win.kind] || 'Window';
}

export function windowLabel(kind) {
  return LABEL[kind] || 'Window';
}

export default function WindowPanel({ windows, activeId, onSelect, onClose, ask }) {
  const active = useMemo(() => windows.find(win => win.id === activeId) || windows[windows.length - 1], [windows, activeId]);
  if (!active) return null;
  const Render = RENDER[active.kind];
  return (
    <aside className="cw-panel" aria-label="Window">
      <header className="cw-head">
        <div className="cw-tabs" role="tablist">
          {windows.map(win => (
            <button type="button" role="tab" aria-selected={win.id === active.id} key={win.id} className={win.id === active.id ? 'is-active' : ''} onClick={() => onSelect(win.id)}>
              {windowLabel(win.kind)}
            </button>
          ))}
        </div>
        <button type="button" className="cw-close" aria-label="Close window" onClick={onClose}>×</button>
      </header>
      <h2 className="cw-title">{windowTitle(active)}</h2>
      {/* key: a new window of the same kind starts fresh (quiz score, card position). */}
      {Render ? <Render key={active.id} data={active.data || {}} ask={ask} /> : null}
    </aside>
  );
}
