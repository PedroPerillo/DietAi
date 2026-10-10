import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, generatePlan } from '../lib/http.mjs';
import { PlannerError } from '../lib/ai.mjs';
import { instacart, toLineItem } from '../lib/stores/instacart.mjs';
import { lineFor } from '../lib/grocery.mjs';
import { RECIPES_BY_ID } from '../lib/catalog.mjs';
import { parseProfile } from '../lib/profile.mjs';
import { candidatePools, grocerySummary, hydratePlan, validatePlan } from '../public/shared/engine.mjs';

const body = { sex: 'male', age: 40, heightCm: 180, weightKg: 85, activity: 'light', goal: 'lose', diet: 'pescatarian', allergies: ['shellfish'], days: 2 };

let server, base;
before(async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.INSTACART_API_KEY;
  server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, data, raw) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(data) });

test('plan -> grocery list -> demo cart round trip over HTTP', async () => {
  const res = await post('/api/plan', body);
  assert.equal(res.status, 200);
  const { plan, profile, source, warning } = await res.json();
  assert.equal(source, 'built-in');
  assert.equal(warning, null); // no technical "AI is off" notice; the source shows the planner
  assert.equal(plan.days.length, 2);
  assert.ok(plan.days.every((d) => d.meals.every((m) => !RECIPES_BY_ID[m.recipeId].allergens.includes('shellfish'))));
  // the browser derives the grocery list with the same shared engine
  const groceries = grocerySummary(hydratePlan(plan, profile), {}).lines.map((l) => ({ ...l, quantity: l.need }));

  const items = groceries.slice(1).map(({ ingredientId, quantity }) => ({ ingredientId, quantity }));
  const cart = await (await post('/api/checkout', { provider: 'mock', items })).json();
  assert.equal(cart.type, 'cart');
  assert.equal(cart.items.length, groceries.length - 1);
  assert.equal(cart.total, Math.round(groceries.slice(1).reduce((s, g) => s + g.estPrice, 0) * 100) / 100);
});

test('API errors come back as JSON with the right status', async () => {
  assert.equal((await post('/api/plan', null, '{nope')).status, 400);
  assert.equal((await post('/api/plan', { ...body, age: 5 })).status, 400);
  assert.equal((await post('/api/checkout', { provider: 'instacart', items: [{ ingredientId: 'oats', quantity: 1 }] })).status, 400);
  assert.equal((await post('/api/checkout', { provider: 'amazon', items: [] })).status, 400);
  assert.equal((await post('/api/checkout', { provider: 'constructor', items: [] })).status, 400);
  assert.equal((await post('/api/plan', null, 'x'.repeat(70_000))).status, 413);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  assert.equal((await post('/api/plan', null, 'null')).status, 400);
  assert.equal((await post('/api/checkout', null, 'null')).status, 400);
  assert.equal((await post('/api/plan', null, '[1]')).status, 400);
  assert.equal((await post('/api/plan', { ...body, allergies: 'peanuts' })).status, 400);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.ai, false);
  assert.ok(!JSON.stringify(cfg).includes('sk-'), 'config must not leak keys');
});

test('very high targets are either reached or flagged, never silently short', async () => {
  const r = await generatePlan({ sex: 'male', age: 20, heightCm: 200, weightKg: 120, activity: 'very_active', goal: 'gain', diet: 'vegan', snacks: false, days: 7 });
  const short = validatePlan(r.plan, r.profile, r.plan.targets).some((e) => /not within|below/.test(e));
  if (short) assert.match(r.warning, /higher than these meals reach/);
  else assert.equal(r.warning, null);
});

test('an AI plan that repeats a dish within a day falls back with a clear note', async () => {
  const choices = aiChoices(body).map((d) => ({ ...d, dinner: d.lunch }));
  const quiet = console.error;
  console.error = () => {};
  try {
    const r = await generatePlan(body, { useAi: true, planner: async () => ({ choices, summary: '' }) });
    assert.equal(r.source, 'built-in');
    assert.match(r.warning, /repeated a dish/);
  } finally {
    console.error = quiet;
  }
});

test('a malformed URL gets a 400 and does not crash the server', async () => {
  for (const path of ['/%', '/%E0%A4%A', '/foo%zz']) assert.equal((await fetch(base + path)).status, 400, path);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
});

const aiChoices = (b) => {
  const p = parseProfile(b);
  return candidatePools(p, { startDate: p.startDate, days: p.days }).map((d) => {
    const used = new Set();
    return Object.fromEntries(Object.entries(d.slots).map(([slot, ids]) => {
      const id = ids.find((x) => !used.has(x));
      used.add(id);
      return [slot, id];
    }));
  });
};

