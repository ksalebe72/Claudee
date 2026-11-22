// Pruebas del motor de precios (valores exigidos por Color Plus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING, precioPrenda, calcularLinea, calcularRentabilidad, costoDtf, tarifaBordado } from '../shared/pricing.js';

const cfg = structuredClone(DEFAULT_PRICING);
const fijo = { ...structuredClone(DEFAULT_PRICING), prendas: { ...DEFAULT_PRICING.prendas, modo: 'fijo' } };

// Gildan 5000, 12 piezas (costo cualquiera; aquí probamos la decoración por pieza)
const g5000 = (decorations) => calcularLinea({ line_type: 'prenda', description: 'Gildan 5000', qty: 12, unit_cost: 3.1, decorations }, cfg);

test('DTF: logo 3.5×3.5" pecho izquierdo = $6.00 por pieza', () => {
  const l = g5000([{ process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 }]);
  assert.equal(l.precioDecoPieza, 6.0);
});

test('DTF: 9×10" espalda = $10.50 por pieza', () => {
  const l = g5000([{ process: 'dtf', location: 'Espalda', width: 9, height: 10 }]);
  assert.equal(l.precioDecoPieza, 10.5);
});

test('DTF: ambos juntos = $11.50 por pieza (la segunda ubicación usa la tabla adicional)', () => {
  const l = g5000([
    { process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 },
    { process: 'dtf', location: 'Espalda', width: 9, height: 10 },
  ]);
  assert.equal(l.precioDecoPieza, 11.5);
  assert.equal(l.decoraciones.find((d) => d.location === 'Espalda').precioPieza, 10.5, 'la espalda es la 1ª ubicación');
  assert.equal(l.decoraciones.find((d) => d.location === 'Pecho izquierdo').precioPieza, 1.0, 'el pecho es adicional');
});

test('DTF: costo interno 3×3" = $1.85 y 12×12" = $5.60', () => {
  assert.equal(costoDtf(3, 3, cfg), 1.85);
  assert.equal(costoDtf(12, 12, cfg), 5.6);
});

test('Prenda de $4.00 → $8.80 escalonado y $8.00 fijo; prenda de $10.00 → $20.00', () => {
  assert.equal(precioPrenda(4, cfg).precio, 8.8);
  assert.equal(precioPrenda(4, fijo).precio, 8.0);
  assert.equal(precioPrenda(10, cfg).precio, 20.0);
  assert.equal(precioPrenda(10, fijo).precio, 20.0);
  assert.equal(precioPrenda(5, cfg).precio, 10.0, '$5.00 exacto ya es ×2.00');
});

test('Excepciones por producto: porcentaje propio y precio fijo', () => {
  assert.equal(precioPrenda(4, cfg, { tipo: 'porcentaje', valor: 50 }).precio, 6.0);
  assert.equal(precioPrenda(null, cfg, { tipo: 'precio_fijo', valor: 12.5 }).precio, 12.5);
});

test('Bordado: 10 prendas con un logo = $45.00; con dos ubicaciones = $90.00', () => {
  const uno = calcularLinea({ description: 'Polo', qty: 10, unit_cost: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }, cfg);
  assert.equal(uno.porProceso.bordado.venta, 45.0);
  const dos = calcularLinea({ description: 'Polo', qty: 10, unit_cost: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }, { process: 'bordado', location: 'Manga' }] }, cfg);
  assert.equal(dos.porProceso.bordado.venta, 90.0);
});

test('Bordado: tabla lista para rangos de puntadas y cantidad', () => {
  const c = structuredClone(cfg);
  c.bordado.filas = [
    { puntadasHasta: 5000, cantidadDesde: 1, costo: 2, precio: 4.5 }, { puntadasHasta: 5000, cantidadDesde: 48, costo: 1.8, precio: 4 },
    { puntadasHasta: 10000, cantidadDesde: 1, costo: 3, precio: 6 }, { puntadasHasta: null, cantidadDesde: 1, costo: 5, precio: 9 },
  ];
  assert.equal(tarifaBordado(c, 10, 4000).precio, 4.5);
  assert.equal(tarifaBordado(c, 60, 4000).precio, 4);
  assert.equal(tarifaBordado(c, 10, 8000).precio, 6);
  assert.equal(tarifaBordado(c, 10, 20000).precio, 9);
});

test('La decoración no lleva el markup de prendas y el precio manual queda marcado', () => {
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, price_mode: 'manual', manual_price: 7, decorations: [{ process: 'bordado', location: 'Frente' }] }, cfg);
  assert.equal(l.manual, true);
  assert.equal(l.prenda.venta, 70);
  assert.equal(l.porProceso.bordado.venta, 45);
});

test('Heat transfer sin tarifa: costo y precio pendientes, nunca cero', () => {
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'heat_transfer', location: 'Frente', sheets: 1 }] }, cfg);
  assert.equal(l.costo, null);
  assert.ok(l.faltantesCosto.some((f) => f.includes('Heat Transfer')));
});

test('Comisión 25% sobre venta neta: no incluye envío ni impuesto', () => {
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'bordado', location: 'Frente' }] }, cfg);
  const r = calcularRentabilidad({ lineas: [l], envioCobrado: 15, costoEnvio: 12, tasaImpuesto: 0.06, regla: { nombre: 'Bryan ventas', base: 'venta_neta', tasa: 0.25 }, margen: cfg.margen });
  assert.equal(r.ventaProductos, 133); // 88 prendas + 45 bordado
  assert.equal(r.impuesto, round(0.06 * (133 + 15)));
  assert.equal(r.comision.base, 133);
  assert.equal(r.comision.monto, 33.25);
});

function round(n) { return Math.round(n * 100) / 100; }
