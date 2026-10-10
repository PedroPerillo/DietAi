// Instacart demo preview: renders the list FitBite would send to Instacart (from the URL
// fragment, built by lib/stores/instacart.mjs) as a shopping-list page with demo stores.
// Everything is local to this page: nothing is ordered and nothing is sent anywhere.
const $ = (sel) => document.querySelector(sel);
const money = (n) => `$${n.toFixed(2)}`;
const AISLE_ORDER = ['Produce', 'Meat & Seafood', 'Dairy', 'Bakery', 'Deli', 'Frozen', 'Pantry'];
const FILTER_LABEL = { GLUTEN_FREE: 'Gluten-free', VEGAN: 'Vegan' };
// Example stores: price factor applied to FitBite's estimates, so totals differ by store.
const STORES = [
  { id: 'fresh', name: 'Fresh Market', note: 'Delivery in about 2 hours', factor: 1, color: '#2e7d32' },
  { id: 'value', name: 'Value Grocer', note: 'Delivery tomorrow morning', factor: 0.92, color: '#c62828' },
  { id: 'coop', name: 'Organic Co-op', note: 'Pickup in 1 hour', factor: 1.17, color: '#6a1b9a' },
];

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

// The fragment is user-editable, so only accept the shape FitBite builds: short strings,
// finite numbers, a bounded number of items. Everything is rendered as text, never as HTML.
const MAX_ITEMS = 200;
const MAX_TEXT = 80;
const text = (v, fallback = '') => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : fallback);
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(v, 1e6) : 0);

function readList() {
  try {
    const data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (!Array.isArray(data?.items)) return null;
    const items = data.items.slice(0, MAX_ITEMS)
      .filter((i) => i && typeof i.name === 'string' && Array.isArray(i.line_item_measurements))
      .map((i) => ({
        name: text(i.name),
        display_text: text(i.display_text, text(i.name)),
        category: text(i.category, 'Other'),
        estPrice: num(i.estPrice),
        line_item_measurements: i.line_item_measurements.slice(0, 4).map((m) => ({ quantity: num(m?.quantity), unit: text(m?.unit, 'each') })),
        ...(Array.isArray(i.filters?.health_filters) && { filters: { health_filters: i.filters.health_filters.filter((f) => f in FILTER_LABEL) } }),
      }));
    const back = typeof data.back === 'string' && /^https:\/\//.test(data.back) ? data.back : '/';
    return items.length ? { title: text(data.title) || 'Shopping list', items, back } : null;
  } catch {
    return null;
  }
}

const measurementText = ({ quantity, unit }) => {
  const q = +Number(quantity).toFixed(2);
  if (unit === 'each') return `${q}`;
  if (unit === 'gram') return `${q} g`;
  if (unit === 'milliliter') return `${q} ml`;
  return `${q} ${unit}${q === 1 ? '' : 's'}`;
};

const list = readList();
const state = { store: STORES[0], skip: new Set(), inCart: false };

function subtotal() {
  return list.items.reduce((s, it, i) => s + (state.skip.has(i) ? 0 : (it.estPrice ?? 0) * state.store.factor), 0);
}

function renderStores() {
  $('#stores').replaceChildren(...STORES.map((st) => {
    const total = list.items.reduce((s, it, i) => s + (state.skip.has(i) ? 0 : (it.estPrice ?? 0) * st.factor), 0);
    return el('label', { class: 'store' },
      el('input', { type: 'radio', name: 'store', value: st.id, checked: st === state.store, onchange: () => { state.store = st; render(); } }),
      el('span', { class: 'logo', style: `background:${st.color}`, 'aria-hidden': 'true' }, st.name[0]),
      el('span', { class: 'store-text' }, el('b', {}, `${st.name} (demo)`), el('small', {}, st.note)),
      el('span', { class: 'store-total' }, money(total)));
  }));
}

function renderItems() {
  const groups = new Map();
  list.items.forEach((it, i) => {
    const cat = it.category ?? 'Other';
    groups.set(cat, [...(groups.get(cat) ?? []), [it, i]]);
  });
  const rank = (c) => (AISLE_ORDER.includes(c) ? AISLE_ORDER.indexOf(c) : AISLE_ORDER.length);
  $('#items').replaceChildren(...[...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([cat, rows]) =>
    el('div', { class: 'aisle' }, el('h3', {}, cat), rows.map(([it, i]) => {
      const on = !state.skip.has(i);
      const filters = it.filters?.health_filters ?? [];
      return el('label', { class: `item${on ? '' : ' off'}` },
        el('input', { type: 'checkbox', checked: on, 'aria-label': `Include ${it.name}`, onchange: (e) => {
          e.target.checked ? state.skip.delete(i) : state.skip.add(i);
          state.inCart = false;
          render();
        } }),
        el('span', { class: 'item-text' },
          el('span', { class: 'item-name' }, it.name, filters.map((f) => el('span', { class: 'tag' }, FILTER_LABEL[f] ?? f))),
          el('span', { class: 'item-qty' }, it.line_item_measurements.map(measurementText).join(' + '))),
        el('span', { class: 'price' }, money((it.estPrice ?? 0) * state.store.factor)));
    }))));
}

function render() {
  renderStores();
  renderItems();
  const count = list.items.length - state.skip.size;
  $('#bar-label').textContent = `Estimated subtotal at ${state.store.name} · ${count} item${count === 1 ? '' : 's'}`;
  $('#bar-total').textContent = money(subtotal());
  $('#add').disabled = count === 0;
  $('#add').textContent = state.inCart ? 'Go to checkout' : `Add ${count} item${count === 1 ? '' : 's'} to cart`;
}

let lastFocus = null;
function openModal() {
  lastFocus = document.activeElement;
  $('#modal-text').textContent = `On Instacart you'd now pick a delivery or pickup time at ${state.store.name} and pay about ${money(subtotal())} plus fees and tip.`;
  $('#modal').hidden = false;
  $('#modal-title').focus();
}
function closeModal() {
  $('#modal').hidden = true;
  lastFocus?.focus();
}

if (!list) {
  $('#error').hidden = false;
} else {
  $('#title').textContent = list.title;
  $('#back').href = list.back;
  $('#sub').textContent = `${list.items.length} items from FitBite · amounts are what your meals need`;
  $('#payload').textContent = JSON.stringify(list.items.map(({ name, display_text, line_item_measurements, filters }) =>
    ({ name, display_text, line_item_measurements, ...(filters && { filters }) })), null, 2);
  $('#content').hidden = false;
  $('#bar').hidden = false;
  $('#add').addEventListener('click', () => {
    if (state.inCart) return openModal();
    state.inCart = true;
    render();
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('#modal').hidden && closeModal());
  render();
}
