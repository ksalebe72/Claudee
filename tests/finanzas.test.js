// Pruebas de punta a punta del módulo de costos, rentabilidad y comisiones (contra la API real de la app).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s, duena, finanzas, gerencia, ventas;
let bryan, isabel, reglas;
const regla = (nombre) => reglas.find((r) => r.name === nombre).id;
const r2 = (n) => Math.round(n * 100) / 100;

before(async () => {
  s = await startServer({ env: { SEED_DEMO: '0' } });
  duena = s.duena;
  finanzas = await s.userWithRole('finanzas');
  gerencia = await s.userWithRole('gerencia');
  ventas = await s.userWithRole('ventas');
  const vendedores = await duena.get('/vendedores');
  bryan = vendedores.find((v) => v.name === 'Bryan').id;
  isabel = vendedores.find((v) => v.name === 'Isabel').id;
  reglas = await duena.get('/comisiones/reglas');
});
after(() => s.stop());

async function producto(datos) {
  return duena.post('/products', { category: 'Camisetas', supplier: 'SanMar', sizes: ['S', 'M', 'L', 'XL'], colors: ['Negro'], ...datos });
}
async function contacto(nombre) { return duena.post('/contacts', { name: nombre, company: `${nombre} Inc` }); }

/** Crea una cotización, la aprueba si hace falta y la convierte en orden. */
async function orden(datos, { aprobar = true } = {}) {
  const q = await duena.post('/jobs', datos);
  if (aprobar && q.finanzas.aprobacion.requerida) await duena.post(`/jobs/${q.id}/aprobar-margen`, { nota: 'Prueba' });
  return duena.post(`/jobs/${q.id}/convert`);
}

test('Prueba DTF: Gildan 5000 · 12 piezas · $6.00, $10.50 y $11.50 por pieza', async () => {
  const g = await producto({ sku: 'G5000', name: 'Gildan 5000', base_cost: 3.1 });
  const linea = (decorations) => ({ product_id: g.id, color: 'Negro', sizes: { M: 6, L: 6 }, decorations });
  const q = await duena.post('/jobs', {
    title: 'DTF', items: [
      linea([{ process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 }]),
      linea([{ process: 'dtf', location: 'Espalda', width: 9, height: 10 }]),
      linea([{ process: 'dtf', location: 'Pecho izquierdo', width: 3.5, height: 3.5 }, { process: 'dtf', location: 'Espalda', width: 9, height: 10 }]),
    ],
  });
  assert.deepEqual(q.items.map((i) => i.calc.precioDecoPieza), [6.0, 10.5, 11.5]);
});

test('Prendas: $4.00 → $8.80 (escalonado) y $8.00 (fijo); $10.00 → $20.00. Bordado 10 pzs: $75 y $150', async () => {
  const p4 = await producto({ sku: 'P4', name: 'Prenda $4', base_cost: 4 });
  const p10 = await producto({ sku: 'P10', name: 'Prenda $10', base_cost: 10 });
  const q = await duena.post('/jobs', { title: 'Markup', items: [{ product_id: p4.id, qty: 1 }, { product_id: p10.id, qty: 1 }] });
  assert.deepEqual(q.items.map((i) => i.calc.prenda.tallas[0].precio), [8.8, 20.0]);

  const t = await duena.get('/tarifas');
  const fijo = structuredClone(t.config);
  fijo.prendas.modo = 'fijo';
  await duena.put('/tarifas', { config: fijo, nota: 'Prueba modo fijo' });
  const q2 = await duena.post('/jobs', { title: 'Markup fijo', items: [{ product_id: p4.id, qty: 1 }, { product_id: p10.id, qty: 1 }] });
  assert.deepEqual(q2.items.map((i) => i.calc.prenda.tallas[0].precio), [8.0, 20.0]);
  const otraVez = await duena.get(`/jobs/${q.id}`);
  assert.equal(otraVez.items[0].calc.prenda.tallas[0].precio, 8.8, 'la cotización guardada conserva su precio');
  await duena.put('/tarifas', { config: t.config, nota: 'Volver a escalonado' });

  const b1 = await duena.post('/jobs', { title: 'Bordado', items: [{ product_id: p10.id, qty: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }] });
  assert.equal(b1.finanzas.porProceso.bordado.venta, 75.0);
  const b2 = await duena.post('/jobs', { title: 'Bordado 2', items: [{ product_id: p10.id, qty: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }, { process: 'bordado', location: 'Espalda' }] }] });
  assert.equal(b2.finanzas.porProceso.bordado.venta, 150.0);
});

