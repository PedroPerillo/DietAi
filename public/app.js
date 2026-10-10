import { hydratePlan, grocerySummary, alternativesFor, applyMealChange, CHANGE_REASONS } from './shared/engine.mjs';
import { INGREDIENTS, getRecipe, storageTips } from './shared/catalog.mjs';

const STORAGE_KEY = 'fitbite:v1';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmtMoney = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
const GOAL_LABEL = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Build muscle' };
const DIET_LABEL = { omnivore: 'Everything', pescatarian: 'Pescatarian', vegetarian: 'Vegetarian', vegan: 'Vegan' };
const ACTIVITY_LABEL = { sedentary: 'Mostly sitting', light: 'Light activity', moderate: 'Moderate activity', active: 'Active', very_active: 'Athlete' };
const ALLERGEN_LABEL = { nuts: 'Tree nuts', egg: 'Eggs' };
const EQUIPMENT_LABEL = { stove: 'Stove', oven: 'Oven', microwave: 'Microwave', airfryer: 'Air fryer' };
const LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l8-8"/></svg>';
const PREVIEW_ITEMS = 3; // items shown per aisle before "Show N more"
const AISLE_ORDER = ['Produce', 'Meat & Seafood', 'Dairy', 'Bakery', 'Deli', 'Frozen', 'Pantry'];
// Why a meal doesn't fit its slot (engine "hard" rules), in plain words.
const RULE_TEXT = {
  time: 'takes longer than the time you have',
  portable: "doesn't pack well to take away",
  reheat: 'needs reheating and there is no microwave where you eat',
  equipment: "needs kitchen equipment you don't have",
};

// Small DOM helper so nothing from the server (incl. AI text) is ever parsed as HTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}
const svgIcon = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // static constant markup only
  return t.content.firstChild;
};

// Practical amounts: ½ can, 1½ avocados, 150 g.
const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
function fmtAmount(n) {
  const whole = Math.floor(n + 1e-9);
  const frac = FRACTIONS[+(n - whole).toFixed(2)];
  if (frac) return whole ? `${whole}${frac}` : frac;
  return String(+n.toFixed(2));
}
function fmtQty(id, qty) {
  const { unit } = INGREDIENTS[id];
  if (unit === 'g' || unit === 'ml') return `${Math.round(qty)} ${unit}`;
  if (unit === 'each') return fmtAmount(qty);
  return `${fmtAmount(qty)} ${unit}${qty > 1 ? 's' : ''}`;
}
const cap = (t) => t[0].toUpperCase() + t.slice(1);

// state.result is the server's { profile, plan, source, summary, warning }. Groceries:
// have = ingredient ids you already have enough of; bought = { id: packs } already bought.
// changes logs every "my day changed" swap (what you actually ate), for learning later.
// v: storage format version (2 = shared-engine plans), so future migrations are explicit.
const EMPTY_STATE = { v: 2, result: null, have: [], bought: {}, changes: [], day: 0, form: null };
let state = { ...EMPTY_STATE };
let outdatedPlan = false; // a plan saved by an older FitBite version was dropped on load
let config;
let userId = null; // Clerk user id when sign-in is on; plans are stored per user on this device
const storageKey = () => (userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY);
const save = () => localStorage.setItem(storageKey(), JSON.stringify(state));

function loadState() {
  state = { ...EMPTY_STATE };
  outdatedPlan = false;
  try {
    // A plan made before sign-in existed moves to the first account that signs in here.
    if (userId && !localStorage.getItem(storageKey()) && localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(storageKey(), localStorage.getItem(STORAGE_KEY));
      localStorage.removeItem(STORAGE_KEY);
    }
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    if (!saved) return;
    // Plans from an older version (no dates or meal kinds) or naming a recipe the catalog no
    // longer has can't be shown; keep the answers so rebuilding is one tap, drop the plan.
    if (saved.result && !planUsable(saved.result)) {
      outdatedPlan = Boolean(saved.result);
      state = { ...EMPTY_STATE, form: saved.form ?? null };
      return;
    }
    state = { ...EMPTY_STATE, ...saved, have: saved.have ?? saved.owned ?? [] };
    delete state.owned;
  } catch {
    localStorage.removeItem(storageKey());
  }
}

function planUsable(result) {
  const days = result?.plan?.days;
  if (!Array.isArray(days) || !days[0]?.date || !days[0].meals?.[0]?.kind) return false;
  if (days.some((d) => d.meals.some((m) => m.kind !== 'eatout' && !getRecipe(m.recipeId)))) return false;
  try {
    hydratePlan(result.plan, result.profile);
    return true;
  } catch {
    return false;
  }
}

// Everything the screens show is derived from the stored plan by the shared engine.
let view = null;
function groceryState() {
  const partial = (state.result.profile.inventory ?? []).filter((e) => e.qty != null && !state.have.includes(e.id));
  return { inventory: [...partial, ...state.have.map((id) => ({ id, qty: null }))], bought: state.bought };
}
function derive() {
  const r = state.result;
  if (!r) return (view = null);
  const plan = hydratePlan(r.plan, r.profile);
  view = { plan, groceries: grocerySummary(plan, groceryState(), r.profile.budget ?? null) };
  return view;
}

