import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceItem, jobTotals, tierPrice } from '../shared/pricing.js';

const methods = {
  serigrafia: { setup_fee: 25, setup_per_color: 1, color_price: 0.5, tiers: [{ min: 1, price: 6 }, { min: 24, price: 3.5 }, { min: 48, price: 2.5 }] },
  bordado: { setup_fee: 35, setup_per_color: 0, color_price: 0, tiers: [{ min: 1, price: 9 }, { min: 12, price: 7 }] },
};

test('escalas por cantidad', () => {
  assert.equal(tierPrice(methods.serigrafia.tiers, 10), 6);
  assert.equal(tierPrice(methods.serigrafia.tiers, 24), 3.5);
  assert.equal(tierPrice(methods.serigrafia.tiers, 1000), 2.5);
});

test('precio con tallas extra, colores y setup por pantalla', () => {
  const r = priceItem(
    { sizes: { M: 20, L: 20, '2XL': 8 }, decorations: [{ method: 'serigrafia', location: 'Frente', colors: 3 }] },
    { base_cost: 3 }, methods, 0.5
  );
  // 48 pzs: blank 4.5 + serigrafía 2.5 + 2 colores extra * 0.5 = 8/pz -> 384; 2XL 8*2 = 16; setup 25*3 = 75
  assert.equal(r.qty, 48);
  assert.equal(r.total, 384 + 16 + 75);
  assert.equal(r.setup, 75);
});

test('precio manual y producto sin tallas', () => {
  const r = priceItem({ qty: 10, custom_price: 12, decorations: [{ method: 'bordado', location: 'Frente gorra', colors: 1 }] }, null, methods);
  assert.equal(r.total, 10 * 12 + 35);
});

test('totales con descuento e impuesto', () => {
  assert.deepEqual(jobTotals([{ total: 100 }, { total: 50 }], 10, 0.07), { subtotal: 150, discount: 10, tax: 9.8, total: 149.8 });
});
