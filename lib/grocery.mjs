import { INGREDIENTS, RECIPES_BY_ID, getIngredient } from './catalog.mjs';

const MAX_QTY = 100_000;
const roundQty = (q, unit) => (['g', 'ml'].includes(unit) ? Math.ceil(q) : Math.ceil(q * 4) / 4);
const money = (n) => Math.round(n * 100) / 100;

// One line per ingredient across the whole plan. Units are canonical per ingredient,
// so plain addition is correct; packs are rounded up to what the store sells.
export function groceryList(plan) {
  const needed = new Map();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const [id, qty] of RECIPES_BY_ID[meal.recipeId].ingredients) {
        needed.set(id, (needed.get(id) ?? 0) + qty * meal.servings);
      }
    }
  }
  return [...needed].map(([id, qty]) => lineFor(id, qty)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function lineFor(id, qty) {
  const ing = INGREDIENTS[id];
  const quantity = roundQty(qty, ing.unit);
  const packs = Math.ceil(quantity / ing.pack - 1e-9);
  return {
    ingredientId: id,
    name: ing.name,
    category: ing.category,
    quantity,
    unit: ing.unit,
    packs,
    packSize: ing.pack,
    estPrice: money(packs * ing.price),
  };
}

// Checkout requests come from the browser, so rebuild every line from the catalog:
// the client chooses what to buy, never names, units, or prices.
export function parseCheckoutItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Your cart is empty.');
    err.status = 400;
    throw err;
  }
  const merged = new Map();
  for (const item of items) {
    const qty = Number(item?.quantity);
    if (!getIngredient(item?.ingredientId) || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      const err = new Error(`Invalid cart item: ${JSON.stringify(item).slice(0, 80)}`);
      err.status = 400;
      throw err;
    }
    merged.set(item.ingredientId, (merged.get(item.ingredientId) ?? 0) + qty);
  }
  return [...merged].map(([id, qty]) => lineFor(id, qty));
}

export const cartTotal = (lines) => money(lines.reduce((s, l) => s + l.estPrice, 0));
