const STORAGE_KEY = 'dietai:v1';
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => `$${n.toFixed(2)}`;
const fmtQty = (q, unit) => `${+q.toFixed(2)} ${unit}${unit === 'each' || q === 1 || ['g', 'ml'].includes(unit) ? '' : 's'}`;

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

let state = { result: null, owned: [] };
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

async function api(path, body, timeoutMs = 150_000) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    throw new Error(e.name === 'TimeoutError' ? 'The request timed out. Please try again.' : 'Could not reach the server.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showError(target, message) {
  target.textContent = message ?? '';
  target.hidden = !message;
}

// ---------- profile form ----------
function readProfile(form) {
  const f = new FormData(form);
  const n = (k) => Number(f.get(k));
  const imperial = f.get('units') === 'imperial';
  return {
    sex: f.get('sex'),
    age: n('age'),
    heightCm: imperial ? Math.round((n('heightFt') * 12 + n('heightIn')) * 2.54) : n('heightCm'),
    weightKg: imperial ? Math.round(n('weightLb') * 0.4536 * 10) / 10 : n('weightKg'),
    activity: f.get('activity'),
    goal: f.get('goal'),
    diet: f.get('diet'),
    allergies: f.getAll('allergies'),
    dislikes: f.get('dislikes'),
    days: n('days'),
    snacks: f.get('snacks') === 'on',
    notes: f.get('notes'),
  };
}

function toggleUnits(form) {
  const imperial = form.units.value === 'imperial';
  form.querySelectorAll('.imperial').forEach((n) => (n.hidden = !imperial));
  form.querySelectorAll('.metric').forEach((n) => (n.hidden = imperial));
}

let generating = false;
async function onGenerate(e) {
  e.preventDefault();
  if (generating) return; // guards double-submit even before the button disables
  const form = e.currentTarget;
  const button = $('#generate');
  showError($('#form-error'), null);
  generating = true;
  button.disabled = true;
  button.textContent = config?.ai ? 'Building your plan… (AI can take up to a minute)' : 'Building your plan…';
  try {
    state = { result: await api('/api/plan', readProfile(form)), owned: [] };
    save();
    render();
    $('#step-plan').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError($('#form-error'), err.message);
  } finally {
    generating = false;
    button.disabled = false;
    button.textContent = 'Build my plan';
  }
}

// ---------- plan ----------
function renderPlan({ plan, summary, warning, source }) {
  showError($('#plan-warning'), warning);
  $('#plan-summary').textContent = summary || '';
  const t = plan.targets;
  const avg = (k) => Math.round(plan.days.reduce((s, d) => s + d.totals[k], 0) / plan.days.length);
  $('#targets').replaceChildren(
    ...[['kcal', 'Calories / day', ''], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g']].map(([k, label, u]) =>
      el('div', { class: 'stat' }, el('span', {}, label), el('b', {}, `${avg(k)}${u}`), el('span', {}, `target ${t[k]}${u}`)),
    ),
    el('div', { class: 'stat' }, el('span', {}, 'Planned by'), el('b', {}, source === 'ai' ? 'AI' : 'Built-in'), el('span', {}, `${plan.days.length} day(s)`)),
  );
  if (t.floored) $('#plan-summary').append(el('p', { class: 'warning' }, `Your target was raised to the ${config.minKcal} kcal/day safety floor.`));
  $('#days').replaceChildren(
    ...plan.days.map((d) =>
      el('article', { class: 'day' },
        el('h3', {}, `Day ${d.day}`, el('small', {}, `${d.totals.kcal} kcal · ${d.totals.protein}g protein`)),
        d.meals.map((m) =>
          el('div', { class: 'meal' },
            el('span', { class: 'slot' }, m.slot),
            el('span', {}, m.name, m.servings !== 1 ? ` ×${m.servings}` : ''),
            el('span', { class: 'meta' }, `${m.kcal} kcal · P${Math.round(m.protein)} C${Math.round(m.carbs)} F${Math.round(m.fat)} · ${m.minutes} min`),
          ),
        ),
      ),
    ),
  );
}

// ---------- groceries ----------
const buying = () => state.result.groceries.filter((g) => !state.owned.includes(g.ingredientId));

