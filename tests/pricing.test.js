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

test('DTF: la aplicación de $1.60 se cuenta una sola vez por prenda, aunque lleve varias ubicaciones', () => {
  const tres = [
    { process: 'dtf', location: 'Frente', width: 10, height: 12 },
    { process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 },
    { process: 'dtf', location: 'Manga izquierda', width: 3, height: 3 },
  ];
  const area = { ...cfg, dtf: { ...cfg.dtf, costoModo: 'area' } };
  const l = calcularLinea({ line_type: 'prenda', description: 'Gildan 5000', qty: 12, unit_cost: 3.1, decorations: tres }, area);
  const costoPieza = l.decoraciones.reduce((a, d) => a + d.costoPieza, 0);
  // material: (120 + 12.25 + 9) / 144 × $4 = $3.92 · aplicación $1.60 una vez = $5.52
  assert.equal(Math.round(costoPieza * 100) / 100, 5.52);
  assert.equal(l.decoraciones.find((d) => d.location === 'Frente').costoPieza, 4.93, 'la 1ª ubicación lleva la aplicación');
  assert.equal(l.decoraciones.find((d) => d.location === 'Pecho izquierdo').costoPieza, 0.34, 'las demás solo material');
  // Si el dueño lo cambia a «por ubicación», se cuenta en cada una
  const porUbic = calcularLinea({ line_type: 'prenda', description: 'Gildan 5000', qty: 12, unit_cost: 3.1, decorations: tres },
    { ...cfg, dtf: { ...cfg.dtf, costoModo: 'area', aplicacionPor: 'ubicacion' } });
  assert.equal(Math.round(porUbic.decoraciones.reduce((a, d) => a + d.costoPieza, 0) * 100) / 100, 8.72);
});

const conDtf = (qty, decorations) => calcularLinea({ line_type: 'prenda', description: 'PC61', qty, unit_cost: 3.18, decorations }, cfg);
const pechoYEspalda = [
  { process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 },
  { process: 'dtf', location: 'Espalda', width: 9.5, height: 12 },
];
const costoDeco = (l) => Math.round(l.decoraciones.reduce((a, d) => a + d.costo, 0) * 100) / 100;

test('DTF por hoja 12×12: 1 camiseta con pecho y espalda = 1 hoja ($4) + aplicación ($1.60) = $5.60', () => {
  assert.equal(cfg.dtf.costoModo, 'hoja');
  const l = conDtf(1, pechoYEspalda);
  assert.equal(costoDeco(l), 5.6);
  assert.match(l.decoraciones.find((d) => d.location === 'Espalda').detalle, /1 hoja/);
});

test('DTF por hoja: las hojas se cuentan para toda la línea (24 camisetas pecho+espalda = 22 hojas)', () => {
  // 24 × 126.25 in² = 3,030 in² ÷ 144 = 21.04 → 22 hojas × $4 = $88 + 24 × $1.60 = $126.40
  assert.equal(costoDeco(conDtf(24, pechoYEspalda)), 126.4);
  // 12 logos de pecho: 147 in² → 2 hojas = $8 + 12 × $1.60 = $27.20
  assert.equal(costoDeco(conDtf(12, [pechoYEspalda[0]])), 27.2);
});

test('DTF por hoja: aviso si el diseño no cabe en la hoja y costo pendiente si falta un tamaño', () => {
  const grande = conDtf(5, [{ process: 'dtf', location: 'Espalda', width: 13, height: 13 }]);
  assert.ok(grande.avisos.some((a) => a.includes('no cabe en la hoja')));
  const sinTam = conDtf(5, [pechoYEspalda[0], { process: 'dtf', location: 'Espalda' }]);
  assert.ok(sinTam.decoraciones.every((d) => d.costoPieza == null), 'nunca se toma como cero');
  assert.ok(sinTam.faltantesCosto.length >= 2);
});

test('DTF sin el salto a $25: espalda 9.5×12 = $13 (1ª) · frente + espalda = $13 + $8.50 · más grande que la hoja $18.50', () => {
  assert.equal(conDtf(24, [pechoYEspalda[1]]).precioDecoPieza, 13);
  assert.equal(conDtf(24, pechoYEspalda).precioDecoPieza, 14, 'espalda $13 + pecho adicional $1');
  assert.equal(conDtf(24, [{ process: 'dtf', location: 'Frente', width: 10, height: 12 }, pechoYEspalda[1]]).precioDecoPieza, 21.5);
  assert.equal(conDtf(24, [{ process: 'dtf', location: 'Espalda', width: 12, height: 16 }]).precioDecoPieza, 18.5);
});