test('Ajustes: solo el dueño cambia tarifas y queda historial con antes y después', async () => {
  const t = await duena.get('/tarifas');
  const cfg = structuredClone(t.config);
  cfg.dtf.costoAplicacion = 1.75;
  assert.equal((await gerencia.call('PUT', '/tarifas', { config: cfg })).status, 403);
  assert.equal((await finanzas.call('PUT', '/tarifas', { config: cfg })).status, 403);
  await duena.put('/tarifas', { config: cfg, nota: 'Sube aplicación DTF' });
  const hist = await duena.get('/auditoria?area=tarifas');
  const c = hist.find((h) => h.field === 'dtf.costoAplicacion');
  assert.equal(c.user_name, 'Dueño');
  assert.equal(JSON.parse(c.old_value), 1.6);
  assert.equal(JSON.parse(c.new_value), 1.75);
  assert.equal((await ventas.call('GET', '/auditoria')).status, 403);
  cfg.dtf.costoAplicacion = 1.6;
  await duena.put('/tarifas', { config: cfg });
});

test('Comisión de Bryan 25%: el envío y el impuesto no entran en la base', async () => {
  const p = await producto({ sku: 'T4', name: 'Tee $4', base_cost: 4 });
  const c = await contacto('Cliente Bryan');
  const q = await duena.post('/jobs', {
    contact_id: c.id, title: 'Bryan', salesperson_id: bryan, commission_rule_id: regla('Bryan · Ventas'),
    shipping_charged: 15, shipping_cost: 12,
    items: [{ product_id: p.id, qty: 10, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }],
  });
  const f = q.finanzas;
  assert.equal(f.ventaProductos, 163); // 10 × $8.80 + 10 × $7.50
  assert.equal(f.envioCobrado, 15);
  assert.equal(f.impuesto, r2((163 + 15) * 0.06));
  assert.equal(f.comision.base, 163, 'la base es solo la venta neta de productos');
  assert.equal(f.comision.monto, 40.75);
  assert.equal(f.total, r2(163 + 15 + f.impuesto)); // productos + envío + impuesto
});

test('Diseño/Digitalizado y servicios no comisionables quedan fuera de la base', async () => {
  const p = await producto({ sku: 'T5', name: 'Tee $5', base_cost: 5 });
  const web = (await duena.get('/products')).find((x) => x.sku === 'WEB-MES');
  const q = await duena.post('/jobs', {
    title: 'Con diseño', salesperson_id: bryan, commission_rule_id: regla('Bryan · Ventas'),
    items: [
      { product_id: p.id, qty: 10 }, // 10 × $10 = $100
      { line_type: 'diseno', description: 'Diseño/Digitalizado', qty: 1, unit_price: 35, unit_cost: 0 },
      { product_id: web.id, qty: 1, unit_price: 50, unit_cost: 10, line_type: 'servicio' },
    ],
  });
  assert.equal(q.finanzas.ventaProductos, 185);
  assert.equal(q.finanzas.comision.base, 100);
  assert.equal(q.finanzas.comision.monto, 25);
});

test('Orden con costo faltante: rentabilidad y comisión «incompletas», nunca $0', async () => {
  const p = await producto({ sku: 'SINCOSTO', name: 'Sin costo', base_cost: null });
  const q = await duena.post('/jobs', {
    title: 'Falta costo', salesperson_id: bryan, commission_rule_id: regla('Bryan · Wraps'),
    items: [{ product_id: p.id, qty: 10, price_mode: 'manual', manual_price: 12, decorations: [{ process: 'heat_transfer', location: 'Frente', sheets: 1, manual_price: 3 }] }],
  });
  const f = q.finanzas;
  assert.equal(f.incompleta, true);
  assert.equal(f.semaforo, 'incompleta');
  assert.equal(f.gananciaProducto, null);
  assert.equal(f.contribucion, null);
  assert.equal(f.comision.estado, 'pendiente');
  assert.equal(f.comision.monto, null);
  assert.ok(f.faltantes.some((x) => x.includes('costo de la prenda')));
  assert.ok(f.faltantes.some((x) => x.includes('Heat Transfer')));
  // Finanzas no puede confirmar costos mientras falte algo
  assert.equal((await finanzas.call('POST', `/jobs/${q.id}/confirmar-costos`, {})).status, 400);
  // Al llegar la factura del proveedor, el costo real completa la orden
  await finanzas.post(`/jobs/${q.id}/costos-reales`, { category: 'prendas', supplier: 'SanMar', invoice_ref: 'INV-1', amount: 45 });
  const f2 = await finanzas.post(`/jobs/${q.id}/costos-reales`, { category: 'heat_transfer', supplier: 'Halftone', invoice_ref: 'H-9', amount: 12 });
  assert.equal(f2.incompleta, false);
  assert.equal(f2.comision.estado, 'calculada');
  assert.equal(f2.gananciaProducto, 150 - 57);
});

