// Producción externa: PO para el taller cuando el cliente aprobó, con costos de la matriz, enlace público y PDF.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let s, taller, orden, isabel, bryanUser, logi;
const pub = (ruta, opts) => fetch(`${s.B}${ruta}`, opts);

before(async () => {
  s = await startServer({ env: { SEED_DEMO: '0' } });
  const vend = await s.duena.get('/vendedores');
  isabel = await s.userWithRole('coordinacion');
  bryanUser = await s.userWithRole('ventas', vend.find((v) => v.name === 'Bryan').id);
  logi = await s.userWithRole('logistica');
  const c = await s.duena.post('/contacts', { name: 'Ana', company: 'Restaurante Secreto', email: 'ana@secreto.com' });
  const p = await s.duena.post('/products', { sku: 'K500', name: 'Polo', brand: 'Port Authority', supplier: 'SanMar', base_cost: 10, sizes: ['S', 'M', 'L'], colors: ['Navy'] });
  const q = await s.duena.post('/jobs', { title: 'Polos bordados', contact_id: c.id, due_date: '2027-01-20', items: [
    { product_id: p.id, color: 'Navy', sizes: { S: 4, M: 6 }, decorations: [{ process: 'bordado', location: 'Pecho izquierdo', width: 3.5, height: 3.5 }] },
    { line_type: 'diseno', description: 'Digitalizado de logo', qty: 1, unit_price: 50, unit_cost: 25 },
  ] });
  orden = q;
});
after(() => s.stop());

test('talleres: los crea quien manda a producción; quedan en el historial', async () => {
  assert.equal((await bryanUser.call('POST', '/talleres', { name: 'X' })).status, 403);
  assert.equal((await isabel.call('POST', '/talleres', { name: '' })).status, 400);
  taller = await isabel.post('/talleres', { name: 'Bordados El Rápido', contacto: 'Luis', phone: '301-555-0100', address: '12 Industrial Rd, Rockville MD 20850' });
  assert.equal(taller.active, 1);
  const t2 = await s.duena.put(`/talleres/${taller.id}`, { notas: 'Entrega en 5 días' });
  assert.equal(t2.notas, 'Entrega en 5 días');
  assert.ok((await s.duena.get('/auditoria?area=talleres')).length >= 2);
});