// AbortSignal.any needs Safari 17.4 and AbortSignal.timeout Safari 16; fall back so older
// iPhones (iOS 15/16) can still build plans and load settings.
function timeoutSignal(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  return c.signal;
}
function anySignal(signals) {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) { c.abort(s.reason); break; }
    s.addEventListener('abort', () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

async function api(path, body, { timeoutMs = 150_000, signal } = {}) {
  const timeout = timeoutSignal(timeoutMs);
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const token = await window.Clerk?.session?.getToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? anySignal([timeout, signal]) : timeout,
  }).catch((e) => {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
    throw new Error(timeout.aborted ? 'The request timed out. Please try again.' : 'Could not reach the server.');
  });
  let data;
  try {
    data = await res.json();
  } catch {
    // A cut-off body (e.g. the sheet closed mid-download) must never be treated as a result.
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
    if (res.ok) throw new Error('The server sent an incomplete response. Please try again.');
    data = {};
  }
  if (res.status === 401 && config?.auth) {
    // The server rejected the session itself (expired or invalid). Show sign-in first, then
    // sign out of Clerk so the sign-in screen can't bounce straight back into the app. The
    // message survives Clerk's post-sign-out reload via sessionStorage. (A 503 means sign-in
    // is unavailable server-side and falls through as a normal error, keeping the user in.)
    const message = data.error || 'Please sign in to continue.';
    showSignIn(message);
    sessionStorage.setItem(SIGNIN_MESSAGE_KEY, message);
    await window.Clerk?.signOut().catch(() => {});
    throw Object.assign(new Error(message), { cancelled: true });
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showError(target, message) {
  target.textContent = message ?? '';
  target.hidden = !message;
}

// ================= Wizard =================
const STEPS = [
  ['About you', 'We use this to estimate how much energy you need each day.'],
  ['Your goal', 'Pick where you want to go. You can change it any time.'],
  ['How you eat', 'Allergies are enforced on every recipe, not just suggested.'],
  ['Your routine', 'So every meal fits your budget, your kitchen and your schedule.'],
  ['Final touches', 'Last details, then FitBite builds your week.'],
];
const LAST_STEP = STEPS.length;
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ALL_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
let step = 1;
let building = null; // AbortController while a plan is being built
let lastFocus = null;
const form = () => $('#profile-form');

function readForm() {
  const f = new FormData(form());
  const get = (k) => f.get(k);
  const days = (k) => f.getAll(k).map(Number);
  const meals = f.getAll('meals');
  return {
    sex: get('sex'), units: get('units'), age: get('age'), weightLb: get('weightLb'), weightKg: get('weightKg'),
    heightFt: get('heightFt'), heightIn: get('heightIn'), heightCm: get('heightCm'), goal: get('goal'), activity: get('activity'),
    diet: get('diet'), allergies: f.getAll('allergies'), dislikes: get('dislikes'), days: Number(get('days')), notes: get('notes'),
    budget: get('budget'), meals, snacks: meals.includes('snack'), equipment: f.getAll('equipment'), skill: get('skill'), style: get('style'),
    lunchWhere: get('lunchWhere'), lunchMicrowave: f.has('lunchMicrowave'), lunchFridge: f.has('lunchFridge'), lunchMinutes: get('lunchMinutes'),
    busyDays: days('busyDays'), prepDays: days('prepDays'), pantry: f.getAll('pantry'),
  };
}

// Answers saved before the routine step existed get its defaults.
const ROUTINE_DEFAULTS = {
  budget: '', equipment: ['stove', 'microwave', 'oven'], skill: 'comfortable', style: 'balanced', lunchWhere: 'home',
  lunchMicrowave: false, lunchFridge: false, lunchMinutes: '20', busyDays: [], prepDays: [], pantry: [],
};

function writeForm(saved) {
  if (!saved) return;
  const v = { ...ROUTINE_DEFAULTS, meals: saved.snacks === false ? ALL_MEALS.slice(0, 3) : ALL_MEALS, ...saved };
  const fm = form();
  for (const name of ['sex', 'units', 'goal', 'diet', 'skill', 'lunchWhere']) {
    const r = fm.querySelector(`input[name="${name}"][value="${CSS.escape(String(v[name]))}"]`);
    if (r) r.checked = true;
  }
  for (const name of ['age', 'weightLb', 'weightKg', 'heightFt', 'heightIn', 'heightCm', 'activity', 'dislikes', 'notes', 'budget', 'style', 'lunchMinutes']) {
    if (v[name] != null && fm.elements[name]) fm.elements[name].value = v[name];
  }
  for (const name of ['allergies', 'meals', 'equipment', 'busyDays', 'prepDays', 'pantry']) {
    const on = (v[name] ?? []).map(String);
    fm.querySelectorAll(`input[name="${name}"]`).forEach((c) => (c.checked = on.includes(c.value)));
  }
  fm.elements.lunchMicrowave.checked = Boolean(v.lunchMicrowave);
  fm.elements.lunchFridge.checked = Boolean(v.lunchFridge);
  setDays(v.days ?? 7);
  toggleUnits();
  toggleCarry();
}

// Weekday routine for the planner: weekday lunches (where, time, fridge/microwave there)
// and busy days, which only get quick meals.
function toRoutine(v) {
  const routine = {};
  for (let wd = 0; wd < 7; wd++) {
    const day = {};
    const busy = v.busyDays.includes(wd);
    if (busy) day.busy = true;
    if (wd < 5 && v.meals.includes('lunch')) {
      const minutes = Number(v.lunchMinutes);
      const lunch = { minutes: busy ? Math.min(minutes, 15) : minutes };
      if (v.lunchWhere === 'carry') Object.assign(lunch, { where: 'carry', microwave: v.lunchMicrowave, fridge: v.lunchFridge });
      day.meals = { lunch };
    }
    if (Object.keys(day).length) routine[wd] = day;
  }
  return routine;
}

// API body; the server validates everything again.
function toProfile(v) {
  const n = Number;
  const imperial = v.units === 'imperial';
  return {
    sex: v.sex, age: n(v.age),
    heightCm: imperial ? Math.round((n(v.heightFt) * 12 + n(v.heightIn)) * 2.54) : n(v.heightCm),
    weightKg: imperial ? Math.round(n(v.weightLb) * 0.4536 * 10) / 10 : n(v.weightKg),
    activity: v.activity, goal: v.goal, diet: v.diet, allergies: v.allergies, dislikes: v.dislikes ?? '',
    days: v.days, meals: v.meals, notes: v.notes ?? '', startDate: localDate(),
    budget: v.budget === '' || v.budget == null ? null : n(v.budget),
    equipment: v.equipment, skill: v.skill, style: v.style, prepDays: v.prepDays, routine: toRoutine(v),
    inventory: v.pantry.map((id) => ({ id, qty: null })),
  };
}

// Plans start today in the user's own time zone (the server would use UTC).
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validateStep(n, v) {
  if (n === 4) {
    if (!v.meals.length) return 'Pick at least one meal a day.';
    if (v.budget !== '' && !(Number(v.budget) >= 10 && Number(v.budget) <= 1000)) return 'Budget must be between $10 and $1,000 a week, or leave it empty.';
    return null;
  }
  if (n !== 1) return null;
  const inRange = (x, lo, hi) => x !== '' && Number(x) >= lo && Number(x) <= hi;
  if (!inRange(v.age, 18, 100)) return 'Age must be between 18 and 100.';
  if (v.units === 'imperial') {
    if (!inRange(v.weightLb, 80, 660)) return 'Weight must be between 80 and 660 lb.';
    const inches = Number(v.heightFt) * 12 + Number(v.heightIn);
    // Server accepts 120-230 cm: 4 ft 0 in (122 cm) to 7 ft 6 in (229 cm).
    if (!inRange(v.heightFt, 4, 7) || !inRange(v.heightIn, 0, 11) || inches > 90) return 'Height must be between 4 ft 0 in and 7 ft 6 in.';
  } else {
    if (!inRange(v.weightKg, 35, 300)) return 'Weight must be between 35 and 300 kg.';
    if (!inRange(v.heightCm, 120, 230)) return 'Height must be between 120 and 230 cm.';
  }
  return null;
}

function toggleUnits() {
  const imperial = form().units.value === 'imperial';
  $$('#profile-form .imperial').forEach((n) => (n.hidden = !imperial));
  $$('#profile-form .metric').forEach((n) => (n.hidden = imperial));
}

function toggleCarry() {
  $('#profile-form .carry-opts').hidden = form().elements.lunchWhere.value !== 'carry';
}

function setDays(n) {
  const max = config?.maxDays ?? 7;
  const days = Math.min(max, Math.max(1, Number(n) || 7));
  form().elements.days.value = days;
  $('#days-out').textContent = days;
  $('[data-days="-1"]').disabled = days <= 1;
  $('[data-days="1"]').disabled = days >= max;
}

function renderPlanUses() {
  const v = readForm();
  const allergies = v.allergies.length ? `no ${v.allergies.map((a) => (ALLERGEN_LABEL[a] ?? a).toLowerCase()).join(', ')}` : 'no allergies';
  const lunch = v.meals.includes('lunch') && (v.lunchWhere === 'carry'
    ? `weekday lunch to go${v.lunchMicrowave ? ', microwave there' : ', no microwave'}`
    : 'weekday lunch at home');
  $('#plan-uses').replaceChildren(
    el('span', {}, `${GOAL_LABEL[v.goal]} · ${ACTIVITY_LABEL[v.activity]}`),
    el('span', {}, `${DIET_LABEL[v.diet]} · ${allergies}`),
    el('span', {}, `${v.days} day${v.days > 1 ? 's' : ''} · ${v.meals.join(', ')}`),
    el('span', {}, [v.budget ? `$${Number(v.budget)} a week` : 'no budget limit', lunch].filter(Boolean).join(' · ')),
    (v.busyDays.length > 0 || v.prepDays.length > 0) && el('span', {}, [
      v.busyDays.length > 0 && `busy ${v.busyDays.map((d) => WEEKDAY_SHORT[d]).join(', ')}`,
      v.prepDays.length > 0 && `prep on ${v.prepDays.map((d) => WEEKDAY_SHORT[d]).join(', ')}`,
    ].filter(Boolean).join(' · ')),
  );
}

function showStep(n) {
  step = n;
  $$('.step').forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$('.progress span').forEach((b, i) => b.classList.toggle('on', i < n));
  $('#wz-step').textContent = `Step ${n} of ${LAST_STEP}`;
  $('#wz-title').textContent = STEPS[n - 1][0];
  $('#wz-sub').textContent = STEPS[n - 1][1];
  $('#wz-back').textContent = n === 1 ? 'Cancel' : 'Back';
  $('#wz-next').textContent = n === LAST_STEP ? 'Build my plan' : 'Continue';
  if (n === LAST_STEP) renderPlanUses();
  showError($('#form-error'), null);
  form().scrollTop = 0;
}

// Users from before the wizard only have the API profile saved (metric units).
function formFromProfile(p) {
  if (!p) return null;
  return {
    sex: p.sex, units: 'metric', age: p.age, weightKg: p.weightKg, heightCm: p.heightCm, goal: p.goal, activity: p.activity,
    diet: p.diet, allergies: p.allergies ?? [], dislikes: (p.dislikes ?? []).join(', '), days: p.days, snacks: p.snacks, notes: p.notes ?? '',
    ...(p.meals && { meals: p.meals }),
  };
}

function openWizard() {
  lastFocus = document.activeElement;
  writeForm(state.form ?? formFromProfile(state.result?.profile));
  setLoading(false);
  showStep(1);
  $('#wizard').hidden = false;
  $('.app').inert = true;
  $('#wz-title').focus();
}

// Aborting also stops the server-side AI call (the server watches for disconnects).
function cancelBuild() {
  building?.abort();
  building = null;
}

function closeWizard({ restoreFocus = true } = {}) {
  cancelBuild();
  $('#wizard').hidden = true;
  $('.app').inert = false;
  if (restoreFocus && lastFocus?.isConnected && lastFocus.offsetParent !== null) lastFocus.focus();
  else if (restoreFocus) ($('#home-plan').hidden ? $('#home-empty .btn') : $('#h-home')).focus();
}

function setLoading(on) {
  $('#wz-loading').hidden = !on;
  form().hidden = on;
  $('.sheet-foot').hidden = on;
  $('.progress').hidden = on;
  $('#wz-sub').hidden = on;
  $('#wz-title').hidden = on;
  $('#wz-step').textContent = on ? 'Building your plan' : `Step ${step} of ${LAST_STEP}`;
  if (on) $('#wz-loading-sub').textContent = config?.ai
    ? 'FitBite is choosing your meals. This can take up to a minute.'
    : 'Matching recipes to your goal and diet.';
}

async function onNext() {
  const v = readForm();
  const problem = validateStep(step, v);
  if (problem) return showError($('#form-error'), problem);
  if (step < LAST_STEP) return showStep(step + 1);
  if (building) return; // double-tap guard
  building = new AbortController();
  setLoading(true);
  try {
    const { signal } = building;
    const result = await api('/api/plan', toProfile(v), { signal });
    if (signal.aborted) return; // closed after the response arrived: keep the previous plan
    if (!result?.plan?.days?.length) throw new Error('The server sent an unexpected response. Please try again.');
    const have = (result.profile.inventory ?? []).filter((e) => e.qty == null).map((e) => e.id);
    state = { ...EMPTY_STATE, result, have, form: v };
    outdatedPlan = false;
    save();
    building = null;
    closeWizard({ restoreFocus: false });
    render();
    showView('home');
    $('#h-home').focus(); // the button that opened the wizard may now be hidden
  } catch (err) {
    if (err.cancelled || building?.signal.aborted) return;
    building = null;
    setLoading(false);
    showStep(LAST_STEP);
    showError($('#form-error'), err.message);
  }
}

// ================= Home =================
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

let flash = null; // one-time confirmation shown after a change (e.g. a swapped meal)

function planNotices(r, plan) {
  const t = plan.targets;
  const notices = [];
  if (flash) notices.push(el('p', { class: 'notice ok', role: 'status' }, flash));
  if (r.warning) notices.push(r.warning);
  if (t.floored) notices.push(`Your target was raised to the ${config?.minKcal ?? 1200} kcal/day safety minimum.`);
  if (plan.budgetNote) {
    notices.push(el('div', { class: 'notice' }, el('p', {}, plan.budgetNote.text), el('ul', {}, plan.budgetNote.tips.map((tip) => el('li', {}, tip)))));
  }
  for (const n of plan.notes ?? []) {
    if (n.type !== 'relaxed') continue;
    const day = plan.days[n.day];
    if (!day) continue;
    const rules = n.detail.map((h) => RULE_TEXT[h] ?? h).join(' and ');
    notices.push(`${day.label} ${n.slot}: no recipe fit every part of your routine, so this one ${rules}.`);
  }
  if (plan.deviations.length) {
    notices.push(el('div', { class: 'notice' },
      el('p', {}, "With your diet and routine, this week can't match every target. Weekly averages:"),
      el('ul', {}, plan.deviations.map((d) => el('li', {}, d.text)))));
  }
  return notices.map((n) => (typeof n === 'string' ? el('p', { class: 'notice', role: 'status' }, n) : n));
}

function renderHome() {
  const r = state.result;
  $('#home-empty').hidden = Boolean(r);
  $('#home-plan').hidden = !r;
  $('#outdated-note').hidden = !outdatedPlan;
  if (!r) return;
  const { profile } = r;
  const { plan, groceries } = view;
  const t = plan.targets;
  const day = Math.min(state.day ?? 0, plan.days.length - 1);
  const d = plan.days[day];

  $('#greeting').textContent = greeting();
  $('#plan-chips').replaceChildren(
    ...[
      GOAL_LABEL[profile.goal], `${fmtNum(t.kcal)} kcal / day`, DIET_LABEL[profile.diet],
      profile.budget && `${fmtMoney(profile.budget)} / week`,
      // Which planner made this plan; only worth a chip when AI is on (it can fall back).
      (config?.ai || r.source === 'ai') && (r.source === 'ai' ? 'Planned by AI' : 'Built-in planner'),
    ].filter(Boolean).map((text) => el('span', {}, text)),
  );
  $('#plan-notices').replaceChildren(...planNotices(r, plan));
  flash = null;
  $('#plan-summary').hidden = !r.summary;
  $('#plan-summary').textContent = r.summary || '';

  // ring + macros for the selected day
  const C = 2 * Math.PI * 50;
  const frac = Math.min(d.totals.kcal / t.kcal, 1);
  $('#ring-fill').setAttribute('stroke-dasharray', `${(C * frac).toFixed(1)} ${C.toFixed(1)}`);
  $('#ring-svg').setAttribute('aria-label', `${d.longLabel}: ${fmtNum(d.totals.kcal)} of ${fmtNum(t.kcal)} kcal`);
  $('#ring-kcal').textContent = fmtNum(d.totals.kcal);
  $('#ring-of').textContent = `of ${fmtNum(t.kcal)} kcal`;
  $('#macros').replaceChildren(
    ...[['Protein', 'protein', '#90A63B'], ['Carbs', 'carbs', '#C6A05B'], ['Fat', 'fat', '#D3B996']].map(([label, k, color]) =>
      el('div', { class: 'macro' },
        el('div', { class: 'macro-top' }, el('span', {}, label), el('b', {}, `${Math.round(d.totals[k])} / ${t[k]} g`)),
        el('div', { class: 'bar', role: 'img', 'aria-label': `${label} ${Math.round(d.totals[k])} of ${t[k]} g target` },
          el('i', { style: `width:${Math.min(100, (d.totals[k] / t[k]) * 100).toFixed(0)}%;background:${color}` })),
      ),
    ),
  );

  // day picker: real dates ("Mon 12")
  const picker = $('#day-picker');
  picker.style.setProperty('--days', plan.days.length);
  picker.hidden = plan.days.length < 2;
  picker.replaceChildren(
    ...plan.days.map((pd, i) => {
      const [wd, num] = pd.label.split(' ');
      return el('button', {
        type: 'button', class: 'day-btn', role: 'tab', 'aria-selected': String(i === day), 'aria-controls': 'meals', tabindex: i === day ? '0' : '-1',
        'aria-label': pd.longLabel,
        onclick: () => selectDay(i),
        onkeydown: (e) => {
          const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!delta) return;
          e.preventDefault();
          selectDay((i + delta + plan.days.length) % plan.days.length, true);
        },
      }, el('small', {}, wd), el('b', {}, num));
    }),
  );

  $('#day-title').textContent = d.longLabel + (d.context.busy ? ' · busy day' : '');
  $('#meals').setAttribute('aria-label', `${d.longLabel} meals`);
  $('#meals').replaceChildren(...d.meals.map((m) => mealRow(plan, day, m)));
  const buy = groceries.lines.filter((g) => g.status === 'buy');
  $('#groceries-link-meta').textContent = buy.length
    ? `${buy.length} item${buy.length > 1 ? 's' : ''} to buy · est. ${fmtMoney(groceries.toBuyTotal)}`
    : 'Everything is bought or at home';
}