test('Contribución negativa: pide excepción del dueño; gerencia no puede darla', async () => {
  const p = await producto({ sku: 'CARA', name: 'Prenda cara', base_cost: 20 });
  const q = await duena.post('/jobs', { title: 'Pérdida', items: [{ product_id: p.id, qty: 10, price_mode: 'manual', manual_price: 10 }] });
  assert.equal(q.finanzas.semaforo, 'rojo');
  assert.equal(q.finanzas.aprobacion.requerida, 'duena');
  assert.equal((await duena.call('POST', `/jobs/${q.id}/send`)).status, 409, 'no se puede enviar sin la excepción');
  assert.equal((await duena.call('POST', `/jobs/${q.id}/convert`)).status, 409);
  assert.equal((await gerencia.call('POST', `/jobs/${q.id}/aprobar-margen`, { nota: 'ok' })).status, 403);
  assert.equal((await duena.call('POST', `/jobs/${q.id}/aprobar-margen`, {})).status, 400, 'la excepción exige motivo');
  const f = await duena.post(`/jobs/${q.id}/aprobar-margen`, { nota: 'Cliente estratégico' });
  assert.equal(f.aprobacion.ok, true);
  assert.equal((await duena.call('POST', `/jobs/${q.id}/convert`)).status, 200);
});

test('Margen menor a 30%: lo aprueba gerencia', async () => {
  const p = await producto({ sku: 'BAJO', name: 'Margen bajo', base_cost: 10 });
  const q = await duena.post('/jobs', { title: 'Bajo', items: [{ product_id: p.id, qty: 10, price_mode: 'manual', manual_price: 13 }] });
  assert.equal(q.finanzas.aprobacion.requerida, 'gerencia');
  assert.ok([403, 404].includes((await ventas.call('POST', `/jobs/${q.id}/aprobar-margen`, {})).status), 'ventas no aprueba (ni ve órdenes ajenas)');
  const f = await gerencia.post(`/jobs/${q.id}/aprobar-margen`, {});
  assert.equal(f.aprobacion.ok, true);
});

test('Regla sobre ganancia negativa → comisión $0', async () => {
  const p = await producto({ sku: 'W1', name: 'Wrap', base_cost: 20 });
  const q = await duena.post('/jobs', { title: 'Wrap', salesperson_id: bryan, commission_rule_id: regla('Bryan · Wraps'), items: [{ product_id: p.id, qty: 1, price_mode: 'manual', manual_price: 10 }] });
  assert.equal(q.finanzas.comision.estado, 'calculada');
  assert.equal(q.finanzas.comision.monto, 0);
});

test('Isabel: cliente nuevo 10% y existente 5% según órdenes pagadas anteriores', async () => {
  const p = await producto({ sku: 'I1', name: 'Tee Isabel', base_cost: 5 });
  const c = await contacto('Cliente Isabel');
  const datos = { contact_id: c.id, title: 'Isabel', salesperson_id: isabel, commission_rule_id: regla('Isabel · Cliente nuevo'), items: [{ product_id: p.id, qty: 10 }] };
  const o1 = await orden(datos);
  assert.equal(o1.client_status, 'nuevo');
  assert.equal(o1.finanzas.comision.tasa, 0.1);
  await duena.post(`/jobs/${o1.id}/payments`, { amount: o1.total, method: 'tarjeta' });
  const q2 = await duena.post('/jobs', datos);
  assert.equal(q2.client_status, 'existente');
  assert.equal(q2.finanzas.comision.tasa, 0.05, 'la regla cambia sola a cliente existente');
  const q3 = await duena.put(`/jobs/${q2.id}`, { client_status: 'nuevo' });
  assert.equal(q3.finanzas.comision.tasa, 0.1, 'se puede corregir a mano');
});

