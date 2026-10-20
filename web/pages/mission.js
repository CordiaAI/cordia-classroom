import PublicPage from '../components/PublicPage';

export default function MissionPage() {

  const features = [
    {
      title: 'Instant Extraction',
      description: 'Open your course material, click the CordiaClassroom icon, and use the Tutor side panel to capture the page or find related material. Cordia keeps the source attached to what it creates.',
    },
    {
      title: 'NCLEX Question Generation',
      subtitle: 'Nursing User Group (More specific user groups to be added soon!)',
      description: 'CordiaClassroom turns the material you are learning into NCLEX-style questions, so nursing students can practice in the same format as their exams in a couple of clicks.',
    },
    {
      title: 'CordiaClassroom Never Allows the AI to Search for Answers on the Web.',
      description: 'The main issue with simply asking an LLM to create a study guide is that the answers and questions are NOT DIRECTLY from your class material. CordiaClassroom makes this super simple and easy. It only uses the context that was captured as its knowledge! This way it is the exact material from your classes.',
    },
    {
      title: 'One Cordia Tutor',
      description: 'The Classroom Tutor and Chrome side panel share the same conversation, selected class, source material, learning guidance, and active skill so work can continue across both interfaces.',
    },
    {
      title: 'The Cost',
      description: 'Start free with 3 study guides, 10 tutor prompts and 5 Explain views each month. CordiaClassroom Pro is $9.99 a month or $29 a semester. Try Pro free for 7 days with no card; the trial never turns into a charge on its own.',
    },
    {
      title: 'Users Are "Cofounders"',
      description: 'Got a new recommendation or said something along the lines of "I wish it would do this?" Send feedback! Our goal is to get your recommendation ASAP! This is a college study platform made for the people.',
    },
  ];

  return (
    <PublicPage title="Our approach — Cordia Classroom" description="How Cordia Classroom turns your own course material into study guides, quizzes and flashcards." path="/mission">
    <div className="fade-in mission-page" style={{ width: 'min(var(--page-max), 100%)', margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>CordiaClassroom Features</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 28, lineHeight: 1.5 }}>
        CordiaClassroom was built by a college student, for college students. Our mission is to make studying smarter, faster, and more accessible for every student — regardless of major or learning style.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {features.map((f, i) => (
          <div key={i} style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 24px',
          }}>
            <h3 style={{ marginBottom: 4, color: 'var(--text-primary)' }}>
              {f.title}
            </h3>
            {f.subtitle && (
              <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>
                {f.subtitle}
              </span>
            )}
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.5, marginTop: 8 }}>
              {f.description}
            </p>
          </div>
        ))}
      </div>
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 15, marginTop: 24, fontStyle: 'italic' }}>
        Founder - Jackson Laughlin
      </p>
    </div>
    </PublicPage>
  );
}
