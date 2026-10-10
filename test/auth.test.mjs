import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, frontendApiFromKey, publicAuthConfig, verifyRequest } from '../lib/auth.mjs';
import { createServer } from '../lib/http.mjs';
import { grocerySummary, hydratePlan } from '../public/shared/engine.mjs';

const keyFor = (host, env = 'test') => `pk_${env}_${Buffer.from(`${host}$`).toString('base64')}`;
const withEnv = async (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
};

test('frontend API host is decoded from the publishable key and validated', () => {
  assert.equal(frontendApiFromKey(keyFor('fitbite-12.clerk.accounts.dev')), 'fitbite-12.clerk.accounts.dev');
  assert.equal(frontendApiFromKey(keyFor('clerk.fitbite.app', 'live')), 'clerk.fitbite.app');
  for (const bad of [keyFor('evil.com/x"><script>'), keyFor('localhost'), 'sk_test_abc', 'pk_test_', '', null, 'pk_prod_' + Buffer.from('a.b$').toString('base64')]) {
    assert.equal(frontendApiFromKey(bad), null, String(bad));
  }
});

test('auth config is exposed only when both keys are set, and never the secret', async () => {
  await withEnv({ CLERK_PUBLISHABLE_KEY: keyFor('x.clerk.accounts.dev'), CLERK_SECRET_KEY: undefined }, () => assert.equal(publicAuthConfig(), null));
  await withEnv({ CLERK_PUBLISHABLE_KEY: keyFor('x.clerk.accounts.dev'), CLERK_SECRET_KEY: 'sk_test_secret' }, () => {
    const cfg = publicAuthConfig();
    assert.deepEqual(cfg, { publishableKey: keyFor('x.clerk.accounts.dev'), frontendApi: 'x.clerk.accounts.dev' });
    assert.ok(!JSON.stringify(cfg).includes('sk_'));
  });
});

test('verifyRequest rejects missing and malformed tokens with a 401', async () => {
  await withEnv({ CLERK_SECRET_KEY: 'sk_test_secret' }, async () => {
    for (const authorization of [undefined, '', 'Basic abc', 'Bearer', 'Bearer not.a.jwt']) {
      await assert.rejects(verifyRequest({ headers: { authorization } }), (e) => e instanceof AuthError && e.status === 401, String(authorization));
    }
  });
});

// ---- HTTP: with sign-in on, protected routes need a verified user ----
let srv, base;
const users = { 'token-ana': 'user_ana', 'token-bo': 'user_bo' };
const fakeVerify = async (req) => {
  const userId = users[/^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]];
  if (!userId) throw new AuthError();
  return { userId };
};
before(async () => {
  srv = createServer({ authOn: () => true, verifyAuth: fakeVerify, planRateLimit: 2 }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://localhost:${srv.address().port}`;
});
after(() => srv.close());
const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
const profile = { sex: 'female', age: 30, heightCm: 165, weightKg: 60, activity: 'light', goal: 'maintain', diet: 'omnivore', days: 1 };

test('plan and checkout return 401 without a valid session; config stays public', async () => {
  assert.equal((await post('/api/plan', profile)).status, 401);
  assert.equal((await post('/api/plan', profile, 'forged')).status, 401);
  assert.equal((await post('/api/checkout', { provider: 'mock', items: [{ ingredientId: 'oats', quantity: 100 }] })).status, 401);
  assert.match((await (await post('/api/plan', profile)).json()).error, /sign in/i);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
});

test('a signed-in user can plan and check out', async () => {
  const plan = await post('/api/plan', profile, 'token-ana');
  assert.equal(plan.status, 200);
  const r = await plan.json();
  const lines = grocerySummary(hydratePlan(r.plan, r.profile), {}).lines;
  const cart = await post('/api/checkout', { provider: 'mock', items: lines.map(({ ingredientId, need }) => ({ ingredientId, quantity: need })) }, 'token-ana');
  assert.equal(cart.status, 200);
  assert.equal((await cart.json()).type, 'cart');
});

test('rate limit is per user when signed in, even from the same IP', async () => {
  await withEnv({ GROQ_API_KEY: 'test-key' }, async () => {
    // '{}' fails validation (400) after the limiter, so 400 means "allowed through".
    const fresh = createServer({ authOn: () => true, verifyAuth: fakeVerify, planRateLimit: 1 }).listen(0);
    await new Promise((r) => fresh.once('listening', r));
    const url = `http://localhost:${fresh.address().port}/api/plan`;
    const hitFresh = (token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' }).then((r) => r.status);
    try {
      assert.deepEqual([await hitFresh('token-ana'), await hitFresh('token-ana'), await hitFresh('token-bo')], [400, 429, 400]);
    } finally {
      fresh.close();
    }
  });
});

// ---- 401 only for bad tokens; server/Clerk-side failures are 503 so nobody gets signed out ----
const clerkError = (reason) => Object.assign(new Error(`clerk: ${reason}`), { reason });

test('token problems are 401, server or Clerk outages are 503', async () => {
  const quiet = { warn: console.warn, error: console.error };
  const logged = [];
  console.warn = console.error = (msg) => logged.push(msg);
  try {
    await withEnv({ CLERK_SECRET_KEY: 'sk_test_x', CLERK_AUTHORIZED_PARTIES: 'https://fitbite-pi.vercel.app' }, async () => {
      const req = { headers: { authorization: 'Bearer some.jwt.token' } };
      const cases = {
        'token-expired': 401, 'token-invalid': 401, 'token-invalid-signature': 401, 'token-not-active-yet': 401,
        'token-iat-in-the-future': 401, 'token-invalid-authorized-parties': 401,
        'secret-key-invalid': 503, 'jwk-remote-failed-to-load': 503, 'jwk-remote-missing': 503, 'jwk-failed-to-resolve': 503, 'jwk-local-missing': 503,
      };
      for (const [reason, status] of Object.entries(cases)) {
        await assert.rejects(verifyRequest(req, { verify: async () => { throw clerkError(reason); } }), (e) => e.status === status, reason);
      }
      await assert.rejects(verifyRequest(req, { verify: async () => { throw new TypeError('fetch failed'); } }), (e) => e.status === 503, 'network error');
    });
  } finally {
    Object.assign(console, quiet);
  }
  // every failure is logged with its reason; the authorized-parties one includes the config
  assert.ok(logged.some((m) => m.includes('secret-key-invalid')));
  assert.ok(logged.some((m) => m.includes('token-invalid-authorized-parties') && m.includes('https://fitbite-pi.vercel.app')));
});

test('a misconfigured secret key returns 503 "temporarily unavailable" over HTTP, not 401', async () => {
  const quietError = console.error;
  console.error = () => {};
  const s = createServer({ authOn: () => true, verifyAuth: (req) => verifyRequest(req, { verify: async () => { throw clerkError('secret-key-invalid'); } }) }).listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    await withEnv({ CLERK_SECRET_KEY: 'sk_test_wrong' }, async () => {
      const res = await fetch(`http://localhost:${s.address().port}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c' }, body: JSON.stringify(profile) });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /temporarily unavailable/);
    });
  } finally {
    console.error = quietError;
    s.close();
  }
});
