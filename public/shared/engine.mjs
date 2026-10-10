// FitBite planning engine, shared by the server (plan generation, validation) and the
// browser ("my day changed", grocery list, budget). Pure functions only: every number the
// app shows (portions, nutrients, costs, purchases, leftovers) comes from here, so a change
// anywhere stays consistent everywhere.
import { INGREDIENTS, RECIPES, SLOTS, getRecipe, getIngredient, isRecipeAllowed } from './catalog.mjs';

export const MIN_KCAL = 1200;
export const MIN_SERVINGS = 0.5;
export const MAX_SERVINGS = 3;
export const SERVING_STEP = 0.25;
export const KCAL_TOLERANCE = 0.1; // generated days must land within ±10% of the calorie target
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SKILL_LEVEL = { beginner: 1, comfortable: 2, confident: 3 };
export const DEFAULT_MINUTES = { breakfast: 10, lunch: 20, dinner: 30, snack: 5 };
const LEFTOVER_MAX_DAYS = 3; // cooked leftovers: USDA says 3–4 days refrigerated; plan within 3
const REHEAT_MINUTES = 3;
const MAX_USES_PER_WEEK = 3; // the same dish (cooked or as leftovers) at most 3 times a week

const round1 = (n) => Math.round(n * 10) / 10;
const money = (n) => Math.round(n * 100) / 100;
// Sensible portion range per meal, so calories don't pile onto one meal (no 3-apple snacks,
// no half-portion breakfasts). Always within MIN_SERVINGS..MAX_SERVINGS.
export const SLOT_SERVINGS = { breakfast: [0.75, 2.5], lunch: [0.75, MAX_SERVINGS], dinner: [0.75, MAX_SERVINGS], snack: [MIN_SERVINGS, 1.5] };
const clampServings = (s, slot) => {
  const [lo, hi] = SLOT_SERVINGS[slot] ?? [MIN_SERVINGS, MAX_SERVINGS];
  return Math.min(hi, Math.max(lo, Math.round(s / SERVING_STEP) * SERVING_STEP));
};
const unitPrice = (id) => INGREDIENTS[id].price / INGREDIENTS[id].pack;

// ================= dates =================
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
export function dayLabel(iso, { long = false } = {}) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = WEEKDAYS[weekdayOf(iso)];
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return long ? `${wd}, ${month} ${d.getUTCDate()}` : `${wd.slice(0, 3)} ${d.getUTCDate()}`;
}

// ================= portions & nutrition =================
// Practical rounding: whole eggs and tortillas, half cans and avocados, 5 g / 5 ml steps.
export function roundQty(id, qty) {
  if (!(qty > 0)) return 0;
  const step = INGREDIENTS[id].step;
  return Math.max(step, Math.round(qty / step) * step);
}

// Ingredients for `servings` portions, rounded to practical amounts.
export function portionIngredients(recipe, servings) {
  return recipe.ingredients.map(([id, q]) => ({ id, qty: +roundQty(id, q * servings).toFixed(2) }));
}

export function nutritionOf(items) {
  const t = [0, 0, 0, 0];
  for (const { id, qty } of items) {
    const i = INGREDIENTS[id];
    for (let k = 0; k < 4; k++) t[k] += (i.n[k] * qty) / i.per;
  }
  return { kcal: Math.round(t[0]), protein: round1(t[1]), carbs: round1(t[2]), fat: round1(t[3]) };
}

export const consumedCost = (items) => money(items.reduce((s, { id, qty }) => s + unitPrice(id) * qty, 0));
const addNut = (a, b) => ({ kcal: a.kcal + b.kcal, protein: round1(a.protein + b.protein), carbs: round1(a.carbs + b.carbs), fat: round1(a.fat + b.fat) });
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

// ================= preferences & daily context =================
// Normalized student preferences (the server's parseProfile produces this shape).
export function prefsOf(profile) {
  return {
    diet: profile.diet, allergies: profile.allergies ?? [], dislikes: profile.dislikes ?? [],
    meals: profile.meals ?? (profile.snacks === false ? ['breakfast', 'lunch', 'dinner'] : SLOTS),
    equipment: profile.equipment ?? ['stove', 'oven', 'microwave'],
    skill: SKILL_LEVEL[profile.skill] ?? 2,
    style: profile.style ?? 'balanced',
    budget: profile.budget ?? null,
    prepDays: profile.prepDays ?? [],
    routine: profile.routine ?? {},
    inventory: profile.inventory ?? [],
  };
}

