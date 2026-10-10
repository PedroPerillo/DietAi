import { ALLERGENS, DIET_RANK, EQUIPMENT, SLOTS, getIngredient } from './catalog.mjs';
import { MIN_KCAL as ENGINE_MIN_KCAL, SKILL_LEVEL } from '../public/shared/engine.mjs';

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
export const GOALS = { lose: -500, maintain: 0, gain: 300 };
export const MIN_KCAL = ENGINE_MIN_KCAL;
export const STYLES = ['balanced', 'quick', 'homemade', 'bought'];
export const MAX_DAYS = 7;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const num = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return n;
};
const oneOf = (v, name, options) => {
  if (!options.includes(v)) throw new ValidationError(`${name} must be one of: ${options.join(', ')}`);
  return v;
};

// Parses and normalizes the request body. Everything downstream can trust the result.
// Safety-relevant fields are rejected when malformed rather than guessed at: a
// mistyped allergy list must never silently become "no allergies".
export function parseProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Request body must be a JSON object');
  const allergies = body.allergies ?? [];
  if (!Array.isArray(allergies)) throw new ValidationError('allergies must be a list');
  for (const a of allergies) oneOf(a, 'allergy', ALLERGENS);
  if (body.dislikes != null && typeof body.dislikes !== 'string') throw new ValidationError('dislikes must be text');
  if (body.snacks != null && typeof body.snacks !== 'boolean') throw new ValidationError('snacks must be true or false');
  const dislikes = (body.dislikes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const meals = parseMeals(body);
  return {
    sex: oneOf(body.sex, 'sex', ['female', 'male']),
    age: num(body.age, 'age', 18, 100),
    heightCm: num(body.heightCm, 'height', 120, 230),
    weightKg: num(body.weightKg, 'weight', 35, 300),
    activity: oneOf(body.activity, 'activity', Object.keys(ACTIVITY)),
    goal: oneOf(body.goal, 'goal', Object.keys(GOALS)),
    diet: oneOf(body.diet, 'diet', Object.keys(DIET_RANK)),
    allergies: [...new Set(allergies)],
    dislikes,
    days: Math.round(num(body.days ?? 7, 'days', 1, MAX_DAYS)),
    meals,
    snacks: meals.includes('snack'),
    notes: String(body.notes ?? '').slice(0, 500),
    startDate: parseDate(body.startDate),
    budget: body.budget == null || body.budget === '' ? null : Math.round(num(body.budget, 'budget', 10, 1000) * 100) / 100,
    equipment: parseSubset(body.equipment ?? ['stove', 'oven', 'microwave'], 'equipment', EQUIPMENT),
    skill: oneOf(body.skill ?? 'comfortable', 'skill', Object.keys(SKILL_LEVEL)),
    style: oneOf(body.style ?? 'balanced', 'style', STYLES),
    prepDays: parseWeekdays(body.prepDays ?? []),
    routine: parseRoutine(body.routine ?? {}),
    inventory: parseInventory(body.inventory ?? []),
  };
}

function parseMeals(body) {
  if (body.meals == null) return body.snacks === false ? ['breakfast', 'lunch', 'dinner'] : [...SLOTS];
  const meals = parseSubset(body.meals, 'meals', SLOTS);
  if (!meals.length) throw new ValidationError('choose at least one meal per day');
  return SLOTS.filter((s) => meals.includes(s));
}

function parseSubset(v, name, options) {
  if (!Array.isArray(v)) throw new ValidationError(`${name} must be a list`);
  for (const x of v) oneOf(x, name, options);
  return [...new Set(v)];
}

function parseWeekdays(v) {
  if (!Array.isArray(v)) throw new ValidationError('prep days must be a list');
  return [...new Set(v.map((d) => Math.round(num(d, 'prep day', 0, 6))))].sort();
}

// Plan start date (YYYY-MM-DD), within a year either way; defaults to today (UTC).
function parseDate(v) {
  const today = new Date().toISOString().slice(0, 10);
  if (v == null || v === '') return today;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) throw new ValidationError('start date must be YYYY-MM-DD');
  const diff = Math.abs(Date.parse(`${v}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
  if (diff > 366) throw new ValidationError('start date must be within a year of today');
  return v;
}

// Per weekday (0 = Monday): { busy, meals: { slot: { include, minutes, where, fridge, microwave } } }.
// Unknown keys are dropped; wrong types are rejected.
function parseRoutine(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('routine must be an object');
  const out = {};
  for (const [key, day] of Object.entries(v)) {
    const wd = Number(key);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new ValidationError('routine days must be 0 (Monday) to 6 (Sunday)');
    if (!day || typeof day !== 'object' || Array.isArray(day)) throw new ValidationError('each routine day must be an object');
    const d = {};
    if (day.busy != null) d.busy = bool(day.busy, 'busy');
    if (day.meals != null) {
      if (typeof day.meals !== 'object' || Array.isArray(day.meals)) throw new ValidationError('routine meals must be an object');
      d.meals = {};
      for (const [slot, m] of Object.entries(day.meals)) {
        oneOf(slot, 'routine meal', SLOTS);
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ValidationError('each routine meal must be an object');
        const r = {};
        if (m.include != null) r.include = bool(m.include, 'include');
        if (m.minutes != null) r.minutes = Math.round(num(m.minutes, 'minutes', 0, 180));
        if (m.where != null) r.where = oneOf(m.where, 'where', ['home', 'carry']);
        if (m.fridge != null) r.fridge = bool(m.fridge, 'fridge');
        if (m.microwave != null) r.microwave = bool(m.microwave, 'microwave');
        d.meals[slot] = r;
      }
    }
    out[wd] = d;
  }
  return out;
}

function parseInventory(v) {
  if (!Array.isArray(v)) throw new ValidationError('inventory must be a list');
  if (v.length > 100) throw new ValidationError('inventory is limited to 100 items');
  const seen = new Map();
  for (const e of v) {
    if (!e || typeof e !== 'object' || !getIngredient(e.id)) throw new ValidationError('inventory items need a known ingredient id');
    seen.set(e.id, e.qty == null || e.qty === '' ? null : num(e.qty, 'inventory quantity', 0, 100000));
  }
  return [...seen].map(([id, qty]) => ({ id, qty }));
}

const bool = (v, name) => {
  if (typeof v !== 'boolean') throw new ValidationError(`${name} must be true or false`);
  return v;
};

// Mifflin-St Jeor BMR x activity factor, adjusted for goal, floored at MIN_KCAL.
// Protein 1.6 g/kg for lose/gain, 1.2 g/kg to maintain; fat 30% of kcal; carbs fill the rest.
export function computeTargets(p) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity];
  const raw = tdee + GOALS[p.goal];
  const kcal = Math.round(Math.max(MIN_KCAL, raw) / 10) * 10;
  const protein = Math.round(p.weightKg * (p.goal === 'maintain' ? 1.2 : 1.6));
  const fat = Math.round((kcal * 0.3) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, bmr: Math.round(bmr), tdee: Math.round(tdee), floored: raw < MIN_KCAL };
}
