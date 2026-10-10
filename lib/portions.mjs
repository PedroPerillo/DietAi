import { INGREDIENTS, nutritionFor } from './catalog.mjs';

export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 3;
export const SERVING_STEP = 0.25;

export const snapServings = (n) => Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(Number(n) / SERVING_STEP) * SERVING_STEP));

// Rounds a quantity to the ingredient's practical step (whole eggs, half an avocado,
// 5 g of rice). Never rounds to zero: a recipe that uses an ingredient keeps at least
// one step of it.
export function roundToStep(qty, step) {
  const n = Math.round(qty / step) * step;
  const fixed = Math.max(step, n);
  return Math.round(fixed * 1000) / 1000;
}

// Scales a recipe to `servings`, rounds every ingredient to a practical amount, and
// recomputes nutrition and cost from the rounded amounts. This is the only place a
// meal's numbers come from, so what the user is told to cook, buy and eat always
// agree with each other.
export function materialize(recipe, servings) {
  const s = snapServings(servings);
  const pairs = recipe.ingredients.map(([id, qty]) => [id, roundToStep(qty * s, INGREDIENTS[id].step)]);
  const ingredients = pairs.map(([id, quantity]) => ({ id, name: INGREDIENTS[id].name, quantity, unit: INGREDIENTS[id].unit }));
  return { recipeId: recipe.id, servings: s, ingredients, ...nutritionFor(pairs) };
}