// What a given slot on a given date looks like: time available, eaten at home or packed,
// fridge / microwave access where it's eaten, busy day. Unset fields fall back to defaults.
export function dayContext(prefs, iso) {
  const wd = weekdayOf(iso);
  const day = prefs.routine?.[wd] ?? {};
  const slots = {};
  for (const slot of SLOTS) {
    const s = day.meals?.[slot] ?? {};
    const include = s.include ?? prefs.meals.includes(slot);
    const where = s.where === 'carry' ? 'carry' : 'home';
    const homeMicrowave = prefs.equipment.includes('microwave') || prefs.equipment.includes('stove');
    slots[slot] = {
      include,
      minutes: s.minutes ?? (day.busy ? Math.min(DEFAULT_MINUTES[slot], 15) : DEFAULT_MINUTES[slot]),
      where,
      // At home: your fridge and appliances. Packed: only what's available where you eat.
      fridge: where === 'home' ? true : s.fridge === true,
      microwave: where === 'home' ? homeMicrowave : s.microwave === true,
    };
  }
  return { date: iso, weekday: wd, busy: Boolean(day.busy), prepDay: prefs.prepDays.includes(wd), slots };
}

const hasEquipment = (recipe, prefs) => recipe.equipment.every((req) => req.split('|').some((e) => prefs.equipment.includes(e)));

// Checks a fresh-cooked recipe against a slot context. Hard issues rule it out when any
// alternative exists; soft ones only lower its score.
export function contextIssues(recipe, ctx, prefs, { leftover = false } = {}) {
  const hard = [];
  const soft = [];
  if (!leftover && !hasEquipment(recipe, prefs)) hard.push('equipment');
  const minutes = leftover ? (recipe.reheat === 'required' ? REHEAT_MINUTES : 0) : recipe.minutes;
  if (minutes > ctx.minutes) hard.push('time');
  if (ctx.where === 'carry') {
    if (!recipe.portable) hard.push('portable');
    if (recipe.reheat === 'required' && !ctx.microwave) hard.push('reheat');
    if (recipe.perishable && !ctx.fridge) soft.push('ice-pack');
  } else if (leftover && recipe.reheat === 'required' && !ctx.microwave) hard.push('reheat');
  if (!leftover && recipe.skill > prefs.skill) soft.push('skill');
  return { hard, soft, minutes };
}

// ================= planning =================
const TARGET_KEYS = ['kcal', 'protein', 'carbs', 'fat'];

// Squared relative error against the day's targets. Calories matter most; protein
// shortfall is penalized more than excess; carbs and fat both count.
export function dayError(n, t) {
  const rel = (k) => (n[k] - t[k]) / Math.max(1, t[k]);
  const p = rel('protein');
  return 4 * rel('kcal') ** 2 + 2.5 * (p < 0 ? p : p > 0.25 ? p - 0.25 : 0) ** 2 + 1.5 * rel('carbs') ** 2 + 1.5 * rel('fat') ** 2;
}

// Linear (unrounded) nutrition per serving, for fast fitting.
const perServing = (recipe) => ({ kcal: recipe.kcal, protein: recipe.protein, carbs: recipe.carbs, fat: recipe.fat });

// Choose servings for each meal (on the 0.25 grid) to minimize the day's macro error.
// `fixed` meals keep their servings; returns servings array.
export function fitServings(recipes, targets, { fixed = [], start, slots = [] } = {}) {
  const s = recipes.map((r, i) => (fixed[i] ? start?.[i] ?? 1 : clampServings(start?.[i] ?? 1, slots[i])));
  const total = () => recipes.reduce((acc, r, i) => addNut(acc, scale(perServing(r), s[i])), ZERO);
  const err = () => dayError(total(), targets);
  let best = err();
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < recipes.length; i++) {
      if (fixed[i]) continue;
      for (const d of [SERVING_STEP, -SERVING_STEP, 2 * SERVING_STEP, -2 * SERVING_STEP]) {
        const old = s[i];
        const next = clampServings(old + d, slots[i]);
        if (next === old) continue;
        s[i] = next;
        const e = err();
        if (e < best - 1e-9) { best = e; improved = true; } else s[i] = old;
      }
    }
    if (!improved) break;
  }
  return s;
}
const scale = (n, k) => ({ kcal: n.kcal * k, protein: n.protein * k, carbs: n.carbs * k, fat: n.fat * k });

// Marginal grocery cost of adding `items` given what's already committed this week and
// what's in the inventory (whole packs are what you actually pay for).
function marginalCost(items, committed, invQty) {
  let cost = 0;
  for (const { id, qty } of items) {
    const ingr = INGREDIENTS[id];
    const have = invQty(id);
    const before = Math.max(0, (committed[id] ?? 0) - have);
    const after = Math.max(0, (committed[id] ?? 0) + qty - have);
    cost += (Math.ceil(after / ingr.pack - 1e-9) - Math.ceil(before / ingr.pack - 1e-9)) * ingr.price;
  }
  return cost;
}

const inventoryLookup = (inventory) => {
  const map = new Map(inventory.map((e) => [e.id, e.qty == null ? Infinity : e.qty]));
  return (id) => map.get(id) ?? 0;
};

