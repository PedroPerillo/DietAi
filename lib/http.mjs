import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLERGENS, DIET_RANK, SLOTS, getRecipe, isRecipeAllowed } from './catalog.mjs';
import { ACTIVITY, GOALS, MIN_KCAL, MAX_DAYS, parseProfile, computeTargets } from './profile.mjs';
import { candidatePools, generate, planWeek, validatePlan, withBudgetNote } from '../public/shared/engine.mjs';
import { aiEnabled, aiSkeleton, modelName, PlannerError } from './ai.mjs';
import { parseCheckoutItems } from './grocery.mjs';
import { getProvider, listProviders } from './stores/index.mjs';
import { authEnabled, publicAuthConfig, verifyRequest } from './auth.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 64 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'Request too large');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Request body must be a JSON object');
  return body;
}

// Which address to rate-limit on. Direct connections use the socket. Behind a proxy
// every request comes from the proxy, so:
//  - On Vercel, x-vercel-forwarded-for / x-real-ip are set by Vercel's edge and stay
//    correct even with another proxy (e.g. Cloudflare) in front.
//  - With TRUST_PROXY=1, use the LAST x-forwarded-for hop: standard proxies append the
//    address they saw, while earlier entries are whatever the client sent.
export function clientIp(req) {
  if (process.env.VERCEL) {
    const ip = String(req.headers['x-vercel-forwarded-for'] ?? req.headers['x-real-ip'] ?? '').split(',')[0].trim();
    if (ip) return ip;
  }
  if (process.env.TRUST_PROXY === '1') {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops.at(-1);
  }
  return req.socket.remoteAddress;
}

