// The one-off clean of guides the first Notion import (F1) filed, run on a real Postgres (PGlite, in
// memory). From the reviewer's sqlprobe.mjs: pasting the whole file changes nothing; Part 1 lists the
// exact lines; with commit, only F1's own lines in F1's window go; a second run changes nothing; the
// synced_hash rule is unchanged; the line rule matches the app's (tests/fixtures/f1_import_lines.json).
// PGlite is not a dependency of the app: set PGLITE_MODULE to its dist/index.js, or this is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'supabase/oneoff/20261119_clean_notion_import_lines.sql'), 'utf8');
const FIXTURE = require('./fixtures/f1_import_lines.json').lines;
const PART2_AT = SQL.indexOf('-- ===== PART 2');
const PART1 = SQL.slice(0, PART2_AT);
const PART2 = SQL.slice(PART2_AT);
const FIX_LIVE = "timestamptz '2026-11-20 18:00:00+00' as fix_live";
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
const USER = '00000000-0000-4000-8000-0000000000aa';
const IN_WINDOW = '2026-11-19 05:00:00+00';

function pgliteModule() {
  const candidates = [process.env.PGLITE_MODULE, path.join(root, 'node_modules/@electric-sql/pglite/dist/index.js'),
    path.join(root, 'web/node_modules/@electric-sql/pglite/dist/index.js')].filter(Boolean);
  return candidates.find(file => fs.existsSync(file));
}

const GUIDES = {
  f1_unedited: { notes: "## Week 3\n- Glycolysis makes ATP\n- Sub-page: Lecture 4\n- Database: Reading list\n- The rest of this Notion page wasn't imported because Notion was slow to answer." },
  f1_edited: { notes: "## Week 3\n- Glycolysis makes ATP (my edit)\n- Sub-page: Lecture 4\n- Part of this Notion page couldn't be read, so it isn't all here.", edited: true },
  f1_heading: { notes: "## Sub-page: Lab 2\n- The lab measures how fast an enzyme works at five temperatures" },
  cs_course: { notes: "## Intro to IS\n- Database: organized collection of related data\n- DBMS: software that manages a database\n- Database: a structured collection of data." },
  web_design: { notes: "## Site architecture\n- Sub-page: a page nested under a parent page\n- Breadcrumbs show the path back to the home page" },
  literature: { notes: "## Gatsby\n- Nick says the rest of this Notion page wasn't imported because\n- \"The rest of this Notion page wasn't imported because\" is a line I quote\n- Daisy's voice is full of money" },
  crlf: { notes: "## A\r\n- Sub-page: Lecture 9\r\n- Real point\r\n" },
  indented: { notes: "## B\n  - Database: Reading list\n- Real point" },
  only_lines: { notes: "- Sub-page: Lecture 1\n- Sub-page: Lecture 2" },
  blank_lines: { notes: "## C\n\n- Sub-page: Lecture 3\n\n- Kept after a blank line\n" },
  pre_f1: { notes: "- Sub-page: Lecture 4\n- Database: Westlaw and LexisNexis", created: '2026-11-10 12:00:00+00' },
  pre_f1_reimported: { notes: "- Real point\n- Sub-page: Lecture 4", created: '2026-11-10 12:00:00+00', synced: '2026-11-19 06:00:00+00' },
  post_fix: { notes: "- Database: Westlaw and LexisNexis\n- Sub-page: Lecture 4", created: '2026-11-21 09:00:00+00' },
  not_notion: { notes: "- Sub-page: Lecture 4\n- Database: Reading list\n## Database: Design principles", source: 'gdrive:x' },
  canvas_law: { notes: "- Database: Westlaw and LexisNexis\n- Statute: a written law passed by a legislature", source: 'canvas:1' },
  null_notes: { notes: null },
};
// What Part 1 lists (title: lines), and so what commit removes.
const EXPECTED = {
  f1_unedited: ['- Sub-page: Lecture 4', '- Database: Reading list', "- The rest of this Notion page wasn't imported because Notion was slow to answer."],
  f1_edited: ['- Sub-page: Lecture 4', "- Part of this Notion page couldn't be read, so it isn't all here."],
  f1_heading: ['## Sub-page: Lab 2'],
  crlf: ['- Sub-page: Lecture 9'],
  only_lines: ['- Sub-page: Lecture 1', '- Sub-page: Lecture 2'],
  blank_lines: ['- Sub-page: Lecture 3'],
  pre_f1_reimported: ['- Sub-page: Lecture 4'],
};

async function fresh(PGlite, extra = {}) {
  const db = new PGlite();
  await db.exec(`create schema if not exists public;
    create table public.study_guides (id uuid primary key, user_id uuid, title text, notes text, external_source_id text, created_at timestamptz default now());
    create table public.connector_links (user_id uuid, connector text, kind text, cordia_id text, external_id text, synced_hash text,
      removed_by_student boolean default false, updated_at timestamptz default now(), primary key (user_id, connector, kind, cordia_id));`);
  const ids = {};
  let n = 0;
  for (const [title, guide] of Object.entries({ ...GUIDES, ...extra })) {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    ids[title] = id;
    const source = guide.source || `notion:${title}`;
    const created = guide.created || IN_WINDOW;
    await db.query('insert into public.study_guides values ($1, $2, $3, $4, $5, $6)', [id, USER, title, guide.notes, source, created]);
    if (guide.notes !== null) {
      const synced = guide.edited ? hash(guide.notes.replace(' (my edit)', '')) : hash(guide.notes);
      await db.query('insert into public.connector_links values ($1, $2, $3, $4, $5, $6, false, $7)',
        [USER, source.split(':')[0], 'file', id, title, synced, guide.synced || created]);
    }
  }
  return { db, ids };
}