// Plans a week. Returns { days: [{ date, meals }], notes } where each meal is
// { slot, recipeId, servings, kind: 'cook' | 'leftover', leftoverOf?, packFor?, issues }.
// Options: costWeight (budget pressure), pinned { 'dayIdx:slot': meal }, rng-free and
// deterministic so tests and the browser agree.
export function planWeek(profile, targets, { costWeight = 0, pinned = {}, avoid = new Set(), startDate, days } = {}) {
  const prefs = prefsOf(profile);
  const invQty = inventoryLookup(prefs.inventory);
  const pool = RECIPES.filter((r) => isRecipeAllowed(r, prefs));
  const committed = {}; // ingredient -> qty planned so far
  const used = {}; // recipeId -> times planned
  const sources = []; // batch-cooked meals that can feed later leftovers
  const notes = [];
  const out = [];
  const budgetPerMeal = 3; // fixed reference so the cost weight means the same for every budget
  // Cost per 100 kcal ranking per slot (used only under strong budget pressure).
  const cheapRank = new Map();
  const cheapCut = {};
  for (const slot of SLOTS) {
    const inSlot = pool.filter((r) => r.slots.includes(slot)).sort((a, b) => a.cost / a.kcal - b.cost / b.kcal);
    inSlot.forEach((r, i) => cheapRank.set(r.id, Math.min(cheapRank.get(r.id) ?? Infinity, i)));
    cheapCut[slot] = Math.max(3, Math.ceil(inSlot.length * 0.5)) - 1;
  }

  for (let d = 0; d < days; d++) {
    const date = addDays(startDate, d);
    const ctx = dayContext(prefs, date);
    const slots = SLOTS.filter((s) => ctx.slots[s].include);
    // relax: 0 = every rule, 1 = drop the budget shortlist, 2 = also allow more than 3 uses a week.
    const buildOptions = (relax) => slots.map((slot) => {
      const key = `${d}:${slot}`;
      if (pinned[key]) {
        // Pinned recipe (a favorite, or the AI's pick). Servings stay fixed only if given.
        const r = getRecipe(pinned[key].recipeId);
        return r ? [{ recipe: r, kind: 'cook', score: 0, noCostScore: 0, hard: [], soft: [], pinned: pinned[key].servings != null, servings: pinned[key].servings }] : [];
      }
      const sc = ctx.slots[slot];
      const scored = [];
      for (const r of pool) {
        if (!r.slots.includes(slot) || avoid.has(r.id)) continue;
        const { hard, soft, minutes } = contextIssues(r, sc, prefs);
        const items = portionIngredients(r, 1);
        const inv = items.filter((it) => invQty(it.id) > 0 || (committed[it.id] ?? 0) % INGREDIENTS[it.id].pack > 0).length / items.length;
        if ((used[r.id] ?? 0) >= MAX_USES_PER_WEEK && relax < 2) hard.push('variety');
        // Under budget pressure, stick to the cheapest recipes per calorie (more reuse).
        if (costWeight >= 5 && relax < 1 && cheapRank.get(r.id) > cheapCut[slot]) hard.push('cheap');
        // Preference score (variety, inventory reuse, skill, style, busy days); the cost term
        // is added only for shortlist ranking, since searchCombos prices the whole day itself.
        const noCost = (used[r.id] ?? 0) * 1.2 + (out[d - 1]?.meals.some((m) => m.recipeId === r.id) ? 0.8 : 0) - inv * 0.5
          + (soft.includes('skill') ? 0.4 : 0) + (soft.includes('ice-pack') ? 0.5 : 0)
          + (prefs.style === 'quick' ? minutes / 25 : 0) + (prefs.style === 'bought' && r.style === 'assembled' ? -0.4 : 0)
          + (prefs.style === 'homemade' && r.style === 'homemade' ? -0.3 : 0) + (ctx.busy ? minutes / 30 : 0);
        const score = noCost + costWeight * (marginalCost(items, committed, invQty) / budgetPerMeal);
        scored.push({ recipe: r, kind: 'cook', score, noCostScore: noCost, hard, soft, minutes });
      }
      // Leftovers from a batch cooked within the last few days fit busy or short slots.
      for (const src of sources) {
        if (d - src.day < 1 || d - src.day > Math.min(LEFTOVER_MAX_DAYS, src.recipe.batch)) continue;
        if (!src.recipe.slots.includes(slot) || src.portionsLeft <= 0) continue;
        const { hard, soft, minutes } = contextIssues(src.recipe, sc, prefs, { leftover: true });
        if ((used[src.recipe.id] ?? 0) >= MAX_USES_PER_WEEK && relax < 2) hard.push('variety');
        const lscore = (used[src.recipe.id] ?? 0) * 0.3 - (sc.minutes < src.recipe.minutes ? 0.8 : 0.2);
        scored.push({ recipe: src.recipe, kind: 'leftover', src, score: lscore, noCostScore: lscore, hard, soft, minutes });
      }
      const fits = scored.filter((c) => c.hard.length === 0);
      let list = fits;
      if (!list.length) {
        // Nothing fits every rule: relax the budget shortlist first, then variety, then time,
        // then the rest, and say so for the routine rules.
        const only = (...ok) => scored.filter((c) => c.hard.every((h) => ok.includes(h)));
        for (const ok of [['cheap'], ['cheap', 'variety'], ['cheap', 'variety', 'time']]) if (!list.length) list = only(...ok);
        if (!list.length) list = scored.filter((c) => !c.hard.includes('equipment'));
        if (!list.length) list = scored;
        const relaxed = [...new Set(list[0]?.hard ?? [])].filter((h) => h !== 'variety' && h !== 'cheap');
        if (relaxed.length) notes.push({ day: d, slot, type: 'relaxed', detail: relaxed });
      }
      return list.sort((a, b) => a.score - b.score).slice(0, slots.length > 3 ? 5 : 6);
    });
    let options = buildOptions(0);
    if (options.some((o) => !o.length)) {
      const missing = slots.filter((_, i) => !options[i].length);
      const err = new Error(`No recipes fit your constraints for: ${missing.join(', ')}. Try relaxing an allergy or dislike.`);
      err.status = 422;
      throw err;
    }

    // Try every combination of the shortlists; fit portions; keep the best.
    let best = searchCombos(options);
    if (!best) best = searchCombos((options = buildOptions(1)));
    if (!best) best = searchCombos((options = buildOptions(2)));
    if (!best) {
      const err = new Error('Not enough different recipes fit your constraints for one day. Try relaxing an allergy or dislike.');
      err.status = 422;
      throw err;
    }
    function searchCombos(options) {
    let best = null;
    const idx = options.map(() => 0);
    for (;;) {
      const combo = options.map((o, i) => o[idx[i]]);
      const ids = combo.map((c) => c.recipe.id);
      if (new Set(ids).size === ids.length) {
        const recipes = combo.map((c) => c.recipe);
        const fixed = combo.map((c) => Boolean(c.pinned));
        const start = combo.map((c) => c.servings ?? 1);
        const servings = fitServings(recipes, targets, { fixed, start, slots });
        const portions = recipes.map((r, i) => portionIngredients(r, servings[i]));
        const n = portions.reduce((acc, items) => addNut(acc, nutritionOf(items)), ZERO);
        // Real grocery impact of the whole day at the fitted portions (whole packs, given
        // what earlier days already bought and what's at home).
        const dayCost = costWeight ? marginalCost(portions.flat(), committed, invQty) : 0;
        const score = 100 * dayError(n, targets) + combo.reduce((s, c) => s + c.noCostScore, 0) + costWeight * (dayCost / budgetPerMeal);
        if (!best || score < best.score) best = { combo, servings, score };
      }
      let k = 0;
      while (k < idx.length && ++idx[k] >= options[k].length) idx[k++] = 0;
      if (k === idx.length) break;
    }
    return best;
    }

    const meals = best.combo.map((c, i) => {
      const slot = slots[i];
      const servings = best.servings[i];
      used[c.recipe.id] = (used[c.recipe.id] ?? 0) + 1;
      if (c.kind === 'leftover') {
        c.src.portionsLeft -= 1;
        c.src.meal.packFor.push({ day: d, slot, servings });
        for (const it of portionIngredients(c.recipe, servings)) committed[it.id] = (committed[it.id] ?? 0) + it.qty;
        return { slot, recipeId: c.recipe.id, servings, kind: 'leftover', leftoverOf: { day: c.src.day, slot: c.src.slot } };
      }
      for (const it of portionIngredients(c.recipe, servings)) committed[it.id] = (committed[it.id] ?? 0) + it.qty;
      const meal = { slot, recipeId: c.recipe.id, servings, kind: 'cook', packFor: [] };
      if (c.pinned || pinned[`${d}:${slot}`]?.keep) meal.pinned = true;
      // Batch-friendly dinners (and anything cooked on a prep day) can feed later meals.
      if (c.recipe.batch > 0 && (slot === 'dinner' || ctx.prepDay)) {
        sources.push({ day: d, slot, recipe: c.recipe, meal, portionsLeft: ctx.prepDay ? 2 : 1 });
      }
      return meal;
    });
    out.push({ date, meals });
  }
  // Drop empty packFor arrays for compactness.
  for (const day of out) for (const m of day.meals) if (m.packFor && !m.packFor.length) delete m.packFor;
  return { days: out, notes };
}