function mealNotes(plan, m) {
  const notes = [];
  if (m.context.where === 'carry') notes.push(`Take-away${m.context.microwave ? '' : ', no microwave'}`);
  if (m.needsIcePack) notes.push('Pack it with an ice pack');
  if (m.kind === 'leftover') {
    const src = plan.days[m.leftoverOf.day];
    notes.push(`Leftovers from ${src?.label ?? 'earlier'} ${m.leftoverOf.slot}`);
  }
  for (const p of m.packFor ?? []) notes.push(`Cook extra for ${plan.days[p.day]?.label ?? 'later'} ${p.slot}`);
  if (m.kind === 'eatout') notes.push('Eating out');
  return notes;
}

function mealRow(plan, dayIdx, m) {
  const meta = m.kind === 'eatout'
    ? [m.nutritionKnown && `${fmtNum(m.nutrition.kcal)} kcal`, m.cost && `about ${fmtMoney(m.cost)}`]
    : [`${fmtNum(m.nutrition.kcal)} kcal`, `${Math.round(m.nutrition.protein)} g protein`, m.minutes ? `${m.minutes} min` : 'ready to eat', m.servings !== 1 && `×${fmtAmount(m.servings)} portion`];
  const notes = mealNotes(plan, m);
  return el('article', { class: 'meal' },
    el('button', { type: 'button', class: 'meal-open', 'aria-haspopup': 'dialog', onclick: (e) => openMeal(dayIdx, m.slot, e.currentTarget) },
      el('span', { class: 'tile-icon' }, svgIcon(LEAF)),
      el('span', { class: 'meal-text' },
        el('span', { class: 'meal-slot' }, m.slot),
        el('span', { class: 'meal-name' }, m.name),
        el('span', { class: 'meal-meta' }, meta.filter(Boolean).join(' · ')),
        notes.length > 0 && el('span', { class: 'meal-notes' }, notes.join(' · ')),
        m.conflicts.length > 0 && el('span', { class: 'meal-warn' }, `This meal ${m.conflicts.map((h) => RULE_TEXT[h] ?? h).join(' and ')}. Tap "My day changed" to swap it.`),
      ),
    ),
    el('button', { type: 'button', class: 'btn-chip', 'aria-haspopup': 'dialog', 'aria-label': `My day changed: ${m.slot}`, onclick: (e) => openDayChanged(dayIdx, m.slot, e.currentTarget) }, 'My day changed'),
  );
}

