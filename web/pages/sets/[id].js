import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, Bookmark, BookmarkCheck, Brain, Copy, Flag, Globe, Layers, Link2, ListChecks, Lock, Play, ShieldAlert, Users, UsersRound } from 'lucide-react';
import { getToken } from '../../lib/api';
import { pageTitle } from '../../lib/pageTitle';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import PublicPage from '../../components/PublicPage';
import UserChip from '../../components/UserChip';
import Menu from '../../components/Menu';
import FeedbackModal from '../../components/FeedbackModal';
import ReportSheet from '../../components/ReportSheet';
import GuideAsk from '../../components/GuideAsk';
import { VISIBILITY_LABELS, copyGuide, guideLink, loadPublicGuide, saveForLater } from '../../lib/guideSharing';
import { outlineLine } from '../../lib/guideVisibility.mjs';
import { CLASSROOMS_ON, PER_VIEWER_PROGRESS } from '../../lib/featureFlags';
import AddToClassroom from '../../components/AddToClassroom';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const VISIBILITY_ICONS = { public: Globe, link: Link2, classroom: Users, private: Lock };

// A guide as someone else sees it: title, outline preview, question count, author (or "Anonymous
// classmate") and how many people studied it. Signed-out visitors see the preview and a sign-up
// button. Private, held and blocked guides look the same as a wrong link. Search engines index
// public guides only.
export default function SetPage() {
  const router = useRouter();
  const id = String(router.query.id || '');
  const [signedIn, setSignedIn] = useState(null);
  const [result, setResult] = useState(null); // { guide } | { missing } | { error }
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [reporting, setReporting] = useState(''); // '' | 'sheet' | 'feedback' (before the server's update)
  const [adding, setAdding] = useState(false);

  useEffect(() => { setSignedIn(Boolean(getToken())); }, []);

  useEffect(() => {
    if (!id || signedIn === null) return undefined;
    let active = true;
    setResult(null);
    loadPublicGuide(id).then(data => { if (active) setResult(data); });
    return () => { active = false; };
  }, [id, signedIn]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const gate = useLoadGate(Boolean(result));
  const guide = result?.guide;

  async function toggleSave() {
    setBusy('save');
    const { saved, error } = await saveForLater(guide.id, !guide.saved);
    setBusy('');
    if (error) { setToast(error); return; }
    setResult(current => ({ guide: { ...current.guide, saved } }));
    setToast(saved ? 'Saved to your Library' : 'Removed from Saved');
  }

  // Study on your own copy, so your progress is yours: reuse the one you made, or make it now.
  async function study(forceCopy = false) {
    if (guide.is_owner) { router.push('/guide/' + guide.id); return; }
    if (guide.my_copy_id && !forceCopy) { router.push('/guide/' + guide.my_copy_id); return; }
    setBusy(forceCopy ? 'copy' : 'study');
    const { guideId, error } = await copyGuide(guide.id, Boolean(guide.my_copy_id));
    setBusy('');
    if (error) { setToast(error); return; }
    router.push('/guide/' + guideId);
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(guideLink(guide.id));
      setToast('Link copied');
    } catch {
      setToast(guideLink(guide.id));
    }
  }

  const noindex = !guide || guide.visibility !== 'public';
  const head = (
    <Head>
      <title>{pageTitle(guide ? guide.title : 'Study guide')}</title>
      {noindex && <meta name="robots" content="noindex" key="robots" />}
    </Head>
  );

  if (signedIn === null || gate === 'waiting' || gate === 'loader') {
    return <>{head}{signedIn === false ? <PublicPage title="Study guide · Cordia" description="A study guide on Cordia Classroom." path={`/sets/${id}`}><LoadingArea phase={gate} label="Loading guide" /></PublicPage> : <LoadingArea phase={gate} label="Loading guide" />}</>;
  }

  const moreItems = guide ? [
    ...(guide.visibility !== 'private' ? [{ label: 'Copy link', icon: Link2, onSelect: share }] : []),
    ...(guide.is_owner ? [] : [
      { label: 'Report', icon: Flag, onSelect: () => setReporting('sheet') },
      { label: 'Copyright claim', meta: 'It uses your work', icon: ShieldAlert, onSelect: () => router.push(`/copyright?link=${encodeURIComponent(guideLink(guide.id))}`) },
    ]),
  ] : [];
  const VisIcon = VISIBILITY_ICONS[guide?.visibility] || Lock;
  const held = guide?.is_owner && (guide.review_status || 'ok') !== 'ok';
  const body = (
    <Reveal phase={gate}>
      <div className={'sets' + (signedIn ? ' c-page' : '')}>
        {signedIn && (
          <header className="sets-top">
            <button type="button" className="c-icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push('/library'))}><ArrowLeft {...ICON} /></button>
          </header>
        )}

        {!guide && (
          <div className="c-card sets-empty" role="status">
            <h1 className="c-section-title">{result?.missing ? "This guide isn't available" : "Couldn't load this guide"}</h1>
            <p className="c-meta">{result?.missing ? 'The link may be wrong, or the guide may be private now.' : 'Check your connection and try again.'}</p>
            <Link href={signedIn ? '/library' : '/'} className="c-btn c-btn--secondary">{signedIn ? 'Go to Library' : 'Go to Cordia'}</Link>
          </div>
        )}

        {guide && (
          <article className="c-card sets-card" aria-labelledby="sets-title">
            <h1 id="sets-title" className="c-title sets-title">{guide.title}</h1>
            <div className="sets-who">
              {guide.author
                ? <UserChip person={guide.author} />
                : <UserChip person={{ display_name: 'Anonymous classmate', initials: '?' }} />}
            </div>
            <p className="sets-facts">
              <span>{guide.question_count} {guide.question_count === 1 ? 'question' : 'questions'}</span>
              <span><UsersRound size={16} strokeWidth={1.75} aria-hidden="true" />Studied by {guide.studied_by}</span>
              {guide.is_owner && <span><VisIcon size={16} strokeWidth={1.75} aria-hidden="true" />{VISIBILITY_LABELS[guide.visibility]}</span>}
            </p>
            {held && <p className="sets-held" role="status"><ShieldAlert {...ICON} />Held for review. Only you can see it until it's checked.</p>}

            {signedIn ? (
              <div className="sets-actions">
                {PER_VIEWER_PROGRESS && !guide.is_owner ? (
                  // Study the original with your own progress (Stage 4); a copy is only for editing.
                  <span className="sets-study" role="group" aria-label="Study this guide">
                    <Link href={'/learn/' + guide.id} className="c-btn c-btn--primary"><Brain {...ICON} />Learn</Link>
                    <Link href={'/flashcards/study?guideId=' + guide.id} className="c-btn c-btn--secondary"><Layers {...ICON} />Flashcards</Link>
                    <Link href={'/quiz/' + guide.id} className="c-btn c-btn--secondary"><ListChecks {...ICON} />Quiz</Link>
                  </span>
                ) : (
                  <button type="button" className="c-btn c-btn--primary" disabled={Boolean(busy)} onClick={() => study(false)}>
                    <Play {...ICON} />{busy === 'study' ? 'Opening…' : guide.is_owner ? 'Open' : 'Study'}
                  </button>
                )}
                {!guide.is_owner && (
                  <>
                    <button type="button" className="c-btn c-btn--secondary" aria-pressed={Boolean(guide.saved)} disabled={Boolean(busy)} onClick={toggleSave}>
                      {guide.saved ? <BookmarkCheck {...ICON} /> : <Bookmark {...ICON} />}{guide.saved ? 'Saved' : 'Save'}
                    </button>
                    <button type="button" className="c-btn c-btn--secondary" disabled={Boolean(busy)} onClick={() => study(true)}>
                      <Copy {...ICON} />{busy === 'copy' ? 'Copying…' : 'Make a copy'}
                    </button>
                  </>
                )}
                <span className="sets-row-end">
                  {CLASSROOMS_ON ? (
                    (guide.is_owner || ['public', 'link'].includes(guide.visibility)) && (
                      <button type="button" className="c-btn c-btn--secondary" onClick={() => setAdding(true)}><Users {...ICON} />Add to classroom</button>
                    )
                  ) : (
                    <button type="button" className="c-btn c-btn--secondary" disabled>
                      <Users {...ICON} />Add to classroom<span className="sets-soon">Coming soon</span>
                    </button>
                  )}
                  {moreItems.length > 0 && <Menu label="More" items={moreItems} />}
                </span>
              </div>
            ) : (
              <div className="sets-actions">
                <Link href="/signup" className="c-btn c-btn--primary">Sign up free to study this</Link>
                <Link href="/login" className="c-btn c-btn--secondary">Sign in</Link>
              </div>
            )}

            {guide.outline.length > 0 && (
              <section className="sets-outline" aria-labelledby="sets-outline-title">
                <h2 id="sets-outline-title" className="c-section-title">Outline preview</h2>
                <ul>
                  {guide.outline.map(outlineLine).filter(line => line.text).map((line, index) => (
                    <li key={index} className={line.heading ? 'is-heading' : ''}>{line.text}</li>
                  ))}
                </ul>
              </section>
            )}
            {signedIn && <GuideAsk guideId={guide.id} />}
            {!signedIn && <p className="c-meta sets-report">Is this your work, shared without permission? <Link href={`/copyright?link=${encodeURIComponent(guideLink(guide.id))}`}>Report it</Link>.</p>}
          </article>
        )}
      </div>
      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      {adding && guide && (
        <AddToClassroom item={{ type: 'guide', id: guide.id, title: guide.title, mine: guide.is_owner, private: guide.visibility === 'private' }}
          onClose={() => setAdding(false)} onAdded={room => { setAdding(false); setToast(`Added to ${room?.name || 'the classroom'}`); }} />
      )}
      {reporting === 'sheet' && (
        <ReportSheet targetType="guide" targetId={guide.id} name={guide.title} onClose={() => setReporting('')} onUnavailable={() => setReporting('feedback')} />
      )}
      {reporting === 'feedback' && (
        <FeedbackModal initialCategory="other" initialMessage={`Report guide ${guideLink(guide.id)}: `} onClose={() => setReporting('')} />
      )}
      <style jsx>{`
        .sets { width: min(760px, 100%); margin: 0 auto; display: grid; gap: 16px; }
        .sets-top { display: flex; }
        .sets-empty { display: grid; gap: 12px; justify-items: start; padding: 24px; }
        .sets-card { display: grid; gap: 16px; padding: 24px; min-width: 0; }
        .sets-title { margin: 0; font-family: var(--font-display); overflow-wrap: anywhere; }
        .sets-who { min-width: 0; }
        .sets-facts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0; font: 600 14px/1.3 var(--font-sans); color: var(--muted-ink); }
        .sets-facts span { display: inline-flex; align-items: center; gap: 6px; }
        .sets-held { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 14px; border-radius: var(--r-row); background: var(--warning-bg); color: var(--ink); font: 600 14px/1.4 var(--font-sans); }
        .sets-held :global(.lucide) { color: var(--warning); flex: none; }
        .sets-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .sets-row-end { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
        .sets-study { display: inline-flex; flex-wrap: wrap; gap: 8px; }
        .sets-soon { margin-left: 4px; font: 500 12px/1 var(--font-sans); color: var(--muted-ink); }
        .sets-outline { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 16px; }
        .sets-outline ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
        .sets-outline li { color: var(--ink); overflow-wrap: anywhere; }
        .sets-outline li.is-heading { font: 600 16px/1.4 var(--font-sans); margin-top: 6px; }
        .sets-report { margin: 0; }
        .sets-report :global(a) { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 560px) {
          .sets-card { padding: 18px; }
          .sets-actions :global(.c-btn) { flex: 1 1 auto; justify-content: center; }
          .sets-row-end { flex: 1 1 100%; margin-left: 0; }
          .sets-study { flex: 1 1 100%; }
        }
      `}</style>
    </Reveal>
  );

  if (!signedIn) {
    return (
      <>
        {head}
        <PublicPage title={pageTitle(guide ? guide.title : 'Study guide')} description={guide ? `${guide.title}: a study guide on Cordia Classroom.` : 'A study guide on Cordia Classroom.'} path={`/sets/${id}`}>
          {body}
        </PublicPage>
      </>
    );
  }
  return <>{head}{body}</>;
}