// Recipes that fit each day's context (diet, equipment, time, take-away rules), best
// first. The AI chooses from these, so its picks already respect the routine.
export function candidatePools(profile, { startDate, days, limit = 8 } = {}) {
  const prefs = prefsOf(profile);
  const pool = RECIPES.filter((r) => isRecipeAllowed(r, prefs));
  return Array.from({ length: days }, (_, d) => {
    const date = addDays(startDate, d);
    const ctx = dayContext(prefs, date);
    const slots = {};
    for (const slot of SLOTS) {
      if (!ctx.slots[slot].include) continue;
      const ranked = pool
        .filter((r) => r.slots.includes(slot))
        .map((r) => ({ r, ...contextIssues(r, ctx.slots[slot], prefs) }))
        .sort((a, b) => a.hard.length - b.hard.length || a.minutes - b.minutes);
      const fits = ranked.filter((x) => !x.hard.length);
      slots[slot] = (fits.length ? fits : ranked).slice(0, limit).map((x) => x.r.id);
    }
    return { date, weekday: WEEKDAYS[ctx.weekday], busy: ctx.busy, slots };
  });
}

// ================= hydration (derive everything the UI shows) =================
// Turns a stored plan into meals with practical ingredient amounts, nutrition, cost and
// time; day totals; week averages; and deviations from the targets.
export function hydratePlan(plan, profile) {
  const prefs = prefsOf(profile);
  const t = plan.targets;
  const days = plan.days.map((day, d) => {
    const ctx = dayContext(prefs, day.date);
    const meals = day.meals.map((m) => hydrateMeal(m, ctx, prefs));
    const totals = meals.reduce((acc, m) => addNut(acc, m.nutrition), ZERO);
    return { ...day, index: d, label: dayLabel(day.date), longLabel: dayLabel(day.date, { long: true }), context: ctx, meals, totals };
  });
  // Days with a meal of unknown nutrition (eating out, calories not entered) would read as
  // falling short, so averages and deviations use only fully known days.
  const known = days.filter((x) => x.meals.every((m) => m.nutritionKnown));
  const avg = Object.fromEntries(TARGET_KEYS.map((k) => [k, Math.round(known.reduce((s, x) => s + x.totals[k], 0) / Math.max(1, known.length))]));
  return { ...plan, days, average: avg, deviations: known.length ? deviations(avg, t) : [] };
}