function selectDay(i, focus = false) {
  state.day = i;
  save();
  renderHome();
  if (focus) $$('#day-picker .day-btn')[i]?.focus();
}

// ================= Panel (recipe details, "my day changed") =================
let panelReturn = null;
function openPanel({ eyebrow, title, body, foot = [], opener }) {
  panelReturn = opener ?? document.activeElement;
  $('#pn-eyebrow').textContent = eyebrow ?? '';
  $('#pn-title').textContent = title;
  $('#pn-body').replaceChildren(...[body].flat().filter(Boolean));
  $('#pn-body').scrollTop = 0;
  setPanelFoot(foot);
  showError($('#pn-error'), null);
  if ($('#panel').hidden) {
    $('#panel').hidden = false;
    $('.app').inert = true;
  }
  $('#pn-title').focus();
}
function setPanelFoot(buttons) {
  const list = buttons.filter(Boolean);
  $('#pn-foot').replaceChildren(...list);
  $('#pn-foot').hidden = !list.length;
  $('#pn-foot').classList.toggle('single', list.length === 1);
}
function closePanel() {
  if ($('#panel').hidden) return;
  $('#panel').hidden = true;
  $('.app').inert = false;
  const back = panelReturn?.isConnected && panelReturn.offsetParent !== null ? panelReturn : $('#h-home');
  back?.focus();
}
const btn = (label, cls, onclick, attrs = {}) => el('button', { type: 'button', class: `btn ${cls}`, onclick, ...attrs }, label);

