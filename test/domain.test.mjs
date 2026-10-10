import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, DIET_RANK, INGREDIENTS, RECIPES, RECIPES_BY_ID, isRecipeAllowed } from '../lib/catalog.mjs';
import { computeTargets, parseProfile, MIN_KCAL } from '../lib/profile.mjs';
import {
  generate, hydratePlan, grocerySummary, validatePlan, portionIngredients, nutritionOf, alternativesFor, applyMealChange,
  dayContext, prefsOf, dayLabel, MAX_SERVINGS, SLOT_SERVINGS,
} from '../public/shared/engine.mjs';
import { parseCheckoutItems } from '../lib/grocery.mjs';

const START = '2026-10-12'; // a Monday
const base = { sex: 'female', age: 30, heightCm: 165, weightKg: 65, activity: 'moderate', goal: 'maintain', diet: 'omnivore', days: 3, startDate: START };
const profile = (over = {}) => parseProfile({ ...base, ...over });
const planFor = (p) => generate(p, computeTargets(p), { startDate: p.startDate, days: p.days });

// ---------- catalog ----------
test('recipe allergens and diet are derived from ingredients (soy sauce brings gluten)', () => {
  assert.deepEqual(RECIPES_BY_ID['chicken-stir-fry'].allergens, ['gluten', 'soy']);
  assert.equal(RECIPES_BY_ID['veggie-scramble'].diet, 'vegetarian');
  assert.equal(RECIPES_BY_ID['salmon-sweet-potato'].diet, 'pescatarian');
});

test('every recipe has details: steps, equipment, time, storage flags, consistent nutrition', () => {
  for (const r of RECIPES) {
    assert.ok(r.steps.length >= 1, r.id);
    assert.ok(r.minutes > 0 && r.slots.length >= 1, r.id);
    for (const e of r.equipment) for (const x of e.split('|')) assert.ok(['stove', 'oven', 'microwave', 'airfryer'].includes(x), `${r.id} ${x}`);
    assert.ok(['none', 'optional', 'required'].includes(r.reheat), r.id);
    for (const [id] of r.ingredients) assert.ok(INGREDIENTS[id], `${r.id} uses ${id}`);
    // nutrition comes from ingredients, so the 4/4/9 check holds
    assert.ok(Math.abs(r.protein * 4 + r.carbs * 4 + r.fat * 9 - r.kcal) / r.kcal < 0.12, r.id);
  }
});

test('prepared food counts as perishable unless shelf-stable', () => {
  assert.equal(RECIPES_BY_ID['bean-corn-salad'].perishable, true);
  assert.equal(RECIPES_BY_ID['apple-pb'].perishable, false);
});

// ---------- profile ----------
test('rejects malformed profiles with a 400', () => {
  const cases = [{ age: 12 }, { weightKg: 'abc' }, { diet: 'keto' }, { allergies: ['cilantro'] }, { days: 30 }, { sex: undefined },
    { allergies: 'peanuts' }, { allergies: { 0: 'peanuts' } }, { allergies: [['peanuts']] }, { dislikes: 42 }, { snacks: 'no' },
    { budget: 5 }, { budget: 'cheap' }, { equipment: ['fire'] }, { equipment: 'stove' }, { skill: 'chef' }, { style: 'fast' },
    { meals: [] }, { meals: ['brunch'] }, { prepDays: [7] }, { startDate: '12/10/2026' }, { startDate: '2030-01-01' },
    { routine: { 7: {} } }, { routine: { 1: { busy: 'yes' } } }, { routine: { 1: { meals: { lunch: { where: 'office' } } } } },
    { routine: { 1: { meals: { lunch: { minutes: 999 } } } } }, { inventory: [{ id: 'caviar' }] }, { inventory: [{ id: 'oats', qty: -1 }] }, { inventory: 'oats' }];
  for (const bad of cases) assert.throws(() => profile(bad), (e) => e.status === 400, JSON.stringify(bad));
  for (const body of [null, undefined, [], 'x', 7]) assert.throws(() => parseProfile(body), (e) => e.status === 400, String(body));
});

test('calorie target never goes below the safety floor', () => {
  const t = computeTargets(profile({ age: 80, heightCm: 145, weightKg: 40, activity: 'sedentary', goal: 'lose' }));
  assert.equal(t.kcal, MIN_KCAL);
  assert.equal(t.floored, true);
});

