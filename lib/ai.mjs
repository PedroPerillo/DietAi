import Anthropic from '@anthropic-ai/sdk';
import { allowedRecipes } from './catalog.mjs';
import { slotsFor, validateSkeleton, MIN_SERVINGS, MAX_SERVINGS } from './plan.mjs';

export const MODEL = 'claude-opus-5-5';

// Created lazily so the server runs without a key (heuristic planner only).
let client;
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
const getClient = () => (client ??= new Anthropic({ timeout: 120_000, maxRetries: 1 }));

export class PlannerError extends Error {}

// The model only chooses recipes and portion sizes from the allowed catalog; it never
// invents foods or nutrition numbers. Per-slot enums mean it can't even name a recipe
// that breaks the user's constraints, and validateSkeleton re-checks everything anyway.
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

export async function aiSkeleton(profile, targets) {
  const pool = allowedRecipes(profile);
  const catalog = pool.map((r) => ({
    id: r.id, slot: r.slot, name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, minutes: r.minutes,
    ingredients: r.ingredients.map(([id]) => id),
  }));
  const user = {
    days: profile.days,
    meals_per_day: slotsFor(profile),
    daily_targets: { kcal: targets.kcal, protein_g: targets.protein, carbs_g: targets.carbs, fat_g: targets.fat },
    goal: profile.goal,
    diet: profile.diet,
    user_notes: profile.notes || null,
    catalog_per_serving: catalog,
  };

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: outputSchema(profile, pool) } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(user) }],
  });

  if (response.stop_reason === 'refusal') throw new PlannerError('The AI declined to build this plan.');
  if (response.stop_reason === 'max_tokens') throw new PlannerError('The AI response was cut off.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PlannerError('The AI returned malformed output.');
  }
  // Snap portions to the 0.25 grid; validateSkeleton enforces the range and constraints.
  const days = Array.isArray(parsed?.days)
    ? parsed.days.map((d) => Object.fromEntries(Object.entries(d ?? {}).map(([slot, e]) => [slot, { ...e, servings: Math.round(Number(e?.servings) * 4) / 4 }])))
    : parsed?.days;
  const errors = validateSkeleton(days, profile);
  if (errors.length) throw new PlannerError(`The AI plan failed validation: ${errors.slice(0, 3).join('; ')}`);
  return { skeleton: days, summary: String(parsed.summary ?? '') };
}
