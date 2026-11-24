// Mensajería con Twilio (texto y WhatsApp) contra un simulador. Sin claves no sale nada; los automáticos están apagados por defecto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';
import { telefonoE164 } from '../server/messaging.js';

const PUERTO = 4800 + Math.floor(Math.random() * 90);
let conTwilio, sinTwilio, mock, cliente;
const recibidos = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(cuerpo));
      recibidos.push({ url: req.url, auth: req.headers.authorization, ...f });
      res.setHeader('content-type', 'application/json');
      if (f.To?.endsWith('0000')) { res.statusCode = 400; return res.end(JSON.stringify({ code: 21610, message: 'unsubscribed' })); }
      res.statusCode = 201; res.end(JSON.stringify({ sid: 'SM123', status: 'queued' }));
    });
  });
  await new Promise((r) => mock.listen(PUERTO, r));
  conTwilio = await startServer({ env: { SEED_DEMO: '0', TWILIO_BASE_URL: `http://localhost:${PUERTO}`, TWILIO_ACCOUNT_SID: 'ACprueba', TWILIO_AUTH_TOKEN: 'token-NO-real', TWILIO_FROM: '+13015550000', TWILIO_WHATSAPP_FROM: '+13015551111' } });
  sinTwilio = await startServer({ env: { SEED_DEMO: '0', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' } });
  cliente = await conTwilio.duena.post('/contacts', { name: 'Ana', phone: '(301) 555-0101', email: 'ana@x.com' });
});
after(() => { conTwilio.stop(); sinTwilio.stop(); mock.close(); });

test('teléfonos a formato internacional (EE. UU. por defecto)', () => {
  assert.equal(telefonoE164('(301) 555-0101'), '+13015550101');
  assert.equal(telefonoE164('1-301-555-0101'), '+13015550101');
  assert.equal(telefonoE164('+57 300 123 4567'), '+573001234567');
  assert.equal(telefonoE164('555-0101'), null);
});

test('sin claves de Twilio no sale nada: el mensaje solo queda anotado', async () => {
  const c = await sinTwilio.duena.post('/contacts', { name: 'Beto', phone: '3015550102' });
  const a = await sinTwilio.duena.post(`/contacts/${c.id}/activities`, { type: 'sms', direction: 'saliente', body: 'Hola' });
  assert.equal(a.enviado, false);
  assert.match(a.status, /registrado \(texto sin conectar\)/);
  assert.deepEqual((await sinTwilio.duena.get('/meta')).integrations.mensajes, { sms: false, whatsapp: false, email: false });
});

test('con Twilio: texto y WhatsApp salen con el número correcto y queda el estado en la conversación', async () => {
  const antes = recibidos.length;
  const sms = await conTwilio.duena.post(`/contacts/${cliente.id}/activities`, { type: 'sms', direction: 'saliente', body: 'Tu orden está lista' });
  assert.equal(sms.enviado, true);
  assert.equal(sms.status, 'enviado');
  const wa = await conTwilio.duena.post(`/contacts/${cliente.id}/activities`, { type: 'whatsapp', direction: 'saliente', body: 'Hola por WhatsApp' });
  assert.equal(wa.status, 'enviado');
  const [m1, m2] = recibidos.slice(antes);
  assert.match(m1.url, /\/Accounts\/ACprueba\/Messages\.json$/);
  assert.equal(m1.auth, `Basic ${Buffer.from('ACprueba:token-NO-real').toString('base64')}`);
  assert.deepEqual([m1.To, m1.From, m1.Body], ['+13015550101', '+13015550000', 'Tu orden está lista']);
  assert.deepEqual([m2.To, m2.From], ['whatsapp:+13015550101', 'whatsapp:+13015551111']);
  // El email todavía no está conectado: se anota y lo dice
  const em = await conTwilio.duena.post(`/contacts/${cliente.id}/activities`, { type: 'email', direction: 'saliente', body: 'Hola' });
  assert.match(em.status, /email aún no está conectado/);
  // Una nota interna no envía nada
  await conTwilio.duena.post(`/contacts/${cliente.id}/activities`, { type: 'nota', body: 'nota' });
  assert.equal(recibidos.length, antes + 2);
});

test('errores claros: cliente que pidió no recibir mensajes y teléfono inválido; las claves no salen en la respuesta ni en los logs', async () => {
  const stop = await conTwilio.duena.post('/contacts', { name: 'Stop', phone: '3015550000' });
  const a = await conTwilio.duena.post(`/contacts/${stop.id}/activities`, { type: 'sms', direction: 'saliente', body: 'Hola' });
  assert.equal(a.enviado, false);
  assert.match(a.status, /pidió no recibir mensajes/);
  const malo = await conTwilio.duena.post('/contacts', { name: 'Malo', phone: '555' });
  const b = await conTwilio.duena.post(`/contacts/${malo.id}/activities`, { type: 'sms', direction: 'saliente', body: 'Hola' });
  assert.match(b.status, /teléfono del cliente no es válido/);
  assert.ok(!conTwilio.salida().includes('token-NO-real') && !conTwilio.salida().includes('3015550000') && !conTwilio.salida().includes('Hola'), 'ni la clave, ni el teléfono, ni el texto van al log');
});

test('prueba de envío y avisos automáticos: solo el dueño; los automáticos vienen apagados', async () => {
  const e = await conTwilio.duena.get('/mensajes/estado');
  assert.deepEqual(e, { canales: { sms: true, whatsapp: true, email: false }, automatico: false });
  const p = await conTwilio.duena.post('/mensajes/prueba', { canal: 'sms', telefono: '301-555-0199' });
  assert.equal(p.ok, true);
  assert.equal(recibidos.at(-1).To, '+13015550199');
  assert.equal((await conTwilio.duena.call('POST', '/mensajes/prueba', { canal: 'sms', telefono: '12' })).status, 400);
  const v = await conTwilio.userWithRole('ventas');
  assert.equal((await v.call('POST', '/mensajes/prueba', { canal: 'sms', telefono: '3015550199' })).status, 403);
  assert.equal((await v.call('PUT', '/mensajes/automatico', { activo: true })).status, 403);

  // Automatización «orden lista → SMS»: apagada no envía; prendida sí
  const prod = await conTwilio.duena.post('/products', { sku: 'A1', name: 'Tee', base_cost: 4, sizes: ['M'], colors: ['Black'] });
  const q = await conTwilio.duena.post('/jobs', { title: 'Auto', contact_id: cliente.id, items: [{ product_id: prod.id, sizes: { M: 5 } }] });
  await conTwilio.duena.post(`/jobs/${q.id}/convert`);
  await conTwilio.duena.post('/automations', { name: 'Orden lista → SMS', trigger: 'order.status_changed', condition: { to: 'listo' }, action: 'send_sms', params: { message: 'Tu orden {{job.order_number}} está lista' } });
  let antes = recibidos.length;
  await conTwilio.duena.post(`/jobs/${q.id}/status`, { status: 'listo' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(recibidos.length, antes, 'automático apagado: no sale nada');
  const ficha = await conTwilio.duena.get(`/contacts/${cliente.id}`);
  assert.ok(ficha.activities.some((x) => /envío automático apagado/.test(x.status || '')));
  await conTwilio.duena.put('/mensajes/automatico', { activo: true });
  antes = recibidos.length;
  await conTwilio.duena.post(`/jobs/${q.id}/status`, { status: 'calidad' });
  await conTwilio.duena.post(`/jobs/${q.id}/status`, { status: 'listo' });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(recibidos.length, antes + 1, 'automático prendido: sale el aviso');
  assert.ok((await conTwilio.duena.get(`/contacts/${cliente.id}`)).activities.some((x) => x.status === 'enviado · auto'));
});
