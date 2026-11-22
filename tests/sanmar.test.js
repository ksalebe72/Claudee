// Endpoints internos de la app sobre el simulador de SanMar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './fixtures/sanmar-mock.js';
import { startServer } from './helpers.js';

const MOCK = 4600 + Math.floor(Math.random() * 90);
let srv, mock, api;
const json = async (url, opts = {}) => {
  const r = await api.call(opts.method || 'GET', url, opts.body ? JSON.parse(opts.body) : undefined);
  return { status: r.status, body: r.body };
};

before(async () => {
  mock = await startMock(MOCK);
  srv = await startServer({ env: { SANMAR_BASE_URL: `http://localhost:${MOCK}`, SANMAR_CUSTOMER_NUMBER: '1', SANMAR_USERNAME: 'test', SANMAR_PASSWORD: 'ClaveDePrueba123', SANMAR_EXTRA_IMAGE_HOSTS: `localhost:${MOCK}` } });
  api = srv.duena;
});
after(() => { srv.stop(); mock.close(); });

test('GET /api/sanmar/style/:estilo', async () => {
  const meta = (await json('/meta')).body;
  assert.equal(meta.integrations.sanmar, true);
  const { status, body } = await json('/sanmar/style/PC61');
  assert.equal(status, 200);
  assert.equal(body.estilo, 'PC61');
  assert.equal(body.colores.length, 3);
  assert.ok(body.colores[0].fotos.frente);
});

test('GET /api/sanmar/style/:estilo/:color con precio de venta según la matriz de prendas', async () => {
  const { status, body } = await json('/sanmar/style/PC61/Navy');
  assert.equal(status, 200);
  assert.equal(body.modoMarkup, 'escalonado');
  const s = body.tallas.find((t) => t.talla === 'S');
  assert.equal(s.costo, 3.18);
  assert.equal(s.precioVenta, 7.0); // $3.18 < $5.00 → ×2.20
  assert.equal(body.tallas.find((t) => t.talla === '2XL').precioVenta, 10.24); // $5.12 ≥ $5.00 → ×2.00
  assert.equal(s.inventario, 300);
  assert.equal(s.almacenes.length, 3);
});

test('en modo fijo el precio de venta es costo × 2', async () => {
  const t = await api.get('/tarifas');
  const cfg = structuredClone(t.config);
  cfg.prendas.modo = 'fijo';
  await api.put('/tarifas', { config: cfg });
  const { body } = await json('/sanmar/style/PC61/Navy');
  assert.equal(body.tallas[0].precioVenta, 6.36);
  await api.put('/tarifas', { config: t.config });
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
  assert.equal((await api.call('GET', '/sanmar/image?u=' + encodeURIComponent(body.colores[0].fotos.frente))).status, 200);
  assert.equal((await api.call('GET', '/sanmar/image?u=' + encodeURIComponent('http://169.254.169.254/latest'))).status, 400);
});

test('importa el estilo al catálogo con el costo de la cuenta', async () => {
  const { body: p } = await json('/sanmar/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: 'pc61', category: 'Camisetas' }) });
  assert.equal(p.sku, 'PC61');
  assert.equal(p.supplier, 'SanMar');
  assert.equal(p.base_cost, 3.18);
  assert.deepEqual(p.colors, ['Jet Black', 'Navy', 'Athletic Heather']);
  assert.ok(Object.keys(p.size_costs).length > 0, 'guarda el costo por talla');
  for (const c of Object.values(p.size_costs)) assert.ok(c >= p.base_cost);
});

test('la contraseña nunca aparece en los logs del servidor', () => {
  assert.ok(!srv.salida().includes('ClaveDePrueba123'));
});
