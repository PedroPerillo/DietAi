import * as E from './engine.js';
import { INGREDIENTS } from './catalog.js';
const STORAGE_KEY = 'fitbite:v2';
const LEGACY_KEY = 'fitbite:v1';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmtMoney = (n) => `$${n.toFixed(2)}`;
const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
const GOAL_LABEL = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Build muscle' };
const DIET_LABEL = { omnivore: 'Everything', pescatarian: 'Pescatarian', vegetarian: 'Vegetarian', vegan: 'Vegan' };
const ACTIVITY_LABEL = { sedentary: 'Mostly sitting', light: 'Light activity', moderate: 'Moderate activity', active: 'Active', very_active: 'Athlete' };
const ALLERGEN_LABEL = { nuts: 'Tree nuts', egg: 'Eggs' };
const LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l8-8"/></svg>';
const PREVIEW_ITEMS = 3; // items shown per aisle before "Show N more"
const AISLE_ORDER = ['Produce', 'Meat & Seafood', 'Dairy', 'Bakery', 'Deli', 'Frozen', 'Pantry', 'Ready to eat'];

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
const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
const svgIcon = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // static constant markup only
  return t.content.firstChild;
};

const EMPTY_STATE = { result: null, owned: [], bought: [], inventory: [], undo: [], log: {}, day: 0, form: null };
let state = { ...EMPTY_STATE };
let config;
let userId = null; // Clerk user id when sign-in is on; plans are stored per user on this device
const storageKey = () => (userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY);
const save = () => localStorage.setItem(storageKey(), JSON.stringify(state));

function loadState() {
  state = { ...EMPTY_STATE };
  try {
    // A plan made before sign-in existed moves to the first account that signs in here.
    if (userId && !localStorage.getItem(storageKey()) && localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(storageKey(), localStorage.getItem(STORAGE_KEY));
      localStorage.removeItem(STORAGE_KEY);
    }
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    if (saved?.result?.plan?.days && Array.isArray(saved.owned) && saved.result.skeleton) state = { ...EMPTY_STATE, ...saved };
  } catch {
    localStorage.removeItem(storageKey());
  }
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
  ['Final touches', 'Last details, then FitBite builds your week.'],
];
let step = 1;
let building = null; // AbortController while a plan is being built
let lastFocus = null;
const form = () => $('#profile-form');

function readForm() {
  const f = new FormData(form());
  const get = (k) => f.get(k);
  return {
    sex: get('sex'), units: get('units'), age: get('age'), weightLb: get('weightLb'), weightKg: get('weightKg'),
    heightFt: get('heightFt'), heightIn: get('heightIn'), heightCm: get('heightCm'), goal: get('goal'), activity: get('activity'),
    diet: get('diet'), allergies: f.getAll('allergies'), dislikes: get('dislikes'), days: Number(get('days')), snacks: form().snacks.checked, notes: get('notes'),
    budgetWeekly: get('budgetWeekly'), equipment: f.getAll('equipment'), skill: get('skill'), stylePref: get('stylePref'), prepDays: f.getAll('prepDays'), busyDays: f.getAll('busyDays'), inventory: pantry.slice(),
  };
}

function writeForm(v) {
  if (!v) return;
  const fm = form();
  for (const name of ['sex', 'units', 'goal', 'diet']) {
    const r = fm.querySelector(`input[name="${name}"][value="${CSS.escape(String(v[name]))}"]`);
    if (r) r.checked = true;
  }
  for (const name of ['age', 'weightLb', 'weightKg', 'heightFt', 'heightIn', 'heightCm', 'activity', 'dislikes', 'notes', 'budgetWeekly', 'skill', 'stylePref']) {
    if (v[name] != null && fm.elements[name]) fm.elements[name].value = v[name];
  }
  fm.querySelectorAll('input[name="allergies"]').forEach((c) => (c.checked = (v.allergies ?? []).includes(c.value)));
  fm.querySelectorAll('input[name="equipment"]').forEach((c) => (c.checked = (v.equipment ?? ['stove', 'oven', 'microwave']).includes(c.value)));
  fm.querySelectorAll('input[name="prepDays"]').forEach((c) => (c.checked = (v.prepDays ?? []).includes(c.value)));
  fm.querySelectorAll('input[name="busyDays"]').forEach((c) => (c.checked = (v.busyDays ?? []).includes(c.value)));
  pantry = (v.inventory ?? []).slice();
  renderPantry();
  fm.snacks.checked = v.snacks !== false;
  setDays(v.days ?? 7);
  toggleUnits();
}

