// Prueba de punta a punta: cotización -> portal -> orden -> arte -> pago, con automatizaciones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let srv, api;
const call = (method, url, body) => api[method.toLowerCase() === 'delete' ? 'del' : method.toLowerCase()](url, body);

before(async () => { srv = await startServer(); api = srv.duena; });
after(() => srv.stop());

test('flujo completo con automatizaciones', async () => {
  const contact = await call('POST', '/contacts', { name: 'Prueba', phone: '555', email: 'p@x.com', opportunity: { title: 'Camisetas', value: 500 } });
  const opp = (await api.get('/opportunities')).find((o) => o.contact_id === contact.id);
  const tasks = await api.get('/tasks');
  assert.ok(tasks.some((t) => t.contact_id === contact.id), 'tarea de seguimiento automática');

  const products = await api.get('/products');
  let job = await call('POST', '/jobs', {
    contact_id: contact.id, opportunity_id: opp.id, title: 'Camisetas',
    items: [{ product_id: products.find((p) => p.sku === 'G5000').id, sizes: { M: 30 }, decorations: [{ process: 'dtf', location: 'Frente', width: 10, height: 9 }] }],
  });
  assert.equal(job.kind, 'quote');
  assert.ok(job.total > 0);

  job = await call('POST', `/jobs/${job.id}/send`);
  assert.equal(job.status, 'enviada');

  let portal = await call('POST', `/portal/${job.token}/quote`, { approved: true });
  assert.equal(portal.kind, 'order', 'la aprobación convierte en orden');
  assert.equal(portal.status, 'arte');
  const visible = JSON.stringify(portal);
  for (const k of ['unit_cost', 'cost_total', 'size_costs', 'calc', 'finanzas', 'comision', 'costo']) assert.ok(!visible.includes(`"${k}"`), `el portal no expone ${k}`);
  assert.equal((await api.get('/opportunities')).find((o) => o.id === opp.id).stage, 'ganado');

  const design = { garment: 'tshirt', color: '#000000', placements: { Frente: { method: 'dtf', inks: 'Blanco' } }, layers: [{ id: 'a', type: 'text', text: 'HOLA' }] };
  job = await call('POST', `/jobs/${job.id}/proofs`, { file: 'data:image/png;base64,iVBORw0KGgo=', filename: 'a.png', design });
  assert.equal(job.proofs[0].has_design, 1);
  assert.deepEqual(await api.get(`/proofs/${job.proofs[0].id}/design`), design, 'el diseño se guarda para editarlo después');
  assert.equal(job.status, 'aprobacion');
  portal = await call('POST', `/portal/${job.token}/proofs/${job.proofs[0].id}`, { status: 'aprobada' });
  assert.equal(portal.status, 'compras', 'prueba aprobada pasa a compras');

  job = await call('POST', `/jobs/${job.id}/payments`, { amount: job.total, method: 'tarjeta' });
  assert.equal(job.balance, 0);
  const c = await api.get(`/contacts/${contact.id}`);
  assert.ok(c.tags.includes('cliente'));
  assert.ok(!c.activities.some((a) => a.type === 'sms' || a.type === 'email'), 'regla de Color Plus: el sistema no envía mensajes al cliente');
});