function hydrateMeal(m, ctx, prefs) {
  const sc = ctx.slots[m.slot] ?? { minutes: 30, where: 'home', fridge: true, microwave: true };
  if (m.kind === 'eatout') {
    const e = m.eatout;
    const nutrition = { kcal: Math.round(e.kcal ?? 0), protein: round1(e.protein ?? 0), carbs: round1(e.carbs ?? 0), fat: round1(e.fat ?? 0) };
    return { ...m, name: e.name, nutrition, nutritionKnown: e.kcal != null, cookItems: [], eatenItems: [], cost: money(e.cost ?? 0), minutes: 0, context: sc, conflicts: [], needsIcePack: false, tags: [] };
  }
  const recipe = getRecipe(m.recipeId);
  const eatenItems = portionIngredients(recipe, m.servings);
  const extra = (m.packFor ?? []).reduce((s, p) => s + p.servings, 0);
  // Leftover meals were cooked earlier; their ingredients are bought with the cook meal.
  const cookItems = m.kind === 'leftover' ? [] : portionIngredients(recipe, m.servings + extra);
  const { minutes, hard, soft } = contextIssues(recipe, sc, prefs, { leftover: m.kind === 'leftover' });
  return {
    ...m,
    name: recipe.name,
    recipe,
    nutrition: nutritionOf(eatenItems),
    nutritionKnown: true,
    eatenItems,
    cookItems,
    cost: consumedCost(eatenItems),
    minutes,
    context: sc,
    // Rules this meal breaks for its slot (e.g. it was a leftover until the meal that fed it
    // changed, and cooking it fresh takes longer than the time you have). The UI flags these.
    conflicts: [...new Set(hard)].filter((h) => h !== 'variety'),
    // Packed perishable food with no fridge where it's eaten: fine with an ice pack.
    needsIcePack: soft.includes('ice-pack'),
    tags: recipeTags(recipe),
  };
}

export function recipeTags(r) {
  const tags = [];
  if (r.portable) tags.push('take-away');
  if (r.reheat === 'none') tags.push('no-reheat');
  if (r.perishable) tags.push('needs-fridge');
  if (r.minutes <= 10) tags.push('10-min');
  if (r.batch > 0) tags.push('meal-prep');
  return tags;
}

// Explains where the plan can't match the targets, instead of hiding it.
function deviations(avg, t) {
  const out = [];
  const pct = (k) => Math.round(((avg[k] - t[k]) / Math.max(1, t[k])) * 100);
  const limits = { kcal: 5, protein: 10, carbs: 15, fat: 15 };
  const names = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
  for (const k of TARGET_KEYS) {
    const p = pct(k);
    if (k === 'protein' && p > 0 && p <= 30) continue; // a bit more protein is fine
    if (Math.abs(p) > limits[k]) out.push({ key: k, pct: p, text: `${names[k]} average ${avg[k]}${k === 'kcal' ? '' : ' g'} vs target ${t[k]}${k === 'kcal' ? '' : ' g'} (${p > 0 ? '+' : ''}${p}%).` });
  }
  return out;
}