// ---------- recipe details ----------
function ingredientList(items) {
  return el('ul', { class: 'ingredients' }, items.map(({ id, qty }) => el('li', {}, el('b', {}, fmtQty(id, qty)), el('span', {}, INGREDIENTS[id].name))));
}
function nutritionGrid(n, known = true) {
  return el('dl', { class: 'nut-grid' },
    [['kcal', 'Calories', ''], ['protein', 'Protein', ' g'], ['carbs', 'Carbs', ' g'], ['fat', 'Fat', ' g']].map(([k, label, unit]) =>
      el('div', {}, el('dt', {}, label), el('dd', {}, known ? `${fmtNum(n[k])}${unit}` : '—'))));
}

function openMeal(dayIdx, slot, opener) {
  const plan = view.plan;
  const day = plan.days[dayIdx];
  const m = day.meals.find((x) => x.slot === slot);
  if (!m) return;
  const eyebrow = `${day.longLabel} · ${slot}`;
  const changed = btn('My day changed', 'btn-outline', () => openDayChanged(dayIdx, slot, opener));
  const close = btn('Done', 'btn-primary', closePanel);
  if (m.kind === 'eatout') {
    return openPanel({ eyebrow, title: m.name, opener, foot: [changed, close], body: [
      el('p', { class: 'lede' }, `You're eating out for this meal${m.cost ? `, about ${fmtMoney(m.cost)}` : ''}.`),
      nutritionGrid(m.nutrition, m.nutritionKnown),
      !m.nutritionKnown && el('p', { class: 'fine' }, "Calories weren't entered, so this meal isn't counted in the day's totals."),
    ] });
  }
  const r = m.recipe;
  const facts = [
    `${m.minutes} min${m.kind === 'leftover' ? (m.minutes ? ' to reheat' : ', ready to eat') : ''}`,
    `${fmtAmount(m.servings)} portion${m.servings === 1 ? '' : 's'}`,
    m.kind !== 'leftover' && (r.equipment.length ? r.equipment.map((e) => e.split('|').map((x) => EQUIPMENT_LABEL[x]).join(' or ')).join(', ') : 'No cooking gear'),
    m.kind !== 'leftover' && (r.skill > 1 ? 'Some cooking' : 'Easy'),
    r.portable && 'Packs well',
  ].filter(Boolean);
  const extra = (m.packFor ?? []).reduce((s, p) => s + p.servings, 0);
  const body = [
    el('div', { class: 'chips-static' }, facts.map((f) => el('span', {}, f))),
    m.conflicts.length > 0 && el('p', { class: 'notice' }, `This meal ${m.conflicts.map((h) => RULE_TEXT[h] ?? h).join(' and ')}. "My day changed" finds one that fits.`),
    m.kind === 'leftover' && el('p', { class: 'notice' },
      `Leftovers from ${plan.days[m.leftoverOf.day]?.longLabel ?? 'earlier'} ${m.leftoverOf.slot}. `
      + (r.reheat === 'none' ? 'Eat it cold, straight from the fridge.' : 'Reheat until steaming hot (165°F / 74°C).')),
    el('h3', { class: 'panel-h' }, 'This meal'),
    nutritionGrid(m.nutrition),
    el('p', { class: 'fine' }, `About ${fmtMoney(m.cost)} of ingredients (estimated prices).`),
    el('h3', { class: 'panel-h' }, m.kind === 'leftover' ? 'What you are eating' : extra ? `Ingredients to cook ${fmtAmount(m.servings + extra)} portions` : 'Ingredients'),
    ingredientList(m.kind === 'leftover' || !extra ? m.eatenItems : m.cookItems),
    extra > 0 && el('p', { class: 'fine' }, `Eat ${fmtAmount(m.servings)} now and pack the rest for ${m.packFor.map((p) => `${plan.days[p.day]?.label} ${p.slot}`).join(' and ')}.`),
    m.kind !== 'leftover' && el('h3', { class: 'panel-h' }, 'Steps'),
    m.kind !== 'leftover' && el('ol', { class: 'steps' }, r.steps.map((st) => el('li', {}, st))),
    el('h3', { class: 'panel-h' }, 'Storage'),
    el('ul', { class: 'tips' }, storageTips(r).map((tip) => el('li', {}, tip))),
  ];
  openPanel({ eyebrow, title: m.name, body, opener, foot: [changed, close] });
}

// ---------- "my day changed" ----------
function openDayChanged(dayIdx, slot, opener) {
  const day = view.plan.days[dayIdx];
  const m = day.meals.find((x) => x.slot === slot);
  if (!m) return;
  const choose = (reason) => {
    if (reason === 'missing') return pickMissing(dayIdx, slot, m, opener);
    if (reason === 'eatout') return eatOutForm(dayIdx, slot, m, opener);
    showAlternatives(dayIdx, slot, m, reason, null, opener);
  };
  openPanel({
    eyebrow: `${day.longLabel} · ${slot}`, title: 'My day changed', opener,
    body: [
      el('p', { class: 'lede' }, `Instead of ${m.name}. FitBite keeps your diet and allergies, and shows what changes in your day and your shopping.`),
      el('div', { class: 'reason-list' }, Object.entries(CHANGE_REASONS).map(([key, r]) =>
        el('button', { type: 'button', class: 'reason', onclick: () => choose(key) }, r.label, svgIcon('<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>')))),
    ],
    foot: [btn('Cancel', 'btn-outline', closePanel)],
  });
}

function pickMissing(dayIdx, slot, m, opener) {
  const items = m.kind === 'eatout' ? [] : m.eatenItems;
  if (!items.length) return showAlternatives(dayIdx, slot, m, 'other', null, opener);
  openPanel({
    eyebrow: 'My day changed', title: 'Which ingredient is missing?', opener,
    body: el('div', { class: 'reason-list' }, items.map(({ id }) =>
      el('button', { type: 'button', class: 'reason', onclick: () => showAlternatives(dayIdx, slot, m, 'missing', id, opener) }, INGREDIENTS[id].name))),
    foot: [btn('Back', 'btn-outline', () => openDayChanged(dayIdx, slot, opener))],
  });
}

const NOTHING_FITS = {
  missing: 'No recipe without that ingredient fits your diet and routine for this meal. Try "I want another option", or log that you\'re eating out.',
  other: "No other recipe fits your diet and routine for this meal. You can log that you're eating out instead.",
  time: 'No recipe fits that much time along with your diet and routine. Try "I want another option", or log that you\'re eating out.',
};

