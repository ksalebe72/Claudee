// Preparación para producción (Render): salud, código de instalación, respaldos, archivos en el disco y https.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './helpers.js';

const CODIGO = 'codigo-secreto-de-prueba-123';
let s, nuevo;

before(async () => {
  nuevo = await startServer({ skipSetup: true, env: { SETUP_CODE: CODIGO, SEED_DEMO: '0' } });
  s = await startServer({ env: { SETUP_CODE: CODIGO, SEED_DEMO: '0', BACKUP_DISABLED: '0', UPLOAD_DIR: '', BACKUP_DIR: '' } });
});
after(() => { s.stop(); nuevo.stop(); });

test('chequeo de salud público para Render', async () => {
  const r = await nuevo.anon.call('GET', '/salud');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('la cuenta de la dueña solo se crea con el código de instalación', async () => {
  const estado = await nuevo.anon.get('/auth/estado');
  assert.equal(estado.necesitaConfiguracion, true);
  assert.equal(estado.requiereCodigo, true);
  const datos = { name: 'Intruso', username: 'intruso', password: 'ClaveLarga123' };
  assert.equal((await nuevo.anon.call('POST', '/auth/configurar', datos)).status, 403);
  assert.equal((await nuevo.anon.call('POST', '/auth/configurar', { ...datos, codigo: 'otro' })).status, 403);
  const ok = await nuevo.anon.call('POST', '/auth/configurar', { name: 'Dueña', username: 'duena', password: 'ClaveLarga123', codigo: CODIGO });
  assert.equal(ok.status, 200);
  assert.equal((await nuevo.anon.call('POST', '/auth/configurar', { ...datos, codigo: CODIGO })).status, 400, 'después ya no se puede');
});

test('respaldo automático al arrancar, respaldo manual y descarga (solo la dueña)', async () => {
  const lista = await s.duena.get('/respaldos');
  assert.equal(lista.length, 1, 'se crea uno al arrancar');
  const manual = await s.duena.post('/respaldos');
  assert.match(manual.nombre, /^colorplus-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
  const r = await s.duena.call('GET', `/respaldos/${manual.nombre}`);
  assert.equal(r.status, 200);
  assert.equal(new TextDecoder().decode(r.body.slice(0, 15)), 'SQLite format 3', 'es una base SQLite válida');
  const ventas = await s.userWithRole('ventas');
  assert.equal((await ventas.call('GET', '/respaldos')).status, 403);
  assert.equal((await s.duena.call('GET', '/respaldos/..%2F..%2Fetc%2Fpasswd')).status, 404, 'no permite salir de la carpeta');
  assert.ok(existsSync(join(s.dir, 'respaldos')));
});

test('detrás del proxy de Render (https) la cookie de sesión es segura', async () => {
  const entrar = (headers = {}) => fetch(`${s.B}/auth/entrar`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username: 'duena', password: 'ClaveDuena123' }) });
  const conHttps = (await entrar({ 'x-forwarded-proto': 'https' })).headers.get('set-cookie');
  assert.match(conHttps, /;\s*Secure/i);
  assert.match(conHttps, /HttpOnly/i);
  const sinHttps = (await entrar()).headers.get('set-cookie');
  assert.doesNotMatch(sinHttps, /;\s*Secure/i, 'en local (http) no se marca Secure');
});

test('los archivos subidos van a UPLOAD_DIR', async () => {
  const dir = join(s.dir, 'archivos');
  const s2 = await startServer({ env: { SEED_DEMO: '0', UPLOAD_DIR: dir } });
  try {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const b = await s2.duena.post('/settings/logo', { file: png });
    const archivo = b.logo.replace('/uploads/', '');
    assert.ok(readdirSync(dir).includes(archivo));
    const r = await fetch(s2.B.replace('/api', '') + b.logo);
    assert.equal(r.status, 200);
    assert.ok(readFileSync(join(dir, archivo)).length > 0);
  } finally { s2.stop(); }
});