// ---------- portions & nutrition ----------
test('portions are practical: whole eggs and tortillas, half cans, 5 g steps', () => {
  for (const r of RECIPES) {
    for (let s = 0.5; s <= MAX_SERVINGS; s += 0.25) {
      for (const { id, qty } of portionIngredients(r, s)) {
        const step = INGREDIENTS[id].step;
        assert.ok(Math.abs(qty / step - Math.round(qty / step)) < 1e-9 && qty >= step, `${r.id} x${s}: ${qty} ${id}`);
      }
    }
  }
  assert.deepEqual(portionIngredients(RECIPES_BY_ID['veggie-scramble'], 2.25).find((i) => i.id === 'eggs'), { id: 'eggs', qty: 7 });
});

test('meal nutrition is recalculated from the rounded amounts', () => {
  const p = profile({ days: 7 });
  const h = hydratePlan(planFor(p), p);
  for (const day of h.days) {
    for (const m of day.meals) assert.deepEqual(m.nutrition, nutritionOf(portionIngredients(RECIPES_BY_ID[m.recipeId], m.servings)));
  }
});

// Regression: the reported plan hit calories but missed protein/carbs/fat badly.
test('default profile: every day matches calories and all three macros', () => {
  const p = profile({ heightCm: 170, weightKg: 72.6, days: 7 });
  const t = computeTargets(p);
  const h = hydratePlan(planFor(p), p);
  for (const d of h.days) {
    const rel = (k) => (d.totals[k] - t[k]) / t[k];
    assert.ok(Math.abs(rel('kcal')) <= 0.06, `${d.label} kcal ${d.totals.kcal}/${t.kcal}`);
    assert.ok(rel('protein') >= -0.1 && rel('protein') <= 0.35, `${d.label} protein ${d.totals.protein}/${t.protein}`);
    assert.ok(Math.abs(rel('carbs')) <= 0.15, `${d.label} carbs ${d.totals.carbs}/${t.carbs}`);
    assert.ok(Math.abs(rel('fat')) <= 0.15, `${d.label} fat ${d.totals.fat}/${t.fat}`);
  }
  assert.deepEqual(h.deviations, []);
});

test('days are labelled with weekday names and dates', () => {
  const p = profile({ days: 2 });
  const h = hydratePlan(planFor(p), p);
  assert.deepEqual(h.days.map((d) => d.label), ['Mon 12', 'Tue 13']);
  assert.equal(dayLabel('2026-10-14', { long: true }), 'Wednesday, Oct 14');
});

// ---------- restrictions ----------
test('plans never include a forbidden recipe, for every diet x allergen x body size', () => {
  const bodies = [{ age: 80, heightCm: 145, weightKg: 40, activity: 'sedentary', goal: 'lose' }, {}, { sex: 'male', age: 20, heightCm: 195, weightKg: 100, activity: 'active', goal: 'gain' }];
  for (const body of bodies) {
    for (const diet of Object.keys(DIET_RANK)) {
      for (const allergy of [null, ...ALLERGENS]) {
        const p = profile({ ...body, diet, allergies: allergy ? [allergy] : [], days: 7 });
        const plan = planFor(p);
        assert.deepEqual(validatePlan(plan, p, plan.targets, { checkBand: false }), [], `${diet}/${allergy}`);
      }
    }
  }
});

test('unsatisfiable constraints return a 422 naming the meal', () => {
  const p = profile({ diet: 'vegan', allergies: ['gluten', 'soy'], dislikes: 'chia' });
  assert.throws(() => planFor(p), (e) => e.status === 422 && /breakfast/.test(e.message));
});

test('the same dish appears at most 3 times a week', () => {
  const p = profile({ diet: 'vegan', allergies: ['soy', 'nuts'], days: 7, budget: 40 });
  const counts = {};
  for (const d of planFor(p).days) for (const m of d.meals) counts[m.recipeId] = (counts[m.recipeId] ?? 0) + 1;
  assert.ok(Object.values(counts).every((n) => n <= 3), JSON.stringify(counts));
});

