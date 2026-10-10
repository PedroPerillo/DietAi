import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Point the real SDK at a local fake so we exercise request construction + parsing.
const HANG = Symbol('hang');
let srv, lastRequest, reply, onUpstreamClose;
before(async () => {
  srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    const r = reply();
    if (r === HANG) return res.on('close', () => onUpstreamClose?.());
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(r));
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${srv.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});
after(() => {
  srv.closeAllConnections();
  srv.close();
});

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

test('rejects refusals, truncation and malformed JSON', async () => {
  const cases = [
    [() => message('', 'refusal'), /declined/],
    [() => message('{"days": [', 'max_tokens'), /cut off/],
    [() => message('not json'), /malformed/],
  ];
  for (const [r, pattern] of cases) {
    reply = r;
    await assert.rejects(aiSkeleton(profile, targets), (e) => e instanceof PlannerError && pattern.test(e.message));
  }
});

// ---- through the HTTP server, with the fake Anthropic behind it ----
const { createServer } = await import('../server.mjs');
const listen = async (opts) => {
  const s = createServer(opts).listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, url: `http://localhost:${s.address().port}` };
};
const planBody = JSON.stringify({ sex: 'female', age: 35, heightCm: 168, weightKg: 70, activity: 'light', goal: 'lose', diet: 'vegetarian', allergies: ['egg'], days: 1, snacks: false });
const postPlan = (url, signal) => fetch(`${url}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: planBody, signal });

test('cancels the Claude call when the browser disconnects', async () => {
  const closed = new Promise((r) => (onUpstreamClose = r));
  reply = () => HANG;
  const { s, url } = await listen();
  try {
    await assert.rejects(postPlan(url, AbortSignal.timeout(300)));
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('upstream call was not cancelled')), 2000))]);
  } finally {
    onUpstreamClose = null;
    s.close();
  }
});

test('rate-limits plan requests when AI is on', async () => {
  reply = () => message(JSON.stringify({ summary: '', days: [day] }));
  const { s, url } = await listen({ planRateLimit: 2 });
  try {
    assert.equal((await postPlan(url)).status, 200);
    assert.equal((await postPlan(url)).status, 200);
    const third = await postPlan(url);
    assert.equal(third.status, 429);
    assert.match((await third.json()).error, /wait a minute/);
  } finally {
    s.close();
  }
});
