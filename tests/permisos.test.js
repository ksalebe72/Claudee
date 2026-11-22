// Quién ve qué: el vendedor solo sus clientes; logística sin costos; coordinación ve todo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s, bryan, coord, logi, idBryan, idIsabel, propio, ajeno, ordenPropia, ordenAjena, prod;

before(async () => {
  s = await startServer({ env: { SEED_DEMO: '0' } });
  const vend = await s.duena.get('/vendedores');
  idBryan = vend.find((v) => v.name === 'Bryan').id;
  idIsabel = vend.find((v) => v.name === 'Isabel').id;
  bryan = await s.userWithRole('ventas', idBryan);
  coord = await s.userWithRole('coordinacion', idIsabel);
  logi = await s.userWithRole('logistica');
  prod = await s.duena.post('/products', { sku: 'PRM', name: 'Tee permisos', base_cost: 4, sizes: ['M'], colors: ['Negro'] });
  propio = await bryan.post('/contacts', { name: 'Cliente de Bryan' });
  ajeno = await s.duena.post('/contacts', { name: 'Cliente de Isabel', salesperson_id: idIsabel });
  ordenPropia = await bryan.post('/jobs', { title: 'Orden Bryan', contact_id: propio.id, items: [{ product_id: prod.id, sizes: { M: 10 } }] });
  ordenAjena = await s.duena.post('/jobs', { title: 'Orden Isabel', contact_id: ajeno.id, salesperson_id: idIsabel, items: [{ product_id: prod.id, sizes: { M: 5 } }] });
});
after(() => s.stop());

test('roles: Dueño, Finanzas (CFO), Gerencia, Coordinación de ventas, Ventas, Logística', async () => {
  const meta = await s.duena.get('/meta');
  assert.deepEqual(Object.values(meta.roles), ['Dueño', 'Finanzas (CFO)', 'Gerencia', 'Coordinación de ventas', 'Ventas', 'Logística']);
});

test('el cliente que crea el vendedor queda a su nombre; su orden lleva su regla automática', async () => {
  assert.equal(propio.salesperson_id, idBryan);
  assert.equal(ordenPropia.salesperson_id, idBryan);
  const reglas = await s.duena.get('/comisiones/reglas');
  assert.equal(ordenPropia.commission_rule_id, reglas.find((r) => r.name === 'Bryan · Utilidad 40%').id);
});

test('Bryan solo ve sus clientes y sus órdenes', async () => {
  const contactos = await bryan.get('/contacts');
  assert.deepEqual(contactos.map((c) => c.name), ['Cliente de Bryan']);
  assert.equal((await bryan.call('GET', `/contacts/${ajeno.id}`)).status, 404);
  assert.equal((await bryan.call('PUT', `/contacts/${ajeno.id}`, { name: 'x' })).status, 404);
  assert.equal((await bryan.call('DELETE', `/contacts/${ajeno.id}`)).status, 404);

  const ordenes = await bryan.get('/jobs');
  assert.deepEqual(ordenes.map((j) => j.title), ['Orden Bryan']);
  for (const [m, u, b] of [['GET', `/jobs/${ordenAjena.id}`], ['PUT', `/jobs/${ordenAjena.id}`, { title: 'x' }], ['DELETE', `/jobs/${ordenAjena.id}`],
    ['POST', `/jobs/${ordenAjena.id}/duplicate`], ['GET', `/jobs/${ordenAjena.id}/finanzas`], ['POST', `/jobs/${ordenAjena.id}/payments`, { amount: 1 }]]) {
    assert.equal((await bryan.call(m, u, b)).status, 404, `${m} ${u}`);
  }
  // No puede crear cosas para clientes ajenos
  assert.equal((await bryan.call('POST', '/jobs', { title: 'x', contact_id: ajeno.id, items: [] })).status, 404);
  assert.equal((await bryan.call('POST', '/opportunities', { title: 'x', contact_id: ajeno.id })).status, 404);
  assert.equal((await bryan.call('POST', '/tasks', { title: 'x', contact_id: ajeno.id })).status, 404);
  assert.equal((await bryan.call('POST', '/ia/redactar', { jobId: ordenAjena.id, tipo: 'cotizacion' })).status, 404);
  // Ni cambiarse de vendedor
  const intento = await bryan.put(`/jobs/${ordenPropia.id}`, { salesperson_id: idIsabel });
  assert.equal(intento.salesperson_id, idBryan);
  const c = await bryan.put(`/contacts/${propio.id}`, { salesperson_id: idIsabel, name: 'Cliente de Bryan' });
  assert.equal(c.salesperson_id, idBryan);
});

test('el tablero de Bryan solo cuenta lo suyo', async () => {
  await s.duena.post('/opportunities', { title: 'Op ajena', contact_id: ajeno.id, value: 9999 });
  await bryan.post('/opportunities', { title: 'Op propia', contact_id: propio.id, value: 100 });
  const d = await bryan.get('/dashboard');
  assert.equal(d.pipeline.reduce((a, p) => a + p.value, 0), 100);
  const ops = await bryan.get('/opportunities');
  assert.deepEqual(ops.map((o) => o.title), ['Op propia']);
});

