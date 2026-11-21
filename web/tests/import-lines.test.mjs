// The questions and cards made from a guide's notes (makeStudySet sends studySetSource(notes, guide)
// to /generate) leave out the lines the first Notion import wrote about itself, only for guides that
// import filed. Same rule as the backend (is_f1_import_line) and the one-off SQL: one fixture for all three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromF1NotionImport, isF1ImportLine, needsStudySet, studySetSource, withoutImportLines } from '../lib/studySet.mjs';

const { lines: FIXTURE } = JSON.parse(readFileSync(new URL('../../tests/fixtures/f1_import_lines.json', import.meta.url), 'utf8'));
const F1_NOTES = "## Week 3\n- Glycolysis makes ATP\n- The rest of this Notion page wasn't imported because Notion was slow to answer.\n"
  + '- Sub-page: Lecture 4\n- Database: Reading list\n## Sub-page: Lab 2\n- Mitochondria are the site of the Krebs cycle in the matrix';
const COURSE = '## Data and law\n- Database: organized collection of related data\n- Database: Westlaw and LexisNexis\n'
  + '## Database: Design principles\n- Sub-page: a page nested under a parent page';
const f1 = { external_source_id: 'notion:p1', created_at: '2026-11-19T05:00:00.123456+00:00' };

test('every fixture line is judged as the backend and the SQL judge it', () => {
  for (const [line, wanted] of FIXTURE) assert.equal(isF1ImportLine(line), wanted, JSON.stringify(line));
});

test('only guides the first Notion import filed', () => {
  assert.equal(fromF1NotionImport(f1), true);
  assert.equal(fromF1NotionImport({ external_source_id: 'notion:p1' }), true);
  assert.equal(fromF1NotionImport({ external_source_id: 'notion:p1', created_at: '2026-11-10T12:00:00+00:00' }), false);
  for (const source of ['canvas:1', 'gdrive:x', '', null, undefined]) assert.equal(fromF1NotionImport({ ...f1, external_source_id: source }), false);
  assert.equal(fromF1NotionImport(undefined), false);
});

test('the study set source of an F1 guide has none of its lines; every other guide keeps every line', () => {
  const source = studySetSource(F1_NOTES, f1);
  for (const stray of ["wasn't imported", 'Sub-page: Lecture 4', 'Database: Reading list', 'Sub-page: Lab 2']) assert.ok(!source.includes(stray), stray);
  assert.ok(source.includes('Glycolysis makes ATP') && source.includes('Krebs cycle'));
  for (const guide of [{ external_source_id: 'canvas:1' }, { external_source_id: null }, { external_source_id: 'notion:old', created_at: '2026-11-10T12:00:00Z' }, f1]) {
    const kept = studySetSource(COURSE, guide);
    for (const line of ['Database: organized collection of related data', 'Database: Westlaw and LexisNexis', 'Database: Design principles', 'Sub-page: a page nested under a parent page']) {
      if (guide === f1 && line !== 'Database: organized collection of related data' && line !== 'Sub-page: a page nested under a parent page') continue;
      assert.ok(kept.includes(line), `${guide.external_source_id}: ${line}`);
    }
  }
  assert.equal(withoutImportLines(COURSE, { external_source_id: 'canvas:1' }), COURSE);
});

test('a guide that is only F1 lines has no study set to make', () => {
  assert.equal(needsStudySet({ ...f1, study_guide: '', notes: '- Sub-page: Lecture 1\n- Sub-page: Lecture 2\n- Sub-page: Lecture 3\n- Database: Reading list' }), false);
});

test('makeStudySet sends the guide along, so its lines can be left out', () => {
  const source = readFileSync(new URL('../lib/autoStudySet.js', import.meta.url), 'utf8');
  assert.match(source, /content: studySetSource\(guide\.notes, guide\)/);
});