test('uses the AI picks when they validate; the engine sets portions', async () => {
  const choices = aiChoices(body);
  const r = await generatePlan(body, { useAi: true, planner: async () => ({ choices, summary: 'Fish-forward plan.' }) });
  assert.equal(r.source, 'ai');
  assert.equal(r.summary, 'Fish-forward plan.');
  assert.equal(r.warning, null);
  r.plan.days.forEach((d, i) => d.meals.forEach((m) => assert.equal(m.recipeId, choices[i][m.slot])));
  const h = hydratePlan(r.plan, r.profile);
  assert.ok(h.days.every((d) => Math.abs(d.totals.kcal - r.plan.targets.kcal) <= r.plan.targets.kcal * 0.1), 'portions fitted to the target');
});

test('falls back to the built-in planner when the AI fails, and says so', async () => {
  for (const err of [new PlannerError('The AI declined to build this plan.'), new Error('ECONNRESET')]) {
    const r = await generatePlan(body, { useAi: true, planner: async () => { throw err; } });
    assert.equal(r.source, 'built-in');
    assert.match(r.warning, /built-in planner made this plan/);
    assert.doesNotMatch(r.warning, /GROQ|API|key/i);
    assert.equal(r.plan.days.length, 2);
  }
});

test('AI picks that break a safety rule are replaced by the built-in plan', async () => {
  const good = aiChoices(body);
  const cases = [
    good.map((d) => ({ ...d, lunch: 'turkey-chili' })), // pescatarian user: turkey violates
    good.map((d) => ({ ...d, snack: 'shrimp-tacos' })), // shellfish allergy, and not a snack
    good.map((d) => ({ ...d, dinner: 'pizza' })), // unknown recipe
  ];
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const choices of cases) {
      const r = await generatePlan(body, { useAi: true, planner: async () => ({ choices, summary: 'bad' }) });
      assert.equal(r.source, 'built-in');
      assert.match(r.warning, /safety checks/);
      assert.deepEqual(validatePlan(r.plan, r.profile, r.plan.targets, { checkBand: false }), []);
    }
  } finally {
    console.error = quiet;
  }
});

// ---- Instacart adapter against a local fake ----
function fakeInstacart(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, () => resolve(srv));
  });
}

test('instacart: sends line_item_measurements and returns the link', async () => {
  let received;
  const srv = await fakeInstacart(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ products_link_url: 'https://instacart.example/list/1' }));
  });
  process.env.INSTACART_BASE_URL = `http://localhost:${srv.address().port}`;
  process.env.INSTACART_API_KEY = 'test-key';
  try {
    const r = await instacart.checkout([lineFor('salmon', 300), lineFor('whole_wheat_bread', 4)]);
    assert.deepEqual(r, { type: 'link', provider: 'instacart', url: 'https://instacart.example/list/1', itemCount: 2 });
    assert.equal(received.path, '/idp/v1/products/products_link');
    assert.equal(received.auth, 'Bearer test-key');
    assert.deepEqual(received.body.line_items[0].line_item_measurements, [{ quantity: 300, unit: 'gram' }]);
    assert.deepEqual(received.body.line_items[1].line_item_measurements, [{ quantity: 1, unit: 'package' }]);
    assert.equal(received.body.line_items[0].filters, undefined);
  } finally {
    srv.close();
    delete process.env.INSTACART_API_KEY;
  }
});

test('instacart: upstream 500 and timeouts become a 502 with a friendly message', async () => {
  const srv = await fakeInstacart((req, res) => {
    if (req.url.includes('products_link') && req.headers['x-hang'] === undefined && !globalThis.hang) return res.writeHead(500).end('boom');
    // otherwise never respond
  });
  process.env.INSTACART_BASE_URL = `http://localhost:${srv.address().port}`;
  process.env.INSTACART_API_KEY = 'test-key';
  try {
    await assert.rejects(instacart.checkout([lineFor('oats', 100)]), (e) => e.status === 502 && /\(500\)/.test(e.message));
    globalThis.hang = true;
    await assert.rejects(instacart.checkout([lineFor('oats', 100)], { timeoutMs: 200 }), (e) => e.status === 502 && /timed out/.test(e.message));
  } finally {
    delete globalThis.hang;
    srv.closeAllConnections();
    srv.close();
    delete process.env.INSTACART_API_KEY;
  }
});

test('instacart rejects a link that is not https', async () => {
  for (const link of ['javascript:alert(1)', 'http://instacart.example/x', 'not a url', null]) {
    const srv = await fakeInstacart((req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ products_link_url: link })));
    process.env.INSTACART_BASE_URL = `http://localhost:${srv.address().port}`;
    process.env.INSTACART_API_KEY = 'test-key';
    try {
      await assert.rejects(instacart.checkout([lineFor('oats', 100)]), (e) => e.status === 502, String(link));
    } finally {
      srv.close();
      delete process.env.INSTACART_API_KEY;
    }
  }
});