test('Coordinación de ventas ve a todos los clientes y puede asignarlos', async () => {
  const contactos = await coord.get('/contacts');
  assert.ok(contactos.length >= 2);
  const sinAsignar = await s.duena.post('/contacts', { name: 'Cliente nuevo sin vendedor' });
  assert.equal((await bryan.call('GET', `/contacts/${sinAsignar.id}`)).status, 404);
  await coord.put(`/contacts/${sinAsignar.id}`, { salesperson_id: idBryan });
  assert.equal((await bryan.call('GET', `/contacts/${sinAsignar.id}`)).status, 200, 'al asignarlo, Bryan ya lo ve');
  assert.equal((await coord.call('GET', `/jobs/${ordenAjena.id}`)).status, 200);
});

test('Logística ve órdenes y mueve producción, pero sin costos ni márgenes y sin cotizar', async () => {
  const orden = await s.duena.post(`/jobs/${ordenAjena.id}/convert`);
  const vista = await logi.get(`/jobs/${orden.id}`);
  assert.equal(vista.finanzas, undefined);
  assert.equal(vista.items[0].unit_cost, undefined);
  assert.equal(vista.items[0].calc.costo, undefined);
  assert.ok(vista.items[0].calc.venta > 0, 've cantidades y precios de venta');
  assert.equal((await logi.call('GET', `/jobs/${orden.id}/finanzas`)).status, 403);
  assert.equal((await logi.call('POST', '/jobs', { title: 'x', items: [] })).status, 403);
  assert.equal((await logi.call('PUT', `/jobs/${orden.id}`, { title: 'x' })).status, 403);
  assert.equal((await logi.call('GET', '/liquidaciones')).status, 403);
  assert.equal((await logi.call('POST', `/jobs/${orden.id}/payments`, { amount: 5 })).status, 403);
  const d = await logi.get('/dashboard');
  assert.equal(d.revenue, null);
  const mov = await logi.call('POST', `/jobs/${orden.id}/status`, { status: 'produccion' });
  assert.notEqual(mov.status, 403, 'puede mover la producción');
});

test('tablero y búsqueda: cada quien ve lo suyo; Logística sin montos', async () => {
  const t = await s.duena.get('/tablero?meses=6');
  assert.equal(t.serie.ordenes.length, 6);
  assert.ok(t.kpis.ventas > 0);
  assert.ok(t.avisos.some((a) => a.clave === 'margenes'), 'el dueño ve márgenes por aprobar');
  const tb = await bryan.get('/tablero?meses=6');
  assert.ok(tb.kpis.ventas < t.kpis.ventas, 'Bryan solo suma lo suyo');
  assert.equal(tb.kpis.utilidad, null, 'el vendedor no ve utilidad total');
  assert.notEqual(tb.kpis.comisiones, null, 'pero sí su comisión');
  assert.ok(!tb.avisos.some((a) => a.clave === 'margenes'));
  const tl = await logi.get('/tablero');
  assert.equal(tl.kpis, null);
  assert.equal(tl.serie, null);
  const r = await bryan.get('/buscar?q=Cliente');
  assert.deepEqual(r.contactos.map((c) => c.name).sort(), ['Cliente de Bryan', 'Cliente nuevo sin vendedor'].filter((n) => r.contactos.some((c) => c.name === n)).sort());
  assert.ok(!r.contactos.some((c) => c.name === 'Cliente de Isabel'), 'no encuentra clientes ajenos');
  assert.ok(!(await bryan.get('/buscar?q=Orden')).trabajos.some((j) => j.title === 'Orden Isabel'));
  assert.ok((await s.duena.get('/buscar?q=Orden')).trabajos.some((j) => j.title === 'Orden Isabel'));
  assert.ok(Array.isArray(await logi.get('/avisos')));
});

test('Coordinación de ventas (Ana Isabel) ve todo: liquidaciones, reportes, márgenes; aprueba márgenes bajos', async () => {
  assert.equal((await coord.call('GET', '/liquidaciones')).status, 200);
  assert.equal((await coord.call('GET', '/reportes/rentabilidad')).status, 200);
  const t = await coord.get('/tablero');
  assert.notEqual(t.kpis.utilidad, null);
  assert.notEqual(t.kpis.contribucion, null);
  assert.ok(t.avisos.some((a) => a.clave === 'margenes'));
  const bajo = await s.duena.post('/jobs', { title: 'Margen bajo coord', items: [{ product_id: prod.id, sizes: { M: 10 }, price_mode: 'manual', manual_price: 5.4 }] });
  assert.equal(bajo.finanzas.aprobacion.requerida, 'gerencia');
  const f = await coord.post(`/jobs/${bajo.id}/aprobar-margen`, {});
  assert.equal(f.aprobacion.ok, true);
  // Lo que sigue siendo solo del dueño
  assert.equal((await coord.call('PUT', '/tarifas', { config: {} })).status, 403);
  assert.equal((await coord.call('GET', '/usuarios')).status, 403);
});
