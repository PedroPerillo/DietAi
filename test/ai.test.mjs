import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Point the planner at a local fake Groq so we exercise request construction + parsing.
const HANG = Symbol('hang');
let srv, lastRequest, reply, onUpstreamRequest, onUpstreamClose;
before(async () => {
  srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    const r = reply();
    if (r === HANG) {
      res.on('close', () => onUpstreamClose?.());
      return onUpstreamRequest?.();
    }
    if (r.status) return res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(r.body ?? {}));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(r));
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  process.env.GROQ_BASE_URL = `http://localhost:${srv.address().port}/openai/v1`;
  process.env.GROQ_API_KEY = 'test-key';
});
after(() => {
  srv.closeAllConnections();
  srv.close();
});

// All top-level awaits must come before the first test(): an await between tests lets
// node:test run the after() hook early and shut the fake down mid-file.
const { aiSkeleton, PlannerError } = await import('../lib/ai.mjs');
const { parseProfile, computeTargets } = await import('../lib/profile.mjs');
const { createServer } = await import('../lib/http.mjs');

const profile = parseProfile({ sex: 'female', age: 35, heightCm: 168, weightKg: 70, activity: 'light', goal: 'lose', diet: 'vegetarian', allergies: ['egg'], days: 1, snacks: false });
const targets = computeTargets(profile);
// OpenAI-compatible chat completion, as Groq returns it.
const message = (content, finish_reason = 'stop', extra = {}) => ({
  id: 'chatcmpl-1', object: 'chat.completion', model: 'openai/gpt-oss-120b',
  choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 },
});
const day = { breakfast: { recipeId: 'overnight-oats', servings: 1.1 }, lunch: { recipeId: 'lentil-soup', servings: 1 }, dinner: { recipeId: 'chickpea-curry', servings: 1 } };

test('sends a constrained structured-output request and parses the plan', async () => {
  reply = () => message(JSON.stringify({ summary: 'Simple vegetarian day.', days: [day] }));
  const { skeleton, summary } = await aiSkeleton(profile, targets);
  assert.equal(summary, 'Simple vegetarian day.');
  assert.equal(skeleton[0].breakfast.servings, 1); // snapped to 0.25 grid

  const b = lastRequest.body;
  assert.equal(lastRequest.url, '/openai/v1/chat/completions');
  assert.equal(lastRequest.headers.authorization, 'Bearer test-key');
  assert.equal(b.model, 'openai/gpt-oss-120b');
  assert.equal(b.reasoning_effort, 'low');
  assert.equal(b.response_format.type, 'json_schema');
  assert.equal(b.response_format.json_schema.strict, true);
  const schema = b.response_format.json_schema.schema;
  const breakfastEnum = schema.properties.days.items.properties.breakfast.properties.recipeId.enum;
  assert.ok(breakfastEnum.includes('overnight-oats'));
  assert.ok(!breakfastEnum.includes('veggie-scramble'), 'egg recipes must not even be offerable');
  assert.ok(!('snack' in schema.properties.days.items.properties));
  // Groq strict mode: every object lists all its properties as required and closes extras
  const objects = [schema, schema.properties.days.items, schema.properties.days.items.properties.breakfast];
  for (const o of objects) {
    assert.equal(o.additionalProperties, false);
    assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
  }
  assert.equal(b.messages[0].role, 'system');
  assert.ok(JSON.stringify(b.messages).length < 12_000, 'prompt stays small for the free-tier token budget');
});

test('rejects refusals, truncation, malformed JSON and API errors', async () => {
  const quiet = console.error;
  console.error = () => {};
  const cases = [
    [() => message(null, 'stop', { refusal: 'no' }), /declined/],
    [() => message('{"days": [', 'length'), /cut off/],
    [() => message('not json'), /malformed/],
    [() => ({ status: 429, body: { error: { message: 'Rate limit reached' } } }), /free-tier limit/],
    [() => ({ status: 401, body: { error: { message: 'Invalid API Key' } } }), /key was rejected/],
    [() => ({ status: 500, body: {} }), /error \(500\)/],
  ];
  try {
    for (const [r, pattern] of cases) {
      reply = r;
      await assert.rejects(aiSkeleton(profile, targets), (e) => e instanceof PlannerError && pattern.test(e.message), String(pattern));
    }
  } finally {
    console.error = quiet;
  }
});

// ---- through the HTTP server, with the fake Groq behind it ----
const listen = async (opts) => {
  const s = createServer(opts).listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, url: `http://localhost:${s.address().port}` };
};
const planBody = JSON.stringify({ sex: 'female', age: 35, heightCm: 168, weightKg: 70, activity: 'light', goal: 'lose', diet: 'vegetarian', allergies: ['egg'], days: 1, snacks: false });
const postPlan = (url, signal) => fetch(`${url}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: planBody, signal });

const within = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms))]);

test('cancels the AI call when the browser disconnects', async () => {
  const received = new Promise((r) => (onUpstreamRequest = r));
  const closed = new Promise((r) => (onUpstreamClose = r));
  reply = () => HANG;
  const { s, url } = await listen();
  const browser = new AbortController();
  try {
    const pending = postPlan(url, browser.signal);
    // Only disconnect once the AI request is actually in flight.
    await within(received, 2000, 'plan request never reached the fake Groq server');
    browser.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await within(closed, 2000, 'upstream call was not cancelled');
  } finally {
    onUpstreamRequest = onUpstreamClose = null;
    s.close();
  }
});

test('rate-limits plan requests when AI is on', async () => {
  reply = () => message(JSON.stringify({ summary: '', days: [day] }));
  const { s, url } = await listen({ planRateLimit: 2 });
  try {
    for (let i = 0; i < 2; i++) {
      const res = await postPlan(url);
      assert.equal(res.status, 200);
      // Guards against silently testing the fallback path instead of the AI path.
      assert.equal((await res.json()).source, 'ai');
    }
    const third = await postPlan(url);
    assert.equal(third.status, 429);
    assert.match((await third.json()).error, /wait a minute/);
  } finally {
    s.close();
  }
});
