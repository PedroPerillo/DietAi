import { cartTotal } from '../grocery.mjs';

// Simulates a retailer cart so the full flow works with no API keys.
export const mock = {
  id: 'mock',
  label: 'Demo store (simulated)',
  ready: () => true,
  async checkout(lines) {
    return {
      type: 'cart',
      provider: 'mock',
      cartId: `demo-${Date.now().toString(36)}`,
      items: lines.map(({ name, packs, packSize, unit, estPrice }) => ({ name, packs, packSize, unit, price: estPrice })),
      total: cartTotal(lines),
      message: 'Simulated cart. In production the user reviews and pays on the retailer site.',
    };
  },
};
