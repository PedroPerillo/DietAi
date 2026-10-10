import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLERGENS, DIET_RANK } from './catalog.mjs';
import { ACTIVITY, GOALS, MIN_KCAL, MAX_DAYS, parseProfile, computeTargets } from './profile.mjs';
import { buildPlan, heuristicSkeleton, validateSkeleton, KCAL_TOLERANCE } from './plan.mjs';
import { aiEnabled, aiSkeleton, MODEL, PlannerError } from './ai.mjs';
import { groceryList, parseCheckoutItems } from './grocery.mjs';
import { getProvider, listProviders } from './stores/index.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 64 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

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

// Fixed-window limit on Claude-backed requests per client IP, so an exposed server
// can't be used to burn the API key.
function rateLimiter(max, windowMs = 60_000) {
  const hits = new Map();
  return (req) => {
    const now = Date.now();
    for (const [ip, h] of hits) if (now - h.start > windowMs) hits.delete(ip);
    const ip = clientIp(req);
    const hit = hits.get(ip);
    if (!hit) return void hits.set(ip, { start: now, count: 1 });
    if (++hit.count > max) throw httpError(429, 'Too many plans requested. Please wait a minute and try again.');
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Every planner's output passes through validateSkeleton (allergies, diet, slots,
// portions, calorie floor and band) before it is used; the heuristic is the fallback.
export async function generatePlan(body, { planner = aiSkeleton, useAi = aiEnabled(), signal } = {}) {
  const profile = parseProfile(body);
  const targets = computeTargets(profile);
  // Always compute the heuristic plan: it checks the constraints are satisfiable at
  // all and is the fallback if the AI is unavailable or its output fails validation.
  let skeleton = heuristicSkeleton(profile, targets);
  let source = 'heuristic';
  let summary = '';
  let warning = useAi ? null : 'AI is off on this server, so this plan came from the built-in planner.';
  if (useAi) {
    try {
      const result = await planner(profile, targets, { signal });
      const errors = validateSkeleton(result.skeleton, profile, targets);
      if (errors.length) throw new PlannerError(`The AI plan failed validation: ${errors.slice(0, 3).join('; ')}`);
      ({ skeleton, summary } = result);
      source = 'ai';
    } catch (e) {
      console.error('AI planner failed:', e.message);
      warning = `${e instanceof PlannerError ? e.message : 'The AI planner is unavailable.'} Showing a plan from the built-in planner instead.`;
    }
  }
  const plan = buildPlan(skeleton, profile, targets);
  // Only the built-in planner can get here off-target: very high targets can exceed
  // what the largest allowed portions provide.
  if (plan.days.some((d) => d.totals.kcal < targets.kcal * (1 - KCAL_TOLERANCE))) {
    const note = 'Your calorie target is higher than these meals reach at the largest portion size, so some days fall short. Add an extra snack or meal.';
    warning = warning ? `${warning} ${note}` : note;
  }
  return { profile, plan, groceries: groceryList(plan), source, summary, warning };
}

const makeRoutes = ({ checkRateLimit }) => ({
  'GET /api/config': async () => ({
    ai: aiEnabled(),
    model: MODEL,
    providers: listProviders(),
    allergens: ALLERGENS,
    diets: Object.keys(DIET_RANK),
    activity: Object.keys(ACTIVITY),
    goals: Object.keys(GOALS),
    minKcal: MIN_KCAL,
    maxDays: MAX_DAYS,
  }),
  'POST /api/plan': async (req, res) => {
    if (aiEnabled()) checkRateLimit(req);
    const body = await readJson(req);
    // Stop paying for the Claude call if the browser gives up or navigates away.
    const controller = new AbortController();
    res.on('close', () => !res.writableEnded && controller.abort());
    return generatePlan(body, { signal: controller.signal });
  },
  'POST /api/checkout': async (req) => {
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
export function createHandler({ planRateLimit = Number(process.env.PLAN_RATE_LIMIT) || 10 } = {}) {
  const routes = makeRoutes({ checkRateLimit: rateLimiter(planRateLimit) });
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
