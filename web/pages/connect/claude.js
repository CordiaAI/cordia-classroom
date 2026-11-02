import Link from 'next/link';
import PublicPage from '../../components/PublicPage';
import { SUPPORT_EMAIL } from '../../lib/mcp/config.mjs';

// Public docs for the Cordia connector: what it does, how to connect, what to ask, its tools, what
// it can't reach, and how to disconnect. The tool list must match lib/mcp (tests/connect-page.test.mjs).
const SERVER_URL = 'https://classroom.cordiacode.com/mcp';

export const TOOLS = [
  ['search_my_materials', 'Searches your study sets, flashcards, notes and lecture transcripts, with the lecture timestamp for each hit.'],
  ['list_study_sets', 'Lists your study sets, newest first, by course or title.'],
  ['get_study_set', 'Opens one study set: its notes, outline and key terms, and on request its flashcards, quiz and practice problems.'],
  ['list_lectures', 'Lists your recorded lectures.'],
  ['get_lecture', 'Opens one lecture: its outline, the points your professor stressed (with quotes and timestamps), to-dos, key terms and your own notes.'],
  ['get_due_cards', 'Gets what Study now would review today, in the same order: questions you missed while sure come first.'],
  ['get_progress', 'Your streak, study minutes, quiz accuracy, best study hours and weakest topics.'],
  ['get_job_status', 'Checks on a study set Cordia is making in the background.'],
  ['record_answer', 'Records an answer you gave in the chat, so your review schedule and progress update as if you had studied in Cordia.'],
  ['create_study_set', 'Makes a study set from text you paste or a public web page, counted against your plan like one made in Cordia.'],
  ['add_flashcards', 'Adds flashcards to one of your study sets. It skips cards you already have and never changes existing ones.'],
  ['save_note', 'Saves a new note page in your Library, labelled "Added from Claude".'],
];

export const PROMPTS = [
  ['Study now', 'Today\'s review, one card at a time, with every answer logged.'],
  ['Quiz me', 'Ten questions from one study set.'],
  ['Review a lecture', 'The points your professor stressed, with quotes and timestamps, then a quick quiz.'],
];

const EXAMPLES = [
  'What did my professor say about the electron transport chain? Give me the timestamps.',
  'Quiz me on what\'s due today and log my answers.',
  'How\'s my studying going this month? What should I review?',
  'Make a study set from this article: https://…',
  'Turn this conversation into flashcards and add them to my Cell Biology set.',
  'Save a summary of this chat as a note in my History course.',
];

export default function ConnectClaude() {
  return (
    <PublicPage title="Use Cordia Classroom with Claude" description="Connect Cordia Classroom to Claude to search your notes and lectures, get quizzed from your own flashcards and save new cards to your Library." path="/connect/claude">
      <article className="c-card public-doc connect-doc">
        <h1>Use Cordia Classroom with Claude</h1>
        <p className="connect-lead">
          Connect Cordia to Claude and ask about your own course material: your study sets, lecture recordings, notes and flashcards.
          Claude answers from what you studied, quizzes you from your own cards, and saves new cards and notes back to your Library.
        </p>

        <h2>Connect</h2>
        <ol>
          <li>You need a Cordia Classroom account and a Claude plan that supports custom connectors.</li>
          <li>In Claude, open <strong>Settings › Connectors</strong> and choose <strong>Add custom connector</strong>.</li>
          <li>Name it <strong>Cordia Classroom</strong> and paste this URL:<code className="connect-url">{SERVER_URL}</code></li>
          <li>Choose <strong>Connect</strong>. Sign in to Cordia if asked, read what Claude will be able to do, and choose <strong>Allow</strong>.</li>
        </ol>
        <p>The connector shows as connected in Claude. Turn it on in a chat from the connectors menu.</p>

        <h2>Things to ask</h2>
        <ul className="connect-examples">
          {EXAMPLES.map(text => <li key={text}>“{text}”</li>)}
        </ul>
        <p>Claude also offers three ready-made prompts from the connector:</p>
        <dl className="connect-list">
          {PROMPTS.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}
        </dl>

        <h2>What Claude can do</h2>
        <dl className="connect-list">
          {TOOLS.map(([name, text]) => <div key={name}><dt><code>{name}</code></dt><dd>{text}</dd></div>)}
        </dl>
        <p>
          The first eight only read. The last four add to your Library: they never delete or change what you already have,
          and Claude uses them when you ask.
        </p>

        <h2>What Claude can&apos;t see or do</h2>
        <ul>
          <li>Your Canvas or other LMS data: assignments, due dates, grades, announcements or rosters. Courses named by Canvas show as “Course 1”, “Course 2”.</li>
          <li>Your connected accounts (Google, Microsoft, Slack, Notion, Dropbox and others) or your texting assistant.</li>
          <li>Anything in another student&apos;s account.</li>
          <li>Delete anything, or change your account, plan or settings.</li>
        </ul>

        <h2>Disconnect</h2>
        <p>
          In Cordia, open <Link href="/settings?section=connectors">Settings › Connectors</Link> and choose <strong>Disconnect</strong> next to Claude under Connected AI apps.
          Claude loses access at once. You can also remove the connector in Claude&apos;s settings.
        </p>

        <h2>Privacy</h2>
        <p>
          Cordia doesn&apos;t store your conversations with Claude. It keeps only what you ask it to save, plus a short record of each request
          (which tool, whether it worked, how long it took) for 90 days. Read the details in our <Link href="/privacy#connected-ai-apps">Privacy Policy</Link>.
        </p>

        <h2>Help</h2>
        <p>Questions or problems: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </article>
      <style jsx>{`
        .connect-doc { max-width: 800px; margin: 0 auto; padding: 40px clamp(20px, 5vw, 48px); line-height: 1.7; color: var(--text-secondary); }
        .connect-doc h1 { margin: 0 0 12px; color: var(--text-primary); font-size: 2rem; }
        .connect-doc h2 { margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border-default); color: var(--accent); font-size: 1.15rem; }
        .connect-lead { font-size: 1.05rem; color: var(--text-primary); }
        .connect-doc ol, .connect-doc ul { padding-left: 22px; }
        .connect-doc li { margin: 6px 0; }
        .connect-doc code { padding: 1px 6px; border-radius: 6px; background: var(--surface-raised); font-size: 0.9em; overflow-wrap: anywhere; }
        .connect-doc .connect-url { display: block; width: fit-content; max-width: 100%; margin-top: 4px; }
        .connect-examples li { font-style: italic; }
        .connect-list { display: grid; gap: 10px; margin: 12px 0; }
        .connect-list div { display: grid; gap: 2px; }
        .connect-list dt { color: var(--text-primary); font-weight: 600; }
        .connect-list dd { margin: 0; }
      `}</style>
    </PublicPage>
  );
}