// ================= validation (hard safety gate) =================
// Checks a plan from any planner against the profile and targets. Returns problems; empty
// means safe. The calorie band applies to generated plans (checkBand), not to user edits.
export function validatePlan(plan, profile, targets, { checkBand = true } = {}) {
  const prefs = prefsOf(profile);
  const errors = [];
  if (!Array.isArray(plan?.days) || !plan.days.length) return ['plan has no days'];
  plan.days.forEach((day, i) => {
    const before = errors.length;
    const items = [];
    for (const m of day.meals ?? []) {
      const where = `day ${i + 1} ${m?.slot}`;
      if (m?.kind === 'eatout') continue;
      const r = getRecipe(m?.recipeId);
      if (!r) { errors.push(`${where}: unknown recipe "${m?.recipeId}"`); continue; }
      if (!r.slots.includes(m.slot)) errors.push(`${where}: "${r.id}" is not a ${m.slot} recipe`);
      if (!isRecipeAllowed(r, prefs)) errors.push(`${where}: "${r.id}" violates diet/allergy/dislike constraints`);
      if (!(m.servings >= MIN_SERVINGS && m.servings <= MAX_SERVINGS)) errors.push(`${where}: servings ${m.servings} out of range`);
      else items.push(...portionIngredients(r, m.servings));
    }
    if (errors.length > before || !checkBand) return;
    const kcal = nutritionOf(items).kcal;
    if (kcal < MIN_KCAL) errors.push(`day ${i + 1}: ${kcal} kcal is below the ${MIN_KCAL} kcal floor`);
    else if (Math.abs(kcal - targets.kcal) > targets.kcal * KCAL_TOLERANCE) errors.push(`day ${i + 1}: ${kcal} kcal is not within ${KCAL_TOLERANCE * 100}% of the ${targets.kcal} kcal target`);
  });
  return errors;
}

// ================= groceries, budget, inventory =================
// state: { inventory: [{ id, qty|null }], bought: { id: packs } }. qty null = "I have it"
// (enough for this week). Purchase totals are whole packs; "consumed" is what this week's
// meals actually use, valued at the unit price.
export function grocerySummary(hydrated, state = {}, budget = null) {
  const need = {};
  let eatOut = 0;
  let mealsEaten = 0;
  for (const day of hydrated.days) {
    for (const m of day.meals) {
      mealsEaten += 1;
      if (m.kind === 'eatout') eatOut += m.cost;
      for (const { id, qty } of m.cookItems) need[id] = +((need[id] ?? 0) + qty).toFixed(2);
    }
  }
  const inv = new Map((state.inventory ?? []).map((e) => [e.id, e.qty]));
  const bought = state.bought ?? {};
  const lines = [];
  let toBuyTotal = 0;
  let boughtTotal = 0;
  let consumed = 0;
  const leftovers = [];
  for (const [id, qty] of Object.entries(need)) {
    const ingr = INGREDIENTS[id];
    consumed += unitPrice(id) * qty;
    const haveAll = inv.has(id) && inv.get(id) == null;
    const haveQty = haveAll ? Infinity : inv.get(id) ?? 0;
    const boughtPacks = bought[id] ?? 0;
    const boughtQty = boughtPacks * ingr.pack;
    const missing = Math.max(0, qty - haveQty - boughtQty);
    const packs = Math.max(0, Math.ceil(missing / ingr.pack - 1e-9));
    const status = haveAll || (haveQty >= qty && haveQty > 0) ? 'have' : boughtPacks > 0 && missing === 0 ? 'bought' : 'buy';
    toBuyTotal += packs * ingr.price;
    boughtTotal += boughtPacks * ingr.price;
    // Left for next week = what you paid for this week minus what the plan eats of it. Food
    // that was already at home isn't counted: it wasn't part of this week's spending.
    const purchased = boughtQty + packs * ingr.pack;
    const left = haveAll || !purchased ? null : +(purchased - Math.max(0, qty - haveQty)).toFixed(2);
    if (left > 0.001) leftovers.push({ id, name: ingr.name, qty: left, unit: ingr.unit, value: money(left * unitPrice(id)) });
    lines.push({
      ingredientId: id, name: ingr.name, category: ingr.category, unit: ingr.unit, need: qty, have: haveAll ? null : haveQty,
      boughtPacks, packs, packSize: ingr.pack, packPrice: ingr.price, estPrice: money(packs * ingr.price), status,
      usedCost: money(unitPrice(id) * qty), staple: ingr.staple,
    });
  }
  const purchaseTotal = money(toBuyTotal + boughtTotal);
  return {
    lines: lines.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    toBuyTotal: money(toBuyTotal),
    boughtTotal: money(boughtTotal),
    purchaseTotal,
    consumedCost: money(consumed),
    eatOutTotal: money(eatOut),
    perMeal: money((consumed + eatOut) / Math.max(1, mealsEaten)),
    budget,
    remaining: budget == null ? null : money(budget - purchaseTotal - eatOut),
    leftovers: leftovers.sort((a, b) => b.value - a.value),
  };
}

