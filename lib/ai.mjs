import { allowedRecipes } from './catalog.mjs';
import { slotsFor, MIN_SERVINGS, MAX_SERVINGS } from './plan.mjs';

// Groq (OpenAI-compatible API). Defaults work on Groq's free plan; override with env vars.
const BASE_URL = () => (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
export const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'; // supports strict JSON-schema output
export const aiEnabled = () => Boolean(process.env.GROQ_API_KEY);
// One attempt with a hard deadline, kept well under the browser's 150 s timeout so a
// slow call still leaves time to return the fallback plan.
export const AI_TIMEOUT_MS = 90_000;
const MAX_COMPLETION_TOKENS = 4096; // plan JSON is ~1K tokens; the rest is headroom for reasoning

export class PlannerError extends Error {}

// The model only chooses recipes and portion sizes from the allowed catalog; it never
// invents foods or nutrition numbers. Per-slot enums mean it can't even name a recipe
// that breaks the user's constraints; generatePlan re-checks everything regardless.
function outputSchema(profile, pool) {
  const slots = slotsFor(profile);
  const entry = (slot) => ({
    type: 'object',
    additionalProperties: false,
    required: ['recipeId', 'servings'],
    properties: {
      recipeId: { type: 'string', enum: pool.filter((r) => r.slot === slot).map((r) => r.id) },
      servings: { type: 'number', description: `Portion multiplier, ${MIN_SERVINGS}-${MAX_SERVINGS} in 0.25 steps` },
    },
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['days', 'summary'],
    properties: {
      summary: { type: 'string', description: 'Two or three sentences explaining the plan to the user.' },
      days: {
        type: 'array',
        description: `Exactly ${profile.days} day(s).`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: slots,
          properties: Object.fromEntries(slots.map((s) => [s, entry(s)])),
        },
      },
    },
  };
}

const SYSTEM = `You are a registered-dietitian-style meal planner inside a grocery app.
Build a meal plan by choosing recipes from the provided catalog and setting portion multipliers.
Aim for each day's calories within 5% of the target and protein at or above the target.
Favor variety across days, but reuse ingredients across recipes where it helps keep the grocery list short.
Respect the user's notes when they don't conflict with their hard constraints.`;

export async function aiSkeleton(profile, targets, { signal } = {}) {
  const pool = allowedRecipes(profile);
  // Compact rows keep the prompt small (Groq's free plan has a per-minute token budget):
  // [id, slot, kcal, protein, carbs, fat, ingredient ids]
  const catalog = pool.map((r) => [r.id, r.slot, r.kcal, r.protein, r.carbs, r.fat, r.ingredients.map(([id]) => id).join(' ')]);
  const user = {
    days: profile.days,
    meals_per_day: slotsFor(profile),
    daily_targets: { kcal: targets.kcal, protein_g: targets.protein, carbs_g: targets.carbs, fat_g: targets.fat },
    goal: profile.goal,
    diet: profile.diet,
    user_notes: profile.notes || null,
    catalog_columns: ['id', 'slot', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'ingredients'],
    catalog_per_serving: catalog,
  };

  let res;
  try {
    res = await fetch(`${BASE_URL()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(user) },
        ],
        // Strict mode: constrained decoding, so the reply always matches the schema
        // (including the per-slot recipe enums). generatePlan still re-validates it.
        response_format: { type: 'json_schema', json_schema: { name: 'meal_plan', strict: true, schema: outputSchema(profile, pool) } },
        reasoning_effort: 'low',
        include_reasoning: false,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(AI_TIMEOUT_MS)]) : AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    if (signal?.aborted) throw e; // the browser went away; nothing to report
    throw new PlannerError(e.name === 'TimeoutError' ? 'The AI planner took too long.' : 'Could not reach the AI planner.');
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.error(`groq ${res.status}: ${detail}`);
    if (res.status === 429) throw new PlannerError('The AI planner is at its free-tier limit right now.');
    if (res.status === 401 || res.status === 403) throw new PlannerError('The AI planner key was rejected.');
    throw new PlannerError(`The AI planner returned an error (${res.status}).`);
  }
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new PlannerError('The AI response was cut off.');
  if (choice?.message?.refusal) throw new PlannerError('The AI declined to build this plan.');
  let parsed;
  try {
    parsed = JSON.parse(choice?.message?.content);
  } catch {
    throw new PlannerError('The AI returned malformed output.');
  }
  // Snap portions to the 0.25 grid; generatePlan validates range, constraints and calories.
  const days = Array.isArray(parsed?.days)
    ? parsed.days.map((d) => Object.fromEntries(Object.entries(d ?? {}).map(([slot, e]) => [slot, { ...e, servings: Math.round(Number(e?.servings) * 4) / 4 }])))
    : parsed?.days;
  return { skeleton: days, summary: String(parsed?.summary ?? '') };
}
