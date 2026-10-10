import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Point the real SDK at a local fake so we exercise request construction + parsing.
let srv, lastRequest, reply;
before(async () => {
  srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply()));
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${srv.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});
after(() => srv.close());

const { aiSkeleton, PlannerError } = await import('../lib/ai.mjs');
const { parseProfile, computeTargets } = await import('../lib/profile.mjs');

const profile = parseProfile({ sex: 'female', age: 35, heightCm: 168, weightKg: 70, activity: 'light', goal: 'lose', diet: 'vegetarian', allergies: ['egg'], days: 1, snacks: false });
const targets = computeTargets(profile);
const message = (text, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 },
});
const day = { breakfast: { recipeId: 'overnight-oats', servings: 1.1 }, lunch: { recipeId: 'lentil-soup', servings: 1 }, dinner: { recipeId: 'chickpea-curry', servings: 1 } };

test('sends a constrained structured-output request and parses the plan', async () => {
  reply = () => message(JSON.stringify({ summary: 'Simple vegetarian day.', days: [day] }));
  const { skeleton, summary } = await aiSkeleton(profile, targets);
  assert.equal(summary, 'Simple vegetarian day.');
  assert.equal(skeleton[0].breakfast.servings, 1); // snapped to 0.25 grid

  const b = lastRequest.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  const breakfastEnum = b.output_config.format.schema.properties.days.items.properties.breakfast.properties.recipeId.enum;
  assert.ok(breakfastEnum.includes('overnight-oats'));
  assert.ok(!breakfastEnum.includes('veggie-scramble'), 'egg recipes must not even be offerable');
  assert.ok(!('snack' in b.output_config.format.schema.properties.days.items.properties));
});

test('rejects refusals, truncation, malformed JSON and constraint violations', async () => {
  const cases = [
    [() => message('', 'refusal'), /declined/],
    [() => message('{"days": [', 'max_tokens'), /cut off/],
    [() => message('not json'), /malformed/],
    [() => message(JSON.stringify({ summary: '', days: [{ ...day, breakfast: { recipeId: 'avocado-toast-egg', servings: 1 } }] })), /validation/],
    [() => message(JSON.stringify({ summary: '', days: [day, day] })), /validation/],
  ];
  for (const [r, pattern] of cases) {
    reply = r;
    await assert.rejects(aiSkeleton(profile, targets), (e) => e instanceof PlannerError && pattern.test(e.message));
  }
});
