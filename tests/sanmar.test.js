// Endpoints internos de la app sobre el simulador de SanMar.
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
let srv, mock, salida = '';
const json = async (url, opts) => { const r = await fetch(B + url, opts); return { status: r.status, body: await r.json() }; };

before(async () => {
  mock = await startMock(MOCK);
  srv = spawn(process.execPath, ['server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT, DB_PATH: join(dir, 't.db'), SANMAR_BASE_URL: `http://localhost:${MOCK}`, SANMAR_CUSTOMER_NUMBER: '1', SANMAR_USERNAME: 'test', SANMAR_PASSWORD: 'ClaveDePrueba123', SANMAR_EXTRA_IMAGE_HOSTS: `localhost:${MOCK}` },
  });
  srv.stdout.on('data', (d) => (salida += d));
  srv.stderr.on('data', (d) => (salida += d));
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/meta'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { srv.kill(); mock.close(); rmSync(dir, { recursive: true, force: true }); });

test('GET /api/sanmar/style/:estilo', async () => {
  const meta = (await json('/meta')).body;
  assert.equal(meta.integrations.sanmar, true);
  assert.equal(meta.settings.sanmar_markup, 1);
  const { status, body } = await json('/sanmar/style/PC61');
  assert.equal(status, 200);
  assert.equal(body.estilo, 'PC61');
  assert.equal(body.colores.length, 3);
  assert.ok(body.colores[0].fotos.frente);
});

test('GET /api/sanmar/style/:estilo/:color con precio de venta = costo × 2', async () => {
  const { status, body } = await json('/sanmar/style/PC61/Navy');
  assert.equal(status, 200);
  assert.equal(body.markup, 1);
  const s = body.tallas.find((t) => t.talla === 'S');
  assert.equal(s.costo, 3.18);
  assert.equal(s.precioVenta, 6.36);
  assert.equal(s.inventario, 300);
  assert.equal(s.almacenes.length, 3);
});

test('el markup es configurable', async () => {
  await fetch(B + '/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sanmar_markup: 0.5 }) });
  const { body } = await json('/sanmar/style/PC61/Navy');
  assert.equal(body.tallas[0].precioVenta, 4.77);
  await fetch(B + '/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sanmar_markup: 1 }) });
});

test('errores con código claro', async () => {
  const a = await json('/sanmar/style/NOEXISTE');
  assert.equal(a.status, 404);
  assert.equal(a.body.codigo, 'NO_ENCONTRADO');
  const b = await json('/sanmar/style/PC61/Morado');
  assert.equal(b.status, 404);
});

test('fotos solo de hosts permitidos', async () => {
  const { body } = await json('/sanmar/style/PC61');
  assert.equal((await fetch(B + '/sanmar/image?u=' + encodeURIComponent(body.colores[0].fotos.frente))).status, 200);
  assert.equal((await fetch(B + '/sanmar/image?u=' + encodeURIComponent('http://169.254.169.254/latest'))).status, 400);
});

test('importa el estilo al catálogo con el costo de la cuenta', async () => {
  const { body: p } = await json('/sanmar/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: 'pc61', category: 'Camisetas' }) });
  assert.equal(p.sku, 'PC61');
  assert.equal(p.supplier, 'SanMar');
  assert.equal(p.base_cost, 3.18);
  assert.deepEqual(p.colors, ['Jet Black', 'Navy', 'Athletic Heather']);
});

test('la contraseña nunca aparece en los logs del servidor', () => {
  assert.ok(!salida.includes('ClaveDePrueba123'));
});
