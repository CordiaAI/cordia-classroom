import Link from 'next/link';
import PublicPage from './PublicPage';
import Faq from './Faq';
import { PLAN_LINE } from '../lib/brand.mjs';
import { USE_CASES, useCasePath } from '../lib/useCases/index.mjs';
import { walkthroughEvent } from '../lib/walkthrough';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-11-08" -> "November 8, 2026", the same on the server and in every browser.
const longDate = iso => { const [year, month, day] = iso.split('-').map(Number); return `${MONTHS[month - 1]} ${day}, ${year}`; };

// One use-case page from one content file (lib/useCases/). The order is fixed: breadcrumb, H1,
// answer-first opening, how it works, screenshots, question sections, who it's for, the plan line,
// FAQ, the call to action, then the last-updated date and links. The call to action is "Make your
// first study guide free" (signup?from=<slug>) unless the page names its own, such as the Chrome
// Web Store for the extension page, which then keeps the signup link as a second line. The head and JSON-LD (WebPage
// with dateModified, BreadcrumbList, FAQPage) come from PublicPage and the public pages list.
export default function UseCasePage({ page }) {
  const path = useCasePath(page);
  const siblings = USE_CASES.filter(other => other.slug !== page.slug);
  const signup = `/signup?from=${page.slug}`;
  return (
    <PublicPage path={path} faq={page.faq} faqInPage>
      <article className="uc">
        <nav aria-label="Breadcrumb" className="uc-crumbs">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li aria-current="page">{page.crumb}</li>
          </ol>
        </nav>

        <h1 className="uc-title">{page.h1}</h1>
        <div className="uc-lede">{page.lede.map(sentence => <p key={sentence}>{sentence}</p>)}</div>

        <section className="uc-section" aria-labelledby="uc-how">
          <h2 id="uc-how">How it works</h2>
          <ol className="uc-steps">{page.steps.map(step => <li key={step}>{step}</li>)}</ol>
        </section>

        {page.screenshots?.length > 0 && (
          <section className="uc-section" aria-labelledby="uc-shots">
            <h2 id="uc-shots">What it looks like</h2>
            <div className="uc-shots">
              {page.screenshots.map(shot => (
                <figure key={shot.src} className="uc-shot">
                  <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async" />
                  <figcaption>{shot.caption}</figcaption>
                </figure>
              ))}
            </div>
            {page.screenshotNote && <p className="uc-note">{page.screenshotNote}</p>}
          </section>
        )}

        {page.sections.map((section, index) => (
          <section key={section.question} className="uc-section" aria-labelledby={`uc-q${index}`}>
            <h2 id={`uc-q${index}`}>{section.question}</h2>
            <p className="uc-answer">{section.answer}</p>
            {section.paragraphs?.map(text => <p key={text}>{text}</p>)}
            {section.bullets && <ul>{section.bullets.map(text => <li key={text}>{text}</li>)}</ul>}
            {section.link && <p><Link href={section.link.href}>{section.link.label}</Link></p>}
          </section>
        ))}

        <section className="uc-section" aria-labelledby="uc-who">
          <h2 id="uc-who">Who it&apos;s for</h2>
          <p>For example:</p>
          <ul>{page.scenarios.map(text => <li key={text}>{text}</li>)}</ul>
        </section>

        <p className="uc-plan">{PLAN_LINE} <Link href="/pricing">See pricing</Link></p>

        <Faq items={page.faq} />

        <p className="uc-cta">
          {page.cta
            ? <a href={page.cta.href} className="c-btn c-btn--primary" target="_blank" rel="noreferrer" onClick={() => page.cta.event && walkthroughEvent(page.cta.event)}>{page.cta.label}</a>
            : <Link href={signup} className="c-btn c-btn--primary">Make your first study guide free</Link>}
        </p>
        {page.cta && <p className="uc-cta-more">No account yet? <Link href={signup}>Make your first study guide free</Link></p>}

        <footer className="uc-meta">
          <p>Last updated <time dateTime={page.updated}>{longDate(page.updated)}</time></p>
          <nav aria-label="More from Cordia Classroom">
            {siblings.map(other => <Link key={other.slug} href={useCasePath(other)}>{other.footerLabel}</Link>)}
            <Link href="/pricing">Pricing</Link>
          </nav>
        </footer>
      </article>
      <style jsx>{`
        .uc { width: min(var(--page-max), 100%); margin: 0 auto; color: var(--ink); }
        .uc-crumbs ol { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .uc-crumbs li + li::before { content: '›'; margin-right: 8px; color: var(--muted); }
        .uc-crumbs :global(a) { color: var(--muted); }
        .uc-title { margin: 0; max-width: 22em; }
        .uc-lede { max-width: 42em; margin-top: 16px; }
        .uc-lede p { margin: 0 0 8px; color: var(--text-secondary); font: 500 var(--fs-17)/1.55 var(--font-sans); }
        .uc-section { margin-top: 40px; max-width: 46em; }
        .uc-section p, .uc-section li { color: var(--text-secondary); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .uc-section ul, .uc-steps { display: grid; gap: 8px; margin: 12px 0 0; padding-left: 20px; }
        .uc-answer { color: var(--ink) !important; font-weight: 600 !important; }
        .uc-shots { display: grid; gap: 20px; margin-top: 16px; }
        .uc-shot { margin: 0; }
        .uc-shot img { display: block; width: 100%; max-width: 800px; height: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--surface-card); }
        .uc-shot figcaption, .uc-note { margin-top: 8px; color: var(--muted) !important; font: 500 var(--fs-13)/1.5 var(--font-sans) !important; }
        .uc-section:has(.uc-shots) { max-width: 800px; }
        .uc-plan { margin: 40px 0 0; max-width: 46em; padding: 16px 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--lg-card); color: var(--ink); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .uc-cta { margin: 40px 0 0; }
        .uc-cta-more { margin: 12px 0 0; color: var(--text-secondary); font: 500 var(--fs-15)/1.6 var(--font-sans); }
        .uc-meta { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--hairline); color: var(--muted); font: 500 var(--fs-13)/1.5 var(--font-sans); }
        .uc-meta p { margin: 0 0 8px; }
        .uc-meta nav { display: flex; flex-wrap: wrap; gap: 8px 20px; }
      `}</style>
    </PublicPage>
  );
}
