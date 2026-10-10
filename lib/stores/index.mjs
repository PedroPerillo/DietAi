import { mock } from './mock.mjs';
import { instacart } from './instacart.mjs';

// Every grocery provider implements { id, label, ready(), checkout(lines, opts) } and
// returns either { type: 'link', url } (user finishes on retailer) or { type: 'cart', ... }.
// Kroger (OAuth + cart.basic:write) would slot in here next; see PLAN.md.
export const PROVIDERS = { mock, instacart };

export const getProvider = (id) => (Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : undefined);

export const listProviders = () =>
  Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, ready: p.ready() }));