// API body; the server validates everything again.
function toProfile(v) {
  const n = Number;
  const imperial = v.units === 'imperial';
  return {
    sex: v.sex, age: n(v.age),
    heightCm: imperial ? Math.round((n(v.heightFt) * 12 + n(v.heightIn)) * 2.54) : n(v.heightCm),
    weightKg: imperial ? Math.round(n(v.weightLb) * 0.4536 * 10) / 10 : n(v.weightKg),
    activity: v.activity, goal: v.goal, diet: v.diet, allergies: v.allergies, dislikes: (v.dislikes ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    days: v.days, snacks: v.snacks, notes: v.notes ?? '',
    student: { budgetWeekly: v.budgetWeekly ? n(v.budgetWeekly) : null, equipment: v.equipment?.length ? v.equipment : [], skill: v.skill ?? 'comfortable', stylePref: v.stylePref ?? 'mixed', prepDays: v.prepDays ?? [] },
    inventory: v.inventory ?? [],
    week: E.buildWeek({ startDate: new Date().toISOString().slice(0, 10), days: v.days, mealsPerDay: v.snacks ? 4 : 3, busyDays: v.busyDays ?? [] }),
  };
}

// ---- pantry picker ----
let pantry = [];
function renderPantry() {
  const list = $('#pantry-list');
  if (!list) return;
  lisfill(t, ...pantry.map((it) => el('div', { class: 'pantry-row' },
    el('span', {}, INGREDIENTS[it.ingredientId].name),
    el('input', { type: 'number', min: '1', value: it.quantity, 'aria-label': `Quantity of ${INGREDIENTS[it.ingredientId].name} in ${INGREDIENTS[it.ingredientId].unit}`, oninput: (e) => { it.quantity = Number(e.target.value) || 1; } }),
    el('small', {}, INGREDIENTS[it.ingredientId].unit),
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${INGREDIENTS[it.ingredientId].name}`, onclick: () => { pantry = pantry.filter((p) => p !== it); renderPantry(); } }, '×'),
  )));
}
function searchPantry(q) {
  const res = $('#pantry-results');
  q = q.trim().toLowerCase();
  if (!q) return res.replaceChildren();
  const hits = Object.entries(INGREDIENTS).filter(([id, i]) => i.name.toLowerCase().includes(q) && !pantry.some((p) => p.ingredientId === id)).slice(0, 6);
  res.replaceChildren(...hits.map(([id, i]) => el('button', { type: 'button', class: 'chip-btn', onclick: () => { pantry.push({ ingredientId: id, quantity: i.unit === 'each' || i.unit === 'can' || i.unit === 'slice' ? 2 : 200 }); $('#pantry-search').value = ''; res.replaceChildren(); renderPantry(); } }, `+ ${i.name}`)));
}

function validateStep(n, v) {
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
  $('#plan-uses').replaceChildren(
    el('span', {}, `${GOAL_LABEL[v.goal]} · ${ACTIVITY_LABEL[v.activity]}`),
    el('span', {}, `${DIET_LABEL[v.diet]} · ${allergies}`),
    el('span', {}, `${v.days} day${v.days > 1 ? 's' : ''}${v.snacks ? ' + daily snack' : ''}`),
  );
}

function showStep(n) {
  step = n;
  $$('.step').forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$('.progress span').forEach((b, i) => b.classList.toggle('on', i < n));
  $('#wz-step').textContent = `Step ${n} of 4`;
  $('#wz-title').textContent = STEPS[n - 1][0];
  $('#wz-sub').textContent = STEPS[n - 1][1];
  $('#wz-back').textContent = n === 1 ? 'Cancel' : 'Back';
  $('#wz-next').textContent = n === 4 ? 'Build my plan' : 'Continue';
  if (n === 4) renderPlanUses();
  showError($('#form-error'), null);
  form().scrollTop = 0;
}

// Users from before the wizard only have the API profile saved (metric units).
function formFromProfile(p) {
  if (!p) return null;
  return {
    sex: p.sex, units: 'metric', age: p.age, weightKg: p.weightKg, heightCm: p.heightCm, goal: p.goal, activity: p.activity,
    diet: p.diet, allergies: p.allergies ?? [], dislikes: (p.dislikes ?? []).join(', '), days: p.days, snacks: p.snacks, notes: p.notes ?? '',
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

// Aborting also stops the server-side Claude call (the server watches for disconnects).
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
  $('#wz-step').textContent = on ? 'Building your plan' : `Step ${step} of 4`;
  if (on) $('#wz-loading-sub').textContent = 'Matching recipes to your goal, routine, pantry and budget.';
}

async function onNext() {
  const v = readForm();
  const problem = validateStep(step, v);
  if (problem) return showError($('#form-error'), problem);
  if (step < 4) return showStep(step + 1);
  if (v.equipment.length === 0 && v.stylePref !== 'bought') { showError($('#form-error'), 'Pick at least one piece of equipment, or choose "Bought, ready-to-eat" meals.'); return; }
  if (building) return; // double-tap guard
  building = new AbortController();
  setLoading(true);
  try {
    const { signal } = building;
    await new Promise((r) => setTimeout(r, 400)); // let the loading state paint
    const result = E.generate(toProfile(v));
    if (signal.aborted) return; // closed after the response arrived: keep the previous plan
    result.groceries = E.groceries(result.plan, { inventory: result.profile.inventory, budget: result.profile.student.budgetWeekly });
    result.warning = 'Plan from the built-in planner (demo). Nutrition and prices are estimates.';
    state = { ...EMPTY_STATE, result, day: 0, form: v, inventory: result.profile.inventory.slice() };
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
    showStep(4);
    showError($('#form-error'), err.message);
  }
}

// ================= Home =================
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderHome() {
  const r = state.result;
  $('#home-empty').hidden = Boolean(r);
  $('#home-plan').hidden = !r;
  if (!r) return;
  const { plan, profile } = r;
  const t = plan.targets;
  const day = Math.min(state.day ?? 0, plan.days.length - 1);
  const d = plan.days[day];

  $('#greeting').textContent = greeting();
  fill($('#plan-chips'), 
    ...[GOAL_LABEL[profile.goal], `${fmtNum(t.kcal)} kcal / day`, DIET_LABEL[profile.diet], `${plan.days.length} day${plan.days.length > 1 ? 's' : ''}${profile.snacks ? ' + snack' : ''}`, profile.student?.budgetWeekly ? `$${profile.student.budgetWeekly}/week budget` : null].filter(Boolean)
      .map((text) => el('span', {}, text)),
  );
  const notices = [];
  if (r.warning) notices.push(r.warning);
  for (const nt of r.notes ?? []) notices.push(nt.text);
  for (const dv of d.deviations ?? []) notices.push(dv);
  if (t.floored) notices.push(`Your target was raised to the ${config?.minKcal ?? 1200} kcal/day safety minimum.`);
  $('#plan-notices').replaceChildren(...notices.map((n) => el('p', { class: 'notice', role: 'status' }, n)));
  $('#plan-summary').hidden = !r.summary;
  $('#plan-summary').textContent = r.summary || '';

  // ring + macros for the selected day
  const C = 2 * Math.PI * 50;
  const frac = Math.min(d.totals.kcal / t.kcal, 1);
  $('#ring-fill').setAttribute('stroke-dasharray', `${(C * frac).toFixed(1)} ${C.toFixed(1)}`);
  $('#ring-svg').setAttribute('aria-label', `Day ${d.day}: ${fmtNum(d.totals.kcal)} of ${fmtNum(t.kcal)} kcal`);
  $('#ring-kcal').textContent = fmtNum(d.totals.kcal);
  $('#ring-of').textContent = `of ${fmtNum(t.kcal)} kcal`;
  $('#macros').replaceChildren(
    ...[['Protein', 'protein', '#90A63B'], ['Carbs', 'carbs', '#C6A05B'], ['Fat', 'fat', '#D3B996']].map(([label, k, color]) =>
      el('div', { class: 'macro' },
        el('div', { class: 'macro-top' }, el('span', {}, label), el('b', {}, `${Math.round(d.totals[k])} g`)),
        el('div', { class: 'bar', role: 'img', 'aria-label': `${label} ${Math.round(d.totals[k])} of ${t[k]} g target` },
          el('i', { style: `width:${Math.min(100, (d.totals[k] / t[k]) * 100).toFixed(0)}%;background:${color}` })),
      ),
    ),
  );

  // day picker
  const picker = $('#day-picker');
  picker.style.setProperty('--days', plan.days.length);
  picker.hidden = plan.days.length < 2;
  picker.replaceChildren(
    ...plan.days.map((pd, i) =>
      el('button', {
        type: 'button', class: 'day-btn', role: 'tab', 'aria-selected': String(i === day), 'aria-controls': 'meals', tabindex: i === day ? '0' : '-1',
        'aria-label': pd.label,
        onclick: () => selectDay(i),
        onkeydown: (e) => {
          const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!delta) return;
          e.preventDefault();
          selectDay((i + delta + plan.days.length) % plan.days.length, true);
        },
      }, el('small', {}, pd.label.slice(0, 3)), el('b', {}, pd.date.slice(8))),
    ),
  );

  $('#meals').setAttribute('aria-label', `${d.label} meals`);
  $('#meals').replaceChildren(
    ...d.meals.map((m) => {
      const logged = state.log[`${d.index}:${m.slot}`];
      const badges = [m.prepOn && `Prepped ${m.prepOn}`, m.context?.where === 'away' && 'To go', m.estimated && 'Estimated', logged && ({ followed: 'Logged ✓', alternative: 'Adapted ✓', skipped: 'Skipped' })[logged.status]].filter(Boolean);
      return el('button', { type: 'button', class: 'meal meal-btn', onclick: () => openRecipe(d.index, m.slot) },
        el('span', { class: 'tile-icon' }, svgIcon(LEAF)),
        el('div', { class: 'meal-text' },
          el('span', { class: 'meal-slot' }, `${m.slot}${m.context ? ` · ${m.context.minutes} min` : ''}`),
          el('h3', { class: 'meal-name' }, m.name),
          el('span', { class: 'meal-meta' }, [`${fmtNum(m.kcal)} kcal`, `${Math.round(m.protein)} g protein`, `${m.effectiveMinutes ?? m.minutes} min`, `$${m.cost.toFixed(2)}`, m.servings !== 1 && `×${m.servings} portion`].filter(Boolean).join(' · ')),
          badges.length ? el('span', { class: 'badges' }, ...badges.map((b) => el('span', { class: 'mini-badge' }, b))) : null,
        ),
      );
    }),
  );
  const bt = r.groceries.totals;
  $('#budget-strip').hidden = false;
  fill($('#budget-strip'), 
    el('span', {}, `Groceries ~${fmtMoney(bt.purchase)}`),
    bt.budget != null ? el('span', { class: bt.diff < 0 ? 'over' : 'ok' }, bt.diff < 0 ? `${fmtMoney(-bt.diff)} over budget` : `${fmtMoney(bt.diff)} under budget`) : null,
    el('span', {}, `~${fmtMoney(bt.perMeal)} per meal`),
  );
  const buy = buying();
  $('#groceries-link-meta').textContent = `${buy.length} items · est. ${fmtMoney(sum(buy))}`;
}

function selectDay(i, focus = false) {
  state.day = i;
  save();
  renderHome();
  if (focus) $$('#day-picker .day-btn')[i]?.focus();
}

// ================= Groceries =================
function regroceries() {
  const r = state.result;
  r.groceries = E.groceries(r.plan, { inventory: state.inventory, have: state.owned, bought: state.bought, budget: r.profile.student.budgetWeekly });
}
const buying = () => state.result.groceries.lines.filter((g) => g.status === 'buy' && g.packs > 0);
const sum = (items) => items.reduce((s, g) => s + g.estPrice, 0);
const expanded = new Set();

function qtyText(g) {
  const inv = g.fromInventory ? ` · ${+g.fromInventory.toFixed(2)} ${g.unit} from pantry` : '';
  if (g.status === 'have') return `need ${+g.need.toFixed(2)} ${g.unit} · you have it`;
  if (g.packs === 0) return `need ${+g.need.toFixed(2)} ${g.unit}${inv} · covered`;
  const left = g.leftover > 0 ? ` · ${+g.leftover.toFixed(1)} ${g.unit} left for next week` : '';
  if (g.packSize === 1) return `${g.packs} ${g.unit === 'each' ? 'each' : g.unit + (g.packs > 1 ? 's' : '')}${inv}`;
  return `${g.packs} × ${g.packSize} ${g.unit} · need ${+g.toBuy.toFixed(2)} ${g.unit}${inv}${left}`;
}

function renderGroceries() {
  const r = state.result;
  if (!r) return;
  const groups = new Map();
  const rank = (c) => (AISLE_ORDER.includes(c) ? AISLE_ORDER.indexOf(c) : AISLE_ORDER.length);
  for (const g of [...r.groceries.lines].sort((a, b) => rank(a.category) - rank(b.category))) groups.set(g.category, [...(groups.get(g.category) ?? []), g]);
  const days = r.plan.days.length;
  const T = r.groceries.totals;
  $('#groceries-sub').textContent = `${r.groceries.lines.length} ingredients for ${days} day${days > 1 ? 's' : ''}.`;
  fill($('#budget-panel'), 
    el('div', { class: 'budget-grid' },
      el('div', {}, el('small', {}, 'To buy (whole packs)'), el('b', {}, fmtMoney(T.toBuy))),
      el('div', {}, el('small', {}, 'Already bought'), el('b', {}, fmtMoney(T.spent))),
      el('div', {}, el('small', {}, 'Budget'), el('b', {}, T.budget != null ? fmtMoney(T.budget) : '—')),
      el('div', { class: T.diff != null && T.diff < 0 ? 'over' : 'ok' }, el('small', {}, 'Difference'), el('b', {}, T.diff != null ? (T.diff < 0 ? `−${fmtMoney(-T.diff)}` : `+${fmtMoney(T.diff)}`) : '—')),
      el('div', {}, el('small', {}, 'Ingredients eaten this week'), el('b', {}, fmtMoney(T.consumed))),
      el('div', {}, el('small', {}, 'Per meal'), el('b', {}, fmtMoney(T.perMeal))),
      el('div', {}, el('small', {}, 'Leftover for next week'), el('b', {}, fmtMoney(T.leftoverValue))),
      el('div', {}, el('small', {}, 'Eating out (logged)'), el('b', {}, fmtMoney(T.eatingOut))),
    ),
    T.budget != null ? el('div', { class: 'bar budget-bar', role: 'img', 'aria-label': `${fmtMoney(T.purchase)} of ${fmtMoney(T.budget)} budget` }, el('i', { style: `width:${Math.min(100, (T.purchase / T.budget) * 100).toFixed(0)}%;background:${T.diff < 0 ? '#9B2C1F' : '#90A63B'}` })) : null,
  );
  const { allergies = [], diet = 'omnivore' } = r.profile ?? {};
  $('#label-warning').hidden = !allergies.length && diet === 'omnivore';

  $('#grocery-list').replaceChildren(
    ...[...groups].map(([category, items]) => {
      const open = expanded.has(category) || items.length <= PREVIEW_ITEMS + 1;
      const shown = open ? items : items.slice(0, PREVIEW_ITEMS);
      const id = `aisle-${category.replace(/\W+/g, '-').toLowerCase()}`;
      return el('section', { class: 'aisle', 'aria-labelledby': id },
        el('div', { class: 'aisle-head' }, el('h2', { id }, category), el('small', {}, `${items.length} item${items.length > 1 ? 's' : ''}`)),
        shown.map((g) => {
          const set = (status) => {
            state.owned = state.owned.filter((x) => x !== g.ingredientId);
            state.bought = state.bought.filter((x) => x !== g.ingredientId);
            if (status === 'have') state.owned.push(g.ingredientId);
            if (status === 'bought') state.bought.push(g.ingredientId);
            regroceries(); save(); renderGroceries(); renderHome();
          };
          const tog = (status, label) => el('button', { type: 'button', class: `tog${g.status === status ? ' on' : ''}`, 'aria-pressed': String(g.status === status), onclick: () => set(g.status === status ? 'buy' : status) }, label);
          return el('div', { class: `item${g.status !== 'buy' ? ' off' : ''}` },
            el('span', { class: 'item-text' }, el('span', { class: 'item-name' }, g.name), el('span', { class: 'item-qty' }, qtyText(g))),
            el('span', { class: 'item-right' }, el('span', { class: 'item-price' }, g.status === 'have' ? '—' : fmtMoney(g.packCost)), el('span', { class: 'togs' }, tog('have', 'Have'), tog('bought', 'Bought'))),
          );
        }),
        items.length > PREVIEW_ITEMS + 1 && el('button', {
          type: 'button', class: 'more', 'aria-expanded': String(open),
          onclick: () => { open ? expanded.delete(category) : expanded.add(category); renderGroceries(); },
        }, open ? 'Show less' : `Show ${items.length - PREVIEW_ITEMS} more`),
      );
    }),
  );
  const buy = buying();
  $('#total-label').textContent = `Estimated · ${buy.length} item${buy.length === 1 ? '' : 's'} to buy`;
  $('#grocery-total').textContent = fmtMoney(sum(buy));
}

let checkingOut = false;
async function onCheckout() {
  if (checkingOut) return;
  const button = $('#checkout');
  const buy = buying();
  showError($('#checkout-error'), null);
  if (!buy.length) {
    showError($('#checkout-error'), 'Nothing to buy. Every item is unticked.');
    return $('#checkout-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  checkingOut = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const { diet, allergies } = state.result.profile ?? {};
    const r = await api('/api/checkout', { provider: $('#provider').value, items: buy.map(({ ingredientId, toBuy }) => ({ ingredientId, quantity: toBuy })), dietary: { diet, allergies } }, { timeoutMs: 30_000 });
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
function showDone(r, buy) {
  const plan = state.result.plan;
  const meals = plan.days.reduce((s, d) => s + d.meals.length, 0);
  const link = r.type === 'link';
  $('#h-done').textContent = link ? 'Your list is on Instacart' : 'Your demo cart is ready';
  $('#done-sub').textContent = link
    ? 'Pick your store, check the labels and pay there. Nothing is charged until you check out.'
    : 'This is a simulated store. With Instacart connected, you would pick a store and pay there.';
  $('#done-items').textContent = String(buy.length);
  $('#done-meals').textContent = `${meals} over ${plan.days.length} day${plan.days.length > 1 ? 's' : ''}`;
  $('#done-total').textContent = fmtMoney(link ? sum(buy) : r.total);
  $('#done-actions').replaceChildren(...[
    link && el('a', { class: 'btn btn-gold', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open Instacart', svgIcon('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>')),
    el('button', { type: 'button', class: 'btn btn-outline', onclick: hideDone }, 'Back to home'),
  ].filter(Boolean));
  $('#done-details').hidden = link;
  if (!link) $('#done-lines').replaceChildren(...r.items.map((i) => el('tr', {}, el('td', {}, `${i.packs} × ${i.name}`), el('td', {}, fmtMoney(i.price)))));
  $('#view-done').hidden = false;
  $('.app').inert = true;
  $('#h-done').setAttribute('tabindex', '-1');
  $('#h-done').focus();
}

function hideDone() {
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
}

// ================= App shell =================
function showView(name) {
  if ((name === 'groceries' || name === 'progress') && !state.result) name = 'home';
  $('#view-home').hidden = name !== 'home';
  $('#view-groceries').hidden = name !== 'groceries';
  $('#view-progress').hidden = name !== 'progress';
  if (name === 'progress') renderProgress();
  for (const t of $$('.tab')) {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

function render() {
  $('.tab[data-view="groceries"]').disabled = !state.result;
  $('.tab[data-view="progress"]').disabled = !state.result;
  renderHome();
  renderGroceries();
}

async function init() {
  // Wire the shell first so the UI responds even if config is slow.
  $$('[data-open-wizard]').forEach((b) => b.addEventListener('click', openWizard));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#wz-close').addEventListener('click', closeWizard);
  $('#wz-back').addEventListener('click', () => (step === 1 ? closeWizard() : showStep(step - 1)));
  $('#wz-next').addEventListener('click', onNext);
  form().addEventListener('submit', (e) => { e.preventDefault(); onNext(); });
  form().addEventListener('change', (e) => {
    if (e.target.name === 'units') toggleUnits();
    if (step === 4) renderPlanUses();
  });
  $$('[data-days]').forEach((b) => b.addEventListener('click', () => { setDays(Number(form().elements.days.value) + Number(b.dataset.days)); renderPlanUses(); }));
  // Taps on the dimmed area close the sheet, but never cancel a plan that's being built.
  $('#wizard').addEventListener('click', (e) => e.target.id === 'wizard' && !building && closeWizard());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#wizard').hidden) closeWizard();
    else if (!$('#recipe-sheet').hidden) closeRecipe();
    else if (!$('#view-done').hidden) hideDone();
  });
  $('#checkout').addEventListener('click', onCheckout);
  $('#demo-btn').addEventListener('click', () => { openWizard(); writeForm(E.DEMO_FORM); showStep(4); showError($('#form-error'), 'Demo profile (fictional): a 21-year-old student, $55/week, busy Tuesdays and Thursdays, rice, oats, eggs and peanut butter in the pantry.'); });
  $('#pantry-search').addEventListener('input', (e) => searchPantry(e.target.value));
  $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeRecipe));
  $('#recipe-sheet').addEventListener('click', (e) => e.target.id === 'recipe-sheet' && closeRecipe());
  for (const [id, name] of [['prep-days', 'prepDays'], ['busy-days', 'busyDays']]) {
    $(`#${id}`).replaceChildren(...E.WEEKDAYS.map((d) => el('label', {}, el('input', { type: 'checkbox', name, value: d }), el('span', {}, E.WEEKDAY_LABEL[d].slice(0, 3)))));
  }

  try {
    config = await api('/api/config', null, { timeoutMs: 10_000 });
  } catch (err) {
    $('#home-empty').hidden = false;
    return showError($('#checkout-error'), `Could not load app settings: ${err.message}`);
  }
  $('#ai-status').textContent = 'Built-in planner (demo)';
  $('#ai-status').title = 'Plans are built in your browser from a demo catalog';
  $('#allergies').replaceChildren(
    ...config.allergens.map((a) => el('label', {}, el('input', { type: 'checkbox', name: 'allergies', value: a }), el('span', {}, ALLERGEN_LABEL[a] ?? a[0].toUpperCase() + a.slice(1)))),
  );
  $('#provider').replaceChildren(
    ...config.providers.map((p) => el('option', { value: p.id, disabled: !p.ready, selected: p.ready && p.id !== 'mock' }, p.ready ? (p.id === 'instacart' ? 'Instacart (pick your store)' : p.label) : `${p.label} (not set up)`)),
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
}

init();

// ================= Recipe sheet, "My day changed", meal log =================
let sheetFocus = null;
function openRecipe(dayIdx, slot) {
  sheetFocus = document.activeElement;
  renderRecipe(dayIdx, slot);
  $('#recipe-sheet').hidden = false;
  $('.app').inert = true;
  $('#rs-title').focus();
}
function closeRecipe() {
  $('#recipe-sheet').hidden = true;
  $('.app').inert = false;
  if (sheetFocus?.isConnected) sheetFocus.focus();
}
const nutriRow = (n) => el('div', { class: 'nutri' }, ...[['kcal', n.kcal, ''], ['protein', n.protein, ' g'], ['carbs', n.carbs, ' g'], ['fat', n.fat, ' g']].map(([k, v, u]) => el('span', {}, el('b', {}, `${Math.round(v)}${u}`), el('small', {}, k))));

function renderRecipe(dayIdx, slot) {
  const d = state.result.plan.days[dayIdx];
  const m = d.meals.find((x) => x.slot === slot);
  $('#rs-slot').textContent = `${d.label} · ${slot}`;
  $('#rs-title').textContent = m.name;
  const body = $('#rs-body');
  const meta = m.eatOut
    ? [`${m.source === 'demo' ? 'Demo venue' : 'Logged by you'}`, `~${fmtMoney(m.cost)}`, 'Nutrition is an estimate']
    : [`${m.minutes} min total · ${m.activeMinutes} min hands-on`, m.prepOn ? `Cook on ${m.prepOn}, reheat ${m.effectiveMinutes} min` : null, `Equipment: ${m.equipment.length ? m.equipment.join(', ') : 'none'}`, `Serves 1 · ×${m.servings} portion`, `~${fmtMoney(m.cost)} of ingredients`, m.context ? `You have ${m.context.minutes} min${m.context.where === 'away' ? ', away from home' : ''}` : null].filter(Boolean);
  fill(body, 
    el('p', { class: 'meal-meta' }, meta.join(' · ')),
    el('span', { class: 'badges' }, ...m.tags.map((t) => el('span', { class: 'mini-badge' }, t.replace(/-/g, ' ')))),
    nutriRow(m),
    m.fit && m.fit !== 'strict' ? el('p', { class: 'notice' }, 'Nothing in the catalog fit this slot exactly, so this is the closest option.') : null,
    m.ingredients.length ? el('h3', {}, 'Ingredients') : null,
    m.ingredients.length ? el('ul', { class: 'ings' }, ...m.ingredients.map((i) => el('li', {}, `${+i.quantity.toFixed(2)} ${i.unit} ${i.name}`))) : null,
    m.steps.length ? el('h3', {}, 'Steps') : null,
    m.steps.length ? el('ol', { class: 'steps' }, ...m.steps.map((s) => el('li', {}, s))) : null,
    m.storage ? el('p', { class: 'fine' }, `Storage: ${m.storage.note}`) : null,
    el('h3', {}, 'My day changed'),
    el('div', { class: 'reasons' }, ...Object.entries(E.REASONS).map(([k, label]) => el('button', { type: 'button', class: 'btn btn-outline', onclick: () => showAlternatives(dayIdx, slot, k) }, label))),
    el('div', { id: 'alt-area' }),
    el('h3', {}, 'How did it go?'),
    el('p', { class: 'fine' }, 'Any answer is fine. This only helps next week fit you better.'),
    el('div', { class: 'reasons' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => logMeal(dayIdx, slot, 'followed') }, 'Ate as planned'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => askReason(dayIdx, slot, 'alternative') }, 'Ate something else'),
      el('button', { type: 'button', class: 'btn btn-outline', onclick: () => askReason(dayIdx, slot, 'skipped') }, 'Skipped this meal'),
    ),
    el('div', { id: 'log-area' }, state.log[`${dayIdx}:${slot}`] ? el('p', { class: 'notice' }, `Logged: ${state.log[`${dayIdx}:${slot}`].status}${state.log[`${dayIdx}:${slot}`].reason ? ` (${E.LOG_REASONS[state.log[`${dayIdx}:${slot}`].reason]})` : ''}`) : null),
  );
}

function showAlternatives(dayIdx, slot, reason) {
  const area = $('#alt-area');
  const m = state.result.plan.days[dayIdx].meals.find((x) => x.slot === slot);
  fill(area, el('p', { class: 'lede' }, 'Finding options…'));
  if (reason === 'eat_out') return showEatOut(dayIdx, slot);
  if (reason === 'missing_ingredient' && !m.ingredients.length) return fill(area, el('p', { class: 'notice' }, 'This meal has no ingredients to miss.'));
  const run = (missingIngredientId) => {
    const res = E.alternatives(state.result, dayIdx, slot, reason, { missingIngredientId, inventory: state.inventory, have: state.owned, bought: state.bought, lines: state.result.groceries.lines.filter((l) => l.status === 'buy' && l.packs > 0) });
    if (!res.alternatives.length) return fill(area, el('p', { class: 'notice' }, res.message));
    fill(area, 
      el('p', { class: 'eyebrow' }, 'Up to three options'),
      ...res.alternatives.map((a) => el('div', { class: 'alt' },
        el('b', {}, a.name),
        el('span', { class: 'meal-meta' }, `${a.minutes} min · ~${fmtMoney(a.cost.consumed)} of ingredients · ${a.cost.newPurchase ? `+${fmtMoney(a.cost.newPurchase)} new groceries (${a.newIngredients.join(', ')})` : 'no new groceries'}`),
        nutriRow(a.nutrition),
        el('ul', { class: 'why' }, ...a.why.map((w) => el('li', {}, w))),
        el('div', { class: 'reasons' },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => confirmSwap(dayIdx, slot, { recipeId: a.recipeId, servings: a.servings, prepOn: null, fit: 'swap' }, a.name) }, 'Use this'),
          el('button', { type: 'button', class: 'btn btn-outline', onclick: () => fill(area, ) }, 'Cancel'),
        ),
      )),
    );
  };
  if (reason === 'missing_ingredient') {
    fill(area, el('p', { class: 'eyebrow' }, 'Which ingredient is missing?'), el('div', { class: 'reasons' }, ...m.ingredients.map((i) => el('button', { type: 'button', class: 'chip-btn', onclick: () => run(i.id) }, i.name))));
    return;
  }
  run(null);
}

