// Mock planning engine that runs entirely in the browser (MVP demo). Same catalog and
// portion rules as the server; a deterministic planner filtered by the student's routine.
import { INGREDIENTS, RECIPES, RECIPES_BY_ID, SLOTS, SKILL_RANK, DIET_RANK, isRecipeAllowed, allowedRecipes, materialize, snapServings, unitPrice, EAT_OUT_DEMO, eatOutAllowed } from './catalog.js';

export const MIN_KCAL = 1200;
const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
const GOALS = { lose: -500, maintain: 0, gain: 300 };
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const W = { kcal: 4, protein: 2, carbs: 1, fat: 1 };
export const MACRO_TOLERANCE = 0.15;
const money = (n) => Math.round(n * 100) / 100;
const LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function computeTargets(p) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity];
  const raw = tdee + GOALS[p.goal];
  const kcal = Math.round(Math.max(MIN_KCAL, raw) / 10) * 10;
  const protein = Math.round(p.weightKg * (p.goal === 'maintain' ? 1.2 : 1.6));
  const fat = Math.round((kcal * 0.3) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, floored: raw < MIN_KCAL };
}

// ---------- routine ----------
// Builds the dated week from the wizard's per-weekday settings. busyDays: lunch is 10 min,
// eaten away; awayNoMicrowave: no microwave on those days. prepDays: cook-ahead days.
export function buildWeek({ startDate, days = 7, mealsPerDay = 4, busyDays = [], awayNoMicrowave = true, minutes = {} }) {
  const start = new Date(startDate + 'T12:00:00');
  const base = { breakfast: 10, lunch: 25, dinner: 30, snack: 5, ...minutes };
  const meals = mealsPerDay === 4 ? [...SLOTS] : SLOTS.filter((s) => s !== 'snack');
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    const weekday = WEEKDAYS[(d.getDay() + 6) % 7];
    const busy = busyDays.includes(weekday);
    const slots = Object.fromEntries(meals.map((m) => [m, { minutes: busy && m === 'lunch' ? 10 : base[m], where: busy && m === 'lunch' ? 'away' : 'home' }]));
    return { index: i, date: d.toISOString().slice(0, 10), weekday, label: LABEL.format(d), busy, fridge: true, microwave: !(busy && awayNoMicrowave), meals, slots };
  });
}

// ---------- candidates ----------
const LEVELS = ['strict', 'time', 'equipment', 'any'];
export function candidates(profile, day, slot) {
  const ctx = day.slots[slot];
  const base = allowedRecipes(profile).filter((r) => r.slot === slot);
  const prepDate = (r) => {
    if (!r.tags.includes('meal-prep') || !profile.student.prepDays.length) return null;
    for (let back = 0; back <= r.storage.fridgeDays; back++) {
      const d = new Date(day.date + 'T12:00:00'); d.setDate(d.getDate() - back);
      if (profile.student.prepDays.includes(WEEKDAYS[(d.getDay() + 6) % 7])) return LABEL.format(d);
    }
    return null;
  };
  const filter = (level) => base.map((r) => {
    const relaxEq = level === 'equipment' || level === 'any';
    if (level !== 'any') {
      if (!relaxEq && !r.equipment.every((e) => profile.student.equipment.includes(e))) return null;
      if (!relaxEq && SKILL_RANK[r.skill] > SKILL_RANK[profile.student.skill]) return null;
      if (ctx.where === 'away') {
        if (!r.tags.includes('portable')) return null;
        if (!r.tags.includes('no-reheat') && !day.microwave) return null;
      }
      const limit = ctx.minutes + (level === 'strict' ? 0 : 10);
      const prep = prepDate(r);
      if (!(r.minutes <= limit || (prep && r.reheatMinutes != null && r.reheatMinutes <= limit))) return null;
      return { recipe: r, prepOn: r.minutes <= limit ? null : prep };
    }
    return { recipe: r, prepOn: null };
  }).filter(Boolean);
  for (const level of LEVELS) {
    const pool = filter(level);
    if (pool.length) return { pool, level };
  }
  return { pool: [], level: 'any' };
}

