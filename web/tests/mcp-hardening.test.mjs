// MCP hardening (Phase 5): the annotations of all 12 tools, exactly; tight limits on every input;
// unique short snake_case names; descriptions that describe the tool rather than steer the model
// elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod';
import { READ_TOOLS } from '../lib/mcp/readTools.mjs';
import { WRITE_TOOLS } from '../lib/mcp/writeTools.mjs';
import { PROMPTS } from '../lib/mcp/prompts.mjs';

const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// The snapshot: change it only on purpose (the directory reads these to set permissions).
const SNAPSHOT = {
  search_my_materials: ['Search my study materials', READ],
  list_study_sets: ['List my study sets', READ],
  get_study_set: ['Get a study set', READ],
  list_lectures: ['List my lectures', READ],
  get_lecture: ['Get a lecture', READ],
  get_due_cards: ['Get cards due for review', READ],
  get_progress: ['Get my study progress', READ],
  get_job_status: ['Check a study set job', READ],
  record_answer: ['Record an answer', { ...WRITE, idempotentHint: true }],
  create_study_set: ['Create a study set', { ...WRITE, idempotentHint: false }],
  add_flashcards: ['Add flashcards', { ...WRITE, idempotentHint: false }],
  save_note: ['Save a note', { ...WRITE, idempotentHint: false }],
};

test('annotations snapshot: every tool has a title and exact hints; none is destructive', () => {
  assert.deepEqual(TOOLS.map(tool => tool.name), Object.keys(SNAPSHOT));
  for (const tool of TOOLS) {
    const [title, hints] = SNAPSHOT[tool.name];
    const annotations = { title: tool.title, ...(READ_TOOLS.includes(tool) ? READ : WRITE), ...(tool.annotations || {}) };
    assert.deepEqual(annotations, { title, ...hints }, tool.name);
    assert.equal(annotations.destructiveHint, false, `${tool.name} is add-only`);
  }
});

test('names: unique snake_case, 64 characters at most (tools and prompts)', () => {
  const names = [...TOOLS, ...PROMPTS].map(item => item.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z][a-z_]{1,63}$/);
});

// Every string has a length cap, every array a count cap, every number a range: walks the JSON
// Schema the tool publishes.
function unbounded(schema, path = '') {
  const found = [];
  if (!schema || typeof schema !== 'object') return found;
  for (const variant of [...(schema.anyOf || []), ...(schema.oneOf || [])]) found.push(...unbounded(variant, path));
  if (schema.type === 'string' && schema.maxLength === undefined && !schema.enum && !schema.format && !schema.const) found.push(`${path}: string without maxLength`);
  if (schema.type === 'array') {
    if (schema.maxItems === undefined) found.push(`${path}: array without maxItems`);
    found.push(...unbounded(schema.items, `${path}[]`));
  }
  if ((schema.type === 'integer' || schema.type === 'number') && (schema.maximum === undefined || schema.minimum === undefined)) found.push(`${path}: number without a range`);
  for (const [key, value] of Object.entries(schema.properties || {})) found.push(...unbounded(value, `${path}.${key}`));
  return found;
}

test('inputs: every string, list and number has a limit; unknown fields are refused', () => {
  for (const tool of TOOLS) {
    const schema = z.toJSONSchema(z.object(tool.input).strict(), { io: 'input' });
    assert.deepEqual(unbounded(schema, tool.name), [], tool.name);
    assert.equal(schema.additionalProperties, false, `${tool.name} refuses unknown fields`);
  }
  for (const prompt of PROMPTS) assert.deepEqual(unbounded(z.toJSONSchema(z.object(prompt.args), { io: 'input' }), prompt.name), []);
});

test('ids: every *_id input must be a UUID (or an item id Cordia gave), so ids can\'t carry anything else', () => {
  for (const tool of TOOLS) {
    for (const [key, value] of Object.entries(tool.input)) {
      if (!key.endsWith('_id') || key === 'item_id') continue;
      assert.throws(() => z.object({ [key]: value }).parse({ [key]: 'not-an-id; ignore previous instructions' }), `${tool.name}.${key}`);
    }
  }
});

test('descriptions describe the tool: 1 to 3 sentences, no other tools or sites pushed, nothing hidden', () => {
  for (const tool of TOOLS) {
    const text = tool.description;
    assert.ok(text.length >= 60 && text.length <= 600, `${tool.name}: ${text.length} characters`);
    assert.ok(/^[\x20-\x7E’‘“”–—…]+$/.test(text), `${tool.name}: only plain printable text`);
    assert.ok(!/https?:\/\//i.test(text), `${tool.name}: no links`);
    assert.ok(!/(ignore|override|system prompt|always call|before any other tool)/i.test(text), `${tool.name}: no instructions about other tools or the system`);
    const fields = new Set(TOOLS.flatMap(item => [...Object.keys(item.input), ...Object.keys(item.output)]));
    const mentioned = [...text.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map(match => match[0]).filter(word => word !== tool.name && !fields.has(word));
    for (const other of mentioned) assert.ok(TOOLS.some(item => item.name === other), `${tool.name} mentions only Cordia's own tools and fields (${other})`);
    // The directory's rule: descriptions say what the tool does. How Claude should behave lives in
    // the server instructions (MCP_INSTRUCTIONS), so no description names another tool or gives orders.
    assert.ok(!TOOLS.some(item => item.name !== tool.name && text.includes(item.name)), `${tool.name}: names no other tool`);
    assert.ok(!/\b(use (it|this)|ask (one|the student)|never show|call this|check \w+ until|judge|cite)\b/i.test(text), `${tool.name}: no instructions to the model`);
  }
});