function showEatOut(dayIdx, slot) {
  const area = $('#alt-area');
  const opts = E.eatOutOptions(state.result.profile);
  const manual = el('form', { class: 'manual', onsubmit: (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const kcal = Number(f.get('kcal'));
    if (!f.get('name') || !(kcal > 0)) return showError($('#eo-err'), 'Name and calories are required.');
    confirmSwap(dayIdx, slot, { eatOut: { name: String(f.get('name')).slice(0, 60), kcal, protein: Number(f.get('protein')) || 0, carbs: Number(f.get('carbs')) || 0, fat: Number(f.get('fat')) || 0, cost: Number(f.get('cost')) || 0, source: 'manual' } }, f.get('name'));
  } },
    el('label', {}, 'What did you eat? ', el('input', { name: 'name', required: true, maxlength: '60' })),
    el('div', { class: 'fields' }, el('label', {}, 'kcal ', el('input', { name: 'kcal', type: 'number', min: '1', required: true })), el('label', {}, 'Protein g ', el('input', { name: 'protein', type: 'number', min: '0' })), el('label', {}, 'Carbs g ', el('input', { name: 'carbs', type: 'number', min: '0' })), el('label', {}, 'Fat g ', el('input', { name: 'fat', type: 'number', min: '0' })), el('label', {}, 'Cost $ ', el('input', { name: 'cost', type: 'number', min: '0', step: '0.5' }))),
    el('p', { id: 'eo-err', class: 'error', hidden: true }),
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Log this meal'),
  );
  fill(area, 
    el('p', { class: 'eyebrow' }, 'Demo menu · not a real restaurant'),
    el('p', { class: 'fine' }, 'These are typical examples with estimated nutrition and prices, shown for the demo. Real venues need a menu source.'),
    ...opts.map((o) => el('div', { class: 'alt' }, el('b', {}, o.name), el('span', { class: 'meal-meta' }, `~${fmtMoney(o.price)} · demo data`), nutriRow(o),
      el('div', { class: 'reasons' }, el('button', { type: 'button', class: 'btn btn-primary', onclick: () => confirmSwap(dayIdx, slot, { eatOut: { name: o.name, kcal: o.kcal, protein: o.protein, carbs: o.carbs, fat: o.fat, cost: o.price, source: 'demo' } }, o.name) }, 'Use this')))),
    el('p', { class: 'eyebrow' }, 'Or enter it by hand'),
    manual,
  );
}

