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
