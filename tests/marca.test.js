// Logo y colores de la marca: solo la dueña, con validación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s, ventas;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
before(async () => { s = await startServer({ env: { SEED_DEMO: '0' } }); ventas = await s.userWithRole('ventas'); });
after(() => s.stop());

test('la dueña sube el logo y define colores; se ven en meta, login y portal', async () => {
  const b = await s.duena.post('/settings/logo', { file: PNG });
  assert.match(b.logo, /^\/uploads\/brand-logo-\d+\.png$/);
  await s.duena.put('/settings', { brand_primary: '#e30613', brand_sidebar: '#1a1a1a' });
  const meta = await s.duena.get('/meta');
  assert.equal(meta.brand.primary, '#e30613');
  assert.equal(meta.brand.sidebar, '#1a1a1a');
  const estado = await s.anon.get('/auth/estado');
  assert.equal(estado.marca.logo, b.logo, 'la pantalla de inicio de sesión también la ve');
  const q = await s.duena.post('/jobs', { title: 'x', items: [] });
  const portal = await s.anon.get(`/portal/${q.token}`);
  assert.equal(portal.brand.primary, '#e30613');
});

test('validación y permisos', async () => {
  assert.equal((await s.duena.call('PUT', '/settings', { brand_primary: 'rojo' })).status, 400);
  assert.equal((await ventas.call('POST', '/settings/logo', { file: PNG })).status, 403);
  assert.equal((await ventas.call('PUT', '/settings', { brand_primary: '#000000' })).status, 403);
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await s.duena.call('POST', '/settings/logo', { file: svg })).status, 400);
  assert.equal((await s.duena.call('POST', '/settings/logo', { file: 'data:text/html;base64,PGgxPg==' })).status, 400);
  const hist = await s.duena.get('/auditoria?area=ajustes');
  assert.ok(hist.some((h) => h.field === 'colores de marca'));
});