function confirmSwap(dayIdx, slot, entry, name) {
  const d = state.result.plan.days[dayIdx];
  const prev = { skeleton: state.result.skeleton, bought: state.bought.slice(), inventory: state.inventory.slice() };
  const oldLines = state.result.groceries.lines;
  state.result = E.applySwap(state.result, dayIdx, slot, entry);
  regroceries();
  // Bought ingredients the new plan no longer needs stay in the pantry instead of vanishing.
  for (const l of oldLines) {
    if (l.status === 'bought' && !state.result.groceries.lines.some((n) => n.ingredientId === l.ingredientId)) {
      state.inventory.push({ ingredientId: l.ingredientId, quantity: l.packs * l.packSize });
      state.bought = state.bought.filter((x) => x !== l.ingredientId);
    }
  }
  regroceries();
  state.undo = [...state.undo.slice(-19), prev];
  save(); render(); renderRecipe(dayIdx, slot);
  toast(`${slot} on ${d.label} updated.`, () => {
    const p = state.undo.pop();
    state.result = E.rebuild(state.result, p.skeleton); state.bought = p.bought; state.inventory = p.inventory;
    regroceries(); save(); render(); if (!$('#recipe-sheet').hidden) renderRecipe(dayIdx, slot);
  });
}

let toastTimer;
function toast(text, undo) {
  const t = $('#toast');
  fill(t, el('span', {}, text), undo ? el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { undo(); t.hidden = true; } }, 'Undo') : null);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 8000);
}

