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
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.ai, false);
  assert.ok(!JSON.stringify(cfg).includes('sk-'), 'config must not leak keys');
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
  for (const err of [new PlannerError('The AI plan failed validation: x'), new Error('ECONNRESET')]) {
    const r = await generatePlan(body, { useAi: true, planner: async () => { throw err; } });
    assert.equal(r.source, 'heuristic');
    assert.match(r.warning, /built-in planner/);
    assert.equal(r.plan.days.length, 2);
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

test('instacart line items never use units Instacart lacks', () => {
  assert.deepEqual(toLineItem(lineFor('garlic', 13)).line_item_measurements, [{ quantity: 2, unit: 'head' }]);
  assert.deepEqual(toLineItem(lineFor('eggs', 5)).line_item_measurements, [{ quantity: 5, unit: 'each' }]);
});