// Fixed-window limit on AI-backed requests per signed-in user (or client IP when
// sign-in is off), so an exposed server can't be used to burn the API key.
function rateLimiter(max, windowMs = 60_000) {
  const hits = new Map();
  return (req, user) => {
    const now = Date.now();
    for (const [k, h] of hits) if (now - h.start > windowMs) hits.delete(k);
    const key = user ? `user:${user.userId}` : `ip:${clientIp(req)}`;
    const hit = hits.get(key);
    if (!hit) return void hits.set(key, { start: now, count: 1 });
    if (++hit.count > max) throw httpError(429, 'Too many plans requested. Please wait a minute and try again.');
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Every plan passes validatePlan (allergies, diet, slots, portions, calorie floor and
// band) before it is used. The built-in engine plan is always computed: it proves the
// constraints can be met and is the fallback if the AI is unavailable or fails checks.
const BAND_ERROR = /^day (\d+): \d+ kcal is (?:below|not within)/;

// Share of the AI's picks that must survive for a plan to be labelled as the AI's.
const MIN_AI_SHARE = 0.5;

// Turns the AI's picks into pins for the engine. A pick that breaks the diet or an allergy
// rejects the whole AI plan: it ignored the user's restrictions. Picks that are merely
// unusable (unknown recipe, wrong meal, doesn't fit that day's routine, or a dish
// repeated within the day) are dropped and the engine fills those meals. Models without
// strict schema output (DeepSeek) produce these now and then.
function pinsFromChoices(choices, profile, pools) {
  const pinned = {};
  let total = 0;
  choices.forEach((day, d) => {
    const used = new Set();
    for (const slot of SLOTS) {
      const recipeId = day?.[slot];
      if (recipeId == null) continue;
      total += 1;
      const r = getRecipe(recipeId);
      if (r && !isRecipeAllowed(r, profile)) {
        throw new PlannerError(`AI picked a forbidden recipe for day ${d + 1} ${slot}: ${recipeId}`, "The AI plan didn't pass FitBite's safety checks.");
      }
      const listed = pools[d]?.slots[slot]?.includes(recipeId);
      if (!r || !r.slots.includes(slot) || !listed || used.has(recipeId)) continue;
      used.add(recipeId);
      pinned[`${d}:${slot}`] = { recipeId };
    }
  });
  return { pinned, total };
}

export async function generatePlan(body, { planner = aiSkeleton, useAi = aiEnabled(), signal } = {}) {
  const profile = parseProfile(body);
  const targets = computeTargets(profile);
  const opts = { startDate: profile.startDate, days: profile.days };
  let plan = generate(profile, targets, opts);
  let source = 'built-in';
  let summary = '';
  let warning = null;
  if (useAi) {
    try {
      const result = await planner(profile, targets, { signal });
      // Every recipe that fits each day's routine (not just the short list the AI was shown).
      const pools = candidatePools(profile, { ...opts, limit: Infinity });
      const { pinned, total } = pinsFromChoices(result.choices ?? [], profile, pools);
      let aiPlan;
      let errors = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const p = planWeek(profile, targets, { ...opts, pinned });
        aiPlan = withBudgetNote({ startDate: profile.startDate, targets, days: p.days, notes: p.notes }, profile);
        errors = validatePlan(aiPlan, profile, targets);
        // A day whose picks can't reach the calorie band is handed back to the engine;
        // any other problem rejects the AI plan.
        const offBand = errors.map((e) => BAND_ERROR.exec(e)?.[1]);
        if (!errors.length || offBand.some((d) => d == null)) break;
        const before = Object.keys(pinned).length;
        for (const d of offBand) for (const key of Object.keys(pinned)) if (key.startsWith(`${d - 1}:`)) delete pinned[key];
        if (Object.keys(pinned).length === before) break;
      }
      if (errors.length) throw new PlannerError(`AI plan failed validation: ${errors.slice(0, 3).join('; ')}`, "The AI plan didn't pass FitBite's safety checks.");
      const kept = Object.keys(pinned).length;
      if (kept < total) console.info(`AI plan: kept ${kept} of ${total} picks; the engine planned the rest`);
      // Mostly the engine's work: say so, and don't show an AI summary that may describe
      // dishes that were replaced.
      if (!total || kept / total < MIN_AI_SHARE) throw new PlannerError(`AI plan: only ${kept} of ${total} picks usable`, "The AI picks didn't fit your week.");
      if (aiPlan.budgetNote && !plan.budgetNote) throw new PlannerError('AI plan over budget', 'The AI picks went over your budget.');
      plan = aiPlan;
      summary = result.summary;
      source = 'ai';
    } catch (e) {
      if (signal?.aborted) throw e;
      console.error('AI planner failed:', e.message);
      warning = `${e instanceof PlannerError ? e.userMessage : 'The AI planner is unavailable right now.'} FitBite's built-in planner made this plan instead.`;
    }
  }
  // Built-in plans can miss the band only at extreme targets (portions are capped).
  if (source === 'built-in') {
    const errors = validatePlan(plan, profile, targets, { checkBand: false });
    if (errors.length) throw Object.assign(new Error('Could not build a safe plan for these constraints.'), { status: 422 });
    if (validatePlan(plan, profile, targets).some((e) => /not within|below/.test(e))) {
      const note = 'Your calorie target is higher than these meals reach at the largest portion size, so some days fall short. Add an extra snack or meal.';
      warning = warning ? `${warning} ${note}` : note;
    }
  }
  return { profile, plan, source, summary, warning };
}

const makeRoutes = ({ checkRateLimit, requireUser }) => ({
  'GET /api/config': async () => ({
    ai: aiEnabled(),
    model: modelName(),
    providers: listProviders(),
    allergens: ALLERGENS,
    diets: Object.keys(DIET_RANK),
    activity: Object.keys(ACTIVITY),
    goals: Object.keys(GOALS),
    minKcal: MIN_KCAL,
    maxDays: MAX_DAYS,
    auth: publicAuthConfig(),
  }),
  'POST /api/plan': async (req, res) => {
    const user = await requireUser(req);
    if (aiEnabled()) checkRateLimit(req, user);
    const body = await readJson(req);
    // Stop the AI call if the browser gives up or navigates away (saves free-tier quota).
    const controller = new AbortController();
    res.on('close', () => !res.writableEnded && controller.abort());
    return generatePlan(body, { signal: controller.signal });
  },
  'POST /api/checkout': async (req) => {
    await requireUser(req);
    const body = await readJson(req);
    const provider = getProvider(body.provider);
    if (!provider) throw httpError(400, 'Unknown grocery provider');
    if (!provider.ready()) throw httpError(400, `${provider.label} is not configured on this server`);
    const lines = parseCheckoutItems(body.items);
    return provider.checkout(lines, { linkbackUrl: process.env.PUBLIC_URL, dietary: parseDietary(body.dietary) });
  },
});

// Optional hints for store-side product filters. They can only narrow product matches,
// so a missing or odd value just means no filter. Instacart has no vegetarian or
// pescatarian filter, so any non-omnivore diet uses VEGAN on the few labelRisk items
// (e.g. shrimp paste in curry paste, lard in tortillas).
function parseDietary(d) {
  return {
    glutenFree: Array.isArray(d?.allergies) && d.allergies.includes('gluten'),
    vegan: ['vegan', 'vegetarian', 'pescatarian'].includes(d?.diet),
  };
}

async function serveStatic(req, res) {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }
  const file = join(PUBLIC_DIR, path === '/' ? 'index.html' : path);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

// Vercel's /api/:path* rewrite may hand the function /api/index?path=<rest> instead of
// the original URL; map both forms to the same route key.
function routePath(url) {
  const [pathname, query = ''] = url.split('?');
  if (pathname !== '/api/index') return pathname;
  const rest = new URLSearchParams(query).get('path');
  return rest ? `/api/${rest}` : pathname;
}

// The request handler on its own, shared by the local server and the Vercel function.
// verifyAuth/authOn are injectable for tests; by default they use Clerk when both keys are set.
export function createHandler({ planRateLimit = Number(process.env.PLAN_RATE_LIMIT) || 10, verifyAuth = verifyRequest, authOn = authEnabled } = {}) {
  const requireUser = async (req) => (authOn() ? verifyAuth(req) : null);
  const routes = makeRoutes({ checkRateLimit: rateLimiter(planRateLimit), requireUser });
  return async (req, res) => {
    const route = routes[`${req.method} ${routePath(req.url)}`];
    if (!route) {
      if (req.url.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res).catch((e) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
      });
    }
    try {
      send(res, 200, await route(req, res));
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong' : e.message });
    }
  };
}

export function createServer(opts) {
  return http.createServer(createHandler(opts));
}
