import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES_BY_ID, INGREDIENTS, nutritionFor } from '../lib/catalog.mjs';
import { materialize, roundToStep, snapServings } from '../lib/portions.mjs';

test('roundToStep rounds to the nearest practical amount and never to zero', () => {
  assert.equal(roundToStep(3.75, 1), 4);
  assert.equal(roundToStep(3.25, 1), 3);
  assert.equal(roundToStep(0.2, 1), 1);
  assert.equal(roundToStep(0.6, 0.5), 0.5);
  assert.equal(roundToStep(0.3, 0.25), 0.25);
  assert.equal(roundToStep(72, 5), 70);
  assert.equal(roundToStep(73, 5), 75);
  assert.equal(roundToStep(1, 5), 5);
});

test('materialize gives whole eggs, 5 g grains and recomputes nutrition from the rounded amounts', () => {
  const scramble = materialize(RECIPES_BY_ID['veggie-scramble'], 1.25);
  const eggs = scramble.ingredients.find((i) => i.id === 'eggs');
  assert.equal(eggs.quantity, 4); // 3 × 1.25 = 3.75 → 4 whole eggs
  assert.equal(eggs.unit, 'each');
  const oats = materialize(RECIPES_BY_ID['overnight-oats'], 1.25).ingredients.find((i) => i.id === 'oats');
  assert.equal(oats.quantity, 65); // 50 × 1.25 = 62.5 → 65 g
  const pairs = scramble.ingredients.map((i) => [i.id, i.quantity]);
  assert.deepEqual({ kcal: scramble.kcal, protein: scramble.protein, carbs: scramble.carbs, fat: scramble.fat, cost: scramble.cost }, nutritionFor(pairs));
  assert.ok(scramble.kcal > RECIPES_BY_ID['veggie-scramble'].kcal, 'rounding up eggs adds calories, and the meal says so');
});

test('every ingredient of every recipe keeps at least one step at the smallest portion', () => {
  for (const r of Object.values(RECIPES_BY_ID)) {
    const m = materialize(r, 0.5);
    assert.equal(m.ingredients.length, r.ingredients.length, r.id);
    for (const i of m.ingredients) assert.ok(i.quantity >= INGREDIENTS[i.id].step, `${r.id}: ${i.id} ${i.quantity}`);
  }
});

test('servings snap to the 0.25 grid within 0.5–3', () => {
  assert.equal(snapServings(1.1), 1);
  assert.equal(snapServings(1.13), 1.25);
  assert.equal(snapServings(0.1), 0.5);
  assert.equal(snapServings(9), 3);
  assert.equal(materialize(RECIPES_BY_ID['apple-pb'], 1.13).servings, 1.25);
});
