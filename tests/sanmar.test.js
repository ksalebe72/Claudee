import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMock } from './fixtures/sanmar-mock.js';

const dir = mkdtempSync(join(tmpdir(), 'taller-sm-'));
const MOCK = 4600 + Math.floor(Math.random() * 90);
const PORT = MOCK + 100;
const B = `http://localhost:${PORT}/api`;
let srv, mock;

before(async () => {
  mock = await startMock(MOCK);
  srv = spawn(process.execPath, ['server/index.js'], {
    stdio: 'ignore',
    env: { ...process.env, PORT, DB_PATH: join(dir, 't.db'), SANMAR_ENDPOINT: `http://localhost:${MOCK}/ws`, SANMAR_CUSTOMER_NUMBER: '1', SANMAR_USERNAME: 'test', SANMAR_PASSWORD: 'x', SANMAR_EXTRA_IMAGE_HOSTS: `localhost:${MOCK}` },
  });
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/meta'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { srv.kill(); mock.close(); rmSync(dir, { recursive: true, force: true }); });

test('lee el estilo de SanMar con colores, tallas, precio e imágenes', async () => {
  const meta = await (await fetch(B + '/meta')).json();
  assert.equal(meta.integrations.sanmar, true);
  const d = await (await fetch(B + '/sanmar/style/PC54')).json();
  assert.equal(d.style, 'PC54');
  assert.equal(d.brand, 'Port & Company');
  assert.deepEqual(d.sizes, ['S', 'M', 'L', '2XL']);
  assert.equal(d.piecePrice, 2.98);
  assert.equal(d.colors.length, 3);
  assert.ok(d.colors[0].images.frontFlat && d.colors[0].images.backFlat);
});

test('descarga imágenes solo de hosts permitidos', async () => {
  const d = await (await fetch(B + '/sanmar/style/PC54')).json();
  const ok = await fetch(B + '/sanmar/image?u=' + encodeURIComponent(d.colors[0].images.frontFlat));
  assert.equal(ok.status, 200);
  const bad = await fetch(B + '/sanmar/image?u=' + encodeURIComponent('http://169.254.169.254/latest'));
  assert.equal(bad.status, 400);
});

test('estilo inexistente y áreas calibradas', async () => {
  const r = await fetch(B + '/sanmar/style/NOPE');
  assert.equal(r.status, 404);
  await fetch(B + '/sanmar/areas/PC54/flat', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Frente: { view: 'front', x: 1, y: 2, w: 3, h: 4, inW: 12 } }) });
  const d = await (await fetch(B + '/sanmar/style/PC54')).json();
  assert.equal(d.areas.flat.Frente.x, 1);
});

test('importa el estilo al catálogo', async () => {
  const p = await (await fetch(B + '/sanmar/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: 'pc54' }) })).json();
  assert.equal(p.sku, 'PC54');
  assert.equal(p.supplier, 'SanMar');
  assert.equal(p.base_cost, 2.98);
  assert.deepEqual(p.colors, ['Navy', 'Red', 'Athletic Heather']);
});
