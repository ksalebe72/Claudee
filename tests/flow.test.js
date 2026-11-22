// Prueba de punta a punta: cotización -> portal -> orden -> arte -> pago, con automatizaciones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'taller-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORT}/api`;
let srv;
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};

before(async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, DB_PATH: join(dir, 't.db') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(B + '/meta'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => { srv.kill(); rmSync(dir, { recursive: true, force: true }); });

test('flujo completo con automatizaciones', async () => {
  const contact = await call('POST', '/contacts', { name: 'Prueba', phone: '555', email: 'p@x.com', opportunity: { title: 'Camisetas', value: 500 } });
  const opp = (await call('GET', '/opportunities')).find((o) => o.contact_id === contact.id);
  const tasks = await call('GET', '/tasks');
  assert.ok(tasks.some((t) => t.contact_id === contact.id), 'tarea de seguimiento automática');

  const products = await call('GET', '/products');
  let job = await call('POST', '/jobs', {
    contact_id: contact.id, opportunity_id: opp.id, title: 'Camisetas',
    items: [{ product_id: products[0].id, sizes: { M: 30 }, decorations: [{ method: 'dtf', location: 'Frente', colors: 1 }] }],
  });
  assert.equal(job.kind, 'quote');
  assert.ok(job.total > 0);

  job = await call('POST', `/jobs/${job.id}/send`);
  assert.equal(job.status, 'enviada');

  let portal = await call('POST', `/portal/${job.token}/quote`, { approved: true });
  assert.equal(portal.kind, 'order', 'la aprobación convierte en orden');
  assert.equal(portal.status, 'arte');
  assert.equal((await call('GET', '/opportunities')).find((o) => o.id === opp.id).stage, 'ganado');

  job = await call('POST', `/jobs/${job.id}/proofs`, { file: 'data:image/png;base64,iVBORw0KGgo=', filename: 'a.png' });
  assert.equal(job.status, 'aprobacion');
  portal = await call('POST', `/portal/${job.token}/proofs/${job.proofs[0].id}`, { status: 'aprobada' });
  assert.equal(portal.status, 'compras', 'prueba aprobada pasa a compras');

  job = await call('POST', `/jobs/${job.id}/payments`, { amount: job.total, method: 'tarjeta' });
  assert.equal(job.balance, 0);
  const c = await call('GET', `/contacts/${contact.id}`);
  assert.ok(c.tags.includes('cliente'));
  assert.ok(c.activities.some((a) => a.type === 'sms'), 'se registraron SMS automáticos');
});