test('no se puede mandar a producción hasta que el cliente aprueba', async () => {
  // Todavía es cotización y no hay prueba
  let e = await s.duena.get(`/jobs/${orden.id}/po`);
  assert.equal(e.requisitos.ok, false);
  assert.equal((await s.duena.call('POST', `/jobs/${orden.id}/po`, { taller_id: taller.id })).status, 400);
  // Se convierte en orden y se envía la prueba, pero el cliente no la ha aprobado
  await s.duena.post(`/jobs/${orden.id}/convert`);
  const conPrueba = await s.duena.post(`/jobs/${orden.id}/proofs`, { file: PNG, filename: 'p.png' });
  e = await s.duena.get(`/jobs/${orden.id}/po`);
  assert.deepEqual(e.requisitos.lista.map((x) => x.ok), [true, false]);
  const r = await s.duena.call('POST', `/jobs/${orden.id}/po`, { taller_id: taller.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /todavía no aprueba/);
  // El cliente aprueba en su portal
  const prueba = conPrueba.proofs[0];
  const ap = await pub(`/portal/${conPrueba.token}/proofs/${prueba.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'aprobada' }) });
  assert.equal(ap.status, 200);
  e = await s.duena.get(`/jobs/${orden.id}/po`);
  assert.equal(e.requisitos.ok, true);
  assert.equal(e.previa.total, 10 * 4.5 + 25, 'vista previa con los costos de la matriz: bordado $4.50 × 10 + digitalizado $25');
});

test('PO: costos de la matriz, corregibles en borrador; al enviarlo la orden pasa a Producción', async () => {
  assert.equal((await bryanUser.call('POST', `/jobs/${orden.id}/po`, { taller_id: taller.id })).status, 404, 'un vendedor no manda (y esta orden no es suya)');
  const po = await isabel.post(`/jobs/${orden.id}/po`, { taller_id: taller.id, instrucciones: 'Hilo blanco. Empacar por talla.' });
  assert.match(po.numero, /^PO-\d+$/);
  assert.equal(po.status, 'borrador');
  assert.equal(po.fecha_entrega, '2027-01-20');
  assert.equal(po.lineas[0].decoraciones[0].costoUnitario, 4.5);
  assert.equal(po.total, 70);
  assert.deepEqual(po.listaCompra, [{ codigo: 'K500', descripcion: 'Polo', color: 'Navy', talla: 'S', cantidad: 4 }, { codigo: 'K500', descripcion: 'Polo', color: 'Navy', talla: 'M', cantidad: 6 }]);
  assert.equal(po.pruebas.length, 1);
  assert.equal((await isabel.call('POST', `/jobs/${orden.id}/po`, { taller_id: taller.id })).status, 400, 'un solo PO vigente por orden');
  // El enlace no funciona mientras es borrador
  assert.equal((await pub(`/portal/taller/${po.token}`)).status, 404);

  // Corrige el costo: el taller cobra $5 por pieza; un costo vacío no deja enviar
  const sinCosto = await isabel.put(`/po/${po.id}`, { lineas: [{ decoraciones: [{ costoUnitario: '' }] }, {}] });
  assert.equal(sinCosto.total, null, 'costo desconocido: el total queda sin definir, nunca $0');
  const bloqueado = await isabel.call('POST', `/po/${po.id}/enviar`);
  assert.equal(bloqueado.status, 400);
  assert.match(bloqueado.body.error, /Falta el costo/);
  const corregido = await isabel.put(`/po/${po.id}`, { lineas: [{ decoraciones: [{ costoUnitario: 5, colores: 'Blanco' }] }, {}] });
  assert.equal(corregido.total, 75);
  assert.equal(corregido.lineas[0].cantidad, 10, 'las cantidades no se cambian desde el PO');

  const enviado = await isabel.post(`/po/${po.id}/enviar`);
  assert.equal(enviado.status, 'enviado');
  assert.equal((await s.duena.get(`/jobs/${orden.id}`)).status, 'produccion');
  assert.equal((await isabel.call('PUT', `/po/${po.id}`, { instrucciones: 'otra' })).status, 400, 'enviado: ya no se edita');
  const lista = await s.duena.get('/jobs?kind=order');
  assert.deepEqual([lista[0].po_status, lista[0].po_taller], ['enviado', 'Bordados El Rápido']);
  orden.po = enviado;
});

test('el taller abre su enlace: ve instrucciones, artes y su pago, nunca al cliente ni los precios de venta', async () => {
  const r = await pub(`/portal/taller/${orden.po.token}`);
  assert.equal(r.status, 200);
  const texto = await r.text();
  const d = JSON.parse(texto);
  assert.equal(d.numero, orden.po.numero);
  assert.equal(d.instrucciones, 'Hilo blanco. Empacar por talla.');
  assert.equal(d.total, 75);
  assert.equal(d.pruebas.length, 1);
  for (const privado of ['Restaurante Secreto', 'ana@secreto.com', 'unit_price', '"token"', 'contribucion', 'comision']) assert.ok(!texto.includes(privado), `el taller no recibe ${privado}`);
  assert.equal((await pub('/portal/taller/noexiste')).status, 404);

  // PDF: público por token e interno con sesión
  const pdf = await pub(`/portal/taller/${orden.po.token}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await logi.call('GET', `/po/${orden.po.id}/pdf`)).status, 403);

  // El taller marca recibido y terminado; al terminar la orden pasa a Calidad y queda una tarea
  const marcar = (estado, nota) => pub(`/portal/taller/${orden.po.token}/estado`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado, nota }) }).then((x) => x.json());
  assert.equal((await marcar('recibido')).status, 'recibido');
  const fin = await marcar('terminado', 'Listo para recoger');
  assert.equal(fin.status, 'terminado');
  assert.equal((await s.duena.get(`/jobs/${orden.id}`)).status, 'calidad');
  assert.ok((await s.duena.get('/tasks')).some((t) => /el taller terminó/.test(t.title)));
  assert.equal((await marcar('recibido')).status, 'terminado', 'no retrocede');
  assert.equal((await isabel.call('POST', `/po/${orden.po.id}/cancelar`, { motivo: 'error' })).status, 400, 'terminado no se cancela');
});

test('Logística y Ventas ven el estado del PO sin lo que se le paga al taller', async () => {
  const l = await logi.get(`/jobs/${orden.id}/po`);
  assert.equal(l.po.status, 'terminado');
  assert.equal(l.po.total, undefined);
  assert.ok(l.po.lineas[0].decoraciones.every((d) => d.costoUnitario === undefined && d.total === undefined));
  assert.equal(l.puedeMandar, false);
  assert.equal((await logi.call('POST', `/po/${orden.po.id}/estado`, { estado: 'terminado' })).status, 403);
  assert.equal((await bryanUser.call('GET', `/jobs/${orden.id}/po`)).status, 404, 'orden ajena');
});
