import { Fragment, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { classLabel } from '../../../lib/classLabel';
import { TYPE_NAMES, buildPrint, decodeFormat } from '../../../lib/printQuiz.mjs';

// A printable quiz: the student's format (?f=, lib/printQuiz.mjs) laid out on Letter paper, then
// the browser's print dialog. No server-side PDF: "Save as PDF" in that dialog makes one.
// ?print=0 skips the dialog (previews and tests); ?seed= fixes the shuffle.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// "Romantic Era & Early 20th-Century Music: Exam Review" -> title and italic subtitle.
function splitTitle(title) {
  const text = String(title || '').trim();
  const at = Math.max(text.lastIndexOf(': '), text.lastIndexOf(' — '), text.lastIndexOf(' - '));
  if (at <= 0) return [text, ''];
  return [text.slice(0, at).trim(), text.slice(at).replace(/^[:—-]\s*|^\s+[—-]\s*/, '').trim()];
}

function className(name) {
  const { title, code } = classLabel(name);
  return [code.trim(), title.trim()].filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).join(' · ');
}

function Brand({ tag }) {
  return (
    <div className="pq-brand-row">
      <span className="pq-brand"><img className="pq-mark" src="/academic-butterfly-open-book.png" alt="" /><span className="pq-word">Cordia</span><span className="pq-classroom">Classroom</span></span>
      <span className="pq-tag">{tag}</span>
    </div>
  );
}

function SectionHead({ section }) {
  return (
    <>
      <div className="pq-section-head">
        {section.part && <span className="pq-part">Part {section.part}</span>}
        <h2>{section.title}</h2>
        <span className="pq-points">{section.pointsNote}</span>
      </div>
      <p className="pq-directions">{section.directions}</p>
    </>
  );
}

function Choice({ item }) {
  return (
    <div className="pq-q">
      <span className="pq-num">{item.number}</span>
      <div className="pq-body">
        <p className="pq-text">{item.question}</p>
        <ol className="pq-options">
          {item.options.map((option, i) => <li key={i}><span className="pq-circle">{LETTERS[i]}</span>{option}</li>)}
        </ol>
      </div>
    </div>
  );
}

function MatchBlock({ block }) {
  return (
    <div className="pq-match">
      <ol className="pq-terms">
        {block.terms.map(term => <li key={term.number}><span className="pq-num">{term.number}</span><span className="pq-write" /><span className="pq-term">{term.term}</span></li>)}
      </ol>
      <ol className="pq-defs">
        {block.definitions.map(item => <li key={item.letter}><span className="pq-chip">{item.letter}</span>{item.definition}</li>)}
      </ol>
    </div>
  );
}

function Fill({ item }) {
  return (
    <div className="pq-q pq-fill">
      <span className="pq-num">{item.number}</span>
      <p className="pq-text">{item.parts.map((part, i) => (typeof part === 'string' ? <Fragment key={i}>{part}</Fragment> : <span key={i} className="pq-blank" aria-label="blank" />))}</p>
    </div>
  );
}

function Short({ item, lines }) {
  return (
    <div className="pq-q pq-short">
      <span className="pq-num">{item.number}</span>
      <div className="pq-body">
        <p className="pq-text">{item.question}</p>
        {Array.from({ length: lines }, (_, i) => <span key={i} className="pq-line" />)}
      </div>
    </div>
  );
}

function Item({ section, item, block, lines }) {
  if (section.type === 'mc') return <Choice item={item} />;
  if (section.type === 'matching') return <MatchBlock block={block} />;
  if (section.type === 'fill') return <Fill item={item} />;
  return <Short item={item} lines={lines} />;
}

// Every question stays whole on its page, and a section's heading travels with its first question.
function Section({ section, lines }) {
  const units = section.type === 'matching' ? section.blocks.map((block, i) => ({ key: i, block })) : section.items.map(item => ({ key: item.number, item }));
  return (
    <section className={'pq-section pq-' + section.type}>
      {units.map((unit, i) => (
        <div key={unit.key} className="pq-keep">
          {i === 0 && <SectionHead section={section} />}
          <Item section={section} item={unit.item} block={unit.block} lines={lines} />
        </div>
      ))}
    </section>
  );
}

function KeyGrid({ entries }) {
  return <div className="pq-key-grid">{entries.map(entry => <span key={entry.number} className="pq-key-cell"><small>{entry.number}</small><strong>{entry.answer}</strong></span>)}</div>;
}