// ---------- portion fit ----------
function loss(tot, t) {
  let l = 0;
  for (const k of Object.keys(W)) {
    const e = (tot[k] - t[k]) / t[k];
    l += W[k] * e * e * (k === 'protein' && e < 0 ? 1.5 : 1);
  }
  return l;
}
export function fitPortions(recipes, targets, nutritionOf = (r, s) => ({ kcal: r.kcal * s, protein: r.protein * s, carbs: r.carbs * s, fat: r.fat * s })) {
  const total = recipes.reduce((a, r) => a + r.kcal, 0);
  const servings = recipes.map(() => snapServings(targets.kcal / total));
  const totals = (sv) => recipes.reduce((acc, r, i) => { const n = nutritionOf(r, sv[i]); for (const k in acc) acc[k] += n[k]; return acc; }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  let best = loss(totals(servings), targets);
  for (let step = 0; step < 40; step++) {
    let move = null;
    recipes.forEach((r, i) => {
      for (const d of [0.25, -0.25]) {
        const next = servings[i] + d;
        if (next < 0.5 || next > 3) continue;
        const trial = servings.slice(); trial[i] = next;
        const l = loss(totals(trial), targets);
        if (l < best - 1e-6 && (!move || l < move.l)) move = { i, next, l };
      }
    });
    if (!move) break;
    servings[move.i] = move.next; best = move.l;
  }
  while (totals(servings).kcal < MIN_KCAL) {
    const i = recipes.reduce((m, r, j) => (servings[j] < 3 && (m < 0 || r.kcal < recipes[m].kcal) ? j : m), -1);
    if (i < 0) break;
    servings[i] += 0.25;
  }
  return { servings, totals: totals(servings), loss: best };
}

// ---------- planner ----------
export function planWeek(profile, targets) {
  const notes = [];
  const used = new Map();
  const inPlay = new Set(profile.inventory.map((i) => i.ingredientId));
  const pref = profile.student.stylePref;
  const pre = (c, day) => {
    const r = c.recipe;
    const reuse = r.ingredients.filter(([id]) => inPlay.has(id)).length / r.ingredients.length;
    let s = 1.5 * reuse - 0.15 * r.cost - 0.8 * (used.get(r.id) ?? 0);
    if (pref !== 'mixed' && r.style === pref) s += 1;
    if (pref === 'quick' && r.minutes <= 10) s += 0.5;
    if (day.busy) s -= 0.02 * r.minutes;
    if (c.prepOn) s += 0.3;
    return s;
  };
  const skeleton = profile.week.map((day) => {
    const lists = day.meals.map((slot) => {
      const { pool, level } = candidates(profile, day, slot);
      if (!pool.length) { const e = new Error(`No recipe fits your diet and allergies for ${slot}. Try relaxing an allergy or dislike.`); e.status = 422; throw e; }
      if (level !== 'strict') notes.push({ kind: 'relaxed', day: day.index, slot, text: `${day.label} ${slot}: nothing in the catalog fits ${day.slots[slot].minutes} min${day.slots[slot].where === 'away' ? ' away from home' : ''}${level === 'any' ? ' with your equipment' : ''}, so we picked the closest option.` });
      return pool.sort((a, b) => pre(b, day) - pre(a, day) || a.recipe.id.localeCompare(b.recipe.id)).slice(0, 4);
    });
    let best = null;
    const walk = (i, chosen) => {
      if (i === lists.length) {
        const fit = fitPortions(chosen.map((c) => c.recipe), targets);
        const cost = chosen.reduce((a, c, j) => a + c.recipe.cost * fit.servings[j], 0);
        const repeats = chosen.reduce((a, c) => a + (used.get(c.recipe.id) ?? 0), 0);
        const score = fit.loss + 0.004 * cost + 0.03 * repeats;
        if (!best || score < best.score) best = { chosen: chosen.slice(), fit, score };
        return;
      }
      for (const c of lists[i]) { chosen.push(c); walk(i + 1, chosen); chosen.pop(); }
    };
    walk(0, []);
    const exact = fitPortions(best.chosen.map((c) => c.recipe), targets, (r, s) => materialize(r, s));
    return Object.fromEntries(day.meals.map((slot, j) => {
      const c = best.chosen[j];
      used.set(c.recipe.id, (used.get(c.recipe.id) ?? 0) + 1);
      for (const [id] of c.recipe.ingredients) inPlay.add(id);
      return [slot, { recipeId: c.recipe.id, servings: exact.servings[j], prepOn: c.prepOn, fit: candidates(profile, day, slot).level }];
    }));
  });
  return { skeleton, notes };
}

// ---------- build ----------
export function buildPlan(skeleton, profile, targets) {
  const days = profile.week.map((day, i) => {
    const meals = day.meals.map((slot) => {
      const e = skeleton[i][slot];
      if (e.eatOut) {
        const o = e.eatOut;
        return { slot, recipeId: null, eatOut: o, name: o.name, servings: 1, minutes: 0, effectiveMinutes: 0, equipment: [], tags: ['eating-out'], steps: [], ingredients: [], kcal: o.kcal, protein: o.protein, carbs: o.carbs, fat: o.fat, cost: o.cost, allergens: [], estimated: true, source: o.source, context: day.slots[slot] };
      }
      const r = RECIPES_BY_ID[e.recipeId];
      const m = materialize(r, e.servings);
      return { slot, recipeId: r.id, name: r.name, servings: m.servings, minutes: r.minutes, activeMinutes: r.activeMinutes, effectiveMinutes: e.prepOn ? r.reheatMinutes : r.minutes, prepOn: e.prepOn ?? null,
        equipment: r.equipment, tags: r.tags, skill: r.skill, style: r.style, steps: r.steps, storage: r.storage, ingredients: m.ingredients, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, cost: m.cost, allergens: r.allergens, context: day.slots[slot], fit: e.fit ?? 'strict', estimated: false };
    });
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 };
    for (const m of meals) for (const k in totals) totals[k] += m[k];
    for (const k in totals) totals[k] = k === 'kcal' ? Math.round(totals[k]) : Math.round(totals[k] * 10) / 10;
    return { index: i, day: i + 1, date: day.date, weekday: day.weekday, label: day.label, busy: day.busy, meals, totals, deviations: deviations(totals, targets, meals, day) };
  });
  return { targets, days };
}