function showAlternatives(dayIdx, slot, m, reason, ingredientId, opener) {
  const r = state.result;
  const alts = alternativesFor(r.plan, r.profile, groceryState(), dayIdx, slot, reason, { ingredientId });
  let picked = alts[0] ?? null;
  const back = btn('Back', 'btn-outline', () => openDayChanged(dayIdx, slot, opener));
  if (!alts.length) {
    return openPanel({
      eyebrow: CHANGE_REASONS[reason].label, title: 'Nothing fits that', opener,
      body: el('p', { class: 'lede' }, NOTHING_FITS[reason] ?? NOTHING_FITS.time),
      foot: [back],
    });
  }
  const confirm = btn('Swap meal', 'btn-primary', () => {
    if (!picked) return;
    const { slot: s, recipeId, servings, kind, leftoverOf } = picked;
    commitChange(dayIdx, slot, m, reason, { slot: s, recipeId, servings, kind, ...(leftoverOf && { leftoverOf }) },
      `Swapped to ${picked.name}. ${picked.extraSpend > 0 ? `Your grocery list grew by about ${fmtMoney(picked.extraSpend)}.` : 'No extra shopping needed.'}`);
  });
  openPanel({
    eyebrow: CHANGE_REASONS[reason].label, title: 'Pick a swap', opener,
    body: [
      el('p', { class: 'lede' }, `Instead of ${m.name}:`),
      el('div', { class: 'alt-list', role: 'radiogroup', 'aria-label': 'Alternatives' }, alts.map((a, i) =>
        el('label', { class: 'alt' },
          el('input', { type: 'radio', name: 'alt', checked: i === 0, onchange: () => { picked = a; } }),
          el('span', { class: 'alt-card' },
            el('b', {}, a.name),
            el('span', { class: 'meal-meta' }, [`${fmtNum(a.nutrition.kcal)} kcal`, `${Math.round(a.nutrition.protein)} g protein`, `${a.minutes} min`,
              a.extraSpend > 0 ? `+${fmtMoney(a.extraSpend)} shopping` : 'no extra shopping'].join(' · ')),
            el('small', {}, a.reason))))),
    ],
    foot: [back, confirm],
  });
}

function eatOutForm(dayIdx, slot, m, opener) {
  const name = el('input', { name: 'eo-name', autocomplete: 'off', maxlength: '60', placeholder: 'e.g. Campus cafeteria' });
  const cost = el('input', { name: 'eo-cost', type: 'number', inputmode: 'decimal', min: '0', max: '200', step: '0.5', placeholder: '8' });
  const kcal = el('input', { name: 'eo-kcal', type: 'number', inputmode: 'numeric', min: '0', max: '3000', step: '10', placeholder: 'optional' });
  const save = btn('Log it', 'btn-primary', () => {
    const c = cost.value === '' ? 0 : Number(cost.value);
    const k = kcal.value === '' ? null : Number(kcal.value);
    if (!(c >= 0 && c <= 200)) return showError($('#pn-error'), 'Enter a cost between $0 and $200.');
    if (k != null && !(k >= 0 && k <= 3000)) return showError($('#pn-error'), 'Enter calories between 0 and 3,000, or leave it empty.');
    const label = name.value.trim().slice(0, 60) || 'Eating out';
    const eatout = { name: label, cost: Math.round(c * 100) / 100, ...(k != null && { kcal: Math.round(k), protein: 0, carbs: 0, fat: 0 }) };
    commitChange(dayIdx, slot, m, 'eatout', { slot, kind: 'eatout', eatout },
      `${cap(slot)} is now "${label}". Its ingredients came off your grocery list where nothing else needs them.`);
  });
  openPanel({
    eyebrow: CHANGE_REASONS.eatout.label, title: 'Eating out', opener,
    body: [
      el('p', { class: 'lede' }, `Replaces ${m.name}. FitBite drops its ingredients from your shopping and counts what you spend.`),
      el('label', {}, 'Where or what', name),
      el('div', { class: 'fields' }, el('label', {}, 'About how much ($)', cost), el('label', {}, 'Calories, if you know', kcal)),
    ],
    foot: [btn('Back', 'btn-outline', () => openDayChanged(dayIdx, slot, opener)), save],
  });
}

function commitChange(dayIdx, slot, old, reason, meal, message) {
  const r = state.result;
  r.plan = applyMealChange(r.plan, dayIdx, slot, meal);
  state.changes = [...(state.changes ?? []), { at: new Date().toISOString(), date: r.plan.days[dayIdx].date, slot, reason, from: old.recipeId ?? old.kind, to: meal.recipeId ?? meal.kind }].slice(-200);
  save();
  flash = message;
  closePanel();
  render();
  $$('#meals .meal-open')[r.plan.days[dayIdx].meals.findIndex((x) => x.slot === slot)]?.focus();
}

// ================= Groceries =================
const expanded = new Set();

function qtyText(g) {
  const need = `need ${fmtQty(g.ingredientId, g.need)}`;
  if (g.status === 'have') return g.have == null ? `${need} · you have it` : `${need} · you have ${fmtQty(g.ingredientId, g.have)}`;
  if (g.status === 'bought') return `${need} · bought ${g.boughtPacks} × ${g.packSize === 1 ? '' : `${g.packSize} ${g.unit} `}pack`.replace(' pack', g.packSize === 1 ? '' : ' pack');
  if (g.packSize === 1) return `${g.packs} ${g.unit === 'each' ? 'each' : g.unit + (g.packs > 1 ? 's' : '')}`;
  return `${g.packs} × ${g.packSize} ${g.unit} · ${need}`;
}

function toggleHave(id, have) {
  state.have = have ? [...new Set([...state.have, id])] : state.have.filter((x) => x !== id);
  save();
  derive();
  renderGroceries();
  renderHome();
}

