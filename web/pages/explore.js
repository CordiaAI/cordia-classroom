import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Search, X } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { pageTitle } from '../lib/pageTitle';
import { CLASSROOMS_ON } from '../lib/featureFlags';
import UserChip from '../components/UserChip';
import { DiscoverEmpty, DiscoverLoading, DiscoverRetry, SetCard, SetGroup } from '../components/DiscoverParts';
import { FILTERS, SUGGESTION_LIMIT, discoverClassrooms, discoverGuides, discoverPeople, emptySetsCopy, explorePath, isSetList, narrowing, suggestionGroups } from '../lib/discover';
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

  // Back to the plain tab: no search, no filters.
  function clear() {
    clearTimeout(debounceRef.current);
    setDraft('');
    router.replace(explorePath('', { tab }), undefined, { shallow: true, scroll: false });
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
      <div className="ex-controls">
        <form className="c-search ex-search" role="search" onSubmit={event => { event.preventDefault(); clearTimeout(debounceRef.current); update({ q: draft }); }}>
          <Search {...ICON} />
          <label className="sr-only" htmlFor="ex-q">Search everyone's public sets, classrooms and people</label>
          <input id="ex-q" className="c-input" type="search" value={draft} maxLength={200} autoComplete="off" spellCheck={false}
            placeholder="Search sets, classrooms, people" onChange={event => onType(event.target.value)} />
          {draft && <button type="button" className="c-search-clear" aria-label="Clear search" onClick={() => { setDraft(''); update({ q: '' }); }}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
        </form>
        <SegmentedControl kind="tabs" label="Discover" className="ex-tabs" scroller onKeyDown={onTabKey}>
          {TABS.map(item => (
            <button key={item.key} id={`extab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`expanel-${item.key}`}
              tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? 'is-active' : ''} onClick={() => update({ tab: item.key })}>{item.label}</button>
          ))}
        </SegmentedControl>
      </div>
      <div id={`expanel-${tab}`} role="tabpanel" aria-labelledby={`extab-${tab}`} className="ex-panel" tabIndex={-1}>
        {tab === 'guides' && <GuidesPanel q={q} filters={filters} onFilter={update} onClear={clear} />}
        {tab === 'classrooms' && <ClassroomsPanel q={q} onClear={clear} onBrowse={() => update({ tab: 'guides' })} />}
        {tab === 'people' && <PeoplePanel q={q} onClear={clear} />}
      </div>
      <style jsx>{`
        .ex { width: min(var(--page-max), 100%); margin: 0 auto; }
        .ex-head { margin: 0; }
        .ex-controls { display: grid; gap: 14px; min-width: 0; }
        .ex-search { width: 100%; }
        :global(.ex-tabs) { justify-self: start; max-width: 100%; }
        :global(.ex-tabs) button { white-space: nowrap; }
        .ex-panel { display: grid; gap: 16px; min-width: 0; outline: none; }
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

// What fills a search with no results: the most popular public sets, then sets from the student's own
// classmates (classrooms they are in). Both come from /discover/guides, so the backend's rules on
// who may be listed, named or shown at all still apply. Null until they arrive, [] when there are none.
function useSuggestions(enabled) {
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    if (!enabled) { setGroups(null); return undefined; }
    let live = true;
    Promise.all([
      discoverGuides({ limit: SUGGESTION_LIMIT }),
      CLASSROOMS_ON ? discoverGuides({ from_my_classrooms: true, limit: SUGGESTION_LIMIT * 2 }) : null,
    ]).then(([popular, classmates]) => {
      if (live) setGroups(suggestionGroups({ popular: popular?.guides, classmates: classmates?.guides }));
    });
    return () => { live = false; };
  }, [enabled]);
  return groups || [];
}

function GuidesPanel({ q, filters, onFilter, onClear }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [facets, setFacets] = useState({});
  const [extra, setExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = JSON.stringify([q, filters]);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    setExtra([]);
    discoverGuides({ q, ...filters }).then(result => {
      if (!live) return;
      if (isSetList(result)) { setData(result); setFacets(result.facets || {}); } else setFailed(true);
    });
    return () => { live = false; };
  }, [key, tries]);

  async function more() {
    setLoadingMore(true);
    const result = await discoverGuides({ q, ...filters, offset: data.guides.length + extra.length });
    setExtra(current => [...current, ...(result?.guides || [])]);
    setLoadingMore(false);
  }

  const pick = (list, current, empty) => {
    const options = (list || []).map(item => [item.id || item.name, item.name]);
    if (current && !options.some(([value]) => value === current)) options.unshift([current, 'Selected']);
    return [['', empty], ...options];
  };
  const set = (name, value) => onFilter({ [name]: value, ...(name === 'course' ? { term: '' } : {}) });
  const guides = data ? [...data.guides, ...extra] : [];
  const narrowed = narrowing(q, filters);
  const empty = Boolean(data) && !guides.length;
  const suggestions = useSuggestions(empty && narrowed);
  const copy = emptySetsCopy(q, filters);
  const action = copy.action === 'library' ? { label: copy.label, href: '/library' } : { label: copy.label, onClick: onClear };
  return (
    <>
      {!(empty && !narrowed) && <div className="exg-filters" aria-label="Filters" role="group">
        <Select label="School" value={filters.school} options={pick(facets.schools, filters.school, 'Any school')} onChange={value => set('school', value)} />
        <Select label="Course" value={filters.course} options={pick(facets.courses, filters.course, 'Any course')} onChange={value => set('course', value)} />
        <Select label="Term" value={filters.term} options={pick(facets.terms, filters.term, 'Any term')} onChange={value => set('term', value)} />
        <Select label="Made by" value={filters.creator_type} options={MADE_BY} onChange={value => set('creator_type', value)} />
        <Select label="Length" value={filters.size} options={LENGTHS} onChange={value => set('size', value)} />
        <Select label="Updated" value={filters.updated_within} options={UPDATED} onChange={value => set('updated_within', value)} />
        {CLASSROOMS_ON && (
          <label className="exg-check"><input type="checkbox" checked={filters.from_my_classrooms === 'true'} onChange={event => set('from_my_classrooms', event.target.checked ? 'true' : '')} /><span>From my classrooms</span></label>
        )}
      </div>}
      {failed && <DiscoverRetry what="public sets" onRetry={() => setTries(count => count + 1)} />}
      {!failed && data === null && <DiscoverLoading label="Finding sets" />}
      {empty && <DiscoverEmpty message={copy.message} action={action} />}
      {empty && suggestions.map(group => <SetGroup key={group.key} id={`exs-${group.key}`} title={group.title} sets={group.sets} compact />)}
      {guides.length > 0 && !narrowed && <SetGroup id="exs-listed" title="Popular public sets" sets={guides} />}
      {guides.length > 0 && narrowed && (
        <ul className="exg-list" aria-label="Public sets">
          {guides.map(guide => <SetCard key={guide.id} guide={guide} />)}
        </ul>
      )}
      {data && data.total > guides.length && (
        <button type="button" className="c-btn c-btn--secondary exg-more" disabled={loadingMore} onClick={more}>{loadingMore ? 'Loading…' : 'Show more'}</button>
      )}
      <style jsx>{`
        .exg-filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; align-items: center; }
        .exg-check { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--ink); cursor: pointer; }
        .exg-check input { width: 18px; height: 18px; accent-color: var(--olive); flex: none; }
        @media (max-width: 640px) { .exg-check { grid-column: 1 / -1; } }
        .exg-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
        .exg-more { justify-self: center; }
      `}</style>
    </>
  );
}

function ClassroomsPanel({ q, onClear, onBrowse }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState('');
  async function load() {
    const data = await discoverClassrooms({ q });
    if (Array.isArray(data?.classrooms)) { setList(data.classrooms); setFailed(false); } else setFailed(true);
  }
  useEffect(() => { setList(null); setFailed(false); load(); }, [q, tries]);

  async function join(room) {
    const result = await requestJoin(room.id, {});
    if (result?.status === 'active') { router.push('/classrooms/' + room.id); return; }
    if (result?.detail === 'consent_required') { router.push('/classrooms/' + room.id); return; }
    setNote(joinMessage(result));
    load();
  }

  if (failed) return <DiscoverRetry what="public classrooms" onRetry={() => setTries(count => count + 1)} />;
  if (list === null) return <DiscoverLoading label="Finding classrooms" />;
  if (!list.length) {
    return q.trim()
      ? <DiscoverEmpty message={`No public classrooms match “${q.trim()}”.`} action={{ label: 'Clear search', onClick: onClear }} />
      : <DiscoverEmpty message="No public classrooms yet." action={{ label: 'Browse public sets', onClick: onBrowse }} />;
  }
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
        .exc-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .exc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; min-width: 0; }
        .exc-main { display: grid; gap: 6px; min-width: 0; }
        .exc-name { font: 600 var(--fs-17)/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
      `}</style>
    </>
  );
}

function PeoplePanel({ q, onClear }) {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const searching = q.trim().length >= 2;
  useEffect(() => {
    if (!searching) { setList([]); setFailed(false); return undefined; }
    let live = true;
    setList(null);
    setFailed(false);
    discoverPeople(q).then(data => {
      if (!live) return;
      if (Array.isArray(data?.people)) setList(data.people); else setFailed(true);
    });
    return () => { live = false; };
  }, [q, tries]);
  if (!searching) return <DiscoverEmpty message="Search by name or username to find people with public profiles." action={{ label: 'Search people', onClick: () => document.getElementById('ex-q')?.focus() }} />;
  if (failed) return <DiscoverRetry what="people" onRetry={() => setTries(count => count + 1)} />;
  if (list === null) return <DiscoverLoading label="Finding people" />;
  if (!list.length) return <DiscoverEmpty message={`No public profiles match “${q.trim()}”.`} action={{ label: 'Clear search', onClick: onClear }} />;
  return (
    <ul className="c-card exp-list" aria-label="People">
      {list.map(person => <li key={person.username}><UserChip person={person} meta={person.school || ''} /></li>)}
      <style jsx>{`
        .exp-list { margin: 0; padding: 12px 16px; list-style: none; display: grid; gap: 10px; }
      `}</style>
    </ul>
  );
}
