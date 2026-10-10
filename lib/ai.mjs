import { getRecipe } from './catalog.mjs';
import { candidatePools } from '../public/shared/engine.mjs';

// OpenAI-compatible chat providers. DeepSeek wins when its key is set; otherwise Groq
// (free plan defaults). Groq supports strict JSON-schema output; DeepSeek only
// guarantees a JSON object, so it gets the schema in the prompt and the same
// server-side validation afterwards.
const PROVIDERS = {
  deepseek: { key: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL', model: 'DEEPSEEK_MODEL', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', strictSchema: false },
  groq: { key: 'GROQ_API_KEY', baseUrl: 'GROQ_BASE_URL', model: 'GROQ_MODEL', defaultBase: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b', strictSchema: true },
};
export const provider = () => (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'groq');
const cfg = () => PROVIDERS[provider()];
const BASE_URL = () => (process.env[cfg().baseUrl] || cfg().defaultBase).replace(/\/$/, '');
export const MODEL = process.env[cfg().model] || cfg().defaultModel;
export const modelName = () => process.env[cfg().model] || cfg().defaultModel;
export const aiEnabled = () => Boolean(process.env[cfg().key]);
// One attempt with a hard deadline, kept well under the browser's 150 s timeout so a
// slow call still leaves time to return the fallback plan.
export const AI_TIMEOUT_MS = 90_000;
const MAX_COMPLETION_TOKENS = 4096; // plan JSON is ~1K tokens; the rest is headroom for reasoning

// message: for logs. userMessage: plain words for the plan notice (no technical detail).
export class PlannerError extends Error {
  constructor(message, userMessage = 'The AI planner is unavailable right now.') {
    super(message);
    this.userMessage = userMessage;
  }
}

// The model only chooses which recipe goes in each meal, from per-day lists the engine
// already filtered for the user's diet, allergies, equipment, time and take-away needs.
// It never sets portions or nutrition: the engine fits portions to the targets afterwards.
function outputSchema(pools) {
  const dayProps = {};
  pools.forEach((day, i) => {
    const slots = Object.keys(day.slots);
    dayProps[`d${i}`] = {
      type: 'object',
      additionalProperties: false,
      required: slots,
      properties: Object.fromEntries(slots.map((s) => [s, { type: 'string', enum: day.slots[s] }])),
    };
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'days'],
    properties: {
      summary: { type: 'string', description: 'Two or three friendly sentences explaining the week to a student.' },
      days: { type: 'object', additionalProperties: false, required: Object.keys(dayProps), properties: dayProps },
    },
  };
}

const SYSTEM = `You are a meal planner for students on a budget with changing routines.
For each day and meal, pick one recipe id from that day's allowed list, using a different recipe for each meal of the same day (they already fit the student's diet, allergies, kitchen, time and take-away needs).
Favor variety across days, reuse ingredients across recipes to keep shopping cheap, prefer recipes that use what the student already has, and pick faster options on busy days.
Respect the student's notes when they don't conflict with those limits.`;

export async function aiSkeleton(profile, targets, { signal } = {}) {
  const pools = candidatePools(profile, { startDate: profile.startDate, days: profile.days });
  const ids = [...new Set(pools.flatMap((d) => Object.values(d.slots).flat()))];
  // Compact rows keep the prompt small (Groq's free plan has a per-minute token budget):
  // [id, kcal, protein, carbs, fat, minutes, cost per serving USD, ingredient ids]
  const catalog = ids.map((id) => {
    const r = getRecipe(id);
    return [id, r.kcal, r.protein, r.carbs, r.fat, r.minutes, r.cost, r.ingredients.map(([i]) => i).join(' ')];
  });
  const user = {
    daily_targets: { kcal: targets.kcal, protein_g: targets.protein, carbs_g: targets.carbs, fat_g: targets.fat },
    weekly_budget_usd: profile.budget,
    have_at_home: profile.inventory.map((e) => e.id),
    style: profile.style,
    days: pools.map((d, i) => ({ key: `d${i}`, date: d.date, weekday: d.weekday, busy: d.busy })),
    user_notes: profile.notes || null,
    recipe_columns: ['id', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'minutes', 'cost_usd', 'ingredients'],
    recipes_per_serving: catalog,
  };

  const schema = outputSchema(pools);
  const strict = cfg().strictSchema;
  const name = provider();
  let res;
  try {
    res = await fetch(`${BASE_URL()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[cfg().key]}` },
      body: JSON.stringify({
        model: modelName(),
        messages: [
          { role: 'system', content: strict ? SYSTEM : `${SYSTEM}\nReply with a single JSON object that matches this JSON schema exactly (every day key, every meal, recipe ids only from that day's enum):\n${JSON.stringify(schema)}` },
          { role: 'user', content: JSON.stringify(user) },
        ],
        // Strict mode (Groq): constrained decoding, so the reply always matches the schema
        // (including the per-slot recipe enums). Others: plain JSON mode with the schema in
        // the prompt. generatePlan re-validates every choice either way.
        response_format: strict ? { type: 'json_schema', json_schema: { name: 'meal_plan', strict: true, schema } } : { type: 'json_object' },
        ...(strict && { reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: MAX_COMPLETION_TOKENS }),
        ...(!strict && { max_tokens: MAX_COMPLETION_TOKENS, temperature: 0.3 }),
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(AI_TIMEOUT_MS)]) : AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    if (signal?.aborted) throw e; // the browser went away; nothing to report
    throw new PlannerError(e.name === 'TimeoutError' ? `${name} timeout` : `${name} unreachable: ${e.message}`, e.name === 'TimeoutError' ? 'The AI planner took too long.' : 'The AI planner is unavailable right now.');
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.error(`${name} ${res.status}: ${detail}`);
    if (res.status === 429) throw new PlannerError(`${name} 429: rate limit`, 'The AI planner is busy right now.');
    if (res.status === 402) throw new PlannerError(`${name} 402: no balance`, 'The AI planner is unavailable right now.');
    if (res.status === 401 || res.status === 403) throw new PlannerError(`${name} ${res.status}: key rejected`);
    throw new PlannerError(`${name} ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new PlannerError(`${name} response cut off`, "The AI planner's answer was incomplete.");
  if (choice?.message?.refusal) throw new PlannerError(`${name} refusal`, 'The AI planner declined this request.');
  let parsed;
  try {
    parsed = JSON.parse(choice?.message?.content);
  } catch {
    throw new PlannerError(`${name} malformed output`, "The AI planner's answer was incomplete.");
  }
  // Choices only; the caller turns them into a plan with fitted portions and validates it.
  const choices = pools.map((day, i) => {
    const picked = parsed?.days?.[`d${i}`] ?? {};
    return Object.fromEntries(Object.keys(day.slots).map((slot) => [slot, picked[slot]]));
  });
  return { choices, summary: String(parsed?.summary ?? '') };
}
