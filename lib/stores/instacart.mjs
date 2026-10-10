import { INGREDIENTS } from '../catalog.mjs';

// Instacart Developer Platform: create a shopping-list page and send the user there to
// pick a store and check out. Docs: https://docs.instacart.com/developer_platform_api/
const BASE_URL = () => process.env.INSTACART_BASE_URL || 'https://connect.dev.instacart.tools';
const TIMEOUT_MS = 15_000;

export class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.status = 502;
  }
}

// Units with no Instacart equivalent (slices of bread, garlic cloves) are sent as
// whole retail packs instead, so quantity matching never sees an unknown unit.
//
// Health filters narrow matching to labeled products. They're only applied to packaged
// goods: fresh produce and meat are rarely labeled and would stop matching at all.
const UNPACKAGED = new Set(['Produce', 'Meat & Seafood']);
export function toLineItem(line, { glutenFree = false, vegan = false } = {}) {
  const ing = INGREDIENTS[line.ingredientId];
  const byPack = ing.instacartUnit === 'package' || ing.instacartUnit === 'head';
  const measurement = byPack ? { quantity: line.packs, unit: ing.instacartUnit } : { quantity: line.quantity, unit: ing.instacartUnit };
  const healthFilters = UNPACKAGED.has(ing.category) ? [] : [glutenFree && 'GLUTEN_FREE', vegan && 'VEGAN'].filter(Boolean);
  return {
    name: line.name,
    display_text: line.name,
    line_item_measurements: [measurement],
    ...(healthFilters.length && { filters: { health_filters: healthFilters } }),
  };
}

export const instacart = {
  id: 'instacart',
  label: 'Instacart',
  ready: () => Boolean(process.env.INSTACART_API_KEY),
  async checkout(lines, { title = 'My DietAI meal plan', linkbackUrl, dietary, timeoutMs = TIMEOUT_MS } = {}) {
    let res;
    try {
      res = await fetch(`${BASE_URL()}/idp/v1/products/products_link`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INSTACART_API_KEY}`,
        },
        body: JSON.stringify({
          title,
          link_type: 'shopping_list',
          expires_in: 30,
          line_items: lines.map((l) => toLineItem(l, dietary)),
          ...(linkbackUrl && { landing_page_configuration: { partner_linkback_url: linkbackUrl } }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new UpstreamError(e.name === 'TimeoutError' ? 'Instacart timed out. Try again.' : 'Could not reach Instacart.');
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.error(`instacart ${res.status}: ${detail}`);
      throw new UpstreamError(`Instacart returned an error (${res.status}).`);
    }
    const data = await res.json().catch(() => ({}));
    // The browser renders this as an href, so only accept an https URL.
    let url;
    try {
      url = new URL(data.products_link_url);
    } catch {}
    if (url?.protocol !== 'https:') throw new UpstreamError('Instacart response had no valid link.');
    return { type: 'link', provider: 'instacart', url: url.href, itemCount: lines.length };
  },
};
