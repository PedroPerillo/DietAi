import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, DIET_RANK, RECIPES, RECIPES_BY_ID, isRecipeAllowed } from '../lib/catalog.mjs';
import { computeTargets, parseProfile, MIN_KCAL } from '../lib/profile.mjs';
import { buildPlan, fitServings, heuristicSkeleton, validateSkeleton } from '../lib/plan.mjs';
import { groceryList, parseCheckoutItems } from '../lib/grocery.mjs';

const base = { sex: 'female', age: 30, heightCm: 165, weightKg: 65, activity: 'moderate', goal: 'maintain', diet: 'omnivore', days: 3 };
const profile = (over = {}) => parseProfile({ ...base, ...over });

test('recipe allergens are derived from ingredients (soy sauce brings gluten)', () => {
  assert.deepEqual(RECIPES_BY_ID['chicken-stir-fry'].allergens, ['gluten', 'soy']);
  assert.equal(RECIPES_BY_ID['veggie-scramble'].diet, 'vegetarian');
  assert.equal(RECIPES_BY_ID['salmon-sweet-potato'].diet, 'pescatarian');
});

test('rejects malformed profiles with a 400', () => {
  for (const bad of [{ age: 12 }, { weightKg: 'abc' }, { diet: 'keto' }, { allergies: ['cilantro'] }, { days: 30 }, { sex: undefined }]) {
    assert.throws(() => profile(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('calorie target never goes below the safety floor', () => {
  const t = computeTargets(profile({ age: 80, heightCm: 145, weightKg: 40, activity: 'sedentary', goal: 'lose' }));
  assert.equal(t.kcal, MIN_KCAL);
  assert.equal(t.floored, true);
});

test('heuristic plans never include a forbidden recipe, for every diet x single-allergen combo', () => {
  for (const diet of Object.keys(DIET_RANK)) {
    for (const allergy of [null, ...ALLERGENS]) {
      const p = profile({ diet, allergies: allergy ? [allergy] : [], days: 7 });
      const skeleton = heuristicSkeleton(p, computeTargets(p));
      assert.deepEqual(validateSkeleton(skeleton, p), [], `${diet}/${allergy}`);
    }
  }
});

test('vegan + no soy + no tree nuts + gain still gets a full plan', () => {
  const p = profile({ diet: 'vegan', allergies: ['soy', 'nuts'], goal: 'gain', days: 7 });
  const plan = buildPlan(heuristicSkeleton(p, computeTargets(p)), p, computeTargets(p));
  for (const day of plan.days) {
    for (const m of day.meals) assert.ok(!m.allergens.includes('soy') && !m.allergens.includes('nuts'), m.recipeId);
    assert.ok(Math.abs(day.totals.kcal - plan.targets.kcal) / plan.targets.kcal < 0.05, `day ${day.day} kcal ${day.totals.kcal}`);
  }
});

test('unsatisfiable constraints return a 422 explaining which meals are impossible', () => {
  const p = profile({ diet: 'vegan', allergies: ['gluten', 'soy'], snacks: true, dislikes: 'oat, tofu' });
  assert.throws(() => heuristicSkeleton(p, computeTargets(p)), (e) => e.status === 422 && /breakfast/.test(e.message));
});

test('dislikes exclude recipes by name or ingredient', () => {
  const p = profile({ dislikes: 'salmon, Quinoa' });
  assert.equal(isRecipeAllowed(RECIPES_BY_ID['salmon-sweet-potato'], p), false);
  assert.equal(isRecipeAllowed(RECIPES_BY_ID['chicken-quinoa-bowl'], p), false);
  assert.equal(isRecipeAllowed(RECIPES_BY_ID['turkey-chili'], p), true);
});

test('validateSkeleton catches each kind of bad AI output', () => {
  const p = profile({ diet: 'vegetarian', allergies: ['dairy'], days: 1, snacks: false });
  const ok = { breakfast: { recipeId: 'tofu-scramble', servings: 1 }, lunch: { recipeId: 'lentil-soup', servings: 1 }, dinner: { recipeId: 'chickpea-curry', servings: 1 } };
  assert.deepEqual(validateSkeleton([ok], p), []);
  const cases = [
    [[ok, ok], /expected 1 days/],
    [{ days: [ok] }, /expected 1 days/],
    [[{ ...ok, lunch: { recipeId: 'pizza', servings: 1 } }], /unknown recipe/],
    [[{ ...ok, lunch: { recipeId: 'constructor', servings: 1 } }], /unknown recipe/],
    [[{ ...ok, lunch: { recipeId: 'chickpea-curry', servings: 1 } }], /is a dinner recipe/],
    [[{ ...ok, lunch: { recipeId: 'chicken-quinoa-bowl', servings: 1 } }], /violates/],
    [[{ ...ok, lunch: { recipeId: 'chickpea-salad', servings: 1 } }], /violates/], // feta = dairy
    [[{ ...ok, dinner: { recipeId: 'chickpea-curry', servings: 9 } }], /out of range/],
    [[{ ...ok, dinner: { recipeId: 'chickpea-curry', servings: Number.NaN } }], /out of range/],
    [[{ breakfast: ok.breakfast, lunch: ok.lunch }], /dinner: missing/],
  ];
  for (const [skeleton, pattern] of cases) assert.match(validateSkeleton(skeleton, p).join('\n'), pattern);
});

test('fitServings lands near target within serving bounds', () => {
  const s = fitServings([400, 500, 600, 200], 2600);
  assert.ok(s.every((x) => x >= 0.5 && x <= 3 && (x * 4) % 1 === 0));
  const kcal = [400, 500, 600, 200].reduce((sum, k, i) => sum + k * s[i], 0);
  assert.ok(Math.abs(kcal - 2600) <= 100, String(kcal));
});

test('grocery list sums an ingredient across meals and servings, rounding packs up', () => {
  const p = profile({ days: 2, snacks: false });
  const skeleton = [
    { breakfast: { recipeId: 'veggie-scramble', servings: 1 }, lunch: { recipeId: 'chicken-quinoa-bowl', servings: 2 }, dinner: { recipeId: 'chicken-stir-fry', servings: 1 } },
    { breakfast: { recipeId: 'avocado-toast-egg', servings: 1.5 }, lunch: { recipeId: 'turkey-chili', servings: 1 }, dinner: { recipeId: 'salmon-sweet-potato', servings: 1 } },
  ];
  const list = groceryList(buildPlan(skeleton, p, computeTargets(p)));
  const line = (id) => list.find((l) => l.ingredientId === id);
  assert.equal(line('chicken_breast').quantity, 150 * 2 + 150);
  assert.equal(line('chicken_breast').packs, 1); // 450g fits in one 680g pack
  assert.equal(line('eggs').quantity, 3 + 2 * 1.5);
  assert.equal(line('whole_wheat_bread').quantity, 1 + 2 * 1.5);
  assert.equal(new Set(list.map((l) => l.ingredientId)).size, list.length);
});

test('checkout items are rebuilt from the catalog and bad input is rejected', () => {
  const lines = parseCheckoutItems([{ ingredientId: 'salmon', quantity: 500, estPrice: 0.01, name: '<b>free</b>' }, { ingredientId: 'salmon', quantity: 100 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].name, 'Salmon fillet');
  assert.equal(lines[0].packs, 2);
  assert.equal(lines[0].estPrice, 23.98);
  for (const bad of [[], null, [{ ingredientId: 'caviar', quantity: 1 }], [{ ingredientId: 'salmon', quantity: 0 }], [{ ingredientId: 'salmon', quantity: -2 }], [{ ingredientId: 'salmon', quantity: 'lots' }], [{ ingredientId: '__proto__', quantity: 1 }]]) {
    assert.throws(() => parseCheckoutItems(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('every catalog recipe has plausible macros', () => {
  for (const r of RECIPES) {
    const kcal = r.protein * 4 + r.carbs * 4 + r.fat * 9;
    assert.ok(Math.abs(kcal - r.kcal) / r.kcal < 0.12, r.id);
  }
});