// ================= whole-plan generation with budget awareness =================
export function generate(profile, targets, { startDate, days, pinned } = {}) {
  const prefs = prefsOf(profile);
  const budget = prefs.budget;
  const attempt = (costWeight) => {
    const p = planWeek(profile, targets, { costWeight, startDate, days, pinned });
    const plan = { startDate, targets, days: p.days, notes: p.notes };
    const sum = grocerySummary(hydratePlan(plan, profile), { inventory: prefs.inventory }, budget);
    return { plan, sum };
  };
  if (!budget) return attempt(0.15).plan;
  // Increase cost pressure until the plan fits the budget; keep nutrition first otherwise.
  let cheapest = null;
  for (const w of [0.5, 2, 5, 12, 25]) {
    const res = attempt(w);
    if (res.sum.purchaseTotal <= budget) return res.plan;
    if (!cheapest || res.sum.purchaseTotal < cheapest.sum.purchaseTotal) cheapest = res;
  }
  cheapest.plan.budgetNote = budgetAdvice(cheapest, budget);
  return cheapest.plan;
}

// Adds (or clears) the budget note for any plan, e.g. one built from AI picks.
export function withBudgetNote(plan, profile) {
  const prefs = prefsOf(profile);
  delete plan.budgetNote;
  if (!prefs.budget) return plan;
  const sum = grocerySummary(hydratePlan(plan, profile), { inventory: prefs.inventory }, prefs.budget);
  if (sum.purchaseTotal > prefs.budget) plan.budgetNote = budgetAdvice({ plan, sum }, prefs.budget);
  return plan;
}

// Honest guidance when the budget can't be met: what drives the cost and what would help.
function budgetAdvice({ plan, sum }, budget) {
  const over = money(sum.purchaseTotal - budget);
  const drivers = [...sum.lines].filter((l) => l.estPrice > 0).sort((a, b) => b.estPrice - a.estPrice).slice(0, 3);
  const tips = [];
  for (const l of drivers) tips.push(`${l.name}: about $${l.estPrice.toFixed(2)} this week. Mark it "I have it" if you do, or swap a meal that uses it.`);
  const snacks = plan.days.flatMap((d) => d.meals).filter((m) => m.slot === 'snack').length;
  if (snacks) tips.push('Dropping the daily snack lowers the shopping list.');
  tips.push('Adding what you already have at home (rice, oats, beans...) lets the planner reuse it.');
  const carry = money(sum.leftovers.reduce((s, l) => s + l.value, 0));
  const text = `This plan is about $${over.toFixed(2)} over your $${budget.toFixed(2)} budget, even with the cheapest options that fit your diet and routine.`
    + (carry >= 5 ? ` About $${carry.toFixed(2)} of it is food left for next week (whole packs of staples like oil or oats).` : '');
  return { over, text, leftoverValue: carry, tips };
}

// ================= "my day changed" =================
export const CHANGE_REASONS = {
  '5min': { label: 'I only have 5 minutes', minutes: 5 },
  '10min': { label: 'I have up to 10 minutes', minutes: 10 },
  missing: { label: "I don't have an ingredient" },
  eatout: { label: "I'm eating out" },
  other: { label: 'I want another option' },
};