test('checkout sends VEGAN on label-risk items for every non-omnivore diet', async () => {
  let lastBody;
  const srv = await fakeInstacart(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    lastBody = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ products_link_url: 'https://instacart.example/l' }));
  });
  process.env.INSTACART_BASE_URL = `http://localhost:${srv.address().port}`;
  process.env.INSTACART_API_KEY = 'test-key';
  const filtersFor = async (dietary) => {
    const res = await post('/api/checkout', { provider: 'instacart', items: [{ ingredientId: 'curry_paste', quantity: 15 }], dietary });
    assert.equal(res.status, 200);
    return lastBody.line_items[0].filters?.health_filters ?? [];
  };
  try {
    for (const diet of ['vegan', 'vegetarian', 'pescatarian']) assert.deepEqual(await filtersFor({ diet, allergies: [] }), ['VEGAN'], diet);
    assert.deepEqual(await filtersFor({ diet: 'omnivore', allergies: [] }), []);
    assert.deepEqual(await filtersFor({ diet: 'omnivore', allergies: ['gluten'] }), ['GLUTEN_FREE']);
    assert.deepEqual(await filtersFor(undefined), []);
  } finally {
    srv.close();
    delete process.env.INSTACART_API_KEY;
  }
});

test('instacart health filters go only on ingredients with a label risk', () => {
  const dietary = { glutenFree: true, vegan: true };
  assert.deepEqual(toLineItem(lineFor('curry_paste', 15), dietary).filters, { health_filters: ['GLUTEN_FREE', 'VEGAN'] });
  assert.deepEqual(toLineItem(lineFor('curry_paste', 15), { glutenFree: false, vegan: true }).filters, { health_filters: ['VEGAN'] });
  assert.deepEqual(toLineItem(lineFor('tempeh', 100), dietary).filters, { health_filters: ['GLUTEN_FREE'] }); // barley risk, filed under Produce
  assert.deepEqual(toLineItem(lineFor('ww_tortilla', 2), dietary).filters, { health_filters: ['VEGAN'] });
  for (const staple of ['brown_rice', 'olive_oil', 'lentils', 'quinoa', 'banana', 'salmon']) {
    assert.equal(toLineItem(lineFor(staple, 1), dietary).filters, undefined, staple);
  }
  assert.equal(toLineItem(lineFor('curry_paste', 15)).filters, undefined);
});

test('instacart line items never use units Instacart lacks', () => {
  assert.deepEqual(toLineItem(lineFor('garlic', 13)).line_item_measurements, [{ quantity: 2, unit: 'head' }]);
  assert.deepEqual(toLineItem(lineFor('eggs', 5)).line_item_measurements, [{ quantity: 5, unit: 'each' }]);
});

test('the Vercel function entry serves the API with the same handler', async () => {
  const { default: handler } = await import('../api/index.mjs');
  const srv = http.createServer(handler).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const url = `http://localhost:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/config`)).status, 200);
    assert.equal((await fetch(`${url}/api/index?path=config`)).status, 200); // rewritten form
    const res = await fetch(`${url}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).plan.days.length, 2);
  } finally {
    srv.close();
  }
});

test('clientIp cannot be spoofed through x-forwarded-for', async () => {
  const { clientIp } = await import('../lib/http.mjs');
  const req = (headers) => ({ headers, socket: { remoteAddress: '10.0.0.9' } });
  const env = { VERCEL: process.env.VERCEL, TRUST_PROXY: process.env.TRUST_PROXY };
  const set = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    set('VERCEL', undefined); set('TRUST_PROXY', undefined);
    assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' })), '10.0.0.9'); // no proxy trusted: socket only

    set('TRUST_PROXY', '1');
    assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' })), '203.0.113.7'); // client-sent first hop ignored
    assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
    assert.equal(clientIp(req({})), '10.0.0.9');

    set('TRUST_PROXY', undefined); set('VERCEL', '1');
    assert.equal(clientIp(req({ 'x-vercel-forwarded-for': '198.51.100.4', 'x-forwarded-for': '6.6.6.6' })), '198.51.100.4');
    assert.equal(clientIp(req({ 'x-real-ip': '198.51.100.5' })), '198.51.100.5');
  } finally {
    set('VERCEL', env.VERCEL); set('TRUST_PROXY', env.TRUST_PROXY);
  }
});

test('rate limit holds when a client rotates a spoofed first x-forwarded-for hop', async () => {
  const prev = { key: process.env.GROQ_API_KEY, proxy: process.env.TRUST_PROXY };
  // AI "on" so the limiter runs. The '{}' body then fails validation (400) before any
  // AI call, so a 400 means "got past the limiter".
  process.env.GROQ_API_KEY = 'test-key';
  process.env.TRUST_PROXY = '1';
  const srv = createServer({ planRateLimit: 2 }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const url = `http://localhost:${srv.address().port}/api/plan`;
  const hit = (xff) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': xff }, body: '{}' });
  try {
    const statuses = [];
    for (let n = 1; n <= 6; n++) statuses.push((await hit(`10.0.0.${n}, 203.0.113.7`)).status);
    assert.deepEqual(statuses, [400, 400, 429, 429, 429, 429]);
    assert.equal((await hit('10.0.0.1, 203.0.113.8')).status, 400); // a different real client has its own budget
  } finally {
    srv.close();
    if (prev.key === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = prev.key;
    if (prev.proxy === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev.proxy;
  }
});
