import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLERGENS, DIET_RANK } from './lib/catalog.mjs';
import { ACTIVITY, GOALS, MIN_KCAL, MAX_DAYS, parseProfile, computeTargets } from './lib/profile.mjs';
import { buildPlan, heuristicSkeleton } from './lib/plan.mjs';
import { aiEnabled, aiSkeleton, MODEL, PlannerError } from './lib/ai.mjs';
import { groceryList, parseCheckoutItems } from './lib/grocery.mjs';
import { PROVIDERS, getProvider, listProviders } from './lib/stores/index.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY = 64 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'Invalid JSON');
  }
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export async function generatePlan(body, { planner = aiSkeleton, useAi = aiEnabled() } = {}) {
  const profile = parseProfile(body);
  const targets = computeTargets(profile);
  // Always compute the heuristic plan: it checks the constraints are satisfiable at
  // all and is the fallback if the AI is unavailable or its output fails validation.
  let skeleton = heuristicSkeleton(profile, targets);
  let source = 'heuristic';
  let summary = '';
  let warning = useAi ? null : 'AI is off (no ANTHROPIC_API_KEY), so this plan came from the built-in planner.';
  if (useAi) {
    try {
      ({ skeleton, summary } = await planner(profile, targets));
      source = 'ai';
    } catch (e) {
      console.error('AI planner failed:', e.message);
      warning = `${e instanceof PlannerError ? e.message : 'The AI planner is unavailable.'} Showing a plan from the built-in planner instead.`;
    }
  }
  const plan = buildPlan(skeleton, profile, targets);
  return { profile, plan, groceries: groceryList(plan), source, summary, warning };
}

const routes = {
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
  'POST /api/plan': async (req) => generatePlan(await readJson(req)),
  'POST /api/checkout': async (req) => {
    const body = await readJson(req);
    const provider = getProvider(body.provider);
    if (!provider) throw httpError(400, 'Unknown grocery provider');
    if (!provider.ready()) throw httpError(400, `${provider.label} is not configured on this server`);
    const lines = parseCheckoutItems(body.items);
    return provider.checkout(lines, { linkbackUrl: process.env.PUBLIC_URL });
  },
};

async function serveStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
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

export function createServer() {
  return http.createServer(async (req, res) => {
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    if (!route) {
      if (req.url.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res);
    }
    try {
      send(res, 200, await route(req));
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong' : e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`DietAI on http://localhost:${port}  (AI: ${aiEnabled() ? MODEL : 'off'}, Instacart: ${PROVIDERS.instacart.ready() ? 'on' : 'off'})`);
  });
}