async function snapshot(db) {
  const rows = (await db.query(`select g.title, g.notes, l.synced_hash from public.study_guides g
    left join public.connector_links l on l.cordia_id = g.id::text order by g.title`)).rows;
  return Object.fromEntries(rows.map(row => [row.title, row]));
}

const withFixLive = text => text.split('now() as fix_live').join(FIX_LIVE);
const committed = text => withFixLive(text).replace(/\nrollback;\s*$/, '\ncommit;\n');

async function listed(db, part1 = withFixLive(PART1)) {
  const results = await db.exec(part1);
  const out = {};
  for (const row of results[results.length - 1].rows) (out[row.title] ||= []).push(row.line_to_remove);
  return out;
}

const modulePath = pgliteModule();
test('the one-off SQL on Postgres', { skip: modulePath ? false : 'PGlite not installed (set PGLITE_MODULE)' }, async t => {
  const { PGlite } = await import(pathToFileURL(modulePath).href);

  await t.test('pasting the whole file as it is changes nothing', async () => {
    const { db } = await fresh(PGlite);
    const before = await snapshot(db);
    await db.exec(SQL);
    assert.deepEqual(await snapshot(db), before);
    await db.exec(withFixLive(SQL));
    assert.deepEqual(await snapshot(db), before);
  });

  await t.test('Part 1 lists exactly the lines F1 wrote, in F1 guides from F1 window', async () => {
    const { db } = await fresh(PGlite);
    assert.deepEqual(await listed(db), EXPECTED);
  });

  await t.test('Part 2 rolled back says how much it would change', async () => {
    const { db } = await fresh(PGlite);
    const results = await db.exec(withFixLive(PART2));
    const counts = results.find(result => result.rows?.[0]?.guides_changed !== undefined).rows[0];
    assert.equal(Number(counts.guides_changed), Object.keys(EXPECTED).length);
    assert.equal(Number(counts.lines_removed), Object.values(EXPECTED).flat().length);
  });

  await t.test('with commit only those lines go, the rest stays byte for byte, and the hash rule holds', async () => {
    const { db } = await fresh(PGlite);
    const before = await snapshot(db);
    await db.exec(committed(PART2));
    const after = await snapshot(db);
    for (const title of Object.keys(GUIDES)) {
      const old = before[title].notes;
      const removed = EXPECTED[title] || [];
      const want = old === null ? null : old.split('\n').filter(line => !removed.includes(line.replace(/[ \t\r]+$/, ''))).join('\n');
      assert.equal(after[title].notes, want, title);
      const edited = GUIDES[title].edited;
      if (!removed.length || old === null) assert.equal(after[title].synced_hash, before[title].synced_hash, title);
      else if (edited) assert.equal(after[title].synced_hash, before[title].synced_hash, `${title}: an edited guide keeps its old hash`);
      else assert.equal(after[title].synced_hash, hash(after[title].notes), `${title}: an untouched guide stays untouched`);
    }
    assert.equal(after.only_lines.notes, '');
    assert.equal(after.crlf.notes, '## A\r\n- Real point\r\n');
    assert.equal(after.blank_lines.notes, '## C\n\n\n- Kept after a blank line\n');
    for (const kept of ['- Database: organized collection of related data', '- Database: a structured collection of data.']) assert.ok(after.cs_course.notes.includes(kept));
    assert.ok(after.web_design.notes.includes('- Sub-page: a page nested under a parent page'));
    assert.ok(after.pre_f1.notes.includes('- Database: Westlaw and LexisNexis'));
    assert.ok(after.post_fix.notes.includes('- Database: Westlaw and LexisNexis'));
    assert.ok(after.canvas_law.notes.includes('- Database: Westlaw and LexisNexis'));

    await db.exec(committed(PART2));
    assert.deepEqual(await snapshot(db), after, 'a second run changes nothing');
    assert.deepEqual(await listed(db), {});
  });

  await t.test('a line on the keep list stays', async () => {
    const { db, ids } = await fresh(PGlite);
    const keep = committed(PART2).replace('select null::uuid, null::bigint where false', `values ('${ids.f1_unedited}'::uuid, 4::bigint)`);
    await db.exec(keep);
    const after = await snapshot(db);
    assert.ok(after.f1_unedited.notes.includes('- Database: Reading list'));
    assert.ok(!after.f1_unedited.notes.includes('- Sub-page: Lecture 4'));
  });

  await t.test('the line rule is the app rule', async () => {
    const extra = Object.fromEntries(FIXTURE.map(([line], index) => [`fixture_${index}`, { notes: `- Kept\n${line}` }]));
    const { db } = await fresh(PGlite, extra);
    const found = await listed(db);
    FIXTURE.forEach(([line, wanted], index) => {
      const got = Boolean(found[`fixture_${index}`]);
      assert.equal(got, wanted, JSON.stringify(line));
    });
  });

  await t.test('without fix_live set, a guide made after now is not touched either', async () => {
    const { db } = await fresh(PGlite, { future: { notes: '- Sub-page: Lecture 4', created: '2999-01-01 00:00:00+00' } });
    const found = await listed(db, PART1);
    assert.equal(found.future, undefined);
  });
});