test('Factura cobrada en dos partes: entra a liquidación solo cuando se completa; ajuste negativo tras devolución', async () => {
  const p = await producto({ sku: 'LQ', name: 'Tee liquidación', base_cost: 5 });
  const c = await contacto('Cliente Liquidación');
  const o = await orden({ contact_id: c.id, title: 'Liquidación', salesperson_id: bryan, commission_rule_id: regla('Bryan · Ventas'), shipping_charged: 20, shipping_cost: 18, items: [{ product_id: p.id, qty: 20 }] });
  await finanzas.put(`/jobs/${o.id}`, { invoice_date: '2026-03-05' });
  await finanzas.post(`/jobs/${o.id}/confirmar-costos`, {});
  // Abono en mayo
  await duena.post(`/jobs/${o.id}/payments`, { amount: 100, method: 'transferencia', paid_at: '2026-05-10' });
  let mayo = await finanzas.get(`/liquidaciones/2026-05/${bryan}`);
  assert.equal(mayo.entradas.length, 0, 'un abono no basta');
  assert.ok(mayo.pendientes.some((x) => x.jobId === o.id && x.estado === 'pendiente de cobro'));
  // Saldo en noviembre
  const actual = await duena.get(`/jobs/${o.id}`);
  await duena.post(`/jobs/${o.id}/payments`, { amount: r2(actual.total - 100), method: 'transferencia', paid_at: '2026-11-15' });
  mayo = await finanzas.get(`/liquidaciones/2026-05/${bryan}`);
  assert.equal(mayo.entradas.length, 0, 'no entra en mayo');
  const nov = await finanzas.get(`/liquidaciones/2026-11/${bryan}`);
  const e = nov.entradas.find((x) => x.jobId === o.id);
  assert.ok(e, 'entra en la liquidación de noviembre');
  assert.equal(e.monto, 50); // 25% de $200 (20 × $10); sin envío ni impuesto
  assert.equal(e.fechaFactura, '2026-03-05');
  assert.equal(e.fechaCobroCompleto, '2026-11-15');
  assert.equal(nov.liquidacion.fechaPagoPrevista, '2026-12-15');

  // Flujo: Finanzas revisa → el dueño aprueba → se marca pagada (nadie más puede aprobar)
  assert.equal((await duena.call('POST', `/liquidaciones/2026-11/${bryan}/accion`, { accion: 'aprobar' })).status, 409, 'no se aprueba sin revisión de Finanzas');
  await finanzas.post(`/liquidaciones/2026-11/${bryan}/accion`, { accion: 'revisar' });
  assert.equal((await finanzas.call('POST', `/liquidaciones/2026-11/${bryan}/accion`, { accion: 'aprobar' })).status, 403);
  await duena.post(`/liquidaciones/2026-11/${bryan}/accion`, { accion: 'aprobar' });
  assert.equal((await finanzas.call('POST', `/liquidaciones/2026-11/${bryan}/accion`, { accion: 'pagar' })).status, 400, 'pagar exige fecha y referencia');
  const pagada = await finanzas.post(`/liquidaciones/2026-11/${bryan}/accion`, { accion: 'pagar', fecha: '2026-12-15', referencia: 'Cheque 1042' });
  assert.equal(pagada.liquidacion.status, 'pagada');
  const totalNov = pagada.total;

  // Devolución después de pagar la comisión → ajuste negativo en diciembre; noviembre no cambia
  await finanzas.post(`/jobs/${o.id}/creditos`, { type: 'devolucion', amount: 40, note: '4 prendas devueltas' });
  const novDespues = await finanzas.get(`/liquidaciones/2026-11/${bryan}`);
  assert.equal(novDespues.total, totalNov, 'una liquidación pagada nunca se edita');
  const dic = await finanzas.get(`/liquidaciones/2026-12/${bryan}`);
  const ajuste = dic.entradas.find((x) => x.jobId === o.id);
  assert.equal(ajuste.tipo, 'ajuste');
  assert.equal(ajuste.monto, -10); // 25% de $40

  // Exportaciones
  const pdf = await finanzas.call('GET', `/liquidaciones/2026-11/${bryan}/exportar.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(new TextDecoder().decode(pdf.body.slice(0, 4)), '%PDF');
  const xlsx = await finanzas.call('GET', `/liquidaciones/2026-11/${bryan}/exportar.xlsx`);
  assert.equal(xlsx.status, 200);
  assert.equal(new TextDecoder().decode(xlsx.body.slice(0, 2)), 'PK');
  assert.equal((await ventas.call('GET', `/liquidaciones/2026-11/${bryan}`)).status, 403);
});

test('Tasas con fecha de vigencia: se usa la vigente en la fecha de la factura', async () => {
  const id = regla('Bryan · Ventas');
  await duena.post(`/comisiones/reglas/${id}/tasas`, { rate: 0.2, effective_from: '2027-01-01' });
  const p = await producto({ sku: 'VG', name: 'Tee vigencia', base_cost: 5 });
  const o = await orden({ title: 'Vigencia', salesperson_id: bryan, commission_rule_id: id, items: [{ product_id: p.id, qty: 10 }] });
  assert.equal(o.finanzas.comision.tasa, 0.25, 'factura de 2026 usa 25%');
  const o2 = await finanzas.put(`/jobs/${o.id}`, { invoice_date: '2027-02-01' });
  assert.equal(o2.finanzas.comision.tasa, 0.2, 'factura de 2027 usa 20%');
  const hist = await duena.get('/auditoria?area=comisiones');
  assert.ok(hist.some((h) => h.field.includes('2027-01-01') && JSON.parse(h.old_value).tasa === 0.25 && JSON.parse(h.new_value).tasa === 0.2));
});

test('Comisión reducida de Bryan: 40% normal, 20% si la contribución queda bajo 30%; editable y con historial', async () => {
  const reglas = await duena.get('/comisiones/reglas');
  const r = reglas.find((x) => x.name === 'Bryan · Utilidad 40%');
  const vigente = r.tasas[0];
  assert.deepEqual([vigente.rate, vigente.min_contribucion, vigente.rate_reducida], [0.4, 0.3, 0.2], 'queda configurada al arrancar');

  const serv = (precio) => ({ line_type: 'servicio', description: 'Trabajo', qty: 1, unit_cost: 500, unit_price: precio });
  const buena = await duena.post('/jobs', { title: 'Margen sano', salesperson_id: bryan, commission_rule_id: r.id, tax_exempt: true, items: [serv(1000)] });
  assert.equal(buena.fin.comision.monto, 200, '50% de ganancia → 40% completo');
  const baja = await duena.post('/jobs', { title: 'Margen bajo', salesperson_id: bryan, commission_rule_id: r.id, tax_exempt: true, items: [serv(900)] });
  assert.equal(baja.fin.comision.tasa, 0.2);
  assert.equal(baja.fin.comision.monto, 80, 'bajo 30% → 20%');
  assert.equal(baja.fin.contribucion, 320);

  // Validaciones y edición
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  assert.equal((await duena.call('POST', `/comisiones/reglas/${r.id}/tasas`, { rate: 0.4, effective_from: hoy, min_contribucion: 0.3, rate_reducida: null })).status, 400, 'las dos o ninguna');
  assert.equal((await duena.call('POST', `/comisiones/reglas/${r.id}/tasas`, { rate: 0.4, effective_from: hoy, min_contribucion: 0.3, rate_reducida: 0.5 })).status, 400, 'la reducida debe ser menor');
  // Una tasa nueva sin mencionar la reducción la conserva
  const r2 = await duena.post(`/comisiones/reglas/${r.id}/tasas`, { rate: 0.45, effective_from: '2031-01-01' });
  assert.deepEqual([r2.tasas[0].rate, r2.tasas[0].min_contribucion, r2.tasas[0].rate_reducida], [0.45, 0.3, 0.2]);
  // Quitarla (las dos vacías) queda en el historial
  await duena.post(`/comisiones/reglas/${r.id}/tasas`, { rate: 0.45, effective_from: '2032-01-01', min_contribucion: null, rate_reducida: null });
  const hist = await duena.get('/auditoria?area=comisiones');
  assert.ok(hist.some((h) => h.field.includes('2032-01-01') && JSON.parse(h.old_value).tasa_reducida === 0.2 && JSON.parse(h.new_value).tasa_reducida === null));
});

test('Reportes: por orden, cliente, proceso, vendedor, bajo margen y comisiones', async () => {
  for (const agrupar of ['orden', 'cliente', 'proceso', 'vendedor']) {
    const r = await finanzas.get(`/reportes/rentabilidad?agrupar=${agrupar}&desde=2026-01-01&hasta=2027-12-31`);
    assert.ok(r.filas.length > 0, agrupar);
  }
  const bajo = await finanzas.get('/reportes/bajo-margen');
  assert.ok(bajo.filas.every((f) => f.contribucionPct < 30));
  const com = await finanzas.get('/reportes/comisiones');
  const b = com.find((x) => x.vendedor === 'Bryan');
  assert.equal(b.pagadas, 50);
  assert.equal(b.ajustes, -10);
});

test('Seguridad: sin sesión no hay acceso y la contraseña no aparece en logs', async () => {
  assert.equal((await s.anon.call('GET', '/jobs')).status, 401);
  assert.equal((await s.anon.call('GET', '/meta')).status, 401);
  assert.ok(!s.salida().includes('ClaveDuena123'));
});
