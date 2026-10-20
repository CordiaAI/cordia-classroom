import PublicPage from '../components/PublicPage';

export default function PrivacyPolicy() {
  return (
    <PublicPage title="Privacy Policy — Cordia Classroom" description="How Cordia Classroom collects, uses and protects your data." path="/privacy">
      <div className="c-card public-doc" style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '40px clamp(20px, 5vw, 48px)',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-secondary)',
        lineHeight: '1.8',
      }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
          Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '0.9rem' }}>
          Effective Date: February 25, 2026 &nbsp;|&nbsp; Last Updated: October 20, 2026
        </p>

        <p style={{ marginBottom: '32px' }}>
          CordiaClassroom ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when you use the CordiaClassroom
          Chrome extension and web platform (collectively, the "Service"). Please read this policy carefully.
          By using the Service, you agree to the practices described herein.
        </p>

        <Section title="1. Information We Collect">
          <p><strong style={{ color: 'var(--text-primary)' }}>a. Account Information</strong></p>
          <p>When you create an account, we collect your email address and a hashed password. We do not store plaintext passwords.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>b. Page Content</strong></p>
          <p>When you ask the Chrome side panel to capture a page, bounded visible study content is transmitted to our servers for AI processing. The most recent normalized capture, page title, and source URL are stored in your private Tutor session so the same Tutor can continue in CordiaClassroom. A capture may also be retained as study material when you choose to save it.</p>
          <p>If you connect a Canvas calendar feed, its private feed link is stored with your Classroom account so deadlines can reconnect automatically. It is used only by authenticated Classroom calendar routes, is never returned to the browser after saving, and is deleted when you disconnect the calendar.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>c. Generated Study Materials</strong></p>
          <p>Study guides, notes, and flashcards you generate are stored in our database associated with your account so you can access them through the platform.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>d. Usage Data</strong></p>
          <p>We count monthly study builds, Tutor prompts, recording minutes and other AI actions per account to enforce plan limits, and we keep a study log (minutes, cards and streaks) to show your progress. We use Vercel Web Analytics and Speed Insights, which record anonymous page views and page-load performance without cookies or cross-site tracking. When the web app hits an error, the error message, page path and code location are logged so we can fix it; your study content is not included. We do not collect your browsing history.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>e. Lecture Recordings</strong></p>
          <p>If you record a lecture, audio from your microphone is sent in short pieces to our servers and to our speech-to-text provider to make a transcript. The transcript, the notes and to-dos made from it, and the audio pieces are stored with your account until you delete the lecture or your account. You are responsible for having permission to record (see our Terms of Service).</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>f. Canvas Connection</strong></p>
          <p>If you connect Canvas with an access token, we store the token encrypted and use it only to read what the features need: your course list, the courses you choose to bring in (name, code, term, syllabus topics and module titles), their assignment titles and due dates, and the list of course files. A file is downloaded only when you choose it. We do not read rosters, grades, submissions or messages. Each request to Canvas is recorded in an activity log you can see in Settings. Disconnecting deletes the token and the Canvas data we stored; you can also delete the token in Canvas.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>g. Sets Shared With a Class</strong></p>
          <p>If you choose to share a study set with a class, classmates who joined that class can see and copy its title, questions and flashcards (never your private notes). Shared sets are anonymous unless you turn on "Show my first name". Classmates may report a set, and instructors may turn sharing off for their course. You can make a set private again at any time.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>h. Profile and Feedback</strong></p>
          <p>We store the name, school, level and major you give us, your study preferences, and any feedback you send.</p>

          <p style={{ marginTop: '16px' }}><strong style={{ color: 'var(--text-primary)' }}>i. Payment Information</strong></p>
          <p>Payments are processed by Stripe. We do not collect or store your full credit card number, card verification code, or bank account details. Stripe provides us with a customer identifier and subscription status. Stripe's privacy policy governs their handling of your payment data and can be found at stripe.com/privacy.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>We use the information we collect to:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>Provide, operate, and maintain the Service</li>
            <li>Generate AI-powered study materials from content you capture</li>
            <li>Authenticate your account and maintain your session</li>
            <li>Enforce free and paid plan usage limits</li>
            <li>Process subscription payments and manage billing</li>
            <li>Respond to support requests or inquiries</li>
            <li>Improve the reliability and performance of the Service</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            We do not use your content or personal data for advertising purposes, and we do not sell your data to third parties.
          </p>
        </Section>

        <Section title="3. How We Share Your Information">
          <p>We do not sell, trade, or rent your personal information to third parties. We may share data only in the following limited circumstances:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li><strong style={{ color: 'var(--text-primary)' }}>Service Providers:</strong> We use trusted third-party providers to operate the Service, including Supabase (database, file storage and authentication), Groq and OpenAI (AI content generation, image reading and speech-to-text), Napkin AI (diagrams and note covers, which receive the text being illustrated), Stripe (payment processing), Vercel (web hosting and anonymous analytics), and Fly.io (backend hosting). If you connect Canvas, requests go to your school's Canvas (Instructure) site using your token. These providers are contractually obligated to protect your data and may only use it to perform services on our behalf.</li>
            <li style={{ marginTop: '8px' }}><strong style={{ color: 'var(--text-primary)' }}>Legal Requirements:</strong> We may disclose your information if required to do so by law, regulation, or valid legal process (e.g., a court order or subpoena).</li>
            <li style={{ marginTop: '8px' }}><strong style={{ color: 'var(--text-primary)' }}>Business Transfers:</strong> In the event of a merger, acquisition, or sale of all or a portion of our assets, your information may be transferred as part of that transaction. We will notify you of any such change via email or a prominent notice on our platform.</li>
          </ul>
        </Section>

        <Section title="4. Data Retention">
          <p>
            We retain your account information and generated study materials for as long as your account is active.
            The most recent bounded, normalized page capture and its source metadata are retained in your private Tutor
            session until a later capture replaces them or your account is deleted. Study material you choose to save is
            retained with your account. You can delete your account at any time in Settings → Account → Delete account:
            your study materials, notes, lectures and recordings, classes, progress, shared sets and Canvas connection
            are deleted immediately and a paid plan is cancelled. Copies in our providers' encrypted backups expire
            within 30 days, except where retention is required by law.
          </p>
        </Section>

        <Section title="5. Chrome Extension — Data Practices">
          <p>The CordiaClassroom Chrome extension:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>Reads page content <strong style={{ color: 'var(--text-primary)' }}>only</strong> when you start a capture or explicitly ask the Tutor to capture the current page</li>
            <li>Sends a presence signal while the side panel is open so Classroom can show whether browser capture is available; that signal does not include the current URL or page title</li>
            <li>Does not monitor or collect your browsing history. The title, source URL, and bounded page context are sent only for the page you choose to capture</li>
            <li>Does not transmit browser cookies, passwords, form credentials, or unrestricted browser history</li>
            <li>Stores your authentication token locally using Chrome's storage API so you remain logged in between sessions</li>
            <li>Sends extension data only to the <strong style={{ color: 'var(--text-primary)' }}>CordiaClassroom API</strong>; the service providers listed above may process that data to provide the requested feature</li>
          </ul>
        </Section>

        <Section title="6. Cookies and Local Storage">
          <p>
            The CordiaClassroom web platform uses browser local storage to maintain your authenticated session and
            to remember preferences such as your theme and drafts. We do not use third-party tracking cookies or
            advertising cookies. No cross-site tracking is performed.
          </p>
        </Section>

        <Section title="7. Security">
          <p>
            We implement industry-standard security measures to protect your data, including HTTPS encryption
            for all data in transit, hashed password storage, and access controls on our database. However,
            no method of transmission over the internet or electronic storage is 100% secure. We encourage
            you to use a strong, unique password for your account.
          </p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            The Service is not directed to children under the age of 13. We do not knowingly collect personal
            information from children under 13. If you believe a child under 13 has provided us with personal
            information, please contact us and we will promptly delete it.
          </p>
        </Section>

        <Section title="9. Your Rights">
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your personal data</li>
            <li>Object to or restrict certain processing of your data</li>
            <li>Data portability (receive a copy of your data in a structured format)</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            You can delete your account yourself in Settings, export any study guide from its menu, and
            disconnect Canvas or a calendar feed at any time. For anything else, contact us at the email address below.
          </p>
        </Section>

        <Section title="10. Third-Party Links">
          <p>
            The Service may contain links to third-party websites. We are not responsible for the privacy
            practices of those websites and encourage you to review their privacy policies independently.
          </p>
        </Section>

        <Section title="11. Changes to This Privacy Policy">
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the "Last Updated"
            date at the top of this page. If changes are material, we will notify you by email or by posting
            a prominent notice on the platform. Your continued use of the Service after any changes constitutes
            your acceptance of the updated policy.
          </p>
        </Section>

        <Section title="12. Contact Us">
          <p>
            If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices,
            please contact us at:
          </p>
          <p style={{ marginTop: '12px' }}>
            <strong style={{ color: 'var(--text-primary)' }}>CordiaClassroom</strong><br />
            Email: <a href="mailto:support@cordiaai.io" style={{ color: 'var(--accent)' }}>support@cordiaai.io</a><br />
            Website: <a href="https://classroom.cordiaai.io" style={{ color: 'var(--accent)' }}>https://classroom.cordiaai.io</a>
          </p>
        </Section>
      </div>
    </PublicPage>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '36px' }}>
      <h2 style={{
        fontSize: '1.15rem',
        fontWeight: '600',
        color: 'var(--accent)',
        marginBottom: '12px',
        paddingBottom: '6px',
        borderBottom: '1px solid var(--border-default)',
      }}>
        {title}
      </h2>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
        {children}
      </div>
    </div>
  );
}
