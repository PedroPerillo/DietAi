import { RECIPES_BY_ID, SLOTS, allowedRecipes, getRecipe, isRecipeAllowed } from './catalog.mjs';

export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 3;
const roundQuarter = (n) => Math.round(n * 4) / 4;
const round1 = (n) => Math.round(n * 10) / 10;

export const slotsFor = (profile) => (profile.snacks ? SLOTS : SLOTS.filter((s) => s !== 'snack'));

// A "skeleton" is the minimal plan shape both planners produce:
//   [{ breakfast: { recipeId, servings }, lunch: {...}, ... }, ...]  (one object per day)
// buildPlan turns it into the full plan with nutrition totals. Nutrition is always
// computed here from the catalog, never taken from the model.
export function buildPlan(skeleton, profile, targets) {
  const days = skeleton.map((day, i) => {
    const meals = slotsFor(profile).map((slot) => {
      const { recipeId, servings } = day[slot];
      const r = RECIPES_BY_ID[recipeId];
      return {
        slot,
        recipeId,
        name: r.name,
        minutes: r.minutes,
        servings,
        kcal: Math.round(r.kcal * servings),
        protein: round1(r.protein * servings),
        carbs: round1(r.carbs * servings),
        fat: round1(r.fat * servings),
        allergens: r.allergens,
      };
    });
    const total = (k) => round1(meals.reduce((s, m) => s + m[k], 0));
    return { day: i + 1, meals, totals: { kcal: Math.round(total('kcal')), protein: total('protein'), carbs: total('carbs'), fat: total('fat') } };
  });
  return { targets, days };
}

// Checks a skeleton (typically from the LLM) against the profile. Returns a list of
// problems; empty means safe to use. This is the hard allergy/diet gate.
export function validateSkeleton(skeleton, profile) {
  const errors = [];
  if (!Array.isArray(skeleton) || skeleton.length !== profile.days) {
    return [`expected ${profile.days} days, got ${Array.isArray(skeleton) ? skeleton.length : typeof skeleton}`];
  }
  skeleton.forEach((day, i) => {
    for (const slot of slotsFor(profile)) {
      const entry = day?.[slot];
      const where = `day ${i + 1} ${slot}`;
      if (!entry) { errors.push(`${where}: missing`); continue; }
      const r = getRecipe(entry.recipeId);
      if (!r) { errors.push(`${where}: unknown recipe "${entry.recipeId}"`); continue; }
      if (r.slot !== slot) errors.push(`${where}: "${r.id}" is a ${r.slot} recipe`);
      if (!isRecipeAllowed(r, profile)) errors.push(`${where}: "${r.id}" violates diet/allergy/dislike constraints`);
      if (!(entry.servings >= MIN_SERVINGS && entry.servings <= MAX_SERVINGS)) errors.push(`${where}: servings ${entry.servings} out of range`);
    }
  });
  return errors;
}

// Deterministic planner: rotate through allowed recipes per slot for variety, then
// scale servings so each day lands near the calorie target. Used when no API key is
// configured and as the fallback when the LLM output fails validation.
export function heuristicSkeleton(profile, targets) {
  const pool = allowedRecipes(profile);
  const slots = slotsFor(profile);
  const bySlot = Object.fromEntries(slots.map((s) => [s, pool.filter((r) => r.slot === s)]));
  const empty = slots.filter((s) => bySlot[s].length === 0);
  if (empty.length) {
    const err = new Error(`No recipes fit your constraints for: ${empty.join(', ')}. Try relaxing an allergy or dislike.`);
    err.status = 422;
    throw err;
  }
  // Prefer higher protein density so high-protein restrictive diets still get close.
  for (const s of slots) bySlot[s].sort((a, b) => b.protein / b.kcal - a.protein / a.kcal);

  return Array.from({ length: profile.days }, (_, d) => {
    const picks = Object.fromEntries(slots.map((s, si) => [s, bySlot[s][(d + si) % bySlot[s].length]]));
    const servings = fitServings(slots.map((s) => picks[s].kcal), targets.kcal);
    return Object.fromEntries(slots.map((s, i) => [s, { recipeId: picks[s].id, servings: servings[i] }]));
  });
}

// Start from a uniform scale, then nudge individual meals by 0.25 servings while that
// brings the day closer to the calorie target.
export function fitServings(kcals, target) {
  const total = kcals.reduce((a, b) => a + b, 0);
  const clamp = (n) => Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
  const servings = kcals.map(() => clamp(roundQuarter(target / total)));
  const dayKcal = () => kcals.reduce((sum, k, i) => sum + k * servings[i], 0);
  for (let step = 0; step < 24; step++) {
    const diff = target - dayKcal();
    let best = null;
    kcals.forEach((k, i) => {
      const next = clamp(servings[i] + Math.sign(diff) * 0.25);
      const err = Math.abs(diff - k * (next - servings[i]));
      if (next !== servings[i] && err < Math.abs(diff) && (!best || err < best.err)) best = { i, next, err };
    });
    if (!best) break;
    servings[best.i] = best.next;
  }
  return servings;
}