// ---------- student routine ----------
test('a 10-minute packed lunch with no fridge or microwave gets a fitting meal', () => {
  const p = profile({
    days: 7, meals: ['breakfast', 'lunch', 'dinner'],
    routine: { 1: { busy: true, meals: { lunch: { minutes: 10, where: 'carry', fridge: false, microwave: false } } } },
  });
  const h = hydratePlan(planFor(p), p);
  const tue = h.days[1];
  assert.equal(tue.label, 'Tue 13');
  const lunch = tue.meals.find((m) => m.slot === 'lunch');
  assert.ok(lunch.minutes <= 10, `${lunch.recipeId} takes ${lunch.minutes} min`);
  assert.ok(lunch.recipe.portable, `${lunch.recipeId} is not portable`);
  assert.notEqual(lunch.recipe.reheat, 'required', `${lunch.recipeId} needs reheating`);
});

test('no kitchen equipment means no stove/oven recipes', () => {
  const p = profile({ days: 7, equipment: [] });
  for (const d of hydratePlan(planFor(p), p).days) {
    for (const m of d.meals) if (m.kind === 'cook') assert.deepEqual(m.recipe.equipment, [], `${d.label} ${m.recipeId}`);
  }
});

test('meals per day and the per-day include switch are respected', () => {
  const p = profile({ days: 7, meals: ['lunch', 'dinner'], routine: { 5: { meals: { dinner: { include: false } } } } });
  const plan = planFor(p);
  assert.deepEqual(plan.days[0].meals.map((m) => m.slot), ['lunch', 'dinner']);
  assert.deepEqual(plan.days[5].meals.map((m) => m.slot), ['lunch']);
});

test('day context: packed meals only get the fridge/microwave you say you have', () => {
  const prefs = prefsOf(profile({ routine: { 2: { meals: { lunch: { where: 'carry', microwave: true } } } } }));
  const ctx = dayContext(prefs, '2026-10-14');
  assert.equal(ctx.slots.lunch.where, 'carry');
  assert.equal(ctx.slots.lunch.microwave, true);
  assert.equal(ctx.slots.lunch.fridge, false);
  assert.equal(ctx.slots.dinner.fridge, true);
});

// ---------- budget & inventory ----------
test('a reachable budget is met; an impossible one says so honestly', () => {
  const student = { sex: 'male', age: 20, heightCm: 178, weightKg: 70, activity: 'light', diet: 'vegetarian', allergies: ['nuts'], meals: ['breakfast', 'lunch', 'dinner'], days: 7 };
  const ok = profile({ ...student, budget: 95 });
  const okPlan = planFor(ok);
  const okSum = grocerySummary(hydratePlan(okPlan, ok), { inventory: ok.inventory }, ok.budget);
  assert.ok(okSum.purchaseTotal <= 95, `spent ${okSum.purchaseTotal}`);
  assert.equal(okPlan.budgetNote, undefined);
  const tight = profile({ ...student, budget: 20 });
  const tightPlan = planFor(tight);
  assert.ok(tightPlan.budgetNote.over > 0);
  assert.match(tightPlan.budgetNote.text, /over your \$20\.00 budget/);
  assert.ok(tightPlan.budgetNote.tips.length >= 2);
});

test('groceries: inventory, "I have it" and "bought" all reduce what is left to buy', () => {
  const p = profile({ days: 7 });
  const h = hydratePlan(planFor(p), p);
  const base = grocerySummary(h, {});
  const first = base.lines[0];
  assert.ok(base.purchaseTotal >= base.consumedCost - 0.01, 'whole packs cost at least what is used');
  const have = grocerySummary(h, { inventory: [{ id: first.ingredientId, qty: null }] });
  assert.equal(have.lines.find((l) => l.ingredientId === first.ingredientId).status, 'have');
  assert.ok(Math.abs(have.toBuyTotal - (base.toBuyTotal - first.estPrice)) < 0.01);
  const bought = grocerySummary(h, { bought: { [first.ingredientId]: first.packs } });
  const bl = bought.lines.find((l) => l.ingredientId === first.ingredientId);
  assert.equal(bl.status, 'bought');
  assert.ok(Math.abs(bought.toBuyTotal - (base.toBuyTotal - first.estPrice)) < 0.01);
  assert.ok(Math.abs(bought.purchaseTotal - base.purchaseTotal) < 0.01, 'bought still counts toward the week\'s spend');
  // leftovers: packs bought minus what the meals use
  for (const l of base.leftovers) {
    const line = base.lines.find((x) => x.ingredientId === l.id);
    assert.ok(Math.abs(l.qty - (line.packs * line.packSize - line.need)) < 0.01, l.id);
  }
});