function askReason(dayIdx, slot, status) {
  fill($('#log-area'), el('p', { class: 'eyebrow' }, 'What got in the way? (optional)'), el('div', { class: 'reasons' },
    ...Object.entries(E.LOG_REASONS).map(([k, label]) => el('button', { type: 'button', class: 'chip-btn', onclick: () => logMeal(dayIdx, slot, status, k) }, label)),
    el('button', { type: 'button', class: 'chip-btn', onclick: () => logMeal(dayIdx, slot, status, null) }, 'Skip this question')));
}
function logMeal(dayIdx, slot, status, reason = null) {
  const m = state.result.plan.days[dayIdx].meals.find((x) => x.slot === slot);
  state.log[`${dayIdx}:${slot}`] = { status, reason, at: Date.now(), nutrition: status === 'skipped' ? null : { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat }, slot, minutes: m.minutes };
  save(); render(); renderRecipe(dayIdx, slot);
  toast(status === 'followed' ? 'Nice. Logged as planned.' : 'Logged. Thanks for keeping it real.');
}

function renderProgress() {
  const s = E.progressStats(state.log);
  const planned = state.result.plan.days.reduce((n, d) => n + d.meals.length, 0);
  const pct = (n) => (s.logged ? `${Math.round((n / s.logged) * 100)}%` : '—');
  const hints = [];
  const timeLunch = Object.values(state.log).filter((e) => e.reason === 'time' && e.slot === 'lunch').length;
  if (timeLunch >= 2) hints.push('You often swapped lunches for lack of time. Next week we will favor lunches under 10 minutes.');
  if (s.topReasons[0]?.[0] === 'cost') hints.push('Cost came up most often. Next week we will lean on cheaper staples and pantry items.');
  if (s.topReasons[0]?.[0] === 'taste') hints.push("Some meals weren't to your taste. Pin the ones you liked and we'll repeat those.");
  fill($('#progress-body'), 
    el('div', { class: 'budget-grid' },
      el('div', {}, el('small', {}, 'Meals logged'), el('b', {}, `${s.logged} of ${planned}`)),
      el('div', {}, el('small', {}, 'As planned'), el('b', {}, `${s.followed} · ${pct(s.followed)}`)),
      el('div', {}, el('small', {}, 'Adapted'), el('b', {}, `${s.adapted} · ${pct(s.adapted)}`)),
      el('div', {}, el('small', {}, 'Skipped'), el('b', {}, `${s.skipped} · ${pct(s.skipped)}`)),
    ),
    el('h3', {}, 'What got in the way'),
    s.topReasons.length ? el('ul', {}, ...s.topReasons.map(([k, n]) => el('li', {}, `${E.LOG_REASONS[k]}: ${n}`))) : el('p', { class: 'fine' }, 'No reasons logged yet.'),
    el('h3', {}, 'Eaten so far (logged meals only)'),
    el('p', { class: 'fine' }, 'Planned nutrition and logged nutrition are different things; this only counts meals you logged as eaten.'),
    nutriRow(s.eaten),
    hints.length ? el('h3', {}, 'For next week') : null,
    ...hints.map((h) => el('p', { class: 'notice' }, h)),
  );
}
