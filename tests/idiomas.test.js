// Idioma del cliente: facturas, cotizaciones y proofs en español o inglés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { textos, estadoCliente, procesoCliente, ubicacionCliente, fechaCliente } from '../shared/idiomas.js';

let s, prod;
before(async () => {
  s = await startServer({ env: { SEED_DEMO: '0' } });
  prod = await s.duena.post('/products', { sku: 'IDM', name: 'Tee', base_cost: 4, sizes: ['M'], colors: ['Black'] });
});
after(() => s.stop());

test('textos del cliente en los dos idiomas', () => {
  assert.equal(textos('en').factura, 'Invoice');
  assert.equal(textos('es').factura, 'Factura');
  assert.equal(textos('xx').factura, 'Factura', 'idioma desconocido = español');
  assert.equal(estadoCliente('produccion', 'en'), 'In production');
  assert.equal(procesoCliente('bordado', 'en'), 'Embroidery');
  assert.equal(procesoCliente('Bordado', 'en'), 'Embroidery');
  assert.equal(ubicacionCliente('Pecho izquierdo', 'en'), 'Left chest');
  assert.equal(ubicacionCliente('Espalda alta', 'en'), 'Espalda alta', 'lo escrito a mano no se cambia');
  assert.match(fechaCliente('2026-12-15', 'en'), /Dec/);
  // Todas las claves existen en ambos idiomas
  assert.deepEqual(Object.keys(textos('en')).sort(), Object.keys(textos('es')).sort());
});

test('el portal sale en el idioma del cliente; la orden puede cambiarlo', async () => {
  const c = await s.duena.post('/contacts', { name: 'John Smith', company: 'Acme Gym', idioma: 'en' });
  assert.equal(c.idioma, 'en');
  const q = await s.duena.post('/jobs', { title: 'Staff tees', contact_id: c.id, items: [{ product_id: prod.id, sizes: { M: 10 }, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }] });
  const portal = async (job) => (await fetch(`${s.B}/portal/${job.token}`)).json();
  let p = await portal(q);
  assert.equal(p.idioma, 'en', 'toma el del cliente');
  assert.equal(p.items[0].decorations[0].process, 'bordado');
  assert.ok(!JSON.stringify(p).includes('unit_cost'), 'el portal sigue sin costos');

  await s.duena.put(`/jobs/${q.id}`, { idioma: 'es' });
  assert.equal((await portal(q)).idioma, 'es', 'la orden lo cambia solo para ella');
  await s.duena.put(`/jobs/${q.id}`, { idioma: '' });
  assert.equal((await portal(q)).idioma, 'en', 'vacío = vuelve al del cliente');
  await s.duena.put(`/jobs/${q.id}`, { idioma: 'fr' });
  assert.equal((await portal(q)).idioma, 'en', 'valores raros se ignoran');

  const es = await s.duena.post('/contacts', { name: 'Cliente Local' });
  assert.equal(es.idioma, 'es', 'por defecto español');
  const raro = await s.duena.put(`/contacts/${es.id}`, { idioma: 'zz' });
  assert.equal(raro.idioma, 'es');
  const q2 = await s.duena.post('/jobs', { title: 'Camisas', contact_id: es.id, idioma: 'en', items: [] });
  assert.equal((await portal(q2)).idioma, 'en', 'se puede elegir al crear');
});
