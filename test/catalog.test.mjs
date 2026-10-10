import test from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, RECIPES, SLOTS, EQUIPMENT, SKILLS, STYLES, TAGS, STORAGE, nutritionFor, isRecipeAllowed } from '../lib/catalog.mjs';
import { EAT_OUT_DEMO, eatOutAllowed } from '../lib/eatout.mjs';

// Hand-entered per-serving kcal from the first prototype, used as a sanity check that
// the per-ingredient nutrition data is in the right ballpark.
const LEGACY_KCAL = {
  'overnight-oats': 420, 'vegan-protein-oats': 430, 'veggie-scramble': 390, 'avocado-toast-egg': 450, 'tofu-scramble': 340,
  'yogurt-parfait': 380, 'chicken-quinoa-bowl': 560, 'chickpea-salad': 480, 'tuna-wrap': 430, 'turkey-chili': 520, 'lentil-soup': 410,
  'tempeh-grain-bowl': 590, 'seitan-bean-bowl': 560, 'salmon-sweet-potato': 610, 'chicken-stir-fry': 590, 'shrimp-tacos': 520,
  'chickpea-curry': 560, 'turkey-pasta': 620, 'tofu-broccoli': 540, 'veggie-burrito-bowl': 580, 'lentil-bolognese': 520, 'apple-pb': 280,
  'hummus-veg': 200, 'cottage-berries': 210, 'edamame-snack': 190, 'almonds-banana': 270, 'pumpkin-seed-apple': 250,
};

test('every ingredient has per-unit nutrition, a practical step and a storage class', () => {
  for (const [id, ing] of Object.entries(INGREDIENTS)) {
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) assert.ok(Number.isFinite(ing.per[k]) && ing.per[k] >= 0, `${id}.per.${k}`);
    assert.ok(ing.step > 0, `${id}.step`);
    assert.ok(STORAGE.includes(ing.storage), `${id}.storage`);
    assert.ok(ing.pack > 0 && ing.price > 0, `${id} pack/price`);
    if (['g', 'ml'].includes(ing.unit)) assert.equal(ing.step, 5, `${id}: grams/ml round to 5`);
  }
});

test('derived recipe kcal stays near the legacy hand-entered values', () => {
  for (const r of RECIPES) {
    const legacy = LEGACY_KCAL[r.id];
    if (!legacy) continue;
    const ratio = r.kcal / legacy;
    assert.ok(ratio > 0.7 && ratio < 1.3, `${r.id}: ${r.kcal} kcal vs legacy ${legacy}`);
  }
});

test('recipes carry the details the UI and planner need', () => {
  for (const r of RECIPES) {
    assert.ok(SLOTS.includes(r.slot), r.id);
    assert.ok(r.steps.length >= 1, `${r.id} steps`);
    assert.ok(r.equipment.every((e) => EQUIPMENT.includes(e)), `${r.id} equipment`);
    assert.ok(SKILLS.includes(r.skill) && STYLES.includes(r.style), `${r.id} skill/style`);
    assert.ok(r.tags.every((t) => TAGS.includes(t)), `${r.id} tags`);
    assert.ok(r.minutes >= r.activeMinutes, `${r.id} active <= total`);
    assert.ok(r.storage && Number.isFinite(r.storage.fridgeDays) && typeof r.storage.note === 'string', `${r.id} storage`);
    if (r.tags.includes('meal-prep')) assert.ok(Number.isFinite(r.reheatMinutes), `${r.id}: meal-prep needs reheatMinutes`);
    assert.ok(r.cost > 0 && r.kcal > 0 && r.protein >= 0, `${r.id} nutrition`);
    assert.deepEqual({ kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, cost: r.cost }, nutritionFor(r.ingredients));
  }
});

test('each slot has quick, no-equipment, portable and prep options', () => {
  for (const slot of SLOTS) {
    const pool = RECIPES.filter((r) => r.slot === slot);
    assert.ok(pool.some((r) => r.minutes <= 5), `${slot}: a 5-minute option`);
    assert.ok(pool.some((r) => r.equipment.length === 0), `${slot}: a no-equipment option`);
    assert.ok(pool.some((r) => r.tags.includes('portable') && r.tags.includes('no-reheat')), `${slot}: a portable no-reheat option`);
    if (slot === 'lunch' || slot === 'dinner') assert.ok(pool.some((r) => r.tags.includes('meal-prep')), `${slot}: a meal-prep option`);
  }
  // A vegan with a soy and nut allergy still has something in every slot.
  const restricted = { diet: 'vegan', allergies: ['soy', 'nuts', 'peanuts'], dislikes: [] };
  for (const slot of SLOTS) assert.ok(RECIPES.some((r) => r.slot === slot && isRecipeAllowed(r, restricted)), `${slot}: restricted vegan option`);
});

test('eating-out demo items are labelled and filterable', () => {
  assert.ok(EAT_OUT_DEMO.length >= 8);
  for (const e of EAT_OUT_DEMO) {
    assert.equal(e.demo, true, e.id);
    assert.ok(e.kcal > 0 && e.price > 0, e.id);
  }
  assert.ok(eatOutAllowed(EAT_OUT_DEMO.find((e) => e.id === 'veggie-burrito-bowl'), { diet: 'vegan', allergies: [] }));
  assert.equal(eatOutAllowed(EAT_OUT_DEMO.find((e) => e.id === 'cheese-pizza-2'), { diet: 'vegan', allergies: [] }), false);
  assert.equal(eatOutAllowed(EAT_OUT_DEMO.find((e) => e.id === 'falafel-pita'), { diet: 'vegan', allergies: ['sesame'] }), false);
});