function deviations(totals, t, meals, day) {
  const out = [];
  const constrained = meals.filter((m) => m.context && (m.context.minutes <= 10 || m.context.where === 'away' || m.fit !== 'strict'));
  const why = constrained.length
    ? `the recipes that fit ${constrained.map((m) => `a ${m.context.minutes}-minute ${m.slot}${m.context.where === 'away' ? ' away from home' : ''}`).join(' and ')} run that way`
    : 'that is how the recipes that fit your diet balance out';
  for (const k of ['protein', 'carbs', 'fat']) {
    const pct = (totals[k] - t[k]) / t[k];
    if (Math.abs(pct) > MACRO_TOLERANCE) out.push(`${k[0].toUpperCase() + k.slice(1)} lands ${Math.abs(Math.round(pct * 100))}% ${pct > 0 ? 'over' : 'under'} target on ${day.label}: ${why}. Calories were kept on target first.`);
  }
  return out;
}

// ---------- groceries ----------
export function groceries(plan, { inventory = [], have = [], bought = [], budget = null } = {}) {
  const need = new Map();
  for (const d of plan.days) for (const m of d.meals) for (const i of m.ingredients) need.set(i.id, (need.get(i.id) ?? 0) + i.quantity);
  const inv = new Map(inventory.map((i) => [i.ingredientId, i.quantity]));
  const lines = [...need].map(([id, qty]) => {
    const ing = INGREDIENTS[id];
    const fromInventory = Math.min(qty, inv.get(id) ?? 0);
    const status = have.includes(id) ? 'have' : bought.includes(id) ? 'bought' : 'buy';
    const toBuy = status === 'have' ? 0 : Math.max(0, Math.round((qty - fromInventory) * 1000) / 1000);
    const packs = toBuy > 0 ? Math.ceil(toBuy / ing.pack - 1e-9) : 0;
    const up = unitPrice(ing);
    return { ingredientId: id, name: ing.name, category: ing.category, unit: ing.unit, need: Math.round(qty * 1000) / 1000, fromInventory, toBuy, packs, packSize: ing.pack, unitPrice: up,
      packCost: money(packs * ing.price), consumedCost: money(Math.min(packs * ing.price, toBuy * up)), leftover: packs ? Math.round((packs * ing.pack - toBuy) * 1000) / 1000 : 0, leftoverValue: packs ? money((packs * ing.pack - toBuy) * up) : 0, status, estPrice: money(packs * ing.price), quantity: toBuy };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const meals = plan.days.flatMap((d) => d.meals);
  const toBuy = money(lines.filter((l) => l.status === 'buy').reduce((s, l) => s + l.packCost, 0));
  const spent = money(lines.filter((l) => l.status === 'bought').reduce((s, l) => s + l.packCost, 0));
  const consumed = money(meals.filter((m) => !m.eatOut).reduce((s, m) => s + m.cost, 0));
  const eatingOut = money(meals.filter((m) => m.eatOut).reduce((s, m) => s + (m.cost || 0), 0));
  const purchase = money(toBuy + spent);
  return { lines, totals: { toBuy, spent, purchase, consumed, eatingOut, leftoverValue: money(lines.reduce((s, l) => s + l.leftoverValue, 0)), budget, diff: budget == null ? null : money(budget - purchase), perMeal: meals.length ? money(consumed / meals.length) : 0, meals: meals.length } };
}

// Greedy budget pass: swap meals for cheaper candidates while the purchase exceeds the budget.
export function fitBudget(skeleton, profile, targets) {
  const budget = profile.student.budgetWeekly;
  const notes = [];
  if (budget == null) return { skeleton, notes };
  const purchaseOf = (sk) => groceries(buildPlan(sk, profile, targets), { inventory: profile.inventory }).totals.purchase;
  let current = purchaseOf(skeleton);
  const start = current;
  let swaps = 0;
  for (let it = 0; it < 30 && current > budget; it++) {
    let best = null;
    profile.week.forEach((day, d) => day.meals.forEach((slot) => {
      const cur = RECIPES_BY_ID[skeleton[d][slot].recipeId];
      if (!cur) return;
      const { pool } = candidates(profile, day, slot);
      for (const c of pool.filter((x) => x.recipe.cost < cur.cost).slice(0, 6)) {
        const trial = skeleton.map((x) => ({ ...x }));
        const others = day.meals.filter((s) => s !== slot).map((s) => RECIPES_BY_ID[trial[d][s].recipeId]).filter(Boolean);
        const fit = fitPortions([c.recipe, ...others], targets);
        trial[d][slot] = { recipeId: c.recipe.id, servings: fit.servings[0], prepOn: c.prepOn, fit: 'budget' };
        const p = purchaseOf(trial);
        const saving = current - p;
        if (saving > 0.5 && fit.loss < 0.12 && (!best || saving / (0.01 + fit.loss) > best.score)) best = { trial, p, score: saving / (0.01 + fit.loss), label: `${day.label} ${slot}: ${cur.name} → ${c.recipe.name} (saves ~$${saving.toFixed(0)})` };
      }
    }));
    if (!best) break;
    skeleton = best.trial; current = best.p; swaps++;
  }
  if (swaps) notes.push({ kind: 'budget', text: `To fit your $${budget} budget we chose cheaper options for ${swaps} meal${swaps > 1 ? 's' : ''} (groceries went from ~$${start.toFixed(0)} to ~$${current.toFixed(0)}).` });
  if (current > budget) notes.push({ kind: 'budget', text: `Even with the cheapest options we found, groceries come to ~$${current.toFixed(0)}, about $${(current - budget).toFixed(0)} over your $${budget} budget. Options: drop a snack, pick the bought meals, or raise the budget.` });
  return { skeleton, notes };
}

// ---------- top-level ----------
export function generate(profile) {
  const targets = computeTargets(profile);
  const planned = planWeek(profile, targets);
  const budgeted = fitBudget(planned.skeleton, profile, targets);
  const plan = buildPlan(budgeted.skeleton, profile, targets);
  return { profile, skeleton: budgeted.skeleton, plan, notes: [...planned.notes, ...budgeted.notes], source: 'builtin', summary: '' };
}

export function rebuild(result, skeleton) {
  const targets = computeTargets(result.profile);
  return { ...result, skeleton, plan: buildPlan(skeleton, result.profile, targets) };
}

// ---------- My day changed ----------
export const REASONS = {
  five_min: 'I only have 5 minutes', ten_min: 'I have up to 10 minutes', missing_ingredient: "I don't have an ingredient", eat_out: "I'm eating out", another: 'I want another option',
};
export function alternatives(result, dayIdx, slot, reason, { missingIngredientId = null, inventory = [], have = [], bought = [], lines = [] } = {}) {
  const profile = result.profile;
  const day = profile.week[dayIdx];
  const old = result.plan.days[dayIdx].meals.find((m) => m.slot === slot);
  const available = new Set([...inventory.map((i) => i.ingredientId), ...have, ...bought, ...lines.map((l) => l.ingredientId)]);
  const limit = reason === 'five_min' ? 5 : reason === 'ten_min' ? 10 : null;
  const pool = allowedRecipes(profile).filter((r) => r.slot === slot && r.id !== old.recipeId).filter((r) => {
    if (limit != null && r.minutes > limit) return false;
    if (missingIngredientId && r.ingredients.some(([id]) => id === missingIngredientId)) return false;
    if (!r.equipment.every((e) => profile.student.equipment.includes(e))) return false;
    if (day.slots[slot].where === 'away' && (!r.tags.includes('portable') || (!r.tags.includes('no-reheat') && !day.microwave))) return false;
    return true;
  });
  const scored = pool.map((r) => {
    let bestS = 1, bestD = Infinity;
    for (let s = 0.5; s <= 3; s += 0.25) { const d = Math.abs(r.kcal * s - old.kcal); if (d < bestD) { bestD = d; bestS = s; } }
    const m = materialize(r, bestS);
    const newIng = m.ingredients.filter((i) => !available.has(i.id));
    const newPurchase = money(newIng.reduce((s, i) => s + Math.ceil(i.quantity / INGREDIENTS[i.id].pack) * INGREDIENTS[i.id].price, 0));
    const macroDist = Math.abs(m.protein - old.protein) / Math.max(old.protein, 1) + Math.abs(m.kcal - old.kcal) / Math.max(old.kcal, 1);
    const why = [];
    if (r.minutes <= 5) why.push('Ready in 5 minutes'); else if (r.minutes <= 10) why.push('Ready in 10 minutes');
    if (newIng.length === 0) why.push('No new groceries: uses what you already have or are buying');
    if (Math.abs(m.protein - old.protein) <= 8) why.push('Similar protein to the meal it replaces');
    if (r.tags.includes('portable') && r.tags.includes('no-reheat')) why.push('Portable, no reheating needed');
    if (r.cost < old.cost) why.push(`Cheaper than the original (~$${m.cost.toFixed(2)} vs $${old.cost.toFixed(2)})`);
    if (!why.length) why.push('Fits your diet and today\'s routine');
    return { recipeId: r.id, name: r.name, servings: bestS, minutes: r.minutes, nutrition: { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat }, cost: { newPurchase, consumed: m.cost }, newIngredients: newIng.map((i) => i.name), why: why.slice(0, 2), tags: r.tags, score: macroDist + 0.08 * newPurchase + 0.01 * r.minutes };
  }).sort((a, b) => a.score - b.score).slice(0, 3);
  return { alternatives: scored, message: scored.length ? null : 'Nothing in the catalog fits that. Try "I\'m eating out" or log a meal by hand.' };
}

export function eatOutOptions(profile) {
  return EAT_OUT_DEMO.filter((e) => eatOutAllowed(e, profile));
}

export function applySwap(result, dayIdx, slot, entry) {
  const skeleton = result.skeleton.map((d, i) => (i === dayIdx ? { ...d, [slot]: entry } : d));
  return rebuild(result, skeleton);
}

// ---------- progress ----------
export const LOG_REASONS = { time: 'Not enough time', cost: 'Too expensive', taste: "Didn't like it", ingredient: 'Missing an ingredient', out: 'Ate out', other: 'Other' };
export function progressStats(log) {
  const entries = Object.values(log);
  const n = entries.length;
  const by = (s) => entries.filter((e) => e.status === s).length;
  const reasons = {};
  for (const e of entries) if (e.reason) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const eaten = entries.filter((e) => e.status !== 'skipped').reduce((acc, e) => { for (const k in acc) acc[k] += e.nutrition?.[k] ?? 0; return acc; }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  return { logged: n, followed: by('followed'), adapted: by('alternative'), skipped: by('skipped'), topReasons: top, eaten };
}

// ---------- demo ----------
export const DEMO_FORM = {
  sex: 'female', units: 'metric', age: 21, weightKg: 62, heightCm: 168, goal: 'maintain', activity: 'light', diet: 'omnivore', allergies: [], dislikes: '', days: 7, snacks: true, notes: 'Classes until late on Tuesday and Thursday.',
  budgetWeekly: 55, equipment: ['stove', 'microwave'], skill: 'beginner', prepDays: ['sun'], mealsPerDay: 4, stylePref: 'quick', busyDays: ['tue', 'thu'],
  inventory: [{ ingredientId: 'brown_rice', quantity: 600 }, { ingredientId: 'oats', quantity: 400 }, { ingredientId: 'eggs', quantity: 6 }, { ingredientId: 'peanut_butter', quantity: 250 }],
};
