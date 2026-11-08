// Questions and answers from one array of {question, answer}. The page passes the same array to
// PublicPage's `faq`, which renders this list and the FAQPage JSON-LD (lib/structuredData.mjs),
// so the visible text and the markup can't drift apart. Answers are plain text for that reason.
export default function Faq({ items, title = 'Frequently asked questions', level = 2 }) {
  const Heading = `h${level}`;
  const Question = `h${level + 1}`;
  return (
    <section className="faq" aria-labelledby="faq-title" data-faq="">
      <Heading id="faq-title" className="faq-title">{title}</Heading>
      <div className="faq-list">
        {items.map(({ question, answer }) => (
          <div key={question} className="faq-item">
            <Question className="faq-question" data-faq-question="">{question}</Question>
            <p className="faq-answer" data-faq-answer="">{answer}</p>
          </div>
        ))}
      </div>
      <style jsx>{`
        .faq { width: min(var(--page-max), 100%); margin: 48px auto 0; }
        .faq :global(.faq-title) { margin: 0 0 16px; font: 600 var(--fs-28)/1.2 var(--font-display); color: var(--ink); }
        .faq-list { display: grid; gap: 12px; }
        .faq-item { padding: 20px 24px; border: 1px solid var(--line); border-radius: 20px; background: var(--lg-card); }
        .faq-item :global(.faq-question) { margin: 0; font: 600 var(--fs-17)/1.35 var(--font-sans); color: var(--ink); }
        .faq-answer { margin: 8px 0 0; color: var(--text-secondary); font: 500 var(--fs-15)/1.55 var(--font-sans); }
      `}</style>
    </section>
  );
}