test('food already at home is not counted as left over for next week', () => {
  const p = profile({ days: 7, inventory: [{ id: 'oats', qty: 5000 }, { id: 'brown_rice', qty: 5000 }] });
  const h = hydratePlan(planFor(p), p);
  const sum = grocerySummary(h, { inventory: p.inventory });
  for (const id of ['oats', 'brown_rice']) {
    const line = sum.lines.find((l) => l.ingredientId === id);
    if (line) assert.equal(line.packs, 0, id);
    assert.ok(!sum.leftovers.some((l) => l.id === id), `${id} was at home, not bought`);
  }
});

test('portions stay sensible for each meal (no 3-apple snacks)', () => {
  for (const over of [{}, { goal: 'gain', weightKg: 95, heightCm: 190, sex: 'male' }, { goal: 'lose', weightKg: 50, heightCm: 155 }]) {
    const p = profile({ days: 7, ...over });
    for (const d of planFor(p).days) for (const m of d.meals) {
      const [lo, hi] = SLOT_SERVINGS[m.slot];
      assert.ok(m.servings >= lo && m.servings <= hi, `${m.slot} ${m.recipeId} ×${m.servings}`);
    }
  }
});

test('ingredients you have with a quantity only cover that quantity', () => {
  const p = profile({ days: 7 });
  const h = hydratePlan(planFor(p), p);
  const line = grocerySummary(h, {}).lines.find((l) => l.need > l.packSize) ?? grocerySummary(h, {}).lines[0];
  const partial = grocerySummary(h, { inventory: [{ id: line.ingredientId, qty: line.need / 2 }] }).lines.find((l) => l.ingredientId === line.ingredientId);
  assert.equal(partial.status, 'buy');
  assert.ok(partial.packs <= line.packs);
});

test('the planner prefers what is already at home', () => {
  const p = profile({ days: 7, inventory: [{ id: 'black_beans', qty: null }, { id: 'brown_rice', qty: null }] });
  const uses = planFor(p).days.flatMap((d) => d.meals).filter((m) => RECIPES_BY_ID[m.recipeId].ingredients.some(([id]) => id === 'black_beans' || id === 'brown_rice')).length;
  assert.ok(uses >= 3, `only ${uses} meals use the beans/rice at home`);
});

// ---------- "my day changed" ----------
test('alternatives respect restrictions, the new time limit and explain themselves', () => {
  const p = profile({ days: 7, diet: 'vegetarian', allergies: ['egg'] });
  const plan = planFor(p);
  for (const reason of ['5min', '10min', 'other']) {
    const alts = alternativesFor(plan, p, {}, 2, 'lunch', reason);
    assert.ok(alts.length >= 1 && alts.length <= 3, reason);
    for (const a of alts) {
      assert.ok(isRecipeAllowed(RECIPES_BY_ID[a.recipeId], p), `${reason}: ${a.recipeId}`);
      if (reason !== 'other') assert.ok(a.minutes <= (reason === '5min' ? 5 : 10), `${a.recipeId} ${a.minutes} min`);
      assert.match(a.reason, /kcal/);
      assert.ok(a.nutrition.kcal > 0 && typeof a.extraSpend === 'number');
    }
  }
});

test('"I don\'t have an ingredient" excludes it; confirming keeps everything consistent', () => {
  const p = profile({ days: 7 });
  const plan = planFor(p);
  const meal = plan.days[3].meals.find((m) => m.slot === 'dinner');
  const missing = RECIPES_BY_ID[meal.recipeId].ingredients[0][0];
  const alts = alternativesFor(plan, p, {}, 3, 'dinner', 'missing', { ingredientId: missing });
  assert.ok(alts.length);
  for (const a of alts) assert.ok(!RECIPES_BY_ID[a.recipeId].ingredients.some(([id]) => id === missing), a.recipeId);
  const next = applyMealChange(plan, 3, 'dinner', alts[0]);
  assert.deepEqual(validatePlan(next, p, plan.targets, { checkBand: false }), []);
  const h = hydratePlan(next, p);
  const need = Object.fromEntries(grocerySummary(h, {}).lines.map((l) => [l.ingredientId, l.need]));
  const expected = {};
  for (const d of h.days) for (const m of d.meals) for (const it of m.cookItems) expected[it.id] = +((expected[it.id] ?? 0) + it.qty).toFixed(2);
  assert.deepEqual(need, expected, 'grocery needs match the meals after the swap');
});