test('Ajuste a meta: sube por igual prenda y decoraciones automáticas; no toca precios manuales', () => {
  const base = { line_type: 'prenda', description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] };
  const l = calcularLinea({ ...base, ajuste_pct: 0.1 }, cfg);
  assert.equal(l.prenda.tallas[0].precio, 9.68, '$8.80 + 10%');
  assert.equal(l.decoraciones[0].precioPieza, 8.25, 'bordado $7.50 + 10%');
  assert.equal(l.decoraciones[0].costoPieza, 4.5, 'el costo no cambia');
  const manual = calcularLinea({ ...base, ajuste_pct: 0.1, price_mode: 'manual', manual_price: 9, decorations: [{ process: 'bordado', location: 'Frente', manual_price: 5 }] }, cfg);
  assert.equal(manual.prenda.tallas[0].precio, 9);
  assert.equal(manual.decoraciones[0].precioPieza, 5);
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

test('Bordado ($7.50 por logo): 10 prendas con un logo = $75.00; con dos ubicaciones = $150.00', () => {
  const uno = calcularLinea({ description: 'Polo', qty: 10, unit_cost: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }, cfg);
  assert.equal(uno.porProceso.bordado.venta, 75.0);
  assert.equal(uno.porProceso.bordado.costo, 45.0, 'el costo sigue en $4.50');
  const dos = calcularLinea({ description: 'Polo', qty: 10, unit_cost: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }, { process: 'bordado', location: 'Manga' }] }, cfg);
  assert.equal(dos.porProceso.bordado.venta, 150.0);
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
  assert.equal(l.porProceso.bordado.venta, 75);
});

test('Heat transfer sin tarifa: costo y precio pendientes, nunca cero', () => {
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'heat_transfer', location: 'Frente', sheets: 1 }] }, cfg);
  assert.equal(l.costo, null);
  assert.ok(l.faltantesCosto.some((f) => f.includes('Heat Transfer')));
});

test('Comisión 25% sobre venta neta: no incluye envío ni impuesto', () => {
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'bordado', location: 'Frente' }] }, cfg);
  const r = calcularRentabilidad({ lineas: [l], envioCobrado: 15, costoEnvio: 12, tasaImpuesto: 0.06, regla: { nombre: 'Bryan ventas', base: 'venta_neta', tasa: 0.25 }, margen: cfg.margen });
  assert.equal(r.ventaProductos, 163); // 88 prendas + 75 bordado
  assert.equal(r.impuesto, round(0.06 * (163 + 15)));
  assert.equal(r.comision.base, 163);
  assert.equal(r.comision.monto, 40.75);
});

function round(n) { return Math.round(n * 100) / 100; }

test('Digitalizado: costo $25 y precio $50 en la matriz; la línea no comisiona', () => {
  assert.deepEqual(cfg.bordado.digitalizado, { costo: 25, precio: 50 });
  const l = calcularLinea({ line_type: 'diseno', description: 'Digitalizado de logo para bordado (primera vez)', qty: 1, unit_price: 50, unit_cost: 25 }, cfg);
  assert.equal(l.venta, 50);
  assert.equal(l.costo, 25);
  assert.equal(l.comisionable, false);
});

test('Comisión sobre ganancia: un costo real de una categoría no cotizada también se resta (caso OT-2003)', () => {
  // Orden cotizada solo con DTF; luego llega una factura real de bordado que no estaba cotizada
  const l = calcularLinea({ description: 'Tee', qty: 10, unit_cost: 4, decorations: [{ process: 'dtf', location: 'Frente', width: 4, height: 4 }] }, cfg);
  assert.ok(!('bordado' in l.costosPorCategoria));
  const regla = { nombre: 'Bryan · Utilidad 40%', base: 'ganancia_producto', tasa: 0.4 };
  const r = calcularRentabilidad({ lineas: [l], reales: { bordado: 30 }, regla, margen: cfg.margen });
  assert.equal(r.comision.base, r.gananciaProducto, 'la base es la ganancia de producto con el costo real incluido');
  assert.equal(r.comision.monto, round(r.gananciaProducto * 0.4));
  assert.ok(r.contribucion >= r.comision.monto, 'sin envío ni líneas sin comisión, a Color Plus le queda más que al vendedor');
});

test('Comisión reducida por margen bajo: se mide con la tasa normal; 40% → 20% bajo 30% de contribución', () => {
  const regla = { nombre: 'Bryan · Utilidad 40%', base: 'ganancia_producto', tasa: 0.4, minContribucion: 0.3, tasaReducida: 0.2 };
  const linea = (precio) => calcularLinea({ line_type: 'servicio', description: 'Trabajo', qty: 1, unit_cost: 500, unit_price: precio }, cfg);
  // Venta 1000, costo 500 → ganancia 500; normal: comisión 200, contribución 300 = 30% → NO se reduce (justo en el mínimo)
  const ok = calcularRentabilidad({ lineas: [linea(1000)], regla, margen: cfg.margen });
  assert.equal(ok.gananciaBruta, 500);
  assert.equal(ok.comision.monto, 200);
  assert.equal(ok.comision.reducida, undefined);
  // Venta 900, costo 500 → ganancia 400; normal: comisión 160, contribución 240 = 26.67% → se reduce a 20% = 80
  const bajo = calcularRentabilidad({ lineas: [linea(900)], regla, margen: cfg.margen });
  assert.equal(bajo.comision.tasa, 0.2);
  assert.equal(bajo.comision.monto, 80);
  assert.equal(bajo.contribucion, 320);
  assert.equal(bajo.comision.reducida.montoNormal, 160);
  assert.match(bajo.comision.motivo, /Margen bajo/);
  // «Ajustar a meta» mide sin la reducción
  assert.equal(calcularRentabilidad({ lineas: [linea(900)], regla, margen: cfg.margen, sinReduccion: true }).comision.monto, 160);
  // Sin configuración de reducción no cambia nada
  assert.equal(calcularRentabilidad({ lineas: [linea(900)], regla: { ...regla, minContribucion: null, tasaReducida: null }, margen: cfg.margen }).comision.monto, 160);
});