test('una base con tarifas anteriores pasa a «aplicación DTF una vez por prenda» con historial, sin tocar la versión vieja', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const carpeta = mkdtempSync(join(tmpdir(), 'colorplus-mig-'));
  const DB_PATH = join(carpeta, 'vieja.db');
  try {
    const a = await startServer({ env: { SEED_DEMO: '0', DB_PATH } });
    a.stop();
    await new Promise((r) => setTimeout(r, 300));
    // Simula una base creada antes de la opción: la última versión no tiene «aplicacionPor»
    const db = new DatabaseSync(DB_PATH);
    const v = db.prepare('SELECT config FROM pricing_versions ORDER BY id DESC LIMIT 1').get();
    const cfg = JSON.parse(v.config);
    delete cfg.dtf.aplicacionPor;
    delete cfg.dtf.costoModo;
    delete cfg.dtf.hoja;
    delete cfg.dtf.tamanos;
    // tabla de precios original (con el salto a $25)
    cfg.dtf.primera = [{ hasta: 15, precio: 6 }, { hasta: 95, precio: 10.5 }, { hasta: 105, precio: 11.5 }, { hasta: null, precio: 25 }];
    cfg.dtf.adicional = [{ hasta: 15, precio: 1 }, { hasta: 95, precio: 5.5 }, { hasta: null, precio: 25 }];
    cfg.bordado.filas = [{ puntadasHasta: null, cantidadDesde: 1, costo: 4.5, precio: 6 }];
    db.prepare("INSERT INTO pricing_versions (config, note, created_by) VALUES (?, 'antigua', 'sistema')").run(JSON.stringify(cfg));
    const vieja = Number(db.prepare('SELECT max(id) AS id FROM pricing_versions').get().id);
    db.close();

    const b = await startServer({ skipSetup: true, env: { SEED_DEMO: '0', DB_PATH } });
    try {
      const entrar = await fetch(`${b.B}/auth/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'duena', password: 'ClaveDuena123' }) });
      const cookie = entrar.headers.get('set-cookie').split(';')[0];
      const get = async (u) => (await fetch(b.B + u, { headers: { cookie } })).json();
      const actual = await get('/tarifas');
      assert.equal(actual.config.dtf.aplicacionPor, 'prenda');
      assert.ok(actual.id > vieja);
      assert.equal(actual.config.dtf.costoModo, 'hoja');
      assert.deepEqual(actual.config.bordado.filas, [{ puntadasHasta: null, cantidadDesde: 1, costo: 4.5, precio: 7.5 }], 'bordado a $7.50');
      assert.equal(actual.config.dtf.primera.find((f) => f.hasta === 144).precio, 13, 'sin el salto a $25');
      assert.ok(!actual.config.dtf.primera.some((f) => f.precio === 25) && !actual.config.dtf.adicional.some((f) => f.precio === 25));
      assert.deepEqual(actual.config.dtf.hoja, { ancho: 12, alto: 12, costo: 4, aprovechamiento: 1 });
      assert.ok(actual.config.dtf.tamanos.some((t) => t.ubicacion === 'Espalda' && t.ancho === 9.5 && t.alto === 12));
      const v = (await get(`/tarifas/${vieja}`)).config.dtf;
      assert.equal(v.aplicacionPor, 'ubicacion', 'la versión vieja conserva su cálculo');
      assert.equal(v.costoModo, 'area', 'la versión vieja conserva su cálculo');
      const hist = await get('/auditoria?area=tarifas');
      assert.ok(hist.some((h) => h.field === 'dtf.aplicacionPor' && JSON.parse(h.new_value) === 'prenda'));
    } finally { b.stop(); }
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});

test('el ajuste a meta de una línea se guarda y se recalcula en el servidor', async () => {
  const prod = await s.duena.post('/products', { sku: 'AJ1', name: 'Tee ajuste', base_cost: 4, sizes: ['M'], colors: ['Negro'] });
  const q = await s.duena.post('/jobs', { title: 'Ajuste', items: [{ product_id: prod.id, sizes: { M: 10 }, ajuste_pct: 0.25, decorations: [{ process: 'bordado', location: 'Pecho izquierdo' }] }] });
  assert.equal(q.items[0].ajuste_pct, 0.25);
  assert.equal(q.items[0].calc.prenda.tallas[0].precio, 11, '$8.80 + 25%');
  assert.equal(q.items[0].calc.decoraciones[0].precioPieza, 9.38, 'bordado $7.50 + 25%');
});

test('Bryan queda en 40% de la utilidad en todo (también wraps) desde el día del cambio; las reglas de 25% y 50% se desactivan', async () => {
  const reglas = await s.duena.get('/comisiones/reglas');
  const nueva = reglas.find((r) => r.name === 'Bryan · Utilidad 40%');
  assert.ok(nueva?.active, 'regla nueva activa');
  assert.equal(nueva.base, 'ganancia_producto');
  assert.equal(nueva.tasas[0].rate, 0.4);
  assert.match(nueva.tasas[0].effective_from, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(reglas.find((r) => r.name === 'Bryan · Ventas').active, 0, 'la de 25% ya no se sugiere');
  assert.equal(reglas.find((r) => r.name === 'Bryan · Wraps').active, 0, 'wraps también pasa al 40%');
  assert.deepEqual(reglas.filter((r) => r.salesperson_name === 'Bryan' && r.active).map((r) => r.name), ['Bryan · Utilidad 40%'], 'una sola regla activa para Bryan');
  assert.equal(reglas.filter((r) => r.name === 'Bryan · Utilidad 40%').length, 1, 'se crea una sola vez');
  const hist = await s.duena.get('/auditoria?area=comisiones');
  assert.ok(hist.some((h) => h.field === 'regla Bryan · Utilidad 40%'));

  // Orden de Bryan: comisión = 40% de la ganancia de producto
  const bryan = (await s.duena.get('/vendedores')).find((v) => v.name === 'Bryan');
  const prod = await s.duena.post('/products', { sku: 'BR40', name: 'Tee Bryan', base_cost: 4, sizes: ['M'], colors: ['Negro'] });
  const q = await s.duena.post('/jobs', { title: 'Bryan 40', salesperson_id: bryan.id, commission_rule_id: nueva.id, items: [{ product_id: prod.id, sizes: { M: 10 } }] });
  // venta 10 × $8.80 = $88 · costo $40 · ganancia $48 → comisión $19.20
  assert.equal(q.finanzas.comision.base, 48);
  assert.equal(q.finanzas.comision.monto, 19.2);
});

test('la regla automática del perfil del vendedor se pone sola en las órdenes (Bryan → Utilidad 40%)', async () => {
  const reglas = await s.duena.get('/comisiones/reglas');
  const id = (n) => reglas.find((r) => r.name === n).id;
  const vend = await s.duena.get('/vendedores');
  const bryan = vend.find((v) => v.name === 'Bryan');
  const isabel = vend.find((v) => v.name === 'Isabel');
  assert.equal(bryan.default_rule_id, id('Bryan · Utilidad 40%'), 'queda en el perfil de Bryan');

  const nueva = await s.duena.post('/jobs', { title: 'Auto', salesperson_id: bryan.id, items: [] });
  assert.equal(nueva.commission_rule_id, id('Bryan · Utilidad 40%'), 'al crear');
  const sinVend = await s.duena.post('/jobs', { title: 'Sin vendedor', items: [] });
  const cambio = await s.duena.put(`/jobs/${sinVend.id}`, { salesperson_id: bryan.id });
  assert.equal(cambio.commission_rule_id, id('Bryan · Utilidad 40%'), 'al asignar el vendedor después');
  const elegida = await s.duena.post('/jobs', { title: 'Elegida', salesperson_id: bryan.id, commission_rule_id: id('Sin comisión'), items: [] });
  assert.equal(elegida.commission_rule_id, id('Sin comisión'), 'si se elige otra a mano, se respeta');

  // La dueña puede cambiar la regla automática; no puede poner la regla de otro vendedor
  assert.equal((await s.duena.put(`/vendedores/${isabel.id}`, { default_rule_id: id('Isabel · Cliente nuevo') })).default_rule_id, id('Isabel · Cliente nuevo'));
  assert.equal((await s.duena.call('PUT', `/vendedores/${isabel.id}`, { default_rule_id: id('Bryan · Utilidad 40%') })).status, 400);
  const ventas = await s.userWithRole('ventas');
  assert.equal((await ventas.call('PUT', `/vendedores/${isabel.id}`, { default_rule_id: null })).status, 403);
});