function renderGroceries() {
  const groups = new Map();
  for (const g of state.result.groceries) groups.set(g.category, [...(groups.get(g.category) ?? []), g]);
  $('#grocery-list').replaceChildren(
    ...[...groups].map(([category, items]) =>
      el('div', { class: 'group' },
        el('h4', {}, category),
        items.map((g) => {
          const owned = state.owned.includes(g.ingredientId);
          return el('label', { class: `item${owned ? ' off' : ''}` },
            el('input', {
              type: 'checkbox',
              checked: !owned,
              'aria-label': `Buy ${g.name}`,
              onchange: (e) => {
                state.owned = e.target.checked ? state.owned.filter((id) => id !== g.ingredientId) : [...state.owned, g.ingredientId];
                save();
                renderGroceries();
              },
            }),
            el('span', {}, g.name),
            el('span', { class: 'qty' }, `need ${fmtQty(g.quantity, g.unit)}${g.packSize !== 1 ? ` · buy ${g.packs} pack${g.packs > 1 ? 's' : ''}` : ''}`),
            el('span', { class: 'price' }, fmtMoney(g.estPrice)),
          );
        }),
      ),
    ),
  );
  $('#grocery-total').textContent = fmtMoney(buying().reduce((s, g) => s + g.estPrice, 0));
  $('#label-warning').hidden = !state.result.profile?.allergies?.length;
}

let checkingOut = false;
async function onCheckout() {
  if (checkingOut) return;
  const button = $('#checkout');
  const items = buying().map(({ ingredientId, quantity }) => ({ ingredientId, quantity }));
  showError($('#checkout-error'), null);
  $('#checkout-result').replaceChildren();
  if (!items.length) return showError($('#checkout-error'), 'Nothing to buy. Every item is unchecked.');
  checkingOut = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const { diet, allergies } = state.result.profile ?? {};
    const r = await api('/api/checkout', { provider: $('#provider').value, items, dietary: { diet, allergies } }, 30_000);
    $('#checkout-result').replaceChildren(
      r.type === 'link'
        ? el('div', { class: 'result' },
            el('p', {}, `Your list of ${r.itemCount} items is ready on Instacart. Pick a store, review the cart, and check out there.`),
            el('a', { class: 'primary', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open Instacart →'))
        : el('div', { class: 'result' },
            el('p', {}, el('strong', {}, `Cart ${r.cartId} created · ${fmtMoney(r.total)}`), el('br'), r.message),
            el('table', {}, el('tbody', {}, r.items.map((i) => el('tr', {}, el('td', {}, `${i.packs} × ${i.name}`), el('td', {}, fmtMoney(i.price))))))),
    );
  } catch (err) {
    showError($('#checkout-error'), err.message);
  } finally {
    checkingOut = false;
    button.disabled = false;
    button.textContent = 'Send to cart';
  }
}

// ---------- app ----------
function render() {
  const has = Boolean(state.result);
  $('#step-plan').hidden = !has;
  $('#step-groceries').hidden = !has;
  if (!has) return;
  renderPlan(state.result);
  renderGroceries();
}

let config;
async function init() {
  const form = $('#profile-form');
  try {
    config = await api('/api/config', null, 10_000);
  } catch (err) {
    return showError($('#form-error'), `Could not load app settings: ${err.message}`);
  }
  $('#ai-status').textContent = config.ai ? `AI planner: ${config.model}` : 'AI off: using the built-in planner';
  $('#allergies').replaceChildren(
    ...config.allergens.map((a) => el('label', {}, el('input', { type: 'checkbox', name: 'allergies', value: a }), el('span', {}, a === 'nuts' ? 'tree nuts' : a))),
  );
  $('#provider').replaceChildren(
    ...config.providers.map((p) => el('option', { value: p.id, disabled: !p.ready, selected: p.ready && p.id !== 'mock' }, p.ready ? p.label : `${p.label} (not configured)`)),
  );
  form.units.addEventListener('change', () => toggleUnits(form));
  form.addEventListener('submit', onGenerate);
  $('#checkout').addEventListener('click', onCheckout);
  $('#restart').addEventListener('click', () => $('#step-profile').scrollIntoView({ behavior: 'smooth' }));

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.result?.plan?.days && Array.isArray(saved.owned)) state = saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  render();
}

init();
