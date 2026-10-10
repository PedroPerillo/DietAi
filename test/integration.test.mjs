import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, generatePlan } from '../server.mjs';
import { PlannerError } from '../lib/ai.mjs';
import { instacart, toLineItem } from '../lib/stores/instacart.mjs';
import { lineFor } from '../lib/grocery.mjs';

const body = { sex: 'male', age: 40, heightCm: 180, weightKg: 85, activity: 'light', goal: 'lose', diet: 'pescatarian', allergies: ['shellfish'], days: 2 };

let server, base;
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
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
  const { plan, groceries, source, warning } = await res.json();
  assert.equal(source, 'heuristic');
  assert.match(warning, /AI is off/);
  assert.equal(plan.days.length, 2);
  assert.ok(plan.days.every((d) => d.meals.every((m) => !m.allergens.includes('shellfish'))));

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

test('warns when the target is beyond what max portions can reach', async () => {
  const r = await generatePlan({ sex: 'male', age: 20, heightCm: 200, weightKg: 120, activity: 'very_active', goal: 'gain', diet: 'vegan', snacks: false, days: 7 });
  assert.match(r.warning, /higher than these meals reach/);
});

test('a malformed URL gets a 400 and does not crash the server', async () => {
  for (const path of ['/%', '/%E0%A4%A', '/foo%zz']) assert.equal((await fetch(base + path)).status, 400, path);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
});

test('uses the AI skeleton when it validates', async () => {
  const skeleton = Array.from({ length: 2 }, () => ({
    breakfast: { recipeId: 'overnight-oats', servings: 1 }, lunch: { recipeId: 'tuna-wrap', servings: 1.25 },
    dinner: { recipeId: 'salmon-sweet-potato', servings: 1 }, snack: { recipeId: 'apple-pb', servings: 1 },
  }));
  const r = await generatePlan(body, { useAi: true, planner: async () => ({ skeleton, summary: 'Fish-forward plan.' }) });
  assert.equal(r.source, 'ai');
  assert.equal(r.summary, 'Fish-forward plan.');
  assert.equal(r.plan.days[0].meals[1].kcal, 538); // nutrition computed from catalog, not the model
  assert.equal(r.warning, null);
});

test('falls back to the built-in planner when the AI fails, and says so', async () => {
  for (const err of [new PlannerError('The AI declined to build this plan.'), new Error('ECONNRESET')]) {
    const r = await generatePlan(body, { useAi: true, planner: async () => { throw err; } });
    assert.equal(r.source, 'heuristic');
    assert.match(r.warning, /built-in planner/);
    assert.equal(r.plan.days.length, 2);
  }
});

test('any planner output that breaks a safety rule is replaced by the built-in plan', async () => {
  const day = (servings, lunch = 'tuna-wrap') => ({
    breakfast: { recipeId: 'overnight-oats', servings }, lunch: { recipeId: lunch, servings },
    dinner: { recipeId: 'salmon-sweet-potato', servings }, snack: { recipeId: 'apple-pb', servings },
  });
  const cases = [
    [[day(0.5), day(0.5)], /below the 1200 kcal floor/],
    [[day(3), day(3)], /not within 10%/],
    [[day(1, 'turkey-chili'), day(1, 'chickpea-salad')], /day 1 lunch: "turkey-chili" violates/], // pescatarian
    [[day(1)], /expected 2 days/],
  ];
  for (const [skeleton, pattern] of cases) {
    const r = await generatePlan(body, { useAi: true, planner: async () => ({ skeleton, summary: 'bad' }) });
    assert.equal(r.source, 'heuristic', String(pattern));
    assert.match(r.warning, pattern);
    assert.ok(r.plan.days.every((d) => d.totals.kcal >= 1200));
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

test('instacart health filters go on packaged goods only', () => {
  const dietary = { glutenFree: true, vegan: true };
  assert.deepEqual(toLineItem(lineFor('salsa', 50), dietary).filters, { health_filters: ['GLUTEN_FREE', 'VEGAN'] });
  assert.deepEqual(toLineItem(lineFor('salsa', 50), { glutenFree: false, vegan: true }).filters, { health_filters: ['VEGAN'] });
  assert.equal(toLineItem(lineFor('banana', 2), dietary).filters, undefined);
  assert.equal(toLineItem(lineFor('salmon', 200), dietary).filters, undefined);
  assert.equal(toLineItem(lineFor('salsa', 50)).filters, undefined);
});

test('instacart line items never use units Instacart lacks', () => {
  assert.deepEqual(toLineItem(lineFor('garlic', 13)).line_item_measurements, [{ quantity: 2, unit: 'head' }]);
  assert.deepEqual(toLineItem(lineFor('eggs', 5)).line_item_measurements, [{ quantity: 5, unit: 'each' }]);
});
