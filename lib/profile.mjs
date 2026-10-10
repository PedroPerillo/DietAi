import { ALLERGENS, DIET_RANK } from './catalog.mjs';

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
export const GOALS = { lose: -500, maintain: 0, gain: 300 };
export const MIN_KCAL = 1200;
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
export function parseProfile(body = {}) {
  const allergies = Array.isArray(body.allergies) ? body.allergies : [];
  for (const a of allergies) oneOf(a, 'allergy', ALLERGENS);
  const dislikes = String(body.dislikes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
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
    snacks: body.snacks !== false,
    notes: String(body.notes ?? '').slice(0, 500),
  };
}

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
