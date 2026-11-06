import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BadgeCheck, ChevronDown, Search, X } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { pageTitle } from '../lib/pageTitle';
import { CLASSROOMS_ON } from '../lib/featureFlags';
import { SectionLoader } from '../components/CordiaLoader';
import UserChip from '../components/UserChip';
import { FILTERS, discoverClassrooms, discoverGuides, discoverPeople, explorePath, studiedBy } from '../lib/discover';
import { KIND_LABELS, joinMessage, requestJoin } from '../lib/classrooms';
import SegmentedControl from '../components/SegmentedControl';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const TABS = [
  { key: 'guides', label: 'Guides' },
  ...(CLASSROOMS_ON ? [{ key: 'classrooms', label: 'Classrooms' }] : []),
  { key: 'people', label: 'People' },
];
const MADE_BY = [['', 'Anyone'], ['instructor', 'Verified instructors'], ['student', 'Students']];
const LENGTHS = [['', 'Any length'], ['short', 'Under 20 questions'], ['medium', '20 to 60 questions'], ['long', 'Over 60 questions']];
const UPDATED = [['', 'Any time'], ['7', 'Past week'], ['30', 'Past month'], ['365', 'Past year']];
const text = value => (typeof value === 'string' ? value : '');

// Discover: everyone's public guides, public classrooms and public profiles. Filters and the query
// live in the address, so a search can be shared or reopened. The ⌘K panel links here.
export default function Explore() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const q = text(router.query.q);
  const tab = TABS.some(item => item.key === router.query.tab) ? router.query.tab : 'guides';
  const filters = Object.fromEntries(FILTERS.map(key => [key, text(router.query[key])]));
  const [draft, setDraft] = useState(q);
  const debounceRef = useRef(null);

  useEffect(() => { setDraft(q); }, [q]);

  function update(next) {
    const merged = { tab, ...filters, ...next };
    router.replace(explorePath(next.q ?? q, merged), undefined, { shallow: true, scroll: false });
  }

  function onType(value) {
    setDraft(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => update({ q: value }), 300);
  }

  function onTabKey(event) {
    const index = TABS.findIndex(item => item.key === tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    update({ tab: next.key });
    document.getElementById(`extab-${next.key}`)?.focus();
  }

  if (!ready || !router.isReady) return null;
  return (
    <div className="c-page ex">
      <Head><title>{pageTitle('Discover')}</title></Head>
      <header className="c-page-head ex-head">
        <h1 className="c-title">Discover</h1>
      </header>
      <form className="c-search ex-search" role="search" onSubmit={event => { event.preventDefault(); clearTimeout(debounceRef.current); update({ q: draft }); }}>
        <Search {...ICON} />
        <label className="sr-only" htmlFor="ex-q">Search everyone's public sets, classrooms and people</label>
        <input id="ex-q" className="c-input" type="search" value={draft} maxLength={200} autoComplete="off" spellCheck={false}
          placeholder="Search public sets, classrooms and people" onChange={event => onType(event.target.value)} />
        {draft && <button type="button" className="c-search-clear" aria-label="Clear search" onClick={() => { setDraft(''); update({ q: '' }); }}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
      </form>
      <SegmentedControl kind="tabs" label="Discover" className="ex-tabs" scroller onKeyDown={onTabKey}>
        {TABS.map(item => (
          <button key={item.key} id={`extab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`expanel-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? 'is-active' : ''} onClick={() => update({ tab: item.key })}>{item.label}</button>
        ))}
      </SegmentedControl>
      <div id={`expanel-${tab}`} role="tabpanel" aria-labelledby={`extab-${tab}`} className="ex-panel">
        {tab === 'guides' && <GuidesPanel q={q} filters={filters} onFilter={update} />}
        {tab === 'classrooms' && <ClassroomsPanel q={q} />}
        {tab === 'people' && <PeoplePanel q={q} />}
      </div>
      <style jsx>{`
        .ex { display: grid; gap: 14px; width: min(860px, 100%); margin: 0 auto; }
        .ex-head { margin: 0; }
        .ex-search { width: 100%; }
        :global(.ex-tabs) { justify-self: start; max-width: 100%; }
        :global(.ex-tabs) button { white-space: nowrap; }
        .ex-panel { display: grid; gap: 12px; min-width: 0; }
      `}</style>
    </div>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="exf">
      <span className="sr-only">{label}</span>
      <select className="c-select exf-select" value={value} onChange={event => onChange(event.target.value)} aria-label={label}>
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
      <style jsx>{`
        .exf { display: block; min-width: 0; }
        .exf-select { width: 100%; height: 44px; }
      `}</style>
    </label>
  );
}

function GuidesPanel({ q, filters, onFilter }) {
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState([]);
  const [open, setOpen] = useState({});
  const [loadingMore, setLoadingMore] = useState(false);
  const key = JSON.stringify([q, filters]);

  useEffect(() => {
    let live = true;
    setData(null);
    setExtra([]);
    discoverGuides({ q, ...filters }).then(result => { if (live) setData(result?.guides ? result : { guides: [], total: 0, facets: {} }); });
    return () => { live = false; };
  }, [key]);

  async function more() {
    setLoadingMore(true);
    const result = await discoverGuides({ q, ...filters, offset: data.guides.length + extra.length });
    setExtra(current => [...current, ...(result?.guides || [])]);
    setLoadingMore(false);
  }

  const facets = data?.facets || {};
  const pick = (list, current, empty) => {
    const options = (list || []).map(item => [item.id || item.name, item.name]);
    if (current && !options.some(([value]) => value === current)) options.unshift([current, 'Selected']);
    return [['', empty], ...options];
  };
  const set = (name, value) => onFilter({ [name]: value, ...(name === 'course' ? { term: '' } : {}) });
  const guides = data ? [...data.guides, ...extra] : [];
  return (
    <>
      <div className="exg-filters" aria-label="Filters" role="group">
        <Select label="School" value={filters.school} options={pick(facets.schools, filters.school, 'Any school')} onChange={value => set('school', value)} />
        <Select label="Course" value={filters.course} options={pick(facets.courses, filters.course, 'Any course')} onChange={value => set('course', value)} />
        <Select label="Term" value={filters.term} options={pick(facets.terms, filters.term, 'Any term')} onChange={value => set('term', value)} />
        <Select label="Made by" value={filters.creator_type} options={MADE_BY} onChange={value => set('creator_type', value)} />
        <Select label="Length" value={filters.size} options={LENGTHS} onChange={value => set('size', value)} />
        <Select label="Updated" value={filters.updated_within} options={UPDATED} onChange={value => set('updated_within', value)} />
        {CLASSROOMS_ON && (
          <label className="exg-check"><input type="checkbox" checked={filters.from_my_classrooms === 'true'} onChange={event => set('from_my_classrooms', event.target.checked ? 'true' : '')} /><span>From my classrooms</span></label>
        )}
      </div>
      {data === null && <SectionLoader label="Finding sets" />}
      {data && !guides.length && <p className="c-card exg-empty">{q ? `No public sets match “${q}”.` : 'No public sets match these filters.'}</p>}
      {guides.length > 0 && (
        <ul className="exg-list" aria-label="Public sets">
          {guides.map(guide => (
            <li key={guide.id} className="c-card exg-card">
              <Link href={'/sets/' + guide.id} className="exg-title">{guide.title}</Link>
              {guide.outline?.[0] && <p className="exg-outline">{guide.outline[0]}</p>}
              <div className="exg-meta">
                {guide.author ? <UserChip person={guide.author} /> : <span className="c-meta">Anonymous</span>}
                {guide.verified && <span className="exg-badge"><BadgeCheck size={16} strokeWidth={1.75} aria-hidden="true" />Verified instructor</span>}
              </div>
              <p className="c-meta exg-facts">
                {[guide.course ? [guide.course.code, guide.course.school].filter(Boolean).join(', ') : '', guide.term,
                  `${guide.question_count} ${guide.question_count === 1 ? 'question' : 'questions'}`, studiedBy(guide.studied_by)].filter(Boolean).join(' · ')}
              </p>
              {guide.similar?.length > 0 && (
                <div className="exg-similar">
                  <button type="button" className="c-btn c-btn--quiet c-btn--sm" aria-expanded={Boolean(open[guide.id])}
                    onClick={() => setOpen(current => ({ ...current, [guide.id]: !current[guide.id] }))}>
                    +{guide.similar.length} similar<ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={open[guide.id] ? 'exg-flip' : ''} />
                  </button>
                  {open[guide.id] && (
                    <ul className="exg-similar-list">
                      {guide.similar.map(item => <li key={item.id}><Link href={'/sets/' + item.id}>{item.title}</Link></li>)}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > guides.length && (
        <button type="button" className="c-btn c-btn--secondary exg-more" disabled={loadingMore} onClick={more}>{loadingMore ? 'Loading…' : 'Show more'}</button>
      )}
      <style jsx>{`
        .exg-filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; align-items: center; }
        .exg-check { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--ink); cursor: pointer; }
        .exg-check input { width: 18px; height: 18px; accent-color: var(--olive); flex: none; }
        .exg-empty { margin: 0; padding: 16px; color: var(--muted-ink); }
        .exg-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
        .exg-card { display: grid; gap: 8px; padding: 16px; min-width: 0; }
        .exg-card :global(.exg-title) { font: 600 17px/1.3 var(--font-sans); color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
        .exg-card :global(.exg-title:hover) { text-decoration: underline; text-underline-offset: 3px; }
        .exg-outline { margin: 0; color: var(--muted-ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .exg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
        .exg-badge { display: inline-flex; align-items: center; gap: 4px; font: 600 13px/1.3 var(--font-sans); color: var(--olive-ink); }
        .exg-facts { margin: 0; overflow-wrap: anywhere; }
        .exg-similar { display: grid; gap: 4px; justify-items: start; }
        .exg-similar :global(.exg-flip) { transform: rotate(180deg); }
        .exg-similar-list { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
        .exg-similar-list :global(a) { color: var(--ink); overflow-wrap: anywhere; }
        .exg-more { justify-self: center; }
      `}</style>
    </>
  );
}

function ClassroomsPanel({ q }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [note, setNote] = useState('');
  async function load() {
    const data = await discoverClassrooms({ q });
    setList(Array.isArray(data?.classrooms) ? data.classrooms : []);
  }
  useEffect(() => { setList(null); load(); }, [q]);

  async function join(room) {
    const result = await requestJoin(room.id, {});
    if (result?.status === 'active') { router.push('/classrooms/' + room.id); return; }
    if (result?.detail === 'consent_required') { router.push('/classrooms/' + room.id); return; }
    setNote(joinMessage(result));
    load();
  }

  if (list === null) return <SectionLoader label="Finding classrooms" />;
  if (!list.length) return <p className="c-card exc-empty">{q ? `No public classrooms match “${q}”.` : 'No public classrooms yet. Classrooms listed on a course page show up here.'}</p>;
  return (
    <>
      {note && <p className="c-meta" role="status">{note}</p>}
      <ul className="exc-list" aria-label="Public classrooms">
        {list.map(room => (
          <li key={room.id} className="c-card exc-row">
            <div className="exc-main">
              <span className="exc-name">{room.name}</span>
              <span className="c-meta">{[KIND_LABELS[room.kind], room.course, `${room.member_count} ${room.member_count === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}</span>
              {room.owner && <UserChip person={room.owner} meta="Owner" />}
            </div>
            {room.my_status === 'active' ? <Link href={'/classrooms/' + room.id} className="c-btn c-btn--secondary c-btn--sm">Open</Link>
              : room.my_status === 'pending' ? <span className="c-meta">Asked to join</span>
                : <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => join(room)}>{room.join_policy === 'approval' ? 'Ask to join' : 'Join'}</button>}
          </li>
        ))}
      </ul>
      <style jsx>{`
        .exc-empty { margin: 0; padding: 16px; color: var(--muted-ink); }
        .exc-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .exc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; min-width: 0; }
        .exc-main { display: grid; gap: 6px; min-width: 0; }
        .exc-name { font: 600 16px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
      `}</style>
    </>
  );
}

function PeoplePanel({ q }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return undefined; }
    let live = true;
    setList(null);
    discoverPeople(q).then(data => { if (live) setList(Array.isArray(data?.people) ? data.people : []); });
    return () => { live = false; };
  }, [q]);
  if (q.trim().length < 2) return <p className="c-card exp-empty">Type a name or username to find people with public profiles.</p>;
  if (list === null) return <SectionLoader label="Finding people" />;
  if (!list.length) return <p className="c-card exp-empty">No public profiles match “{q}”.</p>;
  return (
    <ul className="c-card exp-list" aria-label="People">
      {list.map(person => <li key={person.username}><UserChip person={person} meta={person.school || ''} /></li>)}
      <style jsx>{`
        .exp-list { margin: 0; padding: 12px 16px; list-style: none; display: grid; gap: 10px; }
        .exp-empty { margin: 0; padding: 16px; color: var(--muted-ink); }
      `}</style>
    </ul>
  );
}