function renderGroceries() {
  const r = state.result;
  if (!r) return;
  const g = view.groceries;
  const groups = new Map();
  const rank = (c) => (AISLE_ORDER.includes(c) ? AISLE_ORDER.indexOf(c) : AISLE_ORDER.length);
  for (const line of [...g.lines].sort((a, b) => rank(a.category) - rank(b.category))) groups.set(line.category, [...(groups.get(line.category) ?? []), line]);
  const days = r.plan.days.length;
  $('#groceries-sub').textContent = `${g.lines.length} ingredients for ${days} day${days > 1 ? 's' : ''}. Untick anything you already have.`;
  const { allergies = [], diet = 'omnivore' } = r.profile ?? {};
  $('#label-warning').hidden = !allergies.length && diet === 'omnivore';

  $('#grocery-list').replaceChildren(
    ...[...groups].map(([category, items]) => {
      const open = expanded.has(category) || items.length <= PREVIEW_ITEMS + 1;
      const shown = open ? items : items.slice(0, PREVIEW_ITEMS);
      const id = `aisle-${category.replace(/\W+/g, '-').toLowerCase()}`;
      return el('section', { class: 'aisle', 'aria-labelledby': id },
        el('div', { class: 'aisle-head' }, el('h2', { id }, category), el('small', {}, `${items.length} item${items.length > 1 ? 's' : ''}`)),
        shown.map((line) => {
          if (line.status === 'bought') {
            return el('div', { class: 'item done-item' },
              el('span', { class: 'pill' }, 'Bought'),
              el('span', { class: 'item-text' }, el('span', { class: 'item-name' }, line.name), el('span', { class: 'item-qty' }, qtyText(line))),
              el('button', { type: 'button', class: 'link-btn', 'aria-label': `Undo bought: ${line.name}`, onclick: () => {
                const { [line.ingredientId]: _, ...rest } = state.bought;
                state.bought = rest;
                save(); derive(); renderGroceries(); renderHome();
              } }, 'Undo'));
          }
          const buy = line.status === 'buy';
          return el('label', { class: `item${buy ? '' : ' off'}` },
            el('input', {
              type: 'checkbox', checked: buy, 'aria-label': `Buy ${line.name}`,
              onchange: (e) => {
                toggleHave(line.ingredientId, !e.target.checked);
                $(`#grocery-list input[aria-label="Buy ${CSS.escape(line.name)}"]`)?.focus();
              },
            }),
            el('span', { class: 'item-text' }, el('span', { class: 'item-name' }, line.name), el('span', { class: 'item-qty' }, qtyText(line))),
            el('span', { class: 'item-price' }, buy ? fmtMoney(line.estPrice) : 'Have it'),
          );
        }),
        items.length > PREVIEW_ITEMS + 1 && el('button', {
          type: 'button', class: 'more', 'aria-expanded': String(open),
          onclick: () => { open ? expanded.delete(category) : expanded.add(category); renderGroceries(); },
        }, open ? 'Show less' : `Show ${items.length - PREVIEW_ITEMS} more`),
      );
    }),
  );

  // Two different numbers: what you pay at the store (whole packs) vs what this week's meals use.
  const leftover = g.leftovers.reduce((s, l) => s + l.value, 0);
  const rows = [
    ['To buy now', fmtMoney(g.toBuyTotal), 'Whole packs, estimated prices'],
    g.boughtTotal > 0 && ['Already bought', fmtMoney(g.boughtTotal)],
    ['Food eaten this week', fmtMoney(g.consumedCost), `About ${fmtMoney(g.perMeal)} per meal`],
    g.eatOutTotal > 0 && ['Eating out', fmtMoney(g.eatOutTotal)],
    leftover >= 0.5 && ['Left for next week', fmtMoney(leftover), g.leftovers.slice(0, 3).map((l) => l.name).join(', ')],
    g.budget != null && [g.remaining >= 0 ? 'Left in budget' : 'Over budget', fmtMoney(Math.abs(g.remaining)), `Weekly budget ${fmtMoney(g.budget)}`],
  ].filter(Boolean);
  $('#cost-summary').replaceChildren(...rows.map(([label, value, sub]) =>
    el('div', { class: label === 'Over budget' ? 'over' : null }, el('dt', {}, label, sub && el('small', {}, sub)), el('dd', {}, value))));

  const buy = g.lines.filter((l) => l.status === 'buy');
  $('#total-label').textContent = `Estimated · ${buy.length} item${buy.length === 1 ? '' : 's'}`;
  $('#grocery-total').textContent = fmtMoney(g.toBuyTotal);
}

let checkingOut = false;
async function onCheckout() {
  if (checkingOut) return;
  const button = $('#checkout');
  const buy = view.groceries.lines.filter((l) => l.status === 'buy');
  showError($('#checkout-error'), null);
  if (!buy.length) {
    showError($('#checkout-error'), 'Nothing to buy. Everything is bought or marked as at home.');
    return $('#checkout-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  checkingOut = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const { diet, allergies } = state.result.profile ?? {};
    const items = buy.map((l) => ({ ingredientId: l.ingredientId, quantity: l.packs * l.packSize }));
    const r = await api('/api/checkout', { provider: $('#provider').value, items, dietary: { diet, allergies } }, { timeoutMs: 30_000 });
    showDone(r, buy);
  } catch (err) {
    showError($('#checkout-error'), err.message);
    $('#checkout-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    checkingOut = false;
    button.disabled = false;
    button.textContent = 'Send to cart';
  }
}

// ================= Cart ready =================
let pendingBuy = null; // lines sent to the cart, marked as bought once the user confirms
function showDone(r, buy) {
  const plan = state.result.plan;
  const meals = plan.days.reduce((s, d) => s + d.meals.length, 0);
  const link = r.type === 'link';
  const total = buy.reduce((s, l) => s + l.estPrice, 0);
  pendingBuy = buy;
  $('#h-done').textContent = link ? (r.demo ? 'Your list is on the Instacart demo' : 'Your list is on Instacart') : 'Your demo cart is ready';
  $('#done-sub').textContent = !link
    ? 'This is a simulated store: nothing is ordered or charged. With Instacart connected, you would pick a store and pay there.'
    : r.demo
      ? 'This is a mockup of the Instacart shopping-list page: pick a store and check out there. Nothing is ordered or charged.'
      : 'Pick your store, check the labels and pay there. Nothing is charged until you check out.';
  $('#done-items').textContent = String(buy.length);
  $('#done-meals').textContent = `${meals} over ${plan.days.length} day${plan.days.length > 1 ? 's' : ''}`;
  $('#done-total').textContent = fmtMoney(link ? total : r.total);
  $('#done-actions').replaceChildren(...[
    link && el('a', { class: 'btn btn-gold', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.demo ? 'Open Instacart demo' : 'Open Instacart', svgIcon('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>')),
    el('button', { type: 'button', class: link ? 'btn btn-outline' : 'btn btn-gold', onclick: () => hideDone(true) }, "I've bought these"),
    el('button', { type: 'button', class: 'btn btn-outline', onclick: () => hideDone(false) }, 'Back to home'),
  ].filter(Boolean));
  $('#done-details').hidden = link;
  if (!link) $('#done-lines').replaceChildren(...r.items.map((i) => el('tr', {}, el('td', {}, `${i.packs} × ${i.name}`), el('td', {}, fmtMoney(i.price)))));
  $('#view-done').hidden = false;
  $('.app').inert = true;
  $('#h-done').setAttribute('tabindex', '-1');
  $('#h-done').focus();
}

function hideDone(bought = false) {
  if (bought && pendingBuy) {
    const next = { ...state.bought };
    for (const l of pendingBuy) next[l.ingredientId] = (next[l.ingredientId] ?? 0) + l.packs;
    state.bought = next;
    flash = 'Marked as bought. Swaps now show only the extra shopping they need.';
    save();
    render();
  }
  pendingBuy = null;
  $('#view-done').hidden = true;
  $('.app').inert = false;
  showView('home');
  $('#h-home').focus();
}

// ================= Sign in (Clerk) =================
// Brand-matched Clerk components (Brand Kit v1.0 colors, serif titles, Arial UI).
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#0F3D32', colorPrimaryForeground: '#F3F0E7', colorForeground: '#1E2622', colorMutedForeground: '#4F5752',
    colorBackground: '#FFFDF8', colorInput: '#FFFFFF', colorInputForeground: '#1E2622', colorBorder: '#958566', colorRing: '#86672F',
    colorDanger: '#9B2C1F', colorSuccess: '#4E5E1C', fontFamily: 'Arial, Helvetica, sans-serif', borderRadius: '12px',
  },
  elements: {
    headerTitle: { fontFamily: '"Times New Roman", Times, Georgia, serif', fontWeight: 400, fontSize: '28px', color: '#0F3D32' },
    card: { boxShadow: '0 12px 32px rgba(0, 0, 0, .28)' },
    userButtonAvatarBox: { width: '34px', height: '34px' },
  },
};

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load sign-in. Check your connection and refresh.'));
    document.head.append(s);
  });
}