function AnswerKey({ version, print, title }) {
  const single = !print.mixed;
  return (
    <section className="pq-key">
      <Brand tag={version.label ? `Version ${version.label} · Answer key` : 'Answer key'} />
      <h1 className="pq-key-title">Answer key</h1>
      <p className="pq-key-sub">{title}</p>
      {version.key.map(entry => {
        const name = entry.type === 'short' ? (single ? 'Key points' : `${TYPE_NAMES.short}: key points`) : TYPE_NAMES[entry.type];
        return (
          <div key={entry.type} className="pq-key-part">
            <h3 className="pq-key-label">{entry.part ? `Part ${entry.part} · ${name}` : name}</h3>
            {(entry.type === 'mc' || entry.type === 'matching') && <KeyGrid entries={entry.entries} />}
            {entry.type === 'fill' && (
              <ol className="pq-key-fill">{entry.entries.map(item => <li key={item.number}><small>{item.number}</small><span>{item.answer}</span></li>)}</ol>
            )}
            {entry.type === 'short' && (
              <ol className="pq-key-short">{entry.entries.map(item => <li key={item.number}><small>{item.number}</small><span>{item.answer}</span></li>)}</ol>
            )}
          </div>
        );
      })}
      <p className="pq-key-note">Print this page separately so the key isn&rsquo;t handed out with the quiz.</p>
    </section>
  );
}

function Version({ version, print, title, subtitle, classLine, first }) {
  const tag = (version.label ? `Version ${version.label} · ` : '') + print.tag;
  return (
    <div className={'pq-version' + (first ? '' : ' pq-new-page')}>
      <Brand tag={tag} />
      <h1 className="pq-title">{title}{subtitle && <em>{subtitle}</em>}</h1>
      {classLine && <p className="pq-class">{classLine}</p>}
      <div className="pq-fields">
        <span className="pq-field pq-name"><small>Name</small></span>
        <span className="pq-field pq-date"><small>Date</small></span>
        <span className="pq-field pq-score"><small>Score</small><b>/ {print.points}</b></span>
      </div>
      {print.mixed && (
        <div className="pq-parts">
          {version.sections.map(section => <div key={section.part} className="pq-part-card"><strong>Part {section.part}</strong><span>{section.title} · {section.points} {section.points === 1 ? 'pt' : 'pts'}</span></div>)}
        </div>
      )}
      <p className="pq-instructions">{print.instructions}</p>
      {version.sections.map(section => <Section key={section.type} section={section} lines={print.shortLines} />)}
      {print.answerKey && <AnswerKey version={version} print={print} title={[title, subtitle].filter(Boolean).join(': ')} />}
    </div>
  );
}

