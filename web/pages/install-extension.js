import PublicPage from '../components/PublicPage';
import { Puzzle } from 'lucide-react';
import AcademicInfinityMark from '../components/AcademicInfinityMark';
import { EXTENSION_STORE_URL } from '../lib/extension';
import { walkthroughEvent } from '../lib/walkthrough';

export default function InstallExtensionPage() {
  return (
    <PublicPage title="Get the Chrome extension — Cordia Classroom" description="Install the Cordia Classroom extension and capture course material in a few clicks." path="/install-extension">
    <div className="extension-install-page fade-in">
      <div className="extension-install-hero">
        <AcademicInfinityMark className="extension-install-logo" />
        <div>
          <p className="extension-install-eyebrow">CordiaClassroom for Chrome</p>
          <h1>Capture course material in a few clicks.</h1>
          <p>Install the extension once, then use it on any page you want to turn into study materials.</p>
        </div>
      </div>

      <ol className="extension-install-steps">
        <li className="extension-install-step">
          <span className="extension-install-number">1</span>
          <div>
            <h2>Download it from the Chrome Web Store</h2>
            <p>Open the listing, then select <strong>Add to Chrome</strong>.</p>
            <a className="extension-install-store-link" onClick={() => walkthroughEvent('extension-opened')} href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
              Open CordiaClassroom in Chrome Web Store <span aria-hidden="true">↗</span>
            </a>
          </div>
        </li>

        <li className="extension-install-step">
          <span className="extension-install-number">2</span>
          <div>
            <h2>Pin CordiaClassroom to your browser</h2>
            <p>Click Chrome&apos;s puzzle-piece Extensions icon, then click the pin next to CordiaClassroom. The icon will stay visible in your toolbar.</p>
            <div className="extension-install-illustration" role="img" aria-label="Example Chrome toolbar with the CordiaClassroom extension icon circled">
              <div className="extension-install-toolbar">
                <span className="extension-install-url">canvas.yourschool.edu</span>
                <Puzzle className="extension-install-puzzle" aria-hidden="true" />
                <span className="extension-install-circle" aria-hidden="true"><img src="/icon128.png" alt="" /></span>
                <span className="extension-install-more" aria-hidden="true">⋮</span>
              </div>
              <p>Look for the circled CordiaClassroom icon.</p>
            </div>
          </div>
        </li>

        <li className="extension-install-step">
          <span className="extension-install-number">3</span>
          <div>
            <h2>Open the page you want to capture</h2>
            <p>Go to a course page, lecture slides, textbook page, or other material. Click the CordiaClassroom icon in your toolbar and sign in if asked.</p>
          </div>
        </li>

        <li className="extension-install-step">
          <span className="extension-install-number">4</span>
          <div>
            <h2>Make and save your guide</h2>
            <p>Click <strong>Make study guide</strong>. One button captures, reads, focuses, and creates the guide. Review it, then click <strong>Save to Classroom</strong> to save and open the exact guide.</p>
          </div>
        </li>
      </ol>

      <div className="extension-install-footer">
        <p>Installed already? Open any course material and click the CordiaClassroom icon to begin.</p>
        <a className="btn" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">Open Chrome Web Store</a>
      </div>

      <style jsx>{`
        .extension-install-page { width: min(var(--page-max), 100%); margin: 0 auto; padding: 16px 0 40px; }
        .extension-install-hero { display: flex; align-items: center; gap: 18px; margin-bottom: 30px; padding: 24px 28px; }
        /* The mark sits in its own space (it was flush against the card's edge; dark mode shows it light). */
        .extension-install-hero :global(.extension-install-logo) { flex: none; }
        .extension-install-eyebrow { color: var(--accent); font-size:13px; font-weight:600; letter-spacing:0; text-transform:none; margin-bottom: 5px; }
        h1 { font-size: max(13px, clamp(1.7rem, 4vw, 2.35rem)); letter-spacing:-0.015em; line-height:1.15; margin: 0 0 8px; }
        .extension-install-hero p:last-child { color: var(--text-secondary); line-height:1.5; max-width: 590px; }
        .extension-install-steps { list-style: none; counter-reset: none; display: grid; gap: 14px; padding: 0; margin: 0; }
        .extension-install-step { min-width: 0; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px; padding: 20px; border: 1px solid var(--border-default); border-radius:var(--radius-lg); background: var(--bg-secondary); box-shadow: var(--shadow-sm); }
        .extension-install-number { width: 30px; height: 30px; display: grid; place-items: center; border-radius:50%; background: var(--olive); color: var(--on-olive); font-size:13px; font-weight:600; }
        h2 { font-size:15px; margin: 4px 0 6px; color: var(--text-primary); }
        .extension-install-step p { color: var(--text-secondary); font-size:13px; line-height:1.5; }
        .extension-install-store-link { display: inline-flex; gap: 6px; align-items: center; margin-top: 13px; padding: 8px 12px; border-radius:12px; background: var(--accent-glow); color: var(--accent); font-size:13px; font-weight:600; }
        .extension-install-store-link:hover { text-decoration: none; box-shadow: var(--lift-shadow); transform: var(--lift); }
        .extension-install-illustration { margin-top: 16px; border: 1px solid var(--border-subtle); border-radius:12px; overflow: hidden; background: var(--bg-primary); }
        .extension-install-toolbar { min-height: 62px; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-tertiary); }
        .extension-install-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius:12px; padding: 7px 10px; background: var(--bg-secondary); color: var(--text-muted); font-size:13px; }
        .extension-install-puzzle, .extension-install-more { font-size:17px; opacity: 0.75; }
        .extension-install-circle { width: 42px; height: 42px; display: grid; place-items: center; border: 3px solid var(--accent); border-radius:50%; box-shadow: 0 0 0 4px var(--accent-glow); }
        .extension-install-circle img { width: 25px; height: 25px; border-radius:12px; }
        .extension-install-illustration p { padding: 10px 12px; color: var(--text-muted); font-size:13px; text-align: center; }
        .extension-install-footer { margin-top: 22px; padding: 20px; border-radius:var(--radius-lg); text-align: center; background: var(--accent-glow); }
        .extension-install-footer p { color: var(--text-secondary); font-size:13px; margin-bottom: 13px; }
        .extension-install-footer .btn { display: inline-block; text-decoration: none; }
        @media (max-width: 560px) { .extension-install-hero { align-items: flex-start; } .extension-install-step { padding: 16px; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; } }
      `}</style>
    </div>
    </PublicPage>
  );
}