test('swapping a meal that fed leftovers keeps those later meals cooked', () => {
  const p = profile({ days: 7 });
  const plan = planFor(p);
  let src;
  plan.days.forEach((d, di) => d.meals.forEach((m) => { if (!src && m.packFor?.length) src = { di, m }; }));
  assert.ok(src, 'plan has at least one batch-cooked meal feeding leftovers');
  const dep = src.m.packFor[0];
  const alt = alternativesFor(plan, p, {}, src.di, src.m.slot, 'other')[0];
  const next = applyMealChange(plan, src.di, src.m.slot, alt);
  const later = next.days[dep.day].meals.find((m) => m.slot === dep.slot);
  assert.equal(later.kind, 'cook');
  assert.equal(later.leftoverOf, undefined);
  const laterCook = hydratePlan(next, p).days[dep.day].meals.find((m) => m.slot === dep.slot);
  assert.ok(laterCook.cookItems.length > 0, 'its ingredients are now bought for that day');
});

test('a former leftover that no longer fits its slot is flagged', () => {
  // Tuesday lunch: 10 minutes, packed, with a microwave at work: a reheated leftover fits, cooking fresh doesn't.
  const p = profile({ days: 7, routine: { 1: { meals: { lunch: { minutes: 10, where: 'carry', fridge: true, microwave: true } } } } });
  const plan = planFor(p);
  const plan2 = structuredClone(plan);
  const mon = plan2.days[0].meals.find((m) => m.slot === 'dinner');
  Object.assign(mon, { recipeId: 'turkey-chili', servings: 1, kind: 'cook', packFor: [{ day: 1, slot: 'lunch', servings: 1 }] });
  plan2.days[1].meals = plan2.days[1].meals.map((m) => (m.slot === 'lunch' ? { slot: 'lunch', recipeId: 'turkey-chili', servings: 1, kind: 'leftover', leftoverOf: { day: 0, slot: 'dinner' } } : m));
  assert.deepEqual(hydratePlan(plan2, p).days[1].meals.find((m) => m.slot === 'lunch').conflicts, []);
  const swapped = applyMealChange(plan2, 0, 'dinner', { slot: 'dinner', recipeId: 'lentil-soup', servings: 1, kind: 'cook' });
  assert.deepEqual(hydratePlan(swapped, p).days[1].meals.find((m) => m.slot === 'lunch').conflicts, ['time']);
});

// ---------- validation gate ----------
test('validatePlan catches each kind of bad plan', () => {
  const p = profile({ diet: 'vegetarian', allergies: ['dairy'], days: 1, meals: ['breakfast', 'lunch', 'dinner'] });
  const t = { kcal: 1500 };
  const ok = [{ slot: 'breakfast', recipeId: 'tofu-scramble', servings: 1, kind: 'cook' }, { slot: 'lunch', recipeId: 'lentil-soup', servings: 1, kind: 'cook' }, { slot: 'dinner', recipeId: 'chickpea-curry', servings: 1, kind: 'cook' }];
  const plan = (meals) => ({ days: [{ date: START, meals }] });
  const swap = (slot, change) => ok.map((m) => (m.slot === slot ? { ...m, ...change } : m));
  assert.deepEqual(validatePlan(plan(ok), p, t), []);
  const cases = [
    [swap('lunch', { recipeId: 'pizza' }), /unknown recipe/],
    [swap('lunch', { recipeId: 'constructor' }), /unknown recipe/],
    [swap('breakfast', { recipeId: 'chickpea-curry' }), /not a breakfast recipe/],
    [swap('lunch', { recipeId: 'chicken-quinoa-bowl' }), /violates/],
    [swap('lunch', { recipeId: 'chickpea-salad' }), /violates/], // feta = dairy
    [swap('dinner', { servings: 9 }), /out of range/],
    [swap('dinner', { servings: Number.NaN }), /out of range/],
    [ok.map((m) => ({ ...m, servings: 0.5 })), /below the 1200 kcal floor/],
    [ok.map((m) => ({ ...m, servings: 3 })), /not within 10%/],
  ];
  for (const [meals, pattern] of cases) assert.match(validatePlan(plan(meals), p, t).join('\n'), pattern);
  assert.deepEqual(validatePlan({ days: [] }, p, t), ['plan has no days']);
});

// ---------- checkout ----------
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
