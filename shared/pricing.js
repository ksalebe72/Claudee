// Motor de precios compartido entre servidor y cliente.
// Precio por pieza = blank (costo * (1 + markup)) + decoraciones por ubicación + recargo por talla.
// Cada método de decoración tiene escalas por cantidad, costo por color extra y cargo de setup.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
export const SIZE_UPCHARGE = { '2XL': 2, '3XL': 3, '4XL': 4, '5XL': 5 };

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function itemQty(item) {
  if (item.sizes && Object.keys(item.sizes).length) {
    return Object.values(item.sizes).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  return Number(item.qty) || 0;
}

export function tierPrice(tiers = [], qty) {
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  const t = sorted.find((x) => qty >= x.min) || sorted[sorted.length - 1];
  return t ? Number(t.price) : 0;
}

/**
 * @param item   { product_id, sizes:{S:10}, qty?, decorations:[{method, location, colors}], custom_price? }
 * @param product { base_cost } | null
 * @param methods  map code -> { setup_fee, tiers, color_price, setup_per_color }
 * @param markup   0.6 = 60% sobre costo del blank
 */
export function priceItem(item, product, methods, markup = 0.6) {
  const qty = itemQty(item);
  if (!qty) return { qty: 0, unit_price: 0, setup: 0, total: 0, breakdown: [] };

  const blank = product ? Number(product.base_cost) * (1 + Number(markup)) : 0;
  let decoUnit = 0;
  let setup = 0;
  const breakdown = [];

  for (const d of item.decorations || []) {
    const m = methods[d.method];
    if (!m) continue;
    const colors = Math.max(1, Number(d.colors) || 1);
    const per = tierPrice(m.tiers, qty) + Number(m.color_price || 0) * (colors - 1);
    const s = Number(m.setup_fee || 0) * (m.setup_per_color ? colors : 1);
    decoUnit += per;
    setup += s;
    breakdown.push({ method: d.method, location: d.location, colors, per_unit: round2(per), setup: round2(s) });
  }

  let upcharge = 0;
  for (const [size, n] of Object.entries(item.sizes || {})) {
    upcharge += (SIZE_UPCHARGE[size] || 0) * (Number(n) || 0);
  }

  const unitBase = item.custom_price != null && item.custom_price !== '' ? Number(item.custom_price) : blank + decoUnit;
  const total = unitBase * qty + upcharge + setup;
  return {
    qty,
    blank: round2(blank),
    deco_unit: round2(decoUnit),
    upcharge: round2(upcharge),
    setup: round2(setup),
    unit_price: round2(total / qty),
    total: round2(total),
    breakdown,
  };
}

export function jobTotals(items, discount = 0, taxRate = 0) {
  const subtotal = round2(items.reduce((a, i) => a + (Number(i.total) || 0), 0));
  const disc = round2(Number(discount) || 0);
  const tax = round2((subtotal - disc) * (Number(taxRate) || 0));
  return { subtotal, discount: disc, tax, total: round2(subtotal - disc + tax) };
}