async function startClerk({ publishableKey, frontendApi }) {
  // Script-tag install per Clerk's JavaScript quickstart: UI bundle first, then clerk-js.
  await loadScript(`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': publishableKey });
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, appearance: CLERK_APPEARANCE, afterSignOutUrl: '/' });
  // Fires now and on every client/session/user change; only act when who's signed in changes.
  window.Clerk.addListener(({ user }) => {
    const next = user?.id ? `in:${user.id}` : 'out';
    if (next === authState) return;
    user?.id ? onSignedIn(user.id) : showSignIn();
  });
}

let authState = null; // 'in:<userId>' | 'out', what the screen currently shows
const SIGNIN_MESSAGE_KEY = 'fitbite:signin-message';

function showSignIn(message) {
  const status = $('#signin-status');
  if (authState === 'out' && !$('#view-signin').hidden) {
    // Already on the sign-in screen: just update the message, don't mount Clerk twice.
    if (message) { status.hidden = false; status.textContent = message; }
    return;
  }
  cancelBuild();
  authState = 'out';
  userId = null;
  state = { ...EMPTY_STATE };
  $('#wizard').hidden = true;
  $('#view-done').hidden = true;
  $('.app').hidden = true;
  $('#view-signin').hidden = false;
  const Clerk = window.Clerk;
  if (!Clerk) return;
  Clerk.unmountUserButton?.($('#user-button'));
  const carried = message ?? sessionStorage.getItem(SIGNIN_MESSAGE_KEY);
  sessionStorage.removeItem(SIGNIN_MESSAGE_KEY);
  status.classList.remove('error');
  status.hidden = !carried;
  status.textContent = carried ?? '';
  Clerk.mountSignIn($('#clerk-signin'), { withSignUp: true });
}

function onSignedIn(id) {
  // A plan still building belongs to whoever started it; never save it under another account.
  if (building && userId !== id) { cancelBuild(); $('#wizard').hidden = true; }
  authState = `in:${id}`;
  userId = id;
  sessionStorage.removeItem(SIGNIN_MESSAGE_KEY);
  window.Clerk.unmountSignIn?.($('#clerk-signin'));
  $('#view-signin').hidden = true;
  $('.app').hidden = false;
  $('.app').inert = false;
  window.Clerk.mountUserButton($('#user-button'));
  loadState();
  render();
  showView('home');
  promptFirstPlan();
}

// New here (no saved plan for this user on this device): open the plan wizard right away
// instead of leaving them on an empty home screen. Closing it leaves "Build my plan" there.
function promptFirstPlan() {
  if (state.result || !$('#wizard').hidden) return;
  openWizard();
}

// ================= App shell =================
function showView(name) {
  if (name === 'groceries' && !state.result) name = 'home';
  $('#view-home').hidden = name !== 'home';
  $('#view-groceries').hidden = name !== 'groceries';
  for (const t of $$('.tab')) {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

function render() {
  derive();
  $('.tab[data-view="groceries"]').disabled = !state.result;
  renderHome();
  renderGroceries();
}

// Wizard chips that come from the catalog, not the server config.
function renderWizardChips() {
  const chip = (name, value, label) => el('label', {}, el('input', { type: 'checkbox', name, value }), el('span', {}, label));
  for (const box of $$('#profile-form [data-weekdays]')) box.replaceChildren(...WEEKDAY_SHORT.map((d, i) => chip(box.dataset.weekdays, i, d)));
  const staples = Object.entries(INGREDIENTS).filter(([, i]) => i.staple).sort((a, b) => a[1].name.localeCompare(b[1].name));
  $('#pantry').replaceChildren(...staples.map(([id, i]) => chip('pantry', id, i.name)));
}

async function init() {
  renderWizardChips();
  // Wire the shell first so the UI responds even if config is slow.
  $$('[data-open-wizard]').forEach((b) => b.addEventListener('click', openWizard));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#wz-close').addEventListener('click', closeWizard);
  $('#wz-back').addEventListener('click', () => (step === 1 ? closeWizard() : showStep(step - 1)));
  $('#wz-next').addEventListener('click', onNext);
  form().addEventListener('submit', (e) => { e.preventDefault(); onNext(); });
  form().addEventListener('input', () => showError($('#form-error'), null));
  form().addEventListener('change', (e) => {
    if (e.target.name === 'units') toggleUnits();
    if (e.target.name === 'lunchWhere') toggleCarry();
    if (step === LAST_STEP) renderPlanUses();
  });
  $$('[data-days]').forEach((b) => b.addEventListener('click', () => { setDays(Number(form().elements.days.value) + Number(b.dataset.days)); renderPlanUses(); }));
  // Taps on the dimmed area close the sheet, but never cancel a plan that's being built.
  $('#wizard').addEventListener('click', (e) => e.target.id === 'wizard' && !building && closeWizard());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#panel').hidden) closePanel();
    else if (!$('#wizard').hidden) closeWizard();
    else if (!$('#view-done').hidden) hideDone();
  });
  $('#pn-close').addEventListener('click', closePanel);
  $('#panel').addEventListener('click', (e) => e.target.id === 'panel' && closePanel());
  $('#checkout').addEventListener('click', onCheckout);

  try {
    config = await api('/api/config', null, { timeoutMs: 10_000 });
  } catch (err) {
    $('#home-empty').hidden = false;
    return showError($('#checkout-error'), `Could not load app settings: ${err.message}`);
  }
  $('#ai-status').textContent = config.ai ? 'AI planner on' : 'Built-in planner';
  $('#ai-status').title = config.ai ? 'Plans are picked by AI, then checked by FitBite' : "Plans come from FitBite's built-in planner";
  $('#allergies').replaceChildren(
    ...config.allergens.map((a) => el('label', {}, el('input', { type: 'checkbox', name: 'allergies', value: a }), el('span', {}, ALLERGEN_LABEL[a] ?? a[0].toUpperCase() + a.slice(1)))),
  );
  $('#provider').replaceChildren(
    ...config.providers.map((p) => el('option', { value: p.id, disabled: !p.ready, selected: p.ready && p.id !== 'mock' },
      !p.ready ? `${p.label} (not set up)` : p.id === 'instacart' ? (p.demo ? 'Instacart (demo)' : 'Instacart (pick your store)') : p.label)),
  );
  setDays(7);

  if (config.auth) {
    // Sign-in required: keep the app hidden until Clerk reports a signed-in user.
    $('.app').hidden = true;
    $('#view-signin').hidden = false;
    try {
      await startClerk(config.auth);
    } catch (err) {
      $('#signin-status').hidden = false;
      $('#signin-status').classList.add('error');
      $('#signin-status').textContent = err.message;
    }
    return;
  }
  loadState();
  render();
  showView('home');
  promptFirstPlan();
}

init();