// Up to `limit` alternatives for one meal, compatible with the restrictions and the
// situation. Each: { recipeId, servings, kind, minutes, nutrition, cost, extraSpend, reason }.
export function alternativesFor(plan, profile, state, dayIdx, slot, reason, { ingredientId, limit = 3 } = {}) {
  const prefs = prefsOf(profile);
  const hyd = hydratePlan(plan, profile);
  const day = hyd.days[dayIdx];
  const current = day.meals.find((m) => m.slot === slot);
  const baseCtx = { ...day.context.slots[slot] };
  if (CHANGE_REASONS[reason]?.minutes) baseCtx.minutes = CHANGE_REASONS[reason].minutes;
  const others = day.meals.filter((m) => m.slot !== slot);
  const otherNut = others.reduce((acc, m) => addNut(acc, m.nutrition), ZERO);
  const before = grocerySummary(hyd, state, prefs.budget);
  const candidates = [];
  const consider = (recipe, kind, extra = {}) => {
    if (!recipe.slots.includes(slot) || !isRecipeAllowed(recipe, prefs)) return;
    if (current && current.recipeId === recipe.id) return; // a different dish, not the same one again
    if (reason === 'missing' && ingredientId && recipe.ingredients.some(([id]) => id === ingredientId)) return;
    const { hard, soft, minutes } = contextIssues(recipe, baseCtx, prefs, { leftover: kind === 'leftover' });
    if (hard.length) return;
    // Portion that best completes the day given the other meals.
    let bestS = 1;
    let bestE = Infinity;
    const [lo, hi] = SLOT_SERVINGS[slot] ?? [MIN_SERVINGS, MAX_SERVINGS];
    for (let s = lo; s <= hi; s += SERVING_STEP) {
      const n = addNut(otherNut, nutritionOf(portionIngredients(recipe, s)));
      const e = dayError(n, plan.targets);
      if (e < bestE) { bestE = e; bestS = s; }
    }
    const meal = { slot, recipeId: recipe.id, servings: bestS, kind, ...extra };
    const trial = applyMealChange(plan, dayIdx, slot, meal);
    const after = grocerySummary(hydratePlan(trial, profile), state, prefs.budget);
    const items = portionIngredients(recipe, bestS);
    candidates.push({
      ...meal, name: recipe.name, minutes, soft,
      nutrition: nutritionOf(items),
      dayTotals: addNut(otherNut, nutritionOf(items)),
      cost: consumedCost(items),
      extraSpend: money(after.toBuyTotal - before.toBuyTotal),
      score: 100 * bestE + Math.max(0, after.toBuyTotal - before.toBuyTotal) * 1.5 + minutes / 20 + (soft.includes('ice-pack') ? 1 : 0),
    });
  };
  // Leftovers from earlier batch cooking first: zero shopping, minutes to serve.
  for (let d = Math.max(0, dayIdx - LEFTOVER_MAX_DAYS); d < dayIdx; d++) {
    for (const m of hyd.days[d].meals) {
      if (m.kind === 'cook' && m.recipe?.batch > 0 && dayIdx - d <= m.recipe.batch) consider(m.recipe, 'leftover', { leftoverOf: { day: d, slot: m.slot } });
    }
  }
  for (const r of RECIPES) consider(r, 'cook');
  const seen = new Set();
  const top = candidates.sort((a, b) => a.score - b.score).filter((c) => !seen.has(c.recipeId) && seen.add(c.recipeId)).slice(0, limit);
  for (const c of top) c.reason = explainChoice(c, reason, baseCtx, plan.targets, ingredientId);
  return top;
}

function explainChoice(c, reason, ctx, targets, ingredientId) {
  const bits = [];
  if (c.kind === 'leftover') bits.push(`uses leftovers you already cooked (${c.minutes ? `${c.minutes} min to reheat` : 'ready to eat'})`);
  else bits.push(`ready in ${c.minutes} min`);
  if (ctx.where === 'carry') bits.push('packs well to take away');
  if (!ctx.microwave && c.kind !== 'leftover') bits.push('no microwave needed');
  if (c.soft.includes('ice-pack')) bits.push('pack it with an ice pack');
  if (reason === 'missing' && ingredientId) bits.push(`skips ${INGREDIENTS[ingredientId].name.toLowerCase()}`);
  if (c.extraSpend <= 0) bits.push('no extra shopping');
  else bits.push(`adds about $${c.extraSpend.toFixed(2)} to your shopping`);
  bits.push(`keeps today at ${c.dayTotals.kcal} of ${targets.kcal} kcal and ${Math.round(c.dayTotals.protein)} g protein`);
  const s = bits.join(', ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

// Replaces one meal and keeps leftover links consistent: if the replaced meal fed later
// leftovers, those become their own cooked meals (same recipe, so nothing else changes);
// if a leftover is replaced, its portion comes off the source meal.
export function applyMealChange(plan, dayIdx, slot, meal) {
  const next = structuredClone(plan);
  const day = next.days[dayIdx];
  const i = day.meals.findIndex((m) => m.slot === slot);
  const old = day.meals[i];
  if (old?.kind === 'leftover' && old.leftoverOf) {
    const src = next.days[old.leftoverOf.day]?.meals.find((m) => m.slot === old.leftoverOf.slot);
    if (src?.packFor) src.packFor = src.packFor.filter((p) => !(p.day === dayIdx && p.slot === slot));
  }
  if (old?.kind === 'cook' && old.packFor?.length) {
    for (const p of old.packFor) {
      const dep = next.days[p.day]?.meals.find((m) => m.slot === p.slot);
      if (dep) { dep.kind = 'cook'; delete dep.leftoverOf; }
    }
  }
  const fresh = { ...meal };
  if (fresh.kind === 'leftover' && fresh.leftoverOf) {
    const src = next.days[fresh.leftoverOf.day]?.meals.find((m) => m.slot === fresh.leftoverOf.slot);
    if (src) (src.packFor ??= []).push({ day: dayIdx, slot, servings: fresh.servings });
  }
  delete fresh.packFor;
  if (i >= 0) day.meals[i] = fresh;
  else day.meals.push(fresh);
  return next;
}

export const getIngredientInfo = getIngredient;
