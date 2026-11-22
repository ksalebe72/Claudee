// Pruebas del cliente services/sanmar contra el simulador (no contra SanMar real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './fixtures/sanmar-mock.js';
import { createSanmarClient, CODIGOS, MemoryCache } from '../services/sanmar/index.js';
import { parseXml, textOf } from '../services/sanmar/xml.js';

const PORT = 4700 + Math.floor(Math.random() * 90);
let mock;
const nuevo = (extra = {}) => createSanmarClient({
  baseUrl: `http://localhost:${PORT}`, customerNumber: '12345', username: 'test', password: 'SuperSecreta!',
  sleep: async () => {}, timeoutMs: 1000, ...extra,
});

before(async () => { mock = await startMock(PORT); });
after(() => mock.close());

test('buscarEstilo devuelve JSON limpio con colores, fotos y tallas', async () => {
  const p = await nuevo().buscarEstilo('pc61');
  assert.equal(p.estilo, 'PC61');
  assert.equal(p.marca, 'Port & Company');
  assert.equal(p.descripcion, 'Camiseta de algodón 6.1 oz.');
  assert.equal(p.peso, 0.42);
  assert.equal(p.colores.length, 3);
  assert.deepEqual(p.tallas, ['S', 'M', 'L', 'XL', '2XL', '3XL']);
  const c = p.colores[1];
  assert.deepEqual([c.nombre, c.codigo], ['Navy', 'NAVY']);
  assert.ok(c.swatch && c.fotos.frente && c.fotos.espalda && c.fotos.lado);
  assert.match(c.fotos.frente, /front\.svg$/, 'frente usa la foto plana');
  assert.equal(c.tallas.length, 6);
});

test('obtenerColores y obtenerFotos', async () => {
  const s = nuevo();
  assert.deepEqual((await s.obtenerColores('PC61')).map((c) => c.nombre), ['Jet Black', 'Navy', 'Athletic Heather']);
  const f = await s.obtenerFotos('PC61', 'navy');
  assert.ok(f.frente && f.espalda && f.lado && f.swatch);
  await assert.rejects(s.obtenerFotos('PC61', 'Morado'), (e) => e.codigo === CODIGOS.NO_ENCONTRADO);
});

test('obtenerTallasYPrecios usa el precio de la cuenta (myPrice)', async () => {
  const t = await nuevo().obtenerTallasYPrecios('PC61', 'Athletic Heather');
  assert.equal(t.length, 6);
  assert.deepEqual(t.map((x) => x.talla), ['S', 'M', 'L', 'XL', '2XL', '3XL']);
  assert.equal(t[0].costo, 3.18);
  assert.equal(t[0].fuenteCosto, 'myPrice');
  assert.equal(t[5].costo, 5.12);
});

test('obtenerInventario por almacén y total', async () => {
  const inv = await nuevo().obtenerInventario('PC61', 'Navy', 'M');
  assert.equal(inv.almacenes.length, 3);
  assert.equal(inv.almacenes[0].nombre, 'Seattle, WA');
  assert.equal(inv.total, 200 + 400 + 0);
});

test('obtenerDetalleColor junta tallas, costo e inventario', async () => {
  const d = await nuevo().obtenerDetalleColor('PC61', 'Jet Black');
  assert.equal(d.tallas.length, 6);
  assert.ok(d.tallas.every((t) => t.costo > 0 && t.inventario > 0));
  assert.equal(d.inventarioTotal, d.tallas.reduce((a, t) => a + t.inventario, 0));
});

test('caché: no repite llamadas dentro del TTL y sí al vencer', async () => {
  const cache = new MemoryCache();
  const s = nuevo({ cache });
  const antes = { ...mock.stats.llamadas };
  await s.buscarEstilo('PC61');
  await s.buscarEstilo('PC61');
  await Promise.all([s.obtenerInventario('PC61', 'Navy', 'L'), s.obtenerInventario('PC61', 'Navy', 'L')]);
  assert.equal(mock.stats.llamadas.producto - antes.producto, 1);
  assert.equal(mock.stats.llamadas.inventario - antes.inventario, 1);
  const corto = nuevo({ cache: new MemoryCache(), ttl: { inventario: -1 } });
  await corto.obtenerInventario('PC61', 'Navy', 'L');
  await corto.obtenerInventario('PC61', 'Navy', 'L');
  assert.equal(mock.stats.llamadas.inventario - antes.inventario, 3, 'con TTL vencido vuelve a consultar');
});

test('errores: credenciales inválidas, sin configurar y estilo inexistente', async () => {
  await assert.rejects(nuevo({ username: 'otro' }).buscarEstilo('PC61'), (e) => e.codigo === CODIGOS.CREDENCIALES && e.status === 502);
  await assert.rejects(createSanmarClient({ env: {} }).buscarEstilo('PC61'), (e) => e.codigo === CODIGOS.NO_CONFIGURADO);
  await assert.rejects(nuevo().buscarEstilo('NOEXISTE'), (e) => e.codigo === CODIGOS.NO_ENCONTRADO && e.status === 404);
});

test('errores: tiempo agotado y límite de la API (con reintentos)', async () => {
  const esperas = [];
  const s = nuevo({ timeoutMs: 300, reintentos: 1, sleep: async (ms) => esperas.push(ms) });
  await assert.rejects(s.buscarEstilo('LENTO'), (e) => e.codigo === CODIGOS.TIEMPO_AGOTADO && e.status === 504);
  await assert.rejects(s.buscarEstilo('LIMITE'), (e) => e.codigo === CODIGOS.LIMITE && e.status === 429);
  assert.equal(esperas.length, 2, 'reintentó una vez cada error recuperable');
});

test('reintenta si se corta la red y luego responde', async () => {
  const p = await nuevo({ reintentos: 2 }).buscarEstilo('INESTABLE');
  assert.equal(p.colores.length, 3);
});

test('no filtra la contraseña en mensajes de error', async () => {
  const fetchImpl = async () => new Response(`<Envelope><Body><Fault><faultstring>Bad password SuperSecreta! for user test</faultstring></Fault></Body></Envelope>`, { status: 500 });
  await assert.rejects(nuevo({ fetchImpl }).buscarEstilo('PC61'), (e) => !e.message.includes('SuperSecreta!') && !String(e.detalle).includes('SuperSecreta!'));
});

test('lector XML: namespaces, entidades, CDATA y nil', () => {
  const d = parseXml('<a:x xmlns:a="u"><a:y>Tom &amp; Jerry</a:y><z><![CDATA[<b>hola</b>]]></z><w xsi:nil="true"/></a:x>');
  assert.equal(textOf(d, 'y'), 'Tom & Jerry');
  assert.equal(textOf(d, 'z'), '<b>hola</b>');
  assert.equal(textOf(d, 'w'), null);
});