export default function PrintQuizPage() {
  const router = useRouter();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seed] = useState(() => Number(router.query.seed) || (Date.now() % 100000) + 1);
  const format = useMemo(() => decodeFormat(router.query.f), [router.query.f]);

  useEffect(() => {
    if (!ready || !id || !router.isReady) return;
    apiFetch(`/quiz/${id}/print-items`, { method: 'POST', timeoutMs: 90000, body: JSON.stringify({ fill: Boolean(format.on.fill) }) }).then(result => {
      if (Array.isArray(result?.mc)) setData(result);
      else setError(apiErrorMessage(result?.detail, 'This quiz could not be prepared for printing.'));
    });
  }, [ready, id, router.isReady, format]);

  const print = useMemo(() => (data ? buildPrint({ mc: data.mc, matching: data.matching, fill: data.fill || [], short: data.short }, format, Number(router.query.seed) || seed) : null), [data, format, seed, router.query.seed]);

  // The print dialog opens once the fonts are in, so the page breaks are the real ones.
  useEffect(() => {
    if (!print || !print.questions || router.query.print === '0') return undefined;
    let cancelled = false;
    Promise.all([document.fonts.load('16px Newsreader'), document.fonts.load('500 16px Quicksand')]).then(() => document.fonts.ready).then(() => {
      if (!cancelled) window.print();
    });
    return () => { cancelled = true; };
  }, [print, router.query.print]);

  const [title, subtitle] = splitTitle(data?.title);
  const notes = print ? [
    ...print.notes,
    ...(data.mc_flagged && format.on.mc ? [`${data.mc_flagged === 1 ? '1 multiple-choice question is' : `${data.mc_flagged} multiple-choice questions are`} left out because an answer choice is another question's answer. Use Refresh answer choices on the guide to fix them.`] : []),
    ...(data.fill_locked && format.on.fill ? ["Fill in the blank needs an AI quiz, and this month's are used up."] : []),
  ] : [];

  return (
    <div className="pq">
      <Head><title>{data?.title ? `${data.title}: printable quiz` : 'Printable quiz'}</title></Head>
      <div className="pq-toolbar">
        {!print && !error && <span>Preparing your quiz…</span>}
        {error && <span role="alert">{error}</span>}
        {print && <button type="button" className="c-btn c-btn--primary" onClick={() => window.print()} disabled={!print.questions}>Print</button>}
        {print && <span>{print.questions} questions · {print.points} points{print.versions.length > 1 ? ' · Versions A and B' : ''}</span>}
        {notes.map(note => <span key={note} className="pq-note" role="status">{note}</span>)}
      </div>
      {print && print.questions > 0 && (
        <div className="pq-paper">
          {print.versions.map((version, i) => <Version key={version.label || 'one'} version={version} print={print} title={title} subtitle={subtitle} classLine={data.class_name ? className(data.class_name) : ''} first={i === 0} />)}
        </div>
      )}
      <style jsx global>{`
        html, body { background: var(--print-box); }
        body::before { display: none !important; }
        .pq { min-height: 100vh; color: var(--print-ink); }
        .pq-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 24px; background: var(--print-paper); border-bottom: 1px solid var(--print-edge); font: 500 14px/1.4 var(--font-sans); }
        .pq-note { flex-basis: 100%; color: var(--print-muted); }
        .pq-paper { width: 8.5in; margin: 24px auto; padding: 0.8in 0.85in 0.85in; background: var(--print-paper); box-sizing: border-box; page: quiz; }
        .pq-paper p, .pq-paper h1, .pq-paper h2, .pq-paper h3, .pq-paper ol { margin: 0; padding: 0; }
        .pq-paper ol { list-style: none; }
        .pq-new-page, .pq-key { break-before: page; }
        .pq-brand-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 0.42in; }
        .pq-brand { display: inline-flex; align-items: baseline; gap: 7px; }
        .pq-mark { width: 18px; height: auto; align-self: center; }
        .pq-word { font: 600 13pt/1 var(--font-display); color: var(--print-olive); }
        .pq-classroom { font: 500 7.5pt/1 var(--font-sans); letter-spacing: 0.22em; text-transform: uppercase; color: var(--print-olive); }
        .pq-tag { font: 500 7.5pt/1 var(--font-sans); letter-spacing: 0.08em; color: var(--print-muted); text-transform: uppercase; text-align: right; }
        .pq-title { display: grid; font: 400 23pt/1.15 var(--font-display); letter-spacing: -0.01em; color: var(--print-ink); }
        .pq-title em { font-style: italic; color: var(--print-olive); }
        .pq-class { margin-top: 6px !important; font: 500 9.5pt/1.3 var(--font-sans); color: var(--print-muted); }
        .pq-fields { display: grid; grid-template-columns: 2.1fr 1fr 0.85fr; gap: 0.2in; margin: 0.42in 0 0.3in; }
        .pq-field { display: flex; align-items: flex-start; gap: 18px; height: 0.42in; border-bottom: 1.2px solid var(--print-ink); font: 600 7.5pt/1 var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--print-muted); }
        .pq-field small { font: inherit; }
        .pq-field b { font-weight: 600; letter-spacing: 0.04em; color: var(--print-muted); }
        .pq-parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 0.16in; margin-bottom: 0.22in; }
        .pq-part-card { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid var(--print-edge); border-radius: 8px; }
        .pq-part-card strong { font: 500 11pt/1.1 var(--font-display); color: var(--print-ink); }
        .pq-part-card span { font: 400 8pt/1.2 var(--font-sans); color: var(--print-muted); }
        .pq-paper .pq-instructions { padding: 12px 16px; border-radius: 8px; background: var(--print-box); font: 400 9pt/1.4 var(--font-sans); color: var(--print-muted); margin-bottom: 0.38in !important; }
        .pq-section { margin-top: 0.12in; }
        .pq-keep { break-inside: avoid; page-break-inside: avoid; }
        .pq-section-head { display: flex; align-items: baseline; gap: 10px; padding-bottom: 9px; border-bottom: 1.4px solid var(--print-rule); }
        .pq-part { font: 600 7.5pt/1 var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--print-olive); }
        .pq-section-head h2 { font: 500 15pt/1.1 var(--font-display); color: var(--print-ink); }
        .pq-points { margin-left: auto; font: 400 8.5pt/1 var(--font-sans); color: var(--print-muted); }
        .pq-directions { margin: 9px 0 0.24in !important; font: 400 8.5pt/1.4 var(--font-sans); color: var(--print-muted); }
        .pq-q { display: grid; grid-template-columns: 0.42in 1fr; padding-bottom: 0.3in; }
        .pq-num { font: 600 9pt/1.6 var(--font-sans); color: var(--print-olive); font-variant-numeric: tabular-nums; }
        .pq-text { font: 400 12pt/1.45 var(--font-display); color: var(--print-ink); }
        .pq-options { display: grid; gap: 9px; margin-top: 12px !important; }
        .pq-options li { display: flex; align-items: center; gap: 12px; font: 400 10pt/1.35 var(--font-sans); color: var(--print-ink); }
        .pq-circle { flex: none; display: inline-grid; place-items: center; width: 15pt; height: 15pt; border: 1px solid var(--print-ink); border-radius: 50%; font: 600 6.5pt/1 var(--font-sans); }
        .pq-match { display: grid; grid-template-columns: 1fr 1.45fr; gap: 0.42in; padding-bottom: 0.3in; }
        .pq-terms li { display: grid; grid-template-columns: 0.42in 0.42in 1fr; align-items: end; gap: 10px; padding: 11px 0 6px; border-bottom: 1px solid var(--print-edge); }
        .pq-write { height: 1px; border-bottom: 1.2px solid var(--print-ink); align-self: end; margin-bottom: 3px; }
        .pq-term { font: 400 12pt/1.3 var(--font-display); }
        .pq-defs { display: grid; gap: 10px; }
        .pq-defs li { display: grid; grid-template-columns: 22px 1fr; gap: 10px; font: 400 9.5pt/1.4 var(--font-sans); }
        .pq-chip { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; background: var(--print-chip); font: 600 7pt/1 var(--font-sans); color: var(--print-olive); }
        .pq-fill { align-items: baseline; }
        .pq-fill .pq-text { line-height: 2.4; }
        .pq-blank { display: inline-block; width: 1.3in; margin: 0 6px; border-bottom: 1.2px solid var(--print-ink); transform: translateY(2px); }
        .pq-line { display: block; height: 0.42in; border-bottom: 1px solid var(--print-line); }
        .pq-short .pq-text { margin-bottom: 0.08in; }
        .pq-key-title { font: 400 23pt/1.15 var(--font-display); }
        .pq-key-sub { margin: 8px 0 0.34in !important; font: 500 9.5pt/1.3 var(--font-sans); color: var(--print-muted); }
        .pq-key-part { margin-bottom: 0.26in; break-inside: avoid; }
        .pq-key-label { margin-bottom: 10px !important; font: 600 7.5pt/1 var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--print-olive); }
        .pq-key-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 10px; }
        .pq-key-cell { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--print-edge); border-radius: 7px; }
        .pq-key-cell small { font: 500 7.5pt/1 var(--font-sans); color: var(--print-muted); }
        .pq-key-cell strong { font: 600 10pt/1 var(--font-sans); color: var(--print-olive); }
        .pq-key-fill { display: grid; grid-template-columns: 1fr 1fr; column-gap: 0.3in; }
        .pq-key-fill li, .pq-key-short li { display: grid; grid-template-columns: 0.42in 1fr; padding: 10px 0; font: 400 11pt/1.45 var(--font-display); }
        .pq-key-fill li { border-bottom: 1px solid var(--print-edge); }
        .pq-key-fill small, .pq-key-short small { font: 600 8pt/1.8 var(--font-sans); color: var(--print-muted); }
        .pq-key-note { margin-top: 0.2in !important; font: 400 8pt/1.4 var(--font-sans); color: var(--print-muted); }
        @media print {
          html, body { background: var(--print-paper); }
          .pq { min-height: 0; }
          .pq-toolbar { display: none; }
          .pq-paper { width: auto; margin: 0; padding: 0; }
        }
      `}</style>
    </div>
  );
}
